# Deployment

Two supported layouts:

- **A. Docker Compose on one server.** This is the recommended start: MongoDB, the API and the web front end run as containers, with HTTPS from a reverse proxy on the host.
- **B. Without Docker.** Node.js and nginx run directly on the server, with MongoDB managed elsewhere (for example MongoDB Atlas). Use this if your IT team prefers it.

Both use the same environment variables, documented in `server/.env.example`.

## Server sizing

For one site with tens of users and thousands of complaints a year: 2 vCPU, 4 GB RAM and 40 GB disk, plus space for attachments, which grow with photos. The load test in [PERFORMANCE.md](PERFORMANCE.md) ran comfortably on a similar machine with 10,000 complaints.

## A. Docker Compose

```bash
git clone <repository> /srv/sfa-cms && cd /srv/sfa-cms
cp server/.env.example server/.env
```

Fill in `server/.env`. At a minimum set these:

```
NODE_ENV=production
JWT_SECRET=<48+ random characters>
CLIENT_ORIGIN=https://complaints.example.com
APP_BASE_URL=https://complaints.example.com
MAIL_DRIVER=smtp
SMTP_HOST=...  SMTP_PORT=587  SMTP_USER=...  SMTP_PASSWORD=...
MAIL_FROM="Customer Relationship Management <no-reply@example.com>"
WHATSAPP_DRIVER=cloud
WHATSAPP_VERIFY_TOKEN=...  WHATSAPP_APP_SECRET=...  WHATSAPP_ACCESS_TOKEN=...  WHATSAPP_PHONE_NUMBER_ID=...
SEED_ADMIN_NAME=...  SEED_ADMIN_EMAIL=...  SEED_ADMIN_PASSWORD=<temporary>
```

`MONGODB_URI`, `STORAGE_DIR` and `TRUST_PROXY` are set by `docker-compose.yml`. The API refuses to start if a required value is missing, or if development drivers are configured in production. Fix whatever the log names.

Then start the stack and set up the first administrator:

```bash
docker compose up -d --build
docker compose ps                                   # all three should be healthy
docker compose exec api node src/scripts/seed.js    # roles + first administrator
docker compose exec api node src/scripts/syncIndexes.js
```

The first administrator must change the temporary password at first sign-in.

### HTTPS

The `web` container listens on `127.0.0.1:8080` only. Terminate HTTPS on the host with nginx and Let's Encrypt (or the company's certificate):

```nginx
server {
  listen 443 ssl http2;
  server_name complaints.example.com;
  ssl_certificate     /etc/letsencrypt/live/complaints.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/complaints.example.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  client_max_body_size 55m;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 120s;
  }
}
server { listen 80; server_name complaints.example.com; return 301 https://$host$request_uri; }
```

Then register `https://complaints.example.com/api/webhooks/whatsapp` as the WhatsApp webhook ([WHATSAPP.md](WHATSAPP.md)).

## B. Without Docker

1. Install Node.js 22 and nginx. Create a MongoDB 6+ replica set (Atlas M10 or larger, or a self-managed replica set with authentication).
2. Install and build:
   ```bash
   cd server && npm ci --omit=dev
   cd ../client && npm ci && npm run build
   ```
3. Set the same `.env` as in A, plus `MONGODB_URI`, `STORAGE_DIR=/srv/sfa-cms/storage` and `TRUST_PROXY=true`.
4. Run the API as a service. A systemd unit, `/etc/systemd/system/sfa-cms.service`:
   ```ini
   [Unit]
   Description=SFA Complaint Management API
   After=network.target
   [Service]
   User=sfacms
   WorkingDirectory=/srv/sfa-cms/server
   EnvironmentFile=/srv/sfa-cms/server/.env
   ExecStart=/usr/bin/node src/server.js
   Restart=always
   [Install]
   WantedBy=multi-user.target
   ```
5. Use `client/nginx.conf` for the site. Change `server api:4000` to `server 127.0.0.1:4000`, set `root` to `client/dist`, and add the HTTPS block above.
6. Run the seed and index scripts as in A, with `npm run seed` and `npm run db:indexes`.

## Upgrading

```bash
ops/backup.sh                         # always back up first
git pull
docker compose up -d --build          # or: npm ci, build, restart the service
docker compose exec api node src/scripts/syncIndexes.js
```

New permissions are given to the Administrator role automatically on start.

## Backups

`ops/backup.sh` writes three files: a compressed database dump, an archive of the attachments, and a checksum file. It deletes backups older than `BACKUP_RETENTION_DAYS` (default 30). Schedule it nightly at a quiet hour. Example cron on the Docker host, using the MongoDB tools inside the `mongo` container:

```cron
0 2 * * * cd /srv/sfa-cms && docker compose exec -T mongo mongodump --uri=mongodb://localhost:27017/sfa_cms --gzip --archive > /srv/backups/sfa-cms-$(date +\%F).db.archive.gz && docker run --rm -v sfa-cms_attachments:/s -v /srv/backups:/b alpine tar -C /s -czf /b/sfa-cms-$(date +\%F).storage.tar.gz .
```

Without Docker, use `MONGODB_URI=... STORAGE_DIR=... BACKUP_DIR=/srv/backups ops/backup.sh`.

**Copy backups off the server**, for example to company file storage or object storage with versioning. A backup on the same disk does not survive the loss of that disk.

**Restore** with `ops/restore.sh <backup-prefix> <target-uri> <target-storage-dir>`. It:
- verifies the checksums;
- refuses a non-empty target unless `--replace` is given;
- fails if nothing was restored.

Practise every quarter by restoring into a separate database (`sfa_cms_restoretest`) and starting an API against it. This procedure was tested in Phase 10: all 18 collections matched, every attachment checksum matched, and sign-in and downloads worked.

For point-in-time recovery, which loses minutes rather than up to a day, use a managed MongoDB with continuous backup (for example Atlas).

## Monitoring

- `GET /api/health` reports that the process is alive; `GET /api/health/ready` reports that the database is reachable (503 if not). Point uptime monitoring at `/api/health/ready`.
- Logs are JSON on stdout (pino). Collect them with the platform's log driver. Watch for:
  - `Unhandled error`;
  - `Notification send failed` with `final: true`;
  - `WhatsApp webhook with invalid signature rejected`.
- **Notification logs** in the app shows failed emails and WhatsApp messages; administrators can retry them.

## Go-live checklist

- [ ] HTTPS works; HTTP redirects to HTTPS; the session cookie is `__Host-sfa_session` and `Secure`.
- [ ] `NODE_ENV=production`, with a strong `JWT_SECRET` unique to this environment.
- [ ] SMTP sends: acknowledge a test complaint and check the inbox and Notification logs.
- [ ] The WhatsApp webhook is verified in Meta; sending "Hi" from a phone gets a reply.
- [ ] MongoDB is not reachable from outside the private network.
- [ ] The first administrator has changed the seeded password; demo users and "(demo)" list values are removed or replaced.
- [ ] Dropdown lists, chatbot SBUs and categories reflect company data (Q6, Q18).
- [ ] The nightly backup runs, is copied off-site, and one restore has been tested.
- [ ] Uptime monitoring is on `/api/health/ready`.
- [ ] Open business questions are reviewed ([OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)), especially D4 (Q9–Q12).
