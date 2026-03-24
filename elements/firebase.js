import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";
import {
  getDatabase,
  ref,
  get,
  set,
  update,
  push,
  onChildAdded,
  query,
  orderByChild,
  limitToLast,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAfTBbqjdoGuEH6WqV1ma2L_tEaaScTEzU",
  authDomain: "edu-kokand.firebaseapp.com",
  databaseURL: "https://edu-kokand-default-rtdb.firebaseio.com",
  projectId: "edu-kokand",
  storageBucket: "edu-kokand.firebasestorage.app",
  messagingSenderId: "637048448838",
  appId: "1:637048448838:web:55ce4c26471565aeeb6747",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const rtdb = db;
const firestore = getFirestore(app);

export {
  app,
  auth,
  db,
  rtdb,
  firestore,
  ref,
  get,
  set,
  update,
  push,
  onChildAdded,
  query,
  orderByChild,
  limitToLast,
  runTransaction,
  serverTimestamp,
};
