# Implementation plan

## Phase 1: repository inspection and requirement mapping

There was no existing repository, so this is a new implementation on the stack the brief specifies: React with Vite and Tailwind, Node.js with Express, and MongoDB with Mongoose.

The brief refers to screenshots of the current Salesforce-based workflow. They were not supplied, so every screen-specific detail has been taken from the brief's text. The places where the screenshots would decide something (field types, the RPN rule, option lists, exact labels) are recorded in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) rather than guessed.

### Requirement map

| Brief section | Where it lives | Phase |
| --- | --- | --- |
| 4. User roles | `auth/permissions.js`, `roles` collection, Users and roles screen | 2 (done) |
| Security: sessions, hashing, RBAC, validation, errors | `services/authService.js`, `middleware/` | 2 (done) |
| 14. Audit trail | `auditLogs` collection, `services/auditService.js` | 2 for users and roles (done); complaint events from 3 |
| 15. Database design | `server/src/models/`, [DATA_MODEL.md](DATA_MODEL.md) | 2 (done) |
| 6, 7. Complaint list and detail | complaint routes and screens | 3 (done) |
| 12. Stage transitions | `services/workflowService.js` | 3 (done); each stage switches its steps on |
| 8. D1 and acknowledgement email | `services/d1Service.js`, D1 tab | 4 (done) |
| 13. Email service and notification logs | `services/notificationService.js`, `mail/` | 4 (done); later templates added with their stages |
| 9. D2 and FRP assignment | `services/d2Service.js`, `services/lookupService.js`, D2 tab, Settings | 5 (done) |
| 10. D3: Why-Why, fishbone, root causes, CAPA | `services/d3Service.js`, `D3Tab.jsx`, `FishboneDiagram.jsx` | 6 (done) |
| 10E. Submission, approval, rejection, rework | `services/d3ReviewService.js`, `D3Review.jsx` | 7 (done) |
| 11. D4 and closure | D4 tab | 8, after rules are confirmed |
| 5. WhatsApp intake | `whatsapp/chatbot.js`, `whatsapp/adapters.js`, simulator | 9 (done) |
| 17. File uploads | `services/attachmentService.js`, `storage/` | 3 (done) |
| 18. Dashboard and reports | `/dashboard/summary`, `services/reportService.js` | 3 and 9 (done) |
| 19. Tests | `server/tests/` | every phase |

## Phase 2: delivered

**Authentication.** Email and password sign-in. bcrypt hashes. Signed session token in an `httpOnly`, `SameSite=Lax` cookie that is `Secure` in production.

Each user has a token version, checked on every request. Changing or resetting a password, deactivating the account, changing roles or choosing "sign out on all devices" increments it. That ends existing sessions immediately rather than when the token expires.

Sign-in is protected in three ways:
- A per-account lockout after a configurable number of failures.
- A per-IP rate limit.
- The same error message and similar timing whether or not the email exists.

**Temporary passwords.** An administrator never chooses a password for someone else. Creating a user or resetting a password produces a random temporary password, shown to the administrator once. Until the user replaces it, the API refuses everything except password change, sign-out and the session check.

**Role-based access.** Nineteen permissions are grouped into five default roles: Administrator, Quality Coordinator, FRP, Reviewer and Employee. Roles live in the database, so an administrator can change what a role may do from the permission matrix without a release.

Every route declares the permission it needs, and the server enforces it. The web app reads the same permission list only to decide what to show.

Permissions for D4 approval and closure exist so roles can be prepared, but no route uses them until those rules are confirmed.

**Administration.**
- Users: list with search, filters and paging; create, edit, deactivate, reactivate and reset password.
- Departments: create, edit and deactivate.
- The role permission matrix.
- A read-only activity log.

The server refuses three changes that would lock the organisation out: deactivating yourself, removing your own administrator role, and removing or deactivating the last active administrator.

**Audit log.** User, role and department changes and sign-in events are appended with the actor, timestamp, IP address and only the fields that changed. Passwords and hashes are stripped before writing. No route can edit or delete an entry.

**Data model.** All seventeen collections in the brief are defined with validation and indexes. The tables for later phases (assignments, stage records, RCA, fishbone causes, root causes, CAPA, attachments, notifications, WhatsApp messages and sessions) are present now, so later phases add behaviour rather than migrations.

Duplicate protection is built into the database, not left to application code:
- At most one active FRP assignment per complaint.
- Each WhatsApp message id is processed only once.
- Each notification is queued only once per business event.
- Each status transition is recorded only once per idempotency key.
- Two people saving the same complaint get a conflict instead of overwriting each other.

