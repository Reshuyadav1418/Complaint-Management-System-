# API reference (Phases 2–7 and 9)

Base path `/api`. JSON in and out. Every endpoint except `/health`, `/auth/login` and `/auth/logout` requires the `sfa_session` cookie set by sign-in.

## Conventions

A successful response looks like this:

```json
{ "data": ..., "meta": { "page": 1, "limit": 20, "total": 57, "totalPages": 3 } }
```

`meta` appears on paged lists, and on `GET /roles`, where it carries the permission labels.

An error response looks like this:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Some fields need attention.",
             "details": [{ "field": "email", "message": "Enter a valid email address." }] } }
```

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | Malformed request, or a rule such as "admin must keep roles.manage" |
| 401 | `UNAUTHENTICATED` | No session, expired session, or wrong email or password |
| 403 | `FORBIDDEN` | Signed in but missing the permission, or the request came from a foreign origin |
| 403 | `PASSWORD_CHANGE_REQUIRED` | User must replace a temporary password first |
| 404 | `NOT_FOUND` / `ROUTE_NOT_FOUND` | Record or endpoint does not exist |
| 409 | `CONFLICT` | Would break a rule (last admin), or someone else saved the record first |
| 422 | `VALIDATION_FAILED` | Field errors in `details` |
| 423 | `ACCOUNT_LOCKED` | Too many failed sign-ins |
| 429 | `RATE_LIMITED` | Slow down |

**Paging:** `?page=` (from 1) and `?limit=` (default 20, maximum 100).

**Origin rule:** `POST`, `PUT`, `PATCH` and `DELETE` requests from a browser must come from `CLIENT_ORIGIN`.

## Auth

| Method and path | Auth | Body | Notes |
| --- | --- | --- | --- |
| `POST /auth/login` | none | `{ email, password }` | Sets the cookie. Returns `{ user, permissions }`. Rate limited per IP. |
| `POST /auth/logout` | none | | Clears the cookie. `204` |
| `GET /auth/me` | session | | `{ user, permissions }`. Works during a pending password change. |
| `POST /auth/change-password` | session | `{ currentPassword, newPassword }` | Policy: 10–128 characters, at least one letter and one number. Ends other sessions and reissues this one's cookie. |
| `POST /auth/logout-all` | session | | Ends every session for this user. `204` |

## Users (`users.manage`)

| Method and path | Body or query | Notes |
| --- | --- | --- |
| `GET /users` | `search, role, department, status=active\|inactive\|all, page, limit` | Search matches name, email or employee ID. |
| `POST /users` | `{ name, email, roles[], employeeId?, phone?, designation?, department?, password? }` | Returns `{ user, temporaryPassword }`. The temporary password is generated when `password` is omitted, and is returned only this once. |
| `GET /users/:id` | | |
| `PATCH /users/:id` | any of the create fields, plus `isActive` | Deactivating a user or changing their roles ends their sessions. Refuses self-deactivation, removing your own admin role, and removing the last admin (`409`). |
| `POST /users/:id/reset-password` | | Returns `{ temporaryPassword }`. Unlocks the account and ends its sessions. |
| `GET /users/directory` | `role, search` | Active users for assignment pickers. Needs `users.manage`, `complaint.assign` or `complaint.d3.edit`. Returns at most 50. |

## Roles and departments

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /roles` | `roles.manage` or `users.manage` | `meta.permissionLabels` maps each key to its label. |
| `PUT /roles/:key/permissions` | `roles.manage` | `{ permissions: [...] }` replaces the role's set. Unknown keys get `422`. The Administrator role must keep `roles.manage`. Applies within 30 seconds. |
| `GET /departments` | any signed-in user | `?includeInactive=true`. Each department includes `activeUsers`. |
| `POST /departments` | `departments.manage` | `{ name, code }`. The code is 2–20 characters from A–Z, 0–9, `-` and `_`. |
| `PATCH /departments/:id` | `departments.manage` | Any of `name`, `code`, `isActive`. |

