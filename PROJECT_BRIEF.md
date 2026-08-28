# Crew Time Tracking App — Project Brief for Claude Code

## What this is

A time-tracking app for a tractor/dirt-pan-scraper crew running
agricultural and commercial jobs. Each rig (piece of equipment) has
a dedicated Android tablet mounted in the cab. Crew clock in/out
against jobs throughout the day, switch jobs mid-shift, and the data
backs up to Google Calendar and exports to Google Sheets.

**Build this as a plain HTML/CSS/JavaScript web app** (no framework
required — a very light one like Alpine.js is fine if it reduces
manual DOM bookkeeping, but avoid heavy build tooling). Use the
**Firebase JS SDK** (Firestore + Cloud Functions) as the backend.
Ship it first as an installed PWA (Add to Home Screen, offline via
service worker) — do not build a Capacitor/native wrapper unless
asked. This choice was made specifically because: the dev has basic
JS knowledge and wants easy troubleshooting via Chrome DevTools; the
same codebase should serve both the cab tablet UI and a desktop
supervisor dashboard; and Firestore's offline persistence handles
the rural/spotty-signal requirement without extra work.

---

## Core requirements

- Time tracked per job, identified by **owner name + job name**.
- Clock in/out daily; **switching jobs mid-day is a first-class,
  low-friction action** (not a multi-step flow).
- **Rig is first-class** — crew clock in *as* a rig (e.g. "Rig #3"),
  not just as a person. A tablet is physically bolted to one rig
  permanently; the rig, not the person, is the fixed identity.
- Multiple rigs (2–6) need to see and select from the **same shared
  job list**.
- Any crew member can create a new job; it's **pending** until a
  supervisor approves it, then it's visible to everyone.
- The job's creator can **clock in immediately** on their own
  pending job — approval doesn't block work from starting.
- **Editing past time entries must be possible, with a full audit
  trail** — never hard-delete or silently overwrite.
- **Google Calendar sync**: each rig has its own Google account
  (used for both auth and Calendar). Two jobs worked in one day = two
  calendar events. Multiple clock-in/out segments on the same job in
  one day aggregate into a single event.
- **Google Sheets export**: still an open design question — see
  "Not yet designed" section below. Do not build this yet without
  further spec.

---

## Identity & auth model (important — simplified from an earlier draft)

Two tiers, deliberately different trust levels:

1. **Rig-level auth (the real security boundary).** Each rig's
   tablet signs into Firebase Auth using **the rig's own Google
   account** (the same account used for Calendar). This is a
   permanent, device-level login — it does not change when the
   operator changes. Firestore security rules key off this identity:
   a rig can only write time entries/jobs tagged with its own
   `rigId`. **The rig's Firestore doc ID is set equal to its own
   Firebase Auth `uid`**, so rules can do a plain equality check
   instead of a query.

2. **Operator name = a self-reported tag, not a login.** Since the
   tablet stays with the rig but the person running it can change,
   the app has a lightweight "who's running this rig today" picker
   (roster of names, tap to select, no password). This name is
   stored as a plain string on time entries — **it is intentionally
   NOT a security principal**. Its only purpose is "if there's a
   question about this entry, we know who to contact." It defaults
   to whoever was last selected on that rig, and is always
   one-tap-visible-and-changeable, shown small in the header so a
   glance can catch a stale default.

