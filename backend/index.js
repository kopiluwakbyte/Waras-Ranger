import fs from 'fs';
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg;
import admin from 'firebase-admin';
import cron from 'node-cron';
import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

// Create Web Server for Render / Cron-job.org
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.json({ status: 'WARAS Bot is Running!', isReady: typeof isReady !== 'undefined' ? isReady : false });
});

app.listen(PORT, () => {
    console.log(`Web server running on port ${PORT} (Used for cron-job.org ping)`);
});

// Initialize Firebase Admin
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('Firebase credentials loaded from Environment Variable.');
} else {
    serviceAccount = JSON.parse(fs.readFileSync('./serviceAccountKey.json', 'utf8'));
    console.log('Firebase credentials loaded from local file.');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Helper to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

console.log('Starting WhatsApp Client...');

// Initialize WhatsApp Client with LocalAuth to persist session
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--single-process']
    }
});

let isReady = false;

client.on('qr', async (qr) => {
    console.log('Scan the QR code below to login:');
    qrcode.generate(qr, { small: true });
    
    // Save QR to Firestore so frontend could potentially show it
    await db.collection('system').doc('wa_status').set({
        status: 'waiting_for_scan',
        qr: qr,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
});

client.on('ready', async () => {
    console.log('WhatsApp Client is ready!');
    isReady = true;
    
    await db.collection('system').doc('wa_status').set({
        status: 'ready',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
});

client.on('disconnected', async (reason) => {
    console.log('WhatsApp Client disconnected:', reason);
    isReady = false;
    await db.collection('system').doc('wa_status').set({
        status: 'disconnected',
        qr: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
});

client.initialize();

// Listener for remote commands from the dashboard
db.collection('system').doc('wa_command').onSnapshot(async (doc) => {
    if (doc.exists) {
        const data = doc.data();
        if (data.action === 'restart') {
            console.log('Received remote RESTART command from dashboard. Exiting process...');
            try {
                // Clear the command so it doesn't trigger again on actual restart
                await doc.ref.delete();
                
                // In production/Render/PM2, exiting the process is the cleanest and most 
                // robust way to handle a complete restart without leaving zombie Puppeteer instances.
                console.log('Exiting... Process manager (like Render or PM2) will auto-restart this.');
                process.exit(1);
            } catch (err) {
                console.error('Failed to handle restart command:', err);
                process.exit(1);
            }
        }
    }
});

// Setup Cron Job to check for schedules every minute
cron.schedule('* * * * *', async () => {
    if (!isReady) {
        console.log('Cron: WA Client not ready, skipping.');
        return;
    }

    console.log('Cron: Checking for pending schedules...');
    try {
        const now = admin.firestore.Timestamp.now();
        const schedulesRef = db.collection('schedules');
        
        // Find schedules that are 'pending' and their startTime is <= now
        const snapshot = await schedulesRef
            .where('status', '==', 'pending')
            .where('startTime', '<=', now)
            .get();

        if (snapshot.empty) {
            return;
        }

        for (const doc of snapshot.docs) {
            const schedule = doc.data();
            console.log(`Cron: Processing schedule ${doc.id}`);
            
            // Mark as running
            await doc.ref.update({ status: 'running' });

            const contacts = schedule.contacts || [];
            const delayMinutes = schedule.delay || 1;
            const messageText = schedule.messageText || '';
            const imageBase64 = schedule.imageBase64 || null;

            let successCount = 0;
            let failCount = 0;
            
            console.log(`Cron: Processing schedule ${doc.id} with ${contacts.length} contacts.`);

            for (let i = 0; i < contacts.length; i++) {
                // Before sending, check if schedule was cancelled by the user
                const currentDoc = await doc.ref.get();
                if (currentDoc.exists && currentDoc.data().status === 'cancelled') {
                    console.log(`[${doc.id}] Schedule was cancelled by user. Stopping.`);
                    break;
                }

                let number = contacts[i];
                
                // Format number to WA ID format (e.g., 62812xxx@c.us)
                number = number.replace(/[^0-9]/g, ''); // Remove non-numeric
                if (number.startsWith('0')) {
                    number = '62' + number.substring(1); // Assume Indonesia for numbers starting with 0
                }
                const chatId = `${number}@c.us`;

                try {
                    if (imageBase64) {
                        // Ensure proper base64 format and mime type, assume image/jpeg if not present
                        let mediaData = imageBase64;
                        let mimetype = 'image/jpeg';
                        
                        if(imageBase64.includes('data:image')){
                            const parts = imageBase64.split(';');
                            mimetype = parts[0].split(':')[1];
                            mediaData = parts[1].split(',')[1];
                        }
                        
                        const media = new MessageMedia(mimetype, mediaData, 'image');
                        await client.sendMessage(chatId, media, { caption: messageText });
                    } else {
                        await client.sendMessage(chatId, messageText);
                    }
                    console.log(`[${doc.id}] Sent to ${number}`);
                    successCount++;
                } catch (err) {
                    console.error(`[${doc.id}] Failed to send to ${number}:`, err.message);
                    failCount++;
                    // Record failed number
                    await doc.ref.update({
                      failedNumbers: admin.firestore.FieldValue.arrayUnion(number)
                    });
                }
                
                // Update progress in Firestore in real-time
                await doc.ref.update({ successCount, failCount });

                // Wait before sending next message (unless it's the last one)
                if (i < contacts.length - 1) {
                    console.log(`[${doc.id}] Waiting for ${delayMinutes} minutes...`);
                    await delay(delayMinutes * 60 * 1000);
                }
            }
            
            // Check final status before marking completed
            const finalDoc = await doc.ref.get();
            if (finalDoc.exists && finalDoc.data().status !== 'cancelled') {
              // Mark as completed
              await doc.ref.update({ 
                  status: 'completed',
                  successCount,
                  failCount,
                  completedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              console.log(`Cron: Schedule ${doc.id} completed.`);
            }
        }

    } catch (err) {
        console.error('Cron Error:', err);
    }
});

console.log('Backend initialized. Waiting for events...');