## Audit and reference data

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /audit-logs` | `audit.view` | `?entityType=User\|Role\|Department&action=...`, newest first, 50 per page. |
| `GET /meta` | any signed-in user | Workflow stages, statuses (key, label, stage), origins, reporter types, fishbone categories. |
| `GET /health` | none | `{ "status": "ok" }` |

## Complaints (Phase 3)

Reading needs `complaint.view.all` (every complaint) or `complaint.view.assigned`. With the second, a user sees only complaints where they are the current FRP or hold an active assignment.

A complaint outside a user's view always returns `404`, never `403`. That way nobody can learn whether a guessed id exists, and the rule applies to every route under `/complaints/:id`.

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /complaints` | view | Query: `search` (number, requester, description, customer, product or batch), `status` (comma-separated), `stage`, `sbu`, `country`, `origin`, `frp`, `from`, `to`, `open=true`, `overdue=true`, `mine=true`, `sort=number\|date\|updated\|status\|sbu\|country`, `order=asc\|desc`, `page`, `limit`. |
| `GET /complaints/filters` | view | `{ sbus, countries }`, only from complaints the user can see. |
| `POST /complaints` | `complaint.create.manual` | Registers a staff-entered complaint: D1 fields plus `origin` (`Phone`, `Email` or `Web`). In one transaction it assigns the number, sets the status to `D1_ACK_PENDING`, and writes the history and audit entries. Returns `201` with the complaint. |
| `GET /complaints/:id` | view | `{ complaint, nextActions[], attachmentCount, can: { editD1, upload } }`. Each next action carries `allowed` and plain-language `blockers`. |
| `PATCH /complaints/:id/d1` | view, plus `complaint.d1.acknowledge` or `complaint.create.manual` | Send any D1 fields plus the required `version`, which is the `__v` you loaded. A stale version gets `409` and nothing is saved. An empty string clears an optional field. Refused (`409`) once the complaint is acknowledged. |
| `GET /complaints/:id/history` | view | Audit entries for the complaint, newest first. |
| `GET /complaints/:id/attachments` | view | File metadata. The storage location is never returned. |
| `POST /complaints/:id/attachments` | view and `attachment.upload` | `multipart/form-data`: `files` (1–5 files, 10 MB each by default) and an optional `stage` (`SYNCED`, `D1`–`D4`). The extension, declared type and file signature must agree. If any file is invalid, none are stored. |
| `GET /complaints/:id/attachments/:attachmentId/download` | view | Streams the file. Add `?inline=1` to view an image or PDF in the browser. It is served with `nosniff`, a sandbox CSP and `no-store`. |
| `GET /dashboard/summary` | any signed-in user | Counts within the user's visibility: `total`, `newLast24h`, `awaitingAcknowledgement`, `awaitingAssignment`, `inInvestigation`, `pendingApproval`, `rework`, `inD4`, `closed`, `overdue`, `assignedToMe`, `byStatus[]`. |

### Registration body

```json
{
  "origin": "Phone",
  "complaintDate": "2026-10-21T05:30:00.000Z",
  "requester": { "name": "Sunil Traders", "email": "sunil@example.test", "mobile": "+91 98390 11111", "type": "Retailer" },
  "sbu": "AHP-Rumicare", "country": "India", "headQuarter": "Lucknow", "category": "Packaging",
  "shortDescription": "Seal on 3 bottles broken on delivery",
  "additionalRemarks": "",
  "customer": { "name": "Sunil Traders", "code": "" },
  "reportedProduct": { "name": "Rumicare Bolus", "batchNumber": "RB2409" }
}
```

Required: `origin`, `requester.name`, `sbu`, `country` and `shortDescription`. `complaintDate` defaults to now and cannot be in the future.

