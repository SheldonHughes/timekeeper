const crypto = require('crypto');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

initializeApp();
const db = getFirestore();

exports.syncTimeEntryToCalendar = require('./calendarSync').syncTimeEntryToCalendar;

function genInviteCode() {
  return crypto.randomBytes(9).toString('base64url'); // 12 url-safe chars
}

// Single source of truth for "who am I" identity resolution. Two
// reasons this is a function rather than the client reading Firestore
// directly: `superadmins` has no client read path at all (by design
// -- see firestore.rules), and a fresh account's very first identity
// check has no rig/admin doc yet to read, which security rules can't
// cleanly express as "not found" (a rule keyed on resource.data
// throws, rather than gracefully denying, when resource is null).
// Admin SDK sidesteps both problems.
exports.whoAmI = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const [superSnap, adminSnap, rigSnap] = await Promise.all([
    db.doc(`superadmins/${uid}`).get(),
    db.doc(`admins/${uid}`).get(),
    db.doc(`rigs/${uid}`).get(),
  ]);

  // Spread first, then set `role` last in each object literal --
  // `role` here means "which identity type is this" (the thing every
  // client screen branches on), which is a different concept than
  // the `role` field stored on an admins doc ('admin' vs
  // 'supervisor', a sub-distinction nothing currently uses). Spreading
  // after would let that stored field silently clobber this one.
  if (superSnap.exists) return { ...superSnap.data(), id: uid, role: 'superadmin' };
  if (adminSnap.exists) return { ...adminSnap.data(), id: uid, adminRole: adminSnap.data().role, role: 'admin' };
  if (rigSnap.exists) return { ...rigSnap.data(), id: uid, role: 'rig' };
  return { role: null };
});

// A signed-in user with no existing identity anywhere creates a new
// group and becomes its founding admin, atomically. This is the
// bootstrap step: creating a *new* group is self-authorizing (you
// don't need to already be an admin of anything), which is what lets
// the very first supervisor ever get in without someone hand-editing
// Firestore.
exports.createGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const name = (request.data?.name || '').trim();
  if (!name) throw new HttpsError('invalid-argument', 'Group name is required.');

  const [existingAdmin, existingRig] = await Promise.all([
    db.doc(`admins/${uid}`).get(),
    db.doc(`rigs/${uid}`).get(),
  ]);
  if (existingAdmin.exists || existingRig.exists) {
    throw new HttpsError('already-exists', 'This account already belongs to a group.');
  }

  const groupRef = db.collection('groups').doc();
  const batch = db.batch();
  batch.set(groupRef, {
    name,
    createdByUid: uid,
    createdAt: FieldValue.serverTimestamp(),
    rigInviteCode: genInviteCode(),
    adminInviteCode: genInviteCode(),
  });
  batch.set(db.doc(`admins/${uid}`), {
    groupId: groupRef.id,
    name: request.auth.token.name || request.auth.token.email || 'Admin',
    role: 'admin',
  });
  await batch.commit();

  return { groupId: groupRef.id, name };
});

// Validates an invite code (rig or admin) and creates the matching
// membership doc. This is the only path that creates rigs/{uid} or
// admins/{uid} for a fresh join -- see firestore.rules, which locks
// direct client creation of admins down to superadmin-only and rig
// creation down to same-group admins, precisely because this check
// has to happen server-side against the real stored code.
exports.joinGroup = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { groupId, code, role } = request.data || {};
  if (!groupId || !code || !['rig', 'admin'].includes(role)) {
    throw new HttpsError('invalid-argument', 'groupId, code, and role ("rig" or "admin") are required.');
  }

  const [groupSnap, existingAdmin, existingRig] = await Promise.all([
    db.doc(`groups/${groupId}`).get(),
    db.doc(`admins/${uid}`).get(),
    db.doc(`rigs/${uid}`).get(),
  ]);
  if (!groupSnap.exists) throw new HttpsError('not-found', 'Invite link is invalid -- group not found.');
  if (existingAdmin.exists || existingRig.exists) {
    throw new HttpsError('already-exists', 'This account already belongs to a group.');
  }

  const group = groupSnap.data();

  if (role === 'rig') {
    if (code !== group.rigInviteCode) throw new HttpsError('permission-denied', 'Invite link is invalid or has been rotated.');
    const label = (request.data.label || '').trim();
    if (!label) throw new HttpsError('invalid-argument', 'Rig label is required.');
    await db.doc(`rigs/${uid}`).set({
      groupId,
      label,
      equipmentType: request.data.equipmentType || 'other',
      googleAccountEmail: request.auth.token.email || '',
      authUid: uid,
      defaultOperatorName: '',
      status: 'active',
    });
  } else {
    if (code !== group.adminInviteCode) throw new HttpsError('permission-denied', 'Invite link is invalid or has been rotated.');
    await db.doc(`admins/${uid}`).set({
      groupId,
      name: request.auth.token.name || request.auth.token.email || 'Supervisor',
      role: 'supervisor',
    });
  }

  return { groupId, groupName: group.name };
});

