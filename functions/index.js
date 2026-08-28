const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');

initializeApp();
const db = getFirestore();

exports.syncTimeEntryToCalendar = require('./calendarSync').syncTimeEntryToCalendar;

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
// job. Writes an editLog doc for the audit trail, same as any other
// entry edit.
exports.reassignTimeEntry = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');

  const adminSnap = await db.doc(`admins/${uid}`).get();
  if (!adminSnap.exists) throw new HttpsError('permission-denied', 'Supervisor/admin account required.');

  const { entryId, newJobId } = request.data;
  if (!entryId || !newJobId) throw new HttpsError('invalid-argument', 'entryId and newJobId are required.');

  const entryRef = db.doc(`timeEntries/${entryId}`);
  const [entrySnap, newJobSnap] = await Promise.all([entryRef.get(), db.doc(`jobs/${newJobId}`).get()]);
  if (!entrySnap.exists) throw new HttpsError('not-found', 'Time entry not found.');
  if (!newJobSnap.exists) throw new HttpsError('not-found', 'Target job not found.');

  const entry = entrySnap.data();
  const newJob = newJobSnap.data();

  await entryRef.update({
    jobId: newJobId,
    jobStatusAtEntry: newJob.status,
    needsReassignment: false,
  });

  await db.collection('editLog').add({
    entryId,
    field: 'jobId',
    oldValue: entry.jobId,
    newValue: newJobId,
    editedByRigId: null,
    editedByOperatorName: `${adminSnap.data().name} (supervisor)`,
    editedAt: FieldValue.serverTimestamp(),
  });

  return { ok: true };
});
