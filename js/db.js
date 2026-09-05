// Firestore read/write helpers. Every write here is shaped to pass
// firestore.rules as-is -- see that file for the actual enforcement.
// Every query is scoped to a groupId because Firestore requires the
// query itself to include the same equality filter the rule checks
// (a rule can't retroactively filter a list result) -- see
// firestore.rules' isMemberOfGroup().
//
// Two deliberate exceptions, both handled by Cloud Functions with
// Admin SDK privileges instead of client writes:
// - Flagging timeEntries with `needsReassignment: true` when a
//   supervisor rejects a job (functions/index.js:flagReassignmentOnReject).
// - Group/membership creation -- creating a group, or joining one as
//   a rig/admin via invite code (functions/index.js: createGroup,
//   joinGroup, regenerateInviteCode). See auth.js for the client side
//   of those calls.

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  Timestamp,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';
import { db } from './firebase-config.js';
import { todayStr } from './utils.js';

// ---------- groups ----------

export function listenGroup(groupId, cb) {
  return onSnapshot(doc(db, 'groups', groupId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data() } : null));
}

// Superadmin only -- firestore.rules' isMemberOfGroup() lets a
// superadmin read every group unfiltered (see the rule comment on
// list-query satisfiability), everyone else must filter by their own
// groupId.
export function listenAllGroups(cb) {
  return onSnapshot(collection(db, 'groups'), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// ---------- roster ----------

export function listenRoster(groupId, cb) {
  const q = query(collection(db, 'roster'), where('groupId', '==', groupId), where('active', '==', true));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })));
  });
}

// ---------- jobs ----------

