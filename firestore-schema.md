# Firestore Schema (v2 — simplified operator identity)

Two-tier identity model:
- RIG tablets authenticate as the rig's own Google account. This is
  the real security boundary — a rig can only write data tagged
  with its own rigId.
- SUPERVISOR/ADMIN users authenticate individually (their own Google
  login) — this is a real permission boundary, since approving jobs
  is a consequential action.
- The OPERATOR name on a time entry is plain self-reported data —
  whoever is tapped in the roster on that rig's tablet. Not tied to
  auth. Good enough to know who to contact; not proof of who
  physically worked it.

## rigs/{rigId}
| field | type | notes |
|---|---|---|
| label | string | e.g. "Rig #3" |
| equipmentType | string | tractor \| scraper \| other |
| googleAccountEmail | string | rig's Google account — used for both Firebase Auth sign-in and Calendar sync |
| authUid | string | Firebase Auth uid for that Google account — this is what security rules check |
| defaultOperatorName | string | self-updates to whoever last clocked in |
| status | string | active \| down \| retired |

## roster/{name-or-id}
Simple lookup list for the operator-tap picker. Not a security
principal — no auth relationship.
| field | type | notes |
|---|---|---|
| name | string | shown in the roster picker |
| active | boolean | lets you retire someone from the list without deleting history |

## admins/{authUid}  (supervisors + admins)
Keyed by the person's own Firebase Auth uid (their individual Google login).
| field | type | notes |
|---|---|---|
| name | string | |
| role | string | supervisor \| admin |

## jobs/{jobId}
| field | type | notes |
|---|---|---|
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
| entryId | ref → timeEntries (or jobId for metadata edits) | |
| field | string | "clockIn" \| "clockOut" \| "note" \| "jobName" \| "ownerName" |
| oldValue | string | |
| newValue | string | |
| editedByRigId | ref → rigs | the authenticated writer |
| editedByOperatorName | string | self-reported, for "who to contact" |
| editedAt | timestamp | |