## D1 acknowledgement (Phase 4)

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /complaints/:id/acknowledgement-preview` | view and `complaint.d1.acknowledge` | `{ to, subject, text }`: exactly what the requester will receive. Changes nothing. |
| `POST /complaints/:id/acknowledge` | view and `complaint.d1.acknowledge` | Body `{ remarks?, idempotencyKey? }`. One transaction: `D1_ACK_PENDING` → `D1_ACKNOWLEDGED`, approver and time recorded, D1 snapshot stored, email queued (dedupe key `D1_ACK:<id>`), audit entry written. A second click gets `409`. A repeat with the same `idempotencyKey` returns `200` and writes nothing. No requester email gives `422`. |
| `GET /complaints/:id/notifications` | view | Emails for this complaint with status, attempts and last error (no message body). |

## D2 (Phase 5)

| Method and path | Permission | Notes |
| --- | --- | --- |
| `POST /complaints/:id/start-d2` | view and `complaint.d2.edit` | `D1_ACKNOWLEDGED` → `D2_IN_PROGRESS`. Body `{ remarks?, idempotencyKey? }`. |
| `PATCH /complaints/:id/d2` | view and `complaint.d2.edit` | Body `{ version, priority?, verifiedProduct?, investigation? }`, allowed only while D2 is in progress. `investigation` holds `occurrences`, `affectedQuantity` and `severity` as `{ value, score }`, plus `rpn`, `manufacturingLocation`, `locationDetail`, `repeatComplaint`, `typeOfFailure`, `slaHoursD3` and `slaHoursD4`. Dropdown values must be active list values, and a location detail must belong to the chosen location. Empty strings clear a field. A stale `version` gets `409`. |
| `GET /complaints/frp-candidates` | `complaint.assign` | Active users whose role can investigate (`complaint.d3.edit`), each with `openComplaints`. |
| `POST /complaints/:id/frp` | view and `complaint.assign` | Body `{ assigneeId, reason? }`; `reason` is required when reassigning. In one transaction it ends the previous assignment, creates the new one, sets `complaint.frp`, queues the "First Responsible Person Assigned" email and writes the audit entry. Re-assigning the current FRP returns `unchanged: true` and does nothing. When two assignments race, one gets `409`. |
| `GET /complaints/:id/assignments` | view | FRP assignment history, newest first: who, by whom, when, the reason, and when and by whom it ended. |
| `POST /complaints/:id/complete-d2` | view and `complaint.d2.edit` | Requires an FRP plus the D2 required fields; the `422` response lists what is missing. Records `d2.completedBy` and `d2.completedAt` and a D2 snapshot, and emails the recipients set in `D2_COMPLETED_NOTIFY`. |

## D3 root cause analysis and CAPA (Phase 6)

**Who may write:** a user with `complaint.d3.edit` who is the complaint's current FRP. Users who see every complaint and also hold `complaint.d3.edit` (administrators) may cover for them.

**When:** only in `D3_IN_PROGRESS` or `D3_REWORK`. A coordinator gets `403`, a former FRP gets `404`, and an edit while the analysis waits for approval gets `409`.

Every write returns the full D3 state, so the screen and the diagram refresh from one response.

| Method and path | Notes |
| --- | --- |
| `POST /complaints/:id/start-d3` | FRP only. `D2_COMPLETED` → `D3_IN_PROGRESS`, and creates the analysis record in the same transaction. |
| `GET /complaints/:id/d3` | Readable by anyone who can see the complaint. Returns `{ analysis, categories, fishbone, rootCauses[] (each with capas[]), canEdit }`. `fishbone` maps each category to its causes, each with `children` (its sub-causes); this is the data the diagram is drawn from. |
| `PATCH /complaints/:id/d3/analysis` | `{ version, methods?, problemStatement?, whyWhy?: [{ why, because }] }`. Levels are renumbered 1–n. A stale version gets `409`. Every earlier version is kept in the audit trail. |
| `POST /complaints/:id/d3/causes` | `{ category, text }`, or `{ text, parent }` for a sub-cause. A sub-cause takes its parent's category. Only two levels are allowed. |
| `PATCH /complaints/:id/d3/causes/:causeId` | `{ text?, category? }`. Moving a main cause carries its sub-causes with it. |
| `DELETE /complaints/:id/d3/causes/:causeId` | Soft delete of the cause and its sub-causes. They leave the diagram but stay stored and audited. |
| `POST /complaints/:id/d3/root-causes` | `{ category, description, sourceCause? }`. A complaint can have several root causes. |
| `PATCH / DELETE /complaints/:id/d3/root-causes/:rootCauseId` | Removing a root cause also removes its CAPA records (soft delete). |
| `POST /complaints/:id/d3/root-causes/:rootCauseId/capa` | `{ capaRequired, category?, description?, correctiveAction?, preventiveAction?, responsiblePerson?, targetDate?, actionStatus? }`. If CAPA is required, corrective action, responsible person and a target date (not in the past) are mandatory. If not, a justification is mandatory and the status becomes `NOT_REQUIRED`. Numbered `<complaint number>-CAPA-01` and up. |
| `PATCH / DELETE /complaints/:id/d3/capa/:capaId` | PATCH takes `version` for conflict detection. |

## D3 submission and review (Phase 7)

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /complaints/:id/d3/readiness` | view | `{ issues: [] }`: plain-language list of what is missing before the analysis can be submitted. |
| `GET /complaints/reviewer-candidates` | `complaint.d3.edit` | Active users whose role can review D3, excluding the person asking. |
| `POST /complaints/:id/d3/submit` | current FRP (as for D3 edits) | Body `{ reviewerId, remarks?, idempotencyKey? }`. Works from `D3_IN_PROGRESS` (submit) or `D3_REWORK` (resubmit). All readiness issues and an invalid reviewer (including yourself) come back together as `422`. In one transaction: status → `D3_PENDING_APPROVAL`; analysis version +1; all CAPA records `SUBMITTED` / `PENDING`; a reviewer assignment created; a frozen snapshot of the whole analysis stored; the approval-request email queued to the reviewer; audit entry written. |
| `POST /complaints/:id/d3/approve` | `complaint.d3.review`, and the assigned reviewer or an administrator; never the submitter | Body `{ remarks?, idempotencyKey? }`. Status → `D3_APPROVED`; CAPA records `REVIEWED` / `APPROVED`. Action statuses are unchanged: approval is not completion. |
| `POST /complaints/:id/d3/reject` | same as approve | Body `{ remarks, idempotencyKey? }`. Remarks are required (`422` without). Status → `D3_REWORK`; CAPA records `REVIEWED` / `REJECTED`; one "CAPA Rejected – Action Required – <CAPA number>" email per CAPA record to the FRP. The FRP can then edit again and resubmit. |
| `GET /complaints/:id/d3/reviews` | view | All submissions and decisions, newest first, with `version`, `remarks`, and for submissions the frozen `snapshot` (problem, Why-Why, fishbone tree, root causes and CAPA as submitted, plus the reviewer). |