3. **Roster management**: admins add/retire operator names (a new
   hire can't self-add on day one — an admin enters them first).

4. **Supervisor/admin accounts are real, individual logins**
   (their own Google sign-in) — because approving a job is a
   consequential permission, unlike the operator tag. Stored in an
   `admins/{authUid}` collection keyed by their own Firebase Auth uid.

---

## Data model

See attached `firestore-schema.md` for the full field-by-field
schema. Collections: `rigs`, `roster`, `admins`, `jobs`,
`timeEntries`, `editLog`, `dailySummaries` (used by Calendar sync to
track which calendar event corresponds to which rig+job+day, so
updates patch the existing event instead of creating duplicates).

Key modeling decisions to preserve:

- `timeEntries.rigId` is the enforced-by-rules field; `operatorName`
  is unenforced metadata.
- `jobs.status` is `pending | approved | rejected`. Editing a job's
  `ownerName`/`jobName` **never** triggers re-approval, even after
  it's already approved — this was an explicit decision (typo fixes
  shouldn't re-open the approval gate). Status changes and metadata
  edits are two separate, separately-authorized update paths.
- If a supervisor **rejects** a job that already has time logged
  against it, don't silently drop those entries — flag them
  (`needsReassignment: true`) so a supervisor resolves them
  explicitly. The approval dashboard should surface "X hours already
  logged" on any pending job so a supervisor sees the consequence
  before rejecting.
- Every entry/job edit writes a corresponding **append-only**
  `editLog` doc (old value, new value, who, when). `editLog` allows
  `create` only — no `update`/`delete`, ever, for anyone, including
  admins. Nothing in `jobs` or `timeEntries` is ever hard-deleted
  either.

See attached `firestore.rules` for the full security rules
implementing all of the above. Treat this file as authoritative for
the permission model — implement the app to match it, don't loosen
it for convenience.

---

## UI/UX — cab tablet (rig-facing)

**Orientation: portrait.** (Changed from an initial landscape
design — portrait matches mounting on the cab's c-pillar and was
chosen deliberately for that reason.)

**Design constraints specific to this environment:**
- Touch targets 64–72dp minimum (vibration + gloved hands) — larger
  than typical mobile guidance.
- High-contrast color, not light-gray-on-white — needs to be
  readable in direct sun.
- Bottom/reachable-zone placement for anything tapped while moving.
- New-job text entry should assume the tractor is stopped (real
  typing isn't safe at speed) even if not technically blocked.

**Color semantics (deliberate, don't reassign):**
- **Green** = "you are currently clocked in" (status band + clock-out
  button). Referred to as "John Deere green."
- **Cobalt blue** = used for in-progress/emphasis states in pickers.
- **Red** = reserved *exclusively* for "not clocked in." Never
  reused elsewhere, so it stays an unambiguous glance-signal.

### Screens (reference the mockups below — save actual screenshots
### into `/screens/` and update these placeholders)

1. **Default screen — not clocked in.**
   Full red status block, "Not clocked in" label. Footer row: small
   "Edit job" button (left) + large "Clock in" button (center,
   dominant) + small "New job" button (right). Edit Job and New Job
   are deliberately de-emphasized vs. Clock In.
   `![Default - not clocked in](./screens/default-not-clocked-in.png)`

2. **Clocked-in screen (active state).**
   Green status band at top showing current job + running timer.
   Below: scrollable list to switch jobs — this rig's **most recent
   job** pinned to top (badge: "You're here" / recency label),
   other known jobs below, "New job" tile last. Full-width green
   "Clock out" button anchored at bottom regardless of scroll
   position.
   `![Clocked in - active](./screens/clocked-in-active.png)`

3. **Job selection / switch-job flow.**
   Shows: most-recent job (top, badge), a **"Browse all company
   jobs"** button (opens the full searchable list — see #4), and
   "New job" tile. This exists specifically to handle "operator
   clocked into the wrong job and needs to find one they've never
   worked before."
   `![Switch job](./screens/switch-job.png)`

4. **Browse all jobs (full company-wide searchable list).**
   Search bar (filters by owner or job name, live). Reusable
   component — also used by the Edit Job flow, parameterized by mode
   (`select` = clock into it; `edit` = open job metadata editor).
   Visibility rule: shows all **approved** jobs, plus the current
   rig's own **pending** jobs (never other rigs' pending jobs — this
   preserves the "not visible to crew until approved" rule even
   through this list).
   `![Browse all jobs](./screens/browse-all-jobs.png)`

5. **New job form.**
   Fields: owner/customer name, job name. Inline note explaining
   it's visible to the creator immediately, to the rest of the crew
   once a supervisor approves it. Submits as `status: "pending"`.
   `![New job form](./screens/new-job-form.png)`

6. **Edit Job flow (metadata, not time).**
   Entry point: "Edit job" button on default screen → opens the
   Browse All Jobs list in "edit" mode (company-wide, including
   pending jobs) → tap a job → edit `ownerName`/`jobName` → save.
   Does **not** trigger re-approval.
   `![Edit job picker](./screens/edit-job-picker.png)`

7. **Long-press action sheet (on a job row in job-history contexts).**
   Two options: **Edit time**, and **Add note** (label swaps to
   **Edit note** once `note` is non-null on that entry).
   `![Long-press action sheet](./screens/longpress-sheet.png)`

8. **Add/Edit note screen.**
   Header shows job name + date so the user can verify context.
   Single text box, keyboard triggers automatically on open. Saves
   to `timeEntries.note`, logs to `editLog`.
   `![Note screen](./screens/note-screen.png)`

9. **Edit time screen.**
   Adjust start/end time for a specific entry. Includes a
   "Previous entries — this job" button opening #10.
   `![Edit time](./screens/edit-time.png)`

10. **Previous entries list (searchable, per-job).**
    Scoped to **this rig's own history on this specific job**
    (not company-wide — that's a supervisor-dashboard concern).
    Search/filter by date. Rows with a note show a small note icon.
    `![Previous entries](./screens/previous-entries.png)`

---

## UI/UX — supervisor dashboard (desktop/tablet, not cab-mounted)

Different surface: information-dense, not big-touch-target. Lists
pending job approvals with creator, rig, time since creation, and —
critically — **how many hours are already logged against it** if
any, so a supervisor sees the consequence before rejecting. Approve
/ Reject actions per row.
`![Supervisor approval dashboard](./screens/supervisor-dashboard.png)`

---

## Google Calendar sync (Cloud Function)

See attached `calendarSync.js` for the reference implementation.
Key points to preserve:

- **Cannot ride on the tablet's Firebase Auth session** (too
  short-lived, tied to an active client). Requires a **one-time
  OAuth setup per rig** (admin-run, `access_type=offline`) that
  captures a refresh token, stored server-side (Secret Manager or
  equivalent) keyed by `rigId`. This is not yet built — flagged as
  the next piece to design if picked back up.
- Trigger: Firestore `onWrite` on `timeEntries` (not just clock-out)
  — this means a later edit automatically recomputes and re-patches
  that day's event, with no separate resync mechanism needed.
- Aggregation: one event per (`rigId`, `jobId`, `date`). Multiple
  segments that day sum into one event; event is a **synthetic
  contiguous block** — starts at the day's earliest clock-in, ends
  at start + total worked seconds (does not show real gaps like
  lunch). Title states the actual hours explicitly, e.g. `"Giesbrecht
  — East 40 leveling (6.4 hrs)"`, so nothing is ambiguous even
  though the block itself is synthetic.
- Notes from all of that day's segments are concatenated into the
  event description (separated by `---`) — **confirm this is still
  wanted before building further; it was flagged as worth
  double-checking, not fully settled.**
- `dailySummaries/{rigId}_{jobId}_{date}` stores the running total
  and the `calendarEventId`, so re-syncs `PATCH` the existing event
  instead of creating duplicates. Also stamped with
  `extendedProperties.private.syncKey` on the event itself as a
  fallback lookup path.

---

## Not yet designed (do not build without further spec)

- **Google Sheets export.** Discussed only at a high level: lean
  toward one append-only "raw entries" tab (mirroring `timeEntries`)
  plus a "Dashboard" tab built with `QUERY`/`FILTER`/pivot tables
  against it, rather than a tab-per-job structure (which would
  require fragile dynamic sheet creation via the API). Per-job tabs
  were floated only as a possible secondary snapshot step for closed
  jobs, not the primary structure. **This needs its own design pass
  before implementation.**
- **Rig OAuth refresh-token capture flow** — the actual one-time
  admin setup screen/script for wiring up each new rig's Calendar
  access. Referenced above but not built.
- Whether the "notes concatenated into calendar description"
  behavior is actually desired (see above).

---

## Attached reference files

- `firestore-schema.md` — full data model
- `firestore.rules` — full security rules (authoritative for the
  permission model)
- `calendarSync.js` — Cloud Function reference implementation for
  Calendar sync

## Screenshot placeholders

Create a `/screens/` folder in the repo and drop the actual mockup
screenshots in, matching the filenames referenced above (e.g.
`default-not-clocked-in.png`, `clocked-in-active.png`, etc.) so the
screen references throughout this doc resolve.
