// Firebase project config + shared SDK initialization.
//
// Copy this file to firebase-config.js (git-ignored) and fill in your
// own project's values below (Firebase console -> Project settings ->
// General -> Your apps -> SDK setup and configuration). This same
// config is used by both the cab tablet app (index.html) and the
// supervisor dashboard (dashboard.html).

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT',
  storageBucket: 'YOUR_PROJECT.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistent offline cache -- the rig tablets run on rural/spotty
// signal, so reads/writes need to keep working (and queue) while
// offline. Single-tab manager matches "one tablet, one browser tab
// permanently open" -- no multi-tab coordination needed.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }),
});