export function listenApprovedJobs(groupId, cb) {
  const q = query(collection(db, 'jobs'), where('groupId', '==', groupId), where('status', '==', 'approved'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

export function listenOwnPendingJobs(groupId, rigId, cb) {
  const q = query(
    collection(db, 'jobs'),
    where('groupId', '==', groupId),
    where('createdByRigId', '==', rigId),
    where('status', '==', 'pending')
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

// Supervisor dashboard: every pending job in this group.
export function listenPendingJobs(groupId, cb) {
  const q = query(collection(db, 'jobs'), where('groupId', '==', groupId), where('status', '==', 'pending'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

export function listenAllJobs(groupId, cb) {
  const q = query(collection(db, 'jobs'), where('groupId', '==', groupId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

export async function createJob({ groupId, ownerName, jobName, createdByRigId, createdByOperatorName }) {
  return addDoc(collection(db, 'jobs'), {
    groupId,
    ownerName,
    jobName,
    status: 'pending',
    createdByRigId,
    createdByOperatorName,
    createdAt: serverTimestamp(),
    approvedByUid: null,
    approvedAt: null,
  });
}

// Metadata-only edit (owner/job name). Never touches `status` --
// matches the "editing never re-triggers approval" rule.
export async function updateJobMeta(job, changes, editContext) {
  const jobRef = doc(db, 'jobs', job.id);
  await updateDoc(jobRef, changes);
  for (const field of Object.keys(changes)) {
    if (changes[field] !== job[field]) {
      await createEditLog({
        groupId: job.groupId,
        entryId: job.id,
        field,
        oldValue: job[field] ?? '',
        newValue: changes[field],
        ...editContext,
      });
    }
  }
}

export async function approveJob(jobId, adminUid) {
  await updateDoc(doc(db, 'jobs', jobId), {
    status: 'approved',
    approvedByUid: adminUid,
    approvedAt: serverTimestamp(),
  });
}

export async function rejectJob(jobId, adminUid) {
  await updateDoc(doc(db, 'jobs', jobId), {
    status: 'rejected',
    approvedByUid: adminUid,
    approvedAt: serverTimestamp(),
  });
}

// One-time sum of hours already logged against a job -- shown on the
// approval dashboard so a supervisor sees the consequence before
// rejecting.
export async function getHoursLoggedForJob(groupId, jobId) {
  const q = query(collection(db, 'timeEntries'), where('groupId', '==', groupId), where('jobId', '==', jobId));
  const snap = await getDocs(q);
  let totalSeconds = 0;
  snap.forEach((d) => {
    const e = d.data({ serverTimestamps: 'estimate' });
    if (e.clockOut) {
      totalSeconds += (e.clockOut.toMillis() - e.clockIn.toMillis()) / 1000;
    }
  });
  return totalSeconds / 3600;
}

// ---------- timeEntries ----------

// This group's currently-active entries (clockOut == null) -- used to
// show "Job active" badges for jobs another rig is working right now.
export function listenActiveEntries(groupId, cb) {
  const q = query(collection(db, 'timeEntries'), where('groupId', '==', groupId), where('clockOut', '==', null));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

// This rig's own recent history, most-recent first -- source for the
// "known jobs" switch-job list (deduped by jobId client-side).
export function listenRecentEntriesForRig(groupId, rigId, cb, max = 50) {
  const q = query(
    collection(db, 'timeEntries'),
    where('groupId', '==', groupId),
    where('rigId', '==', rigId),
    orderBy('clockIn', 'desc'),
    limit(max)
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

export function listenTodayEntriesForRig(groupId, rigId, cb) {
  const q = query(
    collection(db, 'timeEntries'),
    where('groupId', '==', groupId),
    where('rigId', '==', rigId),
    where('date', '==', todayStr())
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

// This rig's own history on one specific job -- the "previous
// entries" screen. Deliberately scoped per-rig, not group-wide.
export function listenEntriesForRigJob(groupId, rigId, jobId, cb) {
  const q = query(
    collection(db, 'timeEntries'),
    where('groupId', '==', groupId),
    where('rigId', '==', rigId),
    where('jobId', '==', jobId),
    orderBy('clockIn', 'desc')
  );
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

export async function clockIn({ groupId, rigId, jobId, operatorName, jobStatusAtEntry }) {
  return addDoc(collection(db, 'timeEntries'), {
    groupId,
    jobId,
    rigId,
    operatorName,
    jobStatusAtEntry,
    clockIn: serverTimestamp(),
    clockOut: null,
    date: todayStr(),
    note: null,
    needsReassignment: false,
    calendarEventId: null,
  });
}

export async function clockOut(entryId) {
  await updateDoc(doc(db, 'timeEntries', entryId), { clockOut: serverTimestamp() });
}

// Edits an entry's start/end time. `newClockIn`/`newClockOut` are JS
// Dates (clockOut may be null if the entry is still active).
export async function editEntryTime(entry, { newClockIn, newClockOut }, editContext) {
  const ref = doc(db, 'timeEntries', entry.id);
  const changes = {};
  if (newClockIn) changes.clockIn = Timestamp.fromDate(newClockIn);
  changes.clockOut = newClockOut ? Timestamp.fromDate(newClockOut) : null;
  await updateDoc(ref, changes);

  if (newClockIn && newClockIn.getTime() !== entry.clockIn.toMillis()) {
    await createEditLog({
      groupId: entry.groupId,
      entryId: entry.id,
      field: 'clockIn',
      oldValue: entry.clockIn.toDate().toISOString(),
      newValue: newClockIn.toISOString(),
      ...editContext,
    });
  }
  const oldClockOutMs = entry.clockOut ? entry.clockOut.toMillis() : null;
  const newClockOutMs = newClockOut ? newClockOut.getTime() : null;
  if (oldClockOutMs !== newClockOutMs) {
    await createEditLog({
      groupId: entry.groupId,
      entryId: entry.id,
      field: 'clockOut',
      oldValue: entry.clockOut ? entry.clockOut.toDate().toISOString() : '',
      newValue: newClockOut ? newClockOut.toISOString() : '',
      ...editContext,
    });
  }
}

export async function setEntryNote(entry, newNote, editContext) {
  await updateDoc(doc(db, 'timeEntries', entry.id), { note: newNote });
  await createEditLog({
    groupId: entry.groupId,
    entryId: entry.id,
    field: 'note',
    oldValue: entry.note ?? '',
    newValue: newNote,
    ...editContext,
  });
}

// ---------- rigs ----------

export function listenRig(rigId, cb) {
  return onSnapshot(doc(db, 'rigs', rigId), (snap) => cb(snap.exists() ? { id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } : null));
}

// Supervisor dashboard: every rig in this group, to resolve rigId -> label.
export function listenAllRigs(groupId, cb) {
  const q = query(collection(db, 'rigs'), where('groupId', '==', groupId));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

// Entries a rejected job's time was flagged onto -- see
// functions/index.js:flagReassignmentOnReject.
export function listenNeedsReassignmentEntries(groupId, cb) {
  const q = query(collection(db, 'timeEntries'), where('groupId', '==', groupId), where('needsReassignment', '==', true));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))));
}

// Rules only allow a rig to touch its own `defaultOperatorName`.
export async function setDefaultOperator(rigId, operatorName) {
  await updateDoc(doc(db, 'rigs', rigId), { defaultOperatorName: operatorName });
}

// ---------- editLog (append-only) ----------

export async function createEditLog({ groupId, entryId, field, oldValue, newValue, editedByRigId, editedByOperatorName }) {
  await addDoc(collection(db, 'editLog'), {
    groupId,
    entryId,
    field,
    oldValue: String(oldValue),
    newValue: String(newValue),
    editedByRigId,
    editedByOperatorName,
    editedAt: serverTimestamp(),
  });
}
