import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCM3ItpFbkdFi8EyA0SsQjAsXODStseC14",
  authDomain: "wa-scheduler-b7da8.firebaseapp.com",
  projectId: "wa-scheduler-b7da8",
  storageBucket: "wa-scheduler-b7da8.firebasestorage.app",
  messagingSenderId: "730019626920",
  appId: "1:730019626920:web:1991ee560758f610ec679d",
  measurementId: "G-RVLGD5BVV1"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
