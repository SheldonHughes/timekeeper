# Firestore Schema (v3 — multi-tenant groups + self-service invites)

Three-tier identity model:
- SUPERADMIN (the app owner) — full control across every group, at
  any time. Manually seeded, never self-service (see `superadmins/`
  below) — a self-service path to god-mode over every tenant would
  defeat the point of it being a security boundary at all.
- SUPERVISOR/ADMIN users authenticate individually (their own Google
  login), scoped to one group — this is a real permission boundary,
  since approving jobs is a consequential action. The *first*
  supervisor of a group is whoever created it (see `groups/` below);
  additional supervisors join the same way rigs do, via an invite
  link.
- RIG tablets authenticate as the rig's own Google account, scoped to
  one group. This is the real security boundary for day-to-day data —
  a rig can only write data tagged with its own rigId and groupId.
- The OPERATOR name on a time entry is plain self-reported data —
  whoever is tapped in the roster on that rig's tablet. Not tied to
  auth. Good enough to know who to contact; not proof of who
  physically worked it.

Every collection below except `groups` and `superadmins` carries a
`groupId` field and is scoped to it — a crew only ever sees its own
group's data. `groups` and `superadmins` are managed exclusively by
Cloud Functions (`functions/index.js`) using the Admin SDK; there is
deliberately no direct client write path to either, since that's
where tenant membership itself gets decided.

## groups/{groupId}
| field | type | notes |
|---|---|---|
| name | string | set once at creation |
| createdByUid | string | the founding supervisor's Firebase Auth uid |
| createdAt | timestamp | |
| rigInviteCode | string | pasted into the rig invite link; rotatable |
| adminInviteCode | string | pasted into the supervisor invite link; rotatable |

Invite links carry `groupId` + the relevant code as query params
(e.g. `index.html?join=rig&group=<id>&code=<code>` for a rig,
`dashboard.html?join=admin&group=<id>&code=<code>` for a supervisor).
Joining calls the `joinGroup` Cloud Function, which validates the
code server-side and creates the `rigs/{uid}` or `admins/{uid}` doc —
the client never gets to write those docs itself for a fresh join.

## superadmins/{authUid}
| field | type | notes |
|---|---|---|
| name | string | |

No client read or write path at all — referenced only via `exists()`
inside security rules, and seeded by hand in the Firebase console.

## rigs/{rigId}
Doc ID == the rig's own Firebase Auth uid.
| field | type | notes |
|---|---|---|
| groupId | ref → groups | which crew this rig belongs to |
| label | string | e.g. "Rig #3" |
| equipmentType | string | tractor_scraper \| tractor_disc \| dozer \| trackhoe \| other |
| googleAccountEmail | string | rig's Google account — used for both Firebase Auth sign-in and Calendar sync |
| authUid | string | same as the doc ID — kept as a field too so rules/queries don't need the id |
| defaultOperatorName | string | self-updates to whoever last clocked in |
| status | string | active \| down \| retired |

## roster/{name-or-id}
Simple lookup list for the operator-tap picker. Not a security
principal — no auth relationship.
| field | type | notes |
|---|---|---|
| groupId | ref → groups | |
| name | string | shown in the roster picker |
| active | boolean | lets you retire someone from the list without deleting history |

## admins/{authUid}  (supervisors + admins)
Doc ID == the person's own Firebase Auth uid (their individual Google
login).
| field | type | notes |
|---|---|---|
| groupId | ref → groups | |
| name | string | |
| role | string | supervisor \| admin |

## jobs/{jobId}
| field | type | notes |
|---|---|---|
| groupId | ref → groups | |
| ownerName | string | |
| jobName | string | |
| status | string | pending \| approved \| rejected |
| createdByRigId | ref → rigs | which rig's tablet created it |
| createdByOperatorName | string | self-reported tag, not authenticated |
| createdAt | timestamp | |
| approvedByUid | string | admins/{uid} — real authenticated approver |
| approvedAt | timestamp | null until approved |

## timeEntries/{entryId}
| field | type | notes |
|---|---|---|
| groupId | ref → groups | |
| jobId | ref → jobs | |
| rigId | ref → rigs | required — this is the enforced identity |
| operatorName | string | self-reported tag from the roster picker |
| jobStatusAtEntry | string | snapshot: pending \| approved |
| clockIn | timestamp | |
| clockOut | timestamp \| null | null while active |
| date | string (YYYY-MM-DD) | for daily aggregation/query |
| note | string \| null | |
| needsReassignment | boolean | set true if parent job gets rejected after entries exist |
| calendarEventId | string \| null | set by sync function, prevents duplicate events |

## editLog/{logId}
| field | type | notes |
|---|---|---|
| groupId | ref → groups | |
| entryId | ref → timeEntries (or jobId for metadata edits) | |
| field | string | "clockIn" \| "clockOut" \| "note" \| "jobName" \| "ownerName" \| "jobId" |
| oldValue | string | |
| newValue | string | |
| editedByRigId | ref → rigs \| null | the authenticated writer, or null for an admin-initiated edit |
| editedByOperatorName | string | self-reported, for "who to contact" |
| editedAt | timestamp | |

## dailySummaries/{rigId}_{jobId}_{date}
Unchanged from before (see `calendarSync.js`) — written only by the
Calendar-sync Cloud Function via the Admin SDK, never by clients.
Also carries `groupId` for consistency, though nothing queries it by
group yet.
