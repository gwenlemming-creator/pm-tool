import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAk00nBbaK5qWUp-lxQxkfjzK5vCsqZwqQ",
  authDomain: "pm-command-center-e7c76.firebaseapp.com",
  databaseURL: "https://pm-command-center-e7c76-default-rtdb.firebaseio.com",
  projectId: "pm-command-center-e7c76",
  storageBucket: "pm-command-center-e7c76.firebasestorage.app",
  messagingSenderId: "308933010289",
  appId: "1:308933010289:web:70178897117a28fc1c4cd0",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getDatabase(app);
