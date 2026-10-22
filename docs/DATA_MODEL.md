# Data model

All schemas are in `server/src/models/`. Collection names below are Mongoose's defaults (lower-case plural). Every collection is defined now; the "Used from" column shows when application code starts reading and writing it.

## Relationships

```
users ──< complaintassignments >── complaints ──< complaintstatushistories
  │                                     │
  │                                     ├──< complaintstagerecords   (acknowledgements, submissions, decisions + snapshots)
  │                                     ├──1 rootcauseanalyses ──< fishbonecauses (self-referencing for sub-causes)
  │                                     │                     └──< rootcauses ──< caparecords ──> complaintattachments (evidence)
  │                                     ├──< complaintattachments
  │                                     ├──< notifications
  │                                     └──< whatsappmessages
  └── department ──> departments

auditlogs: append-only, references any entity and, where relevant, the complaint
roles:     permission sets referenced by users.roles (by key)
counters:  atomic sequences for complaint and CAPA numbers
whatsappsessions: chatbot state per sender, expires after 24h
```

## Collections

| Collection | Purpose | Used from |
| --- | --- | --- |
| `users` | Staff accounts, roles, lockout and session-version fields | Phase 2 |
| `roles` | Role key, name, description, permission list | Phase 2 |
| `departments` | Name, code, active flag | Phase 2 |
| `auditlogs` | Who did what, when, from where, with changed fields | Phase 2 |
| `counters` | Sequences: `complaint:<year>`, `capa:<complaint number>` | Phase 2 |
| `complaints` | The complaint record with D1 and D2 data, current stage and status | Phase 3 |
| `complaintstatushistories` | Every status transition, with idempotency key | Phase 3 |
| `complaintassignments` | FRP and reviewer assignments, including ended ones | Phase 5 |
| `complaintstagerecords` | Stage decisions, each with a snapshot of the data decided on | Phase 4 |
| `complaintattachments` | File metadata; bytes live in private storage | Phase 3 |
| `notifications` | Every outbound email and WhatsApp message and its delivery state | Phase 4 |
| `rootcauseanalyses` | One per complaint: methods, problem statement, Why-Why steps, review state | Phase 6 |
| `fishbonecauses` | Causes and sub-causes by category; the diagram's source data | Phase 6 |
| `rootcauses` | Confirmed root causes with category and description | Phase 6 |
| `caparecords` | Corrective and preventive action per root cause | Phase 6 |
| `whatsappmessages` | Raw inbound and outbound message log | Phase 9 |
| `whatsappsessions` | Chatbot progress per sender | Phase 9 |

## Key fields

**complaints** holds three groups of fields.

D1 fields:
- `complaintNumber`: unique and immutable.
- `complaintDate` and `origin` (WhatsApp, Web, Email, Phone).
- `requester` (`name`, `email`, `mobile`, `type`), `sbu`, `country`, `headQuarter`, `shortDescription`, `additionalRemarks`, `category`.
- `customer` (`name`, `code`) and `reportedProduct` (`name`, `batchNumber`).
- `acknowledgement` (`approvedBy`, `approvedAt`, `remarks`).

D2 fields:
- `d2.verifiedProduct`: `performanceRelated`, `productName`, `batchNumber`, `sku`, `invoiceQuantity`, `remarks`.
- `d2.investigation`:
  - `occurrences`, `affectedQuantity` and `severity`, each a `{ value, score }` pair;
  - `rpn`, `manufacturingLocation`, `locationDetail`, `repeatComplaint`, `typeOfFailure`;
  - `slaHoursD3` and `slaHoursD4`.

Workflow fields: `frp` (the current FRP, kept here for fast listing), `priority`, `stage`, `status`, `stageDueAt`, `closedAt` and `lastActivityAt`.

The reported product and the verified product are kept separately on purpose. The reporter's claim and the company's verified finding can differ, and both need to be kept.

**caparecords** tracks three separate states. `actionStatus` covers the work: not started, in progress, completed, verified or not required. `reviewStatus` and `approvalStatus` cover the D3 decision. Recording a root cause never marks its action complete.

**notifications** separates `SENT` (the provider accepted the message) from `DELIVERED` (the provider confirmed delivery). Plain SMTP never reports delivery, so email stays at `SENT` unless the chosen provider sends delivery events.

## Duplicate and race protection

| Risk | Guard |
| --- | --- |
| Two complaints get the same number | Atomic counter increment, plus a unique index on `complaintNumber` |
| A retried "assign FRP" creates two active FRPs | Partial unique index: one `active: true` row per complaint and role |
| Meta redelivers a webhook and a complaint is registered twice | Unique index on `whatsappmessages.waMessageId` |
| A page refresh sends the acknowledgement email twice | Unique `notifications.dedupeKey`, e.g. `D1_ACK:<complaintId>` |
| A double-clicked transition is recorded twice | Unique `(complaint, idempotencyKey)` on status history |
| Two people edit the same complaint and one overwrites the other | Optimistic concurrency on `complaints`, `rootcauseanalyses` and `caparecords`; a stale save gets HTTP 409 |

## Indexes

The brief's indexing requirements map as follows:

| Requirement | Index |
| --- | --- |
| Complaint number | `complaints.complaintNumber` (unique) |
| Status and stage | `{ status, stage, lastActivityAt }` |
| Assigned employee | `{ frp, status }`, plus `complaintassignments.{ assignee, active }` |
| Creation date | `complaintDate` and `createdAt` |
| SBU and country | `{ sbu, country }` |
| Product and batch | `reportedProduct.name`, `reportedProduct.batchNumber` and `d2.verifiedProduct.batchNumber` |

Audit entries are indexed by complaint, by entity, by actor and by action, each with time descending.

## What is deliberately not stored

- Plain-text passwords, including temporary ones; the administrator sees a temporary password once, in the API response.
- Drawn diagrams; the fishbone is generated from `fishbonecauses` each time.
- File contents in MongoDB; only metadata is stored.
- Any copy of status that could drift from the history. `complaints.status` is the current value, `complaintstatushistories` is the record, and only the workflow service writes both, in one transaction.