`GET /complaints/:id` also returns `review` (`{ analysisStatus, version, submittedBy, submittedAt, reviewer }`) and `can.reviewD3`.

## Reports (Phase 9)

Both endpoints need `reports.view`. Figures are limited to the complaints the user can see. Filters: `from`, `to` (ISO dates, on complaint date), `sbu`, `country`.

| Method and path | Notes |
| --- | --- |
| `GET /reports/summary` | Returns: `total`; `openVsClosed`; `byCategory`, `bySource`, `byStatus` and `bySbu`, each as `[{ key, label, count }]`; `monthly`; `resolution { closedCount, averageDays }`; `acknowledgement { acknowledgedCount, averageHours }`; `workload[]` per FRP; `rootCauseCategories[]`; `capa { byAction, byApproval, overdue, overdueList[] }`; `sla { configured: false, note }`. The definitions are at the top of `services/reportService.js`. |
| `GET /reports/complaints.csv` | UTF-8 CSV (with BOM, for Excel), 20 columns. Cells starting with `= + - @` are prefixed with `'`, so a complaint description cannot run as a spreadsheet formula. Each export is recorded in the audit log. |

## WhatsApp (Phase 9)

| Method and path | Auth | Notes |
| --- | --- | --- |
| `GET /webhooks/whatsapp` | none | Meta's verification handshake. Echoes `hub.challenge` only when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`; otherwise `403`. |
| `POST /webhooks/whatsapp` | `X-Hub-Signature-256` | Raw-body HMAC check with `WHATSAPP_APP_SECRET`; a bad signature gets `401`. Processes messages and delivery statuses. Always answers `200` once the request is authenticated, so Meta does not resend; failures are logged per message. |
| `POST /dev/whatsapp/messages` | `settings.manage` or `complaint.create.manual`, mock mode only | Simulator. Body `{ waId, name?, text? \| reply: { id, title }? \| file: { base64, mimeType, filename, caption? }? }`. Builds a Meta-shaped payload and runs it through the webhook processing. |
| `GET /dev/whatsapp/messages?waId=` | same | The conversation log: inbound and outbound messages, including queued confirmations. |
| `DELETE /dev/whatsapp/messages?waId=` | same | Clears a simulator conversation. |

