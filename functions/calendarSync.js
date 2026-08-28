// Cloud Function: syncs completed time entries to the rig's Google
// Calendar. Triggers on any write to timeEntries -- covers new
// clock-outs AND later edits (edit-time flow), since both need the
// day's event to be recomputed and pushed again.
//
// This is the deployable copy of the reference implementation at the
// project root (calendarSync.js) -- Cloud Functions can only import
// from within their own function directory, so the logic lives here;
// the root file stays as the annotated reference the brief attached.

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { getFirestore } = require('firebase-admin/firestore');
const { google } = require('googleapis');

const db = getFirestore();

exports.syncTimeEntryToCalendar = onDocumentWritten(
  'timeEntries/{entryId}',
  async (event) => {
    const after = event.data.after.data();
    if (!after) return; // entry was deleted -- shouldn't happen, but guard anyway

    // Only entries with a clockOut are "done" for the day and worth
    // syncing -- an entry still active (clockOut == null) isn't
    // final yet, so skip it until it closes.
    if (!after.clockOut) return;

    await syncDailySummary(after.rigId, after.jobId, after.date);
  }
);

async function syncDailySummary(rigId, jobId, date) {
  const summaryId = `${rigId}_${jobId}_${date}`;
  const summaryRef = db.doc(`dailySummaries/${summaryId}`);

  // Recompute the day's total from scratch -- simplest way to stay
  // correct after edits, rather than trying to increment/decrement.
  const entriesSnap = await db.collection('timeEntries')
    .where('rigId', '==', rigId)
    .where('jobId', '==', jobId)
    .where('date', '==', date)
    .where('clockOut', '!=', null)
    .get();

  if (entriesSnap.empty) return;

  let totalSeconds = 0;
  let earliestClockIn = null;
  const notes = [];

  entriesSnap.forEach((doc) => {
    const e = doc.data();
    const start = e.clockIn.toDate();
    const end = e.clockOut.toDate();
    totalSeconds += (end - start) / 1000;
    if (!earliestClockIn || start < earliestClockIn) earliestClockIn = start;
    if (e.note) notes.push(e.note);
  });

  const [rigSnap, jobSnap, summarySnap] = await Promise.all([
    db.doc(`rigs/${rigId}`).get(),
    db.doc(`jobs/${jobId}`).get(),
    summaryRef.get(),
  ]);

  const rig = rigSnap.data();
  const job = jobSnap.data();
  const existingEventId = summarySnap.exists ? summarySnap.data().calendarEventId : null;

  const hours = (totalSeconds / 3600).toFixed(1);
  const startTime = earliestClockIn;
  const endTime = new Date(startTime.getTime() + totalSeconds * 1000);

  const eventBody = {
    summary: `${job.ownerName} — ${job.jobName} (${hours} hrs)`,
    description: notes.length ? notes.join('\n---\n') : undefined,
    start: { dateTime: startTime.toISOString() },
    end: { dateTime: endTime.toISOString() },
    // Belt-and-suspenders: even if calendarEventId ever gets lost,
    // this lets a future reconciliation job find the event again by
    // querying extendedProperties instead of creating a duplicate.
    extendedProperties: { private: { syncKey: summaryId } },
  };

  const calendar = await getCalendarClient(rigId, rig);

  let eventId = existingEventId;
  if (existingEventId) {
    await calendar.events.patch({
      calendarId: 'primary',
      eventId: existingEventId,
      requestBody: eventBody,
    });
  } else {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: eventBody,
    });
    eventId = res.data.id;
  }

  await summaryRef.set({
    rigId, jobId, date,
    totalSeconds,
    calendarEventId: eventId,
    lastSyncedAt: new Date(),
  }, { merge: true });
}

async function getCalendarClient(rigId, rig) {
  // Refresh token was captured once during rig setup and stored
  // server-side -- never touches the tablet client. The one-time
  // OAuth capture flow itself is not yet built (see PROJECT_BRIEF.md
  // "Not yet designed").
  const secret = await getRigRefreshToken(rigId); // -> Secret Manager lookup

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: secret });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

async function getRigRefreshToken(rigId) {
  throw new Error(`Rig OAuth refresh-token capture flow not yet built (rigId: ${rigId}).`);
}
