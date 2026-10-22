# SFA Complaint Management System

Internal web application for registering, investigating and closing customer, retailer and distributor complaints through the D1–D4 workflow, with WhatsApp intake and email notifications.

**Current build: Phases 1–7, 9 and 10.** Implemented and tested:

- authentication, role-based access, and user, role and department administration;
- the audit log and the complete database model;
- the central workflow service and complaint registration;
- the complaint list and detail pages, private file attachments, and a dashboard with live counts;
- D1 acknowledgement with its email, the email queue with retries, notification logs and pending reviews;
- D2 product verification, the preliminary investigation, FRP assignment and reassignment with emails, D2 completion, and admin-managed dropdown lists.;
- D3 analysis: Why-Why, a fishbone diagram generated from saved causes (PNG and PDF export), and root causes with numbered CAPA records.;
- D3 review: submission with readiness checks, approval or rejection by the assigned reviewer, "CAPA Rejected" emails, rework and resubmission, and a review history with frozen copies of every version.;
- WhatsApp complaint registration (chatbot, signed webhook, simulator) and reports with CSV export.

The system is hardened, load-tested and ready to deploy ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). D4 and closure (Phase 8) wait on business rules Q9–Q12. To connect real WhatsApp, see [docs/WHATSAPP.md](docs/WHATSAPP.md). See [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

| Document | Contents |
| --- | --- |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phase plan, what is done, architecture decisions |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Every collection, its fields, indexes and the duplicate guards |
| [docs/API.md](docs/API.md) | REST endpoints, permissions, request and response formats |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | Business rules that must be confirmed before later phases |
| [docs/WHATSAPP.md](docs/WHATSAPP.md) | Chatbot flow, simulator, and connecting the real WhatsApp account |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Docker Compose or plain-server deployment, HTTPS, backups, monitoring, go-live checklist |
| [docs/SECURITY.md](docs/SECURITY.md) | Security controls and the Phase 10 review findings |
| [docs/PERFORMANCE.md](docs/PERFORMANCE.md) | Load-test results with 10,000 complaints, and what was optimised |

## Requirements

Node.js 20 or newer, and MongoDB 6 or newer running as a replica set. A single-node replica set is fine for development; it is needed because later phases use transactions to keep a complaint, its history and its notifications consistent.

To start a local single-node replica set:

```bash
mongod --dbpath ./data --replSet rs0 --bind_ip 127.0.0.1
# in another terminal, once:
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

## First-time setup

```bash
# API
cd server
npm install
cp .env.example .env
# Edit .env: set JWT_SECRET (command is in the file), SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.
# For local HTTP also set COOKIE_SECURE=false.
npm run seed            # default roles + first administrator
npm run seed -- --demo  # optional: 3 departments and one demo user per role

# Web app
cd ../client
npm install
```

Demo users (`qc@`, `frp@`, `reviewer@`, `employee@example.test`) share `SEED_ADMIN_PASSWORD`. The seed refuses `--demo` when `NODE_ENV=production`, and never overwrites existing users or edited role permissions, so it is safe to run again.

## Running

```bash
cd server && npm run dev     # API on http://localhost:4000 (restarts on file changes)
cd client && npm run dev     # app on http://localhost:5173 (proxies /api to the API)
```

Sign in at http://localhost:5173 with the seeded administrator.

In development, emails are not sent. Each one is written to `server/mail-outbox/` as an `.eml` file, which opens in Outlook, Thunderbird or Apple Mail. To send real email, set `MAIL_DRIVER=smtp` and the `SMTP_*` values in `.env`. The email worker runs inside the API process and checks for due messages every `NOTIFY_POLL_SECONDS`.

## Tests

```bash
cd server
npm test
```

By default the suite starts a throwaway in-memory MongoDB replica set (the first run downloads a MongoDB binary). To use an existing server instead:

```bash
TEST_MONGODB_URI="mongodb://127.0.0.1:27017/sfa_cms_test?replicaSet=rs0" npm test
```

The test database is wiped between tests. Never point `TEST_MONGODB_URI` at a database you care about.

The suite has 145 tests:

- Sign-in, lockout and session ending.
- Role enforcement on direct API calls.
- User administration guards and audit trail contents.
- Complaint numbering, including concurrency and the IST year boundary.
- Database-level duplicate guards.
- Workflow transitions: wrong status, missing permission, required data, mandatory remarks, pending rules, idempotent retries and simultaneous clicks.
- Complaint visibility, including `404` for complaints outside a user's view.
- List search, filters and paging.
- D1 edit conflicts and change-only auditing.
- Attachment type sniffing, limits and access.
- D1 acknowledgement: exact email text, double clicks, retried requests, simultaneous approvals, refreshes and a missing email address.
- The email queue: deduplication, retry with backoff, giving up, manual retry, parallel workers and crash recovery.
- D2: validation against the lists, assignment and reassignment rules, simultaneous assignments, the email content and completion requirements.
- D3: who may start and edit, Why-Why versioning, the fishbone cause tree and its persistence, CAPA rules and numbering, and edit locks by stage.
- WhatsApp: handshake, signature rejection, duplicate deliveries, the full conversation with a photo, validation re-prompts, restart and cancel, double-tapped submit, WhatsApp outages, delivery receipts, the acknowledgement status message and simulator permissions.
- Reports: every figure against known data, caching, filters, visibility, permission, and CSV escaping.
- Hardening: production start-up refusals, security headers, `no-store`, readiness, error-detail leakage, body limits and operator injection.
- D3 review: readiness, self-review prevention, the full reject → rework → resubmit → approve cycle, the email contents, who may decide, frozen snapshots per version, and retry protection.

## Project structure

```
server/
  src/
    auth/permissions.js      permission catalogue and default roles
    config/                  env validation, logger, db, workflow vocabulary
    models/                  Mongoose schemas (all 17 collections)
    services/                business logic (auth, users, roles, audit, sequences)
    controllers/             thin HTTP handlers
    routes/                  route tables with permission and validation middleware
    validation/              zod request schemas
    middleware/              authenticate, authorize, validate, origin check, rate limits, errors
    scripts/seed.js
  tests/
client/
  src/
    api/                     axios client and endpoint wrappers
    auth/                    session context, navigation/permission map
    components/              Button, Field, Modal, Badge, Toast, states, pagination
    layout/AppShell.jsx      sidebar, header, user menu
    pages/                   login, password, dashboard, admin screens
docs/
```

## Production notes

Run the API behind HTTPS. `COOKIE_SECURE` defaults to `true` in production, and the session cookie will not be sent over plain HTTP. Behind a load balancer or reverse proxy, set `TRUST_PROXY=true` so client IPs in rate limiting and the audit log are correct.

Serve the built web app (`client/dist`) and the API from the same origin, with `/api` routed to the API. If they must be on different origins, set `VITE_API_BASE_URL` when building the client and `CLIENT_ORIGIN` on the API; cookies then need `SameSite=None`, which is a deliberate change to `sessionCookieOptions()` in `server/src/services/authService.js`.

In production `autoIndex` is off. Create or update indexes once per release with `npm run db:indexes` in `server/`.

Role permissions are cached for 30 seconds per API instance, so a permission change reaches every instance within that time.

Attachments are stored under `STORAGE_DIR` (default `./storage`), which must not be served by any web server and should be backed up with the database. For multiple API servers, use shared storage or the S3/Azure driver, which implements the interface in `server/src/storage/localStorage.js`.

Secrets live only in environment variables. `.env` and `storage/` are git-ignored.
