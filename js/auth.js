// Google sign-in helpers, shared shape but used two different ways:
// - Cab tablet: rig's own Google account, signed in once during
//   setup, then persisted indefinitely (device-level login).
// - Supervisor dashboard: the individual supervisor's own Google
//   account, a real per-person login.
//
// Firestore security rules are the actual boundary (see
// firestore.rules) -- this module just drives the Auth UI/flow.
// Identity resolution (which group, which role) lives in
// membership.js's getMyIdentity(), backed by a Cloud Function rather
// than a direct Firestore read -- see that file for why.

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signOut as fbSignOut,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { auth } from './firebase-config.js';

const provider = new GoogleAuthProvider();

export async function signIn() {
  await setPersistence(auth, browserLocalPersistence);
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}
