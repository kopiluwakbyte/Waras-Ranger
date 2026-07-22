import { useState, useEffect, useRef } from 'react';
import { signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { collection, addDoc, doc, onSnapshot, serverTimestamp, query, where, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';
import Papa from 'papaparse';
import { LogOut, UploadCloud, Calendar, Clock, Image as ImageIcon, Send, FileText, CheckCircle2, AlertCircle, Smartphone, Type, Activity, Trash2, XCircle } from 'lucide-react';
import QRCode from 'react-qr-code';
import toast from 'react-hot-toast';

export default function Dashboard({ user }) {
  const [waStatus, setWaStatus] = useState('loading');
  const [waQr, setWaQr] = useState(null);
  
  // Contacts
  const [inputMode, setInputMode] = useState('csv'); // 'csv' or 'text'
  const [csvFile, setCsvFile] = useState(null);
  const [textContacts, setTextContacts] = useState('');
  const [contacts, setContacts] = useState([]);
  
  // Message data
  const [messageText, setMessageText] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imageBase64, setImageBase64] = useState(null);
  
  // Timing
  const [delay, setDelay] = useState(1); // Delay in minutes now
  const [startTime, setStartTime] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  
  // Progress
  const [activeSchedules, setActiveSchedules] = useState([]);

  const fileInputRef = useRef();
  const imageInputRef = useRef();

  // Initialize Default Time (Current Time + 5 Minutes)
  useEffect(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    
    // Format to YYYY-MM-DDThh:mm
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    setStartTime(`${year}-${month}-${day}T${hours}:${minutes}`);
  }, []);

  // Listen to WA Status and Active Schedules from backend
  useEffect(() => {
    const unsubStatus = onSnapshot(doc(db, 'system', 'wa_status'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setWaStatus(data.status);
        setWaQr(data.qr);
      } else {
        setWaStatus('disconnected');
      }
    });

    // Listen to user's schedules (remove orderBy to prevent index errors, sort in memory instead)
    const q = query(
      collection(db, 'schedules'), 
      where('createdBy', '==', user.email)
    );

    const unsubSchedules = onSnapshot(q, (snapshot) => {
      const scheds = [];
      snapshot.forEach(doc => {
        scheds.push({ id: doc.id, ...doc.data() });
      });
      // Sort in memory by createdAt descending
      scheds.sort((a, b) => {
        const timeA = a.createdAt?.toMillis() || 0;
        const timeB = b.createdAt?.toMillis() || 0;
        return timeB - timeA;
      });
      setActiveSchedules(scheds);
    }, (error) => {
      console.error("Error fetching schedules: ", error);
      if (error.message.includes('requires an index')) {
        toast.error("Database requires an index! Check browser console for the link to create it.", { duration: 10000 });
      }
    });

    return () => {
      unsubStatus();
      unsubSchedules();
    };
  }, [user.email]);

  const handleLogout = () => signOut(auth);

  // Parse Free Text Contacts
  useEffect(() => {
    if (inputMode === 'text') {
      const list = textContacts.split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('0') && line.length >= 10);
      setContacts(list);
    }
  }, [textContacts, inputMode]);

  const handleCsvUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setCsvFile(file);
      Papa.parse(file, {
        complete: (results) => {
          const extracted = [];
          results.data.forEach(row => {
            const val = Object.values(row)[0];
            if (val && typeof val === 'string' && val.trim().startsWith('0') && val.length >= 10) {
              extracted.push(val.trim());
            }
          });
          setContacts(extracted);
          toast.success(`Found ${extracted.length} valid contacts!`);
        },
        header: true,
        skipEmptyLines: true,
      });
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImageFile(file);
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const MAX_DIM = 1024;
        if (width > height && width > MAX_DIM) {
          height *= MAX_DIM / width;
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width *= MAX_DIM / height;
          height = MAX_DIM;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const base64 = canvas.toDataURL('image/jpeg', 0.6);
        setImageBase64(base64);
        toast.success("Image attached!");
      };
    };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (contacts.length === 0) {
      toast.error('Please provide valid contacts (starting with 0).');
      return;
    }
    if (!startTime) {
      toast.error('Please set a start time.');
      return;
    }

    setSubmitting(true);
    try {
      const localDate = new Date(startTime);
      
      await addDoc(collection(db, 'schedules'), {
        contacts,
        messageText,
        imageBase64,
        delay: Number(delay), // delay is now in MINUTEs
        startTime: localDate,
        status: 'pending',
        successCount: 0,
        failCount: 0,
        totalContacts: contacts.length,
        createdAt: serverTimestamp(),
        createdBy: user.email
      });

      toast.success('Schedule created successfully!');
      
      // Reset form
      if (inputMode === 'csv') setCsvFile(null);
      else setTextContacts('');
      setContacts([]);
      setMessageText('');
      setImageFile(null);
      setImageBase64(null);
      
    } catch (error) {
      console.error(error);
      toast.error('Failed to create schedule.');
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate Estimated Completion Time
  const calculateEstimate = () => {
    if (!startTime || contacts.length === 0 || !delay) return "-";
    const start = new Date(startTime).getTime();
    // Total duration = (contacts - 1) * delay * 60000 ms
    const duration = (contacts.length - 1) * Number(delay) * 60 * 1000;
    const end = new Date(start + duration);
    
    // Format Output (HH:MM DD/MM/YYYY)
    const h = String(end.getHours()).padStart(2, '0');
    const m = String(end.getMinutes()).padStart(2, '0');
    const d = String(end.getDate()).padStart(2, '0');
    const mo = String(end.getMonth() + 1).padStart(2, '0');
    const y = end.getFullYear();
    return `${d}/${mo}/${y} at ${h}:${m}`;
  };

  const handleConnect = async () => {
    toast.success('Sending connect signal...');
    try {
      await setDoc(doc(db, 'system', 'wa_command'), {
        action: 'restart',
        timestamp: serverTimestamp()
      });
    } catch (err) {
      toast.error('Failed to send connect signal.');
    }
  };

  const handleCancelSchedule = async (id) => {
    if (window.confirm('Are you sure you want to stop this schedule?')) {
      try {
        await updateDoc(doc(db, 'schedules', id), { status: 'cancelled' });
        toast.success('Schedule cancelled!');
      } catch (err) {
        toast.error('Failed to cancel schedule.');
      }
    }
  };

  const handleDeleteSchedule = async (id) => {
    if (window.confirm('Are you sure you want to delete this history?')) {
      try {
        await deleteDoc(doc(db, 'schedules', id));
        toast.success('History deleted!');
      } catch (err) {
        toast.error('Failed to delete history.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <nav className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-orange-500 via-red-500 to-blue-600 mr-2 font-extrabold">RANGER+</span>
            WARAS
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <span className="text-sm font-medium text-slate-500 hidden sm:block">{user.email}</span>
          <button onClick={handleLogout} className="flex items-center gap-2 text-slate-500 hover:text-red-500 transition-colors font-medium">
            <LogOut className="w-5 h-5" />
            <span className="hidden sm:block">Logout</span>
          </button>
        </div>
      </nav>

      <main className="flex-1 p-6 md:p-10 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column */}
        <div className="lg:col-span-4 space-y-6">
          <div className="glass-card p-6 bg-white border border-slate-200 shadow-sm">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <Smartphone className="text-primary w-5 h-5" />
              Whatsapp Status
            </h2>
            
            <div className="flex items-center gap-3 mb-6 p-4 rounded-xl bg-slate-50 border border-slate-100">
              {waStatus === 'ready' ? (
                <CheckCircle2 className="text-emerald-500 w-8 h-8" />
              ) : waStatus === 'waiting_for_scan' ? (
                <AlertCircle className="text-amber-500 w-8 h-8 animate-pulse" />
              ) : (
                <AlertCircle className="text-red-500 w-8 h-8" />
              )}
              
              <div>
                <p className="font-semibold text-slate-800 capitalize">{waStatus.replace(/_/g, ' ')}</p>
                {waStatus === 'ready' && <p className="text-xs text-slate-500">Ready to blast</p>}
              </div>
            </div>

            {waStatus === 'disconnected' && (
              <button 
                onClick={handleConnect}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white font-bold rounded-xl flex justify-center items-center gap-2 transition-colors shadow-sm"
              >
                <Smartphone className="w-5 h-5" /> Connect
              </button>
            )}

            {waStatus === 'waiting_for_scan' && waQr && (
              <div className="text-center p-4 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">
                <p className="text-sm text-slate-600 mb-4 font-medium">Scan QR below with WhatsApp</p>
                <div className="w-48 h-48 mx-auto bg-white p-2 rounded shadow-sm flex items-center justify-center border">
                  <QRCode value={waQr} size={175} />
                </div>
              </div>
            )}
          </div>

          {/* Progress Tracker */}
          <div className="glass-card p-6 bg-white border border-slate-200 shadow-sm max-h-[500px] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2 mb-4">
              <Activity className="text-primary w-5 h-5" />
              Recent Schedules
            </h2>
            {activeSchedules.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No schedules yet.</p>
            ) : (
              <div className="space-y-4">
                {activeSchedules.map(sched => {
                  const total = sched.totalContacts || sched.contacts?.length || 0;
                  const done = (sched.successCount || 0) + (sched.failCount || 0);
                  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
                  
                  // Format Time manually to guarantee 24h format regardless of browser locale
                  const sTime = sched.startTime?.toDate();
                  const timeString = sTime ? `${String(sTime.getHours()).padStart(2, '0')}:${String(sTime.getMinutes()).padStart(2, '0')}` : '';
                  const d = sTime ? String(sTime.getDate()).padStart(2, '0') : '';
                  const mo = sTime ? String(sTime.getMonth() + 1).padStart(2, '0') : '';
                  const y = sTime ? sTime.getFullYear() : '';
                  const dateString = sTime ? `${d}/${mo}/${y}` : '';
                  
                  return (
                    <div key={sched.id} className="p-3 rounded-lg border border-slate-100 bg-slate-50 relative group">
                      
                      {/* Action Buttons */}
                      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        {(sched.status === 'pending' || sched.status === 'running') ? (
                          <button onClick={() => handleCancelSchedule(sched.id)} className="p-1.5 bg-red-100 text-red-600 rounded hover:bg-red-200" title="Stop Schedule">
                            <XCircle className="w-4 h-4" />
                          </button>
                        ) : (
                          <button onClick={() => handleDeleteSchedule(sched.id)} className="p-1.5 bg-slate-200 text-slate-600 rounded hover:bg-slate-300" title="Delete History">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mb-2 pr-12">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          sched.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 
                          sched.status === 'running' ? 'bg-primary/20 text-primary' : 
                          sched.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                          'bg-slate-200 text-slate-700'}`}>
                          {sched.status.toUpperCase()}
                        </span>
                        <span className="text-[11px] text-slate-500 font-medium">
                          {dateString} {timeString}
                        </span>
                      </div>
                      
                      <p className="text-xs text-slate-700 font-medium mb-3 line-clamp-1 pr-8" title={sched.messageText}>
                        "{sched.messageText || 'No text'}"
                      </p>
                      
                      {/* Progress Bar */}
                      <div className="flex justify-between items-end mb-1">
                        <span className="text-[10px] text-slate-500 font-medium">{done} / {total} Sent</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-1.5 mb-2 overflow-hidden">
                        <div className={`h-1.5 rounded-full ${sched.status === 'completed' ? 'bg-emerald-500' : sched.status === 'cancelled' ? 'bg-red-500' : 'bg-primary transition-all duration-500'}`} style={{ width: `${percent}%` }}></div>
                      </div>
                      
                      <div className="flex justify-between text-[10px] text-slate-500">
                        <span>Success: <b className="text-emerald-600">{sched.successCount || 0}</b></span>
                        <span>Failed: <b className="text-red-500">{sched.failCount || 0}</b></span>
                      </div>
                      
                      {sched.failedNumbers && sched.failedNumbers.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-200">
                          <p className="text-[10px] font-bold text-red-500 mb-1">Failed Numbers:</p>
                          <div className="text-[10px] text-slate-600 max-h-16 overflow-y-auto bg-white p-1 rounded border border-slate-100">
                            {sched.failedNumbers.join(', ')}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-8">
          <div className="glass-card p-6 md:p-8 bg-white border border-slate-200 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">Create New Schedule</h2>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              
              {/* Contact Input Mode Switcher */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-slate-700">Target Contacts</label>
                  <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                      type="button" 
                      onClick={() => setInputMode('csv')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${inputMode === 'csv' ? 'bg-white text-primary shadow' : 'text-slate-500 hover:text-slate-700'}`}
                    >Upload CSV</button>
                    <button 
                      type="button" 
                      onClick={() => setInputMode('text')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${inputMode === 'text' ? 'bg-white text-primary shadow' : 'text-slate-500 hover:text-slate-700'}`}
                    >Text List</button>
                  </div>
                </div>

                {inputMode === 'csv' ? (
                  <div 
                    className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${csvFile ? 'border-primary bg-primary/5' : 'border-slate-300 hover:border-primary hover:bg-slate-50'}`}
                    onClick={() => fileInputRef.current.click()}
                  >
                    <input type="file" accept=".csv" ref={fileInputRef} className="hidden" onChange={handleCsvUpload} />
                    {csvFile ? (
                      <>
                        <FileText className="w-8 h-8 text-primary mb-2" />
                        <p className="font-medium text-slate-800">{csvFile.name}</p>
                        <p className="text-xs text-primary font-bold mt-1">{contacts.length} Valid Contacts</p>
                      </>
                    ) : (
                      <>
                        <UploadCloud className="w-8 h-8 text-slate-400 mb-2" />
                        <p className="text-sm font-medium text-slate-700">Click to upload CSV file</p>
                        <p className="text-xs text-slate-500 mt-1">First column must contain phone numbers (starts with 0)</p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="relative">
                    <Type className="absolute top-3 left-4 text-slate-400 w-5 h-5" />
                    <textarea 
                      className="input-field pl-12 min-h-[120px]"
                      placeholder="081234567890&#10;089876543210&#10;..."
                      value={textContacts}
                      onChange={(e) => setTextContacts(e.target.value)}
                    ></textarea>
                    <p className="text-xs text-slate-500 mt-2 text-right">
                      {contacts.length} valid numbers detected
                    </p>
                  </div>
                )}
              </div>

              {/* Message Content */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Message Text</label>
                <textarea 
                  className="input-field min-h-[120px] resize-y"
                  placeholder="Selamat Kak Anda mendapatkan gratis 10 piring cantik!"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                ></textarea>
              </div>

              {/* Image Upload */}
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-700">Attach Image (Optional)</label>
                <div className="flex items-center gap-4">
                  <input type="file" accept="image/*" ref={imageInputRef} className="hidden" onChange={handleImageUpload} />
                  <button 
                    type="button" 
                    onClick={() => imageInputRef.current.click()}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg flex items-center gap-2 transition-colors border border-slate-200"
                  >
                    <ImageIcon className="w-4 h-4" />
                    {imageFile ? 'Change Image' : 'Select Image'}
                  </button>
                  {imageFile && <span className="text-sm text-primary font-medium flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Ready</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50 p-4 rounded-xl border border-slate-200">
                {/* Delay */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Clock className="w-4 h-4" /> Delay Between Msgs (Minutes)
                  </label>
                  <input 
                    type="number" 
                    min="1" 
                    className="input-field bg-white"
                    value={delay}
                    onChange={(e) => setDelay(e.target.value)}
                  />
                </div>

                {/* Start Time */}
                <div className="space-y-2">
                  <label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> Start Time (24H Format)
                  </label>
                  <input 
                    type="datetime-local" 
                    className="input-field bg-white"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>

                <div className="md:col-span-2 border-t border-slate-200 pt-3 mt-1 flex justify-between items-center">
                  <span className="text-sm text-slate-500 font-medium">Estimated Completion Time:</span>
                  <span className="text-sm font-bold text-primary px-3 py-1 bg-primary/10 rounded-lg">
                    {calculateEstimate()}
                  </span>
                </div>
              </div>

              <button 
                type="submit" 
                disabled={submitting || contacts.length === 0 || !startTime || !messageText.trim()}
                className="btn-primary w-full py-4 text-lg mt-4 flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Calendar className="w-5 h-5" />
                    Schedule Blast to {contacts.length > 0 ? `${contacts.length} Contacts` : 'Contacts'}
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