**Complaint numbering.** An atomic per-year counter produces numbers that stay unique when requests arrive at the same moment. The format and prefix are placeholders set through environment variables until the company's format is confirmed (Q1).

**Web app.** The app includes:
- Sign-in, forced and voluntary password change.
- A responsive shell whose navigation shows only permitted areas, with a mobile drawer.
- The Users and roles section.
- A dashboard that shows no invented figures.

Areas scheduled for later phases are routed, permission-checked, and say plainly that they are not available yet.

## Phase 3: delivered

**Workflow service.** One transition table covers every step from registration to closure: from and to status, required permission, data checks, required remarks and pending rules. `perform()` runs a conditional update, the status history row and the audit entry in one transaction.

Retries with the same idempotency key are harmless. When two people act at the same moment, exactly one succeeds. D4 and closure are refused until their rules are confirmed.

`availableActions()` tells the detail page what the next step is and, in plain language, why it is blocked.

**Complaint registration.** Staff can register complaints received by phone, email or web. The number, the record, the "register" transition and the audit entries commit together. WhatsApp registration (Phase 9) will call the same `createComplaint()` with no actor.

**Visibility.** Every read goes through one filter. Users with `view.all` see everything; `view.assigned` users see only complaints where they are the FRP or hold an active assignment. Everything else returns `404`, so complaint ids cannot be probed.

**List.** Search across number, requester, description, customer, product and batch. Filters for status, stage, SBU, country, origin, open and overdue. Sortable columns and paging. Filters live in the URL, so dashboard links and bookmarks work. "My assigned complaints" uses the same list narrowed to the user.

**Detail page.** The header shows the number, status, description and origin. Below it, a D1 → D2 → D3 → D4 → Closed stage tracker and a "next step" panel that explains any blockers. Then come the stage tabs (Synced files, D1, D2, D3, D4, SLA), an assignment panel and a history timeline.

D1 can be viewed and edited until acknowledgement. Edits carry the loaded version, so a stale save is refused rather than overwriting someone. The audit entry records only fields that really changed.

**Attachments.** Private storage behind a small driver interface: local disk now, with S3 or Azure as a drop-in later. Each file's extension, declared type and signature must agree, so a renamed executable is rejected. Size and count are limited. A request with any bad file stores nothing. Each file gets a SHA-256 hash, and downloads are permission-checked and streamed with safe headers.

**Dashboard.** Pipeline counts from live data, within the user's visibility. Each row links to the matching filtered list. Overdue stays at zero, with a note, until SLA rules exist.

**Bugs found and fixed during browser testing:**
- The audit log recorded unchanged fields as changes when the form sent empty values; there is now a regression test.
- Saving D1 reset the time of receipt to midnight, and the date picker used UTC, which can show the previous day in India.

## Phase 4: delivered

**D1 acknowledgement.** A user with `complaint.d1.acknowledge` opens a dialog showing exactly the email the requester will receive, with optional internal remarks, then approves.

A single transaction then:
- moves the status to "Acknowledged" through the workflow service;
- records the approver, time and remarks;
- stores a snapshot of the D1 data that was acknowledged;
- queues the email;
- writes the audit entry.

D1 is locked afterwards. Without a requester email, approval is blocked with a clear reason (see Q2a).

**Email exactly once.** Three separate guards, each tested:
- The workflow refuses a second acknowledgement.
- A retried request with the same idempotency key is answered without writing anything.
- The notification's unique `D1_ACK:<id>` key makes a second email impossible.

Opening or refreshing the page never sends anything.

**Email service.**
- **Queue:** messages are rendered once, at queue time, so retries send identical content, and queued inside the same transaction as the action, so a rolled-back action never emails.
- **Worker:** a background worker claims messages atomically, so parallel workers never double-send.
- **Retries:** delays grow from 1 minute to 3 hours; after `NOTIFY_MAX_ATTEMPTS` the email is marked Failed, with the error recorded and audited.
- **Recovery:** a sender that crashes mid-send loses its lock after 2 minutes, and the email is picked up again.
- **Statuses:** "Sent" means the mail server accepted the email. "Delivered" is reserved for providers that confirm delivery; plain SMTP cannot.

**Mail drivers.** `file` (development) writes standard `.eml` files to `mail-outbox/`. `smtp` uses the company relay. Switching is configuration only.

**Screens.**
- Pending reviews: the acknowledgement queue, oldest first, plus the D3 approval queue ready for Phase 7.
- Notification logs: filters, the message as received (in a sandboxed preview), the plain text, the error and a retry button.
- The email status shown on the complaint's D1 tab.

**Permissions.** Added `notifications.retry`. The Administrator role now automatically receives permissions added in new releases.