// Lets a group's admin (or the superadmin) rotate a leaked invite
// link without affecting the other one.
exports.regenerateInviteCode = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const { groupId, role } = request.data || {};
  if (!groupId || !['rig', 'admin'].includes(role)) {
    throw new HttpsError('invalid-argument', 'groupId and role ("rig" or "admin") are required.');
  }

  const [adminSnap, superSnap] = await Promise.all([
    db.doc(`admins/${uid}`).get(),
    db.doc(`superadmins/${uid}`).get(),
  ]);
  const isGroupAdmin = adminSnap.exists && adminSnap.data().groupId === groupId;
  if (!isGroupAdmin && !superSnap.exists) {
    throw new HttpsError('permission-denied', 'Supervisor/admin of this group required.');
  }

  const code = genInviteCode();
  await db.doc(`groups/${groupId}`).update({ [`${role}InviteCode`]: code });
  return { code };
});

// When a supervisor rejects a job that already has time logged
// against it, don't silently drop those entries -- flag them so a
// supervisor resolves them explicitly (PROJECT_BRIEF.md, "Key
// modeling decisions to preserve"). Runs with Admin SDK privileges,
// bypassing firestore.rules, because the rules deliberately only let
// a *rig* write its own timeEntries -- there is no client-side path
// for an admin to set this flag directly.
exports.flagReassignmentOnReject = onDocumentUpdated('jobs/{jobId}', async (event) => {
  const before = event.data.before.data();
  const after = event.data.after.data();
  if (before.status === after.status || after.status !== 'rejected') return;

  const jobId = event.params.jobId;
  const entriesSnap = await db.collection('timeEntries').where('jobId', '==', jobId).get();
  if (entriesSnap.empty) return;

  const batch = db.batch();
  entriesSnap.forEach((doc) => {
    if (!doc.data().needsReassignment) {
      batch.update(doc.ref, { needsReassignment: true });
    }
  });
  await batch.commit();
});

// Callable: lets a signed-in supervisor/admin resolve a
// needsReassignment entry by moving it to a different (approved)
// job in the same group. Writes an editLog doc for the audit trail,
// same as any other entry edit.
exports.reassignTimeEntry = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const [adminSnap, superSnap] = await Promise.all([
    db.doc(`admins/${uid}`).get(),
    db.doc(`superadmins/${uid}`).get(),
  ]);
  if (!adminSnap.exists && !superSnap.exists) {
    throw new HttpsError('permission-denied', 'Supervisor/admin account required.');
  }

  const { entryId, newJobId } = request.data;
  if (!entryId || !newJobId) throw new HttpsError('invalid-argument', 'entryId and newJobId are required.');

  const entryRef = db.doc(`timeEntries/${entryId}`);
  const [entrySnap, newJobSnap] = await Promise.all([entryRef.get(), db.doc(`jobs/${newJobId}`).get()]);
  if (!entrySnap.exists) throw new HttpsError('not-found', 'Time entry not found.');
  if (!newJobSnap.exists) throw new HttpsError('not-found', 'Target job not found.');

  const entry = entrySnap.data();
  const newJob = newJobSnap.data();

  if (!superSnap.exists && adminSnap.data().groupId !== entry.groupId) {
    throw new HttpsError('permission-denied', 'Entry belongs to a different group.');
  }
  if (newJob.groupId !== entry.groupId) {
    throw new HttpsError('invalid-argument', 'Target job must be in the same group as the entry.');
  }

  const actorName = adminSnap.exists ? adminSnap.data().name : (superSnap.data().name || 'Superadmin');

  await entryRef.update({
    jobId: newJobId,
    jobStatusAtEntry: newJob.status,
    needsReassignment: false,
  });

  await db.collection('editLog').add({
    groupId: entry.groupId,
    entryId,
    field: 'jobId',
    oldValue: entry.jobId,
    newValue: newJobId,
    editedByRigId: null,
    editedByOperatorName: `${actorName} (supervisor)`,
    editedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});