See [WHATSAPP.md](WHATSAPP.md) for the conversation flow and how to connect the real account.

## Dropdown lists (Phase 5)

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /lookups` | any signed-in user | `{ definitions, lists: { manufacturingLocation, locationDetail, typeOfFailure } }`. Add `?includeInactive=true` for the settings screen. |
| `POST /lookups` | `settings.manage` | `{ list, value, parent? }`. `parent` (a manufacturing location) is required for `locationDetail`. Duplicates are rejected, ignoring case. |
| `PATCH /lookups/:id` | `settings.manage` | Any of `value`, `order`, `active`, `parent`. Renaming a location carries its details along. |

## Notification logs (Phase 4)

| Method and path | Permission | Notes |
| --- | --- | --- |
| `GET /notifications` | `notifications.view` | Filters: `status` (`QUEUED`, `SENT`, `DELIVERED`, `FAILED`), `type`, and `search` (recipient, subject or complaint number). Paged. |
| `GET /notifications/:id` | `notifications.view` | Includes `bodyText` and `bodyHtml`. |
| `POST /notifications/:id/retry` | `notifications.retry` | `FAILED` only. Requeues the email with fresh attempts. Anything else gets `409`, so a sent email can never be sent twice. |

## Workflow

Status changes go through `server/src/services/workflowService.js`, the only code that writes `complaint.status`. Its transition table lists, for every step: the from and to status, the permission required, any data checks, whether remarks are required, and whether the rules are still pending.

Each transition is a conditional update inside a transaction, so two simultaneous clicks cannot both succeed; one gets `409`. A repeated request carrying the same `idempotencyKey` returns the earlier result and writes nothing.

Switched on so far: `register` (Phase 3), `acknowledge` (Phase 4), `startD2` and `completeD2` (Phase 5), `startD3` (Phase 6), and `submitD3`, `resubmitD3`, `approveD3` and `rejectD3` (Phase 7). `startD4` and `close` stay refused until the D4 rules are confirmed. The other steps are switched on by their stage endpoints in later phases.

## Permission keys

The keys are grouped by area:

- Complaints:
  - `complaint.view.all`, `complaint.view.assigned`, `complaint.create.manual`;
  - `complaint.d1.acknowledge`, `complaint.d2.edit`, `complaint.assign`, `complaint.d3.edit`, `complaint.d3.review`;
  - `complaint.d4.edit`, `complaint.d4.approve`, `complaint.close` (rules pending);
  - `attachment.upload`.
- Oversight: `reports.view`, `audit.view`, `notifications.view`.
- Administration: `users.manage`, `roles.manage`, `departments.manage`, `settings.manage`.

The default role assignments are in `server/src/auth/permissions.js`, and the matrix screen shows them.

## Trying it with curl

```bash
curl -c jar.txt -H 'Content-Type: application/json' \
     -d '{"email":"admin@example.test","password":"..."}' http://localhost:4000/api/auth/login
curl -b jar.txt http://localhost:4000/api/users?limit=5
```