## Phase 5: delivered

**D2 form.** The tab covers:
- verified product information: product, batch, SKU, invoice quantity, performance/efficacy related, and remarks; it starts from the reported values, so the verifier only corrects what differs;
- priority;
- the preliminary investigation:
  - the A, B and C factors, each with an observation and a score;
  - RPN, entered manually until the formula is confirmed (Q5);
  - manufacturing location, and a location detail that depends on it;
  - repeat complaint, type of failure, and SLA hours for D3 and D4.

D2 can be edited only while in progress, with the same stale-save protection and change-only audit as D1.

**Dropdown lists.** Manufacturing locations, location details and failure types are administrator-managed under Settings. Values are validated on the server. A deactivated value stays on complaints that already use it and stays visible in their forms. Renaming a location keeps its details attached. Demo values are seeded only with `--demo` and are labelled "(demo)".

**FRP assignment.** The picker shows active employees whose role can investigate, with their open workload. One transaction assigns, queues the email and audits. The email follows the brief's field list and includes a "View Complaint Record" link, plus an urgency line for High or Critical priority.

Guards around assignment:
- Reassignment needs a reason and keeps the full history; access moves with it.
- Assigning the current FRP again does nothing.
- If two coordinators assign at once, exactly one succeeds, enforced by the one-active-FRP index and a conditional update.

**Completing D2.** Requires an FRP and the D2 required fields (a placeholder set, Q6c); the refusal says exactly what is missing. Completion stores a snapshot, locks D2 and emails the recipients set in `D2_COMPLETED_NOTIFY` (default: the FRP; Q6b).

**Stage tracker.** It now shows a stage as done when its work is finished (D2 completed, D3 approved), not only after the next stage starts.

## Phase 6: delivered

**Starting D3.** Only the assigned FRP can start D3, from D2 completed; the analysis record is created in the same transaction. From then on, only the current FRP can edit, plus see-everything users holding `complaint.d3.edit` (administrators) if the FRP is away. Everyone who can see the complaint can read the analysis. A former FRP loses access on reassignment. Nothing can change while the analysis waits for approval.

**Analysis.** The method selector allows Why-Why, Fishbone or both. The problem statement becomes the fishbone's head. Why-Why takes up to 10 levels; every saved version is kept in the audit trail.

**Fishbone.**
- Causes and sub-causes are stored as rows under the six categories (two levels).
- The diagram is SVG generated by a pure layout function (`layoutFishbone`) from the saved rows. It redraws when the data changes, grows taller as causes are added so labels never overlap, and shortens long labels (full text on hover).
- Removing a cause soft-deletes it and its sub-causes, so history is kept.
- Export to PNG (2×) or a one-page A4 PDF that also lists every cause in full. The PDF is about 130 KB, and the PDF library loads only when used.

**Root causes and CAPA.**
- Several root causes per complaint, each with its own CAPA records, numbered `<complaint number>-CAPA-01` and up.
- Required fields depend on whether CAPA is required.
- Action status (the work) is tracked separately from approval status (the D3 decision, Phase 7), so recording a CAPA never marks it complete.
- CAPA edits are versioned and audited.

**Found during browser testing and fixed:**
- the PDF was 4.7 MB because of an uncompressed PNG;
- the PDF title mangled the complaint number;
- the PDF lost long cause text;
- the CAPA table was too wide for the tab.

## Phase 7: delivered

**Submit.** The FRP opens "Submit for approval".
- A readiness check lists, in plain language, everything still missing:
  - an analysis method and a problem statement;
  - a complete Why-Why level and at least one fishbone cause, for whichever methods were chosen;
  - at least one root cause, with a CAPA or a "not required" record for each;
  - complete required CAPA fields.
- The FRP then picks a reviewer from users who hold the review permission (never themselves).

A single transaction then:
- moves the status to pending approval;
- increments the version;
- marks every CAPA submitted;
- records the reviewer as an assignment;
- stores a frozen snapshot of the complete analysis;
- queues the approval-request email and writes the audit entry.

The analysis is locked while under review.

**Decide.**
- **Who:** only the assigned reviewer decides. An administrator may stand in, but nobody can decide on their own submission, even an administrator acting as FRP.
- **Approval:** CAPA records become Approved, while their action status stays as it was, because approving the plan is not doing the work.
- **Rejection:** remarks are required; one "CAPA Rejected – Action Required – <CAPA number>" email per CAPA goes to the FRP, with all eleven fields in the brief; the analysis reopens for rework.

