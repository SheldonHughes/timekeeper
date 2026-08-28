// Firebase project config + shared SDK initialization.
//
// Fill in your own project's values below (Firebase console ->
// Project settings -> General -> Your apps -> SDK setup and
// configuration). This same config is used by both the cab tablet
// app (index.html) and the supervisor dashboard (dashboard.html).

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBIpyBuxbV-27W50GAXy8KUZvLkCooBKII",
  authDomain: "timekeeper-42c07.firebaseapp.com",
  databaseURL: "https://timekeeper-42c07-default-rtdb.firebaseio.com",
  projectId: "timekeeper-42c07",
  storageBucket: "timekeeper-42c07.firebasestorage.app",
  messagingSenderId: "488450678473",
  appId: "1:488450678473:web:2bc4c52e0f0b07d1caf718",
  measurementId: "G-7HB8HHPREH",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistent offline cache -- the rig tablets run on rural/spotty
// signal, so reads/writes need to keep working (and queue) while
// offline. Single-tab manager matches "one tablet, one browser tab
// permanently open" -- no multi-tab coordination needed.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentSingleTabManager(),
  }),
});
