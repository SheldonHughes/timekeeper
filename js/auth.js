// Google sign-in helpers, shared shape but used two different ways:
// - Cab tablet: rig's own Google account, signed in once during
//   setup, then persisted indefinitely (device-level login).
// - Supervisor dashboard: the individual supervisor's own Google
//   account, a real per-person login.
//
// Firestore security rules are the actual boundary (see
// firestore.rules) -- this module just drives the Auth UI/flow.

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithPopup,
  signOut as fbSignOut,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

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

// Looks up rigs/{uid} for the signed-in user -- null if this Google
// account isn't a recognized rig.
export async function getRigForCurrentUser(user) {
  if (!user) return null;
  const snap = await getDoc(doc(db, "rigs", user.uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Looks up admins/{uid} for the signed-in user -- null if this
// Google account isn't a recognized supervisor/admin.
export async function getAdminForCurrentUser(user) {
  if (!user) return null;
  const snap = await getDoc(doc(db, "admins", user.uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}