**Rework and history.**
- The FRP sees a "Returned for rework" banner with the reviewer's remarks, corrects the analysis and resubmits (version 2, and so on).
- The review history lists every submission and decision. "View as submitted" opens the frozen copy of any version, including its fishbone, so a rejected version stays readable after the corrections.

**Repeat protection.** A retried submit or decision with the same idempotency key returns the earlier result. The replay is now checked before the status check; testing caught a case where a retry was wrongly refused. A second plain click gets `409`.

## Phase 9: delivered

**WhatsApp chatbot.** It collects every field in the brief, with buttons and lists where WhatsApp supports them, validation with friendly re-prompts, up to 5 photos or documents, and a confirmation summary. "Hi" restarts and "cancel" stops.

The webhook has:
- Meta's verification handshake;
- an HMAC signature check on the raw body;
- duplicate-message protection;
- per-message error isolation;
- delivery receipts that mark notifications Delivered or Failed.

The complaint is created through the same `createComplaint()` as staff registration. The reply with the complaint number goes through the notification queue (retried), and acknowledging a WhatsApp complaint also sends a WhatsApp status message.

There are two drivers (`cloud`, `mock`) behind one interface. An in-app simulator drives the real webhook code. The connection guide is in [WHATSAPP.md](WHATSAPP.md).

**Reports.** Built from live data within the user's visibility, filterable by date, SBU and country:
- the figures strip: totals, open versus closed, average resolution days, average hours to acknowledge, and overdue CAPA;
- breakdowns by category, month, source, status and root cause category;
- CAPA action and approval status;
- FRP workload;
- an overdue CAPA list with links.

SLA is reported honestly as "not configured" until its rules exist. A CSV export, safe against spreadsheet formula injection, is audited.

**Found in testing and fixed:**
- queued WhatsApp messages were missing from the conversation log;
- report ties sorted "Uncategorised" before named categories;
- the CAPA bars had no room in the half-width panel.

## Architecture decisions

**Sessions are signed cookies with a server-side revocation check, not a session store.** The token carries only the user id and token version. Checking the version on each request is one indexed read, the same read needed to confirm the user is still active. This gives immediate revocation without running Redis. If request volume makes the extra read matter, a short cache can be added in `resolveSession`.

**CSRF protection is SameSite plus an origin check.** Cookies are `SameSite=Lax`, and every state-changing request must come from `CLIENT_ORIGIN` when the browser sends an Origin or Referer header. The WhatsApp webhook will be mounted before this check and authenticated by Meta's signature header instead.

**Business logic lives in services, not routes.** Routes declare permission and validation; controllers translate HTTP; services hold the rules and write the audit entries. The Phase 3 workflow service will be the only code allowed to change `complaint.status`.

**Status names are internal.** `config/workflow.js` holds a proposed state list. Display labels are separate from the stored keys, so the company's confirmed names can be applied without migrating data (Q3).

**Diagrams are generated, never stored as images.** Fishbone causes are rows. The diagram is drawn from them each time, and exports are rendered on demand.

## Phases 3–10

**Phase 8: D4 and closure (waiting on Q9–Q12).** A stage framework built from the existing components. The transitions `startD4` and `close` already exist and are refused until the rules are confirmed.

## Phase 10: delivered

**Security review** ([SECURITY.md](SECURITY.md)).
- Dependency audit: upgraded react-router to 7, and removed nodemon in favour of Node's built-in `--watch`.
- Code review: regular expressions, injection, id lookups and every route's guard.
- Fixes:
  - the simulator is always off in production;
  - start-up refuses development drivers in production;
  - `no-store` on all API responses;
  - `__Host-` session cookie;
  - request timeouts;
  - a readiness endpoint.
- The production build was run behind nginx with a strict CSP and exercised in a browser: 0 violations.

**Performance** ([PERFORMANCE.md](PERFORMANCE.md)). Load-tested with 10,000 complaints. This found and fixed:
- a full-collection sort on the complaint list (255 → 83 ms);
- dashboard scans (930 → 187 ms);
- reports timing out under concurrent use (now 15 ms, with a 60-second cache and single-flight).

**Backups.** `ops/backup.sh` and `ops/restore.sh`, tested by restoring into a separate database: every collection and attachment checksum matched, and the app ran on the copy. Testing found that the restore script reported success while restoring nothing; this is fixed and the script now fails loudly.

**Deployment** ([DEPLOYMENT.md](DEPLOYMENT.md)).
- Dockerfiles for the API (non-root, health check) and the web front end (non-root nginx);
- `docker-compose.yml`, with replica-set initialisation;
- a GitLab CI pipeline: tests, dependency audit, build;
- an HTTPS reverse-proxy example and a systemd alternative;
- monitoring guidance and a go-live checklist.
