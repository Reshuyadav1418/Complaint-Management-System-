# Security

This document covers the controls built into the system and the results of the Phase 10 review. Report security issues to the system owner, not in public issue trackers.

## Controls

| Area | Control |
| --- | --- |
| Sign-in | bcrypt-hashed passwords (cost 12), a policy of at least 10 characters with a letter and a digit, lockout after 5 failures for 15 minutes, a per-IP sign-in rate limit, and the same response time and message for unknown emails. |
| Sessions | Signed token in an `HttpOnly`, `SameSite=Lax` cookie; `Secure` with the `__Host-` prefix in production. A version check ends every session at once on password change or reset, role change, deactivation or "sign out everywhere". Temporary passwords must be changed before any other use. |
| Authorisation | Every route checks a named permission on the server; the web app only hides what the server would refuse. A complaint outside the user's visibility returns `404`, so ids cannot be probed. Workflow steps check role, current status, required data and, for D3 decisions, the assigned reviewer. Nobody can approve their own submission. |
| CSRF | `SameSite=Lax` cookies plus an `Origin`/`Referer` check on every state-changing request. |
| Input | Every body, query and path parameter is validated with zod. Unknown fields are dropped, and objects where strings are expected are rejected, which blocks NoSQL operator injection. Every regex built from user input is escaped. JSON bodies are capped at 200 KB. |
| Files | Extension, declared type and file signature must agree, so a renamed executable is rejected. Size and count are limited. Files are stored privately outside any web root, under server-generated names (path traversal guarded), and served only after a permission check with `nosniff`, a sandbox CSP and `no-store`. Each file has a SHA-256 hash. |
| Webhooks | The WhatsApp webhook needs a valid HMAC-SHA256 signature of the raw body (constant-time compare). The verification handshake uses a secret token. Redeliveries are ignored by message id. |
| Output | API responses are `Cache-Control: no-store`. Helmet sets HSTS, `nosniff`, frame options and a referrer policy. The web app sends a strict CSP (no inline or third-party scripts). Email templates HTML-escape complaint data. CSV exports neutralise spreadsheet formulas. Error responses never include stack traces or internal messages. |
| Secrets | Secrets come only from environment variables, which are validated at start-up; `.env` is git-ignored. The server refuses to start in production with development mail or WhatsApp drivers. Logs redact cookies and authorisation headers. |
| Audit | An append-only audit log records every complaint action, sign-in, user, role and setting change and data export, with actor, time, IP address and changed fields. No API can edit or delete it. |
| Availability | Per-IP rate limits on the API, sign-in and webhook, plus nginx request limiting. Request and header timeouts are set. Health and readiness endpoints let the platform restart unhealthy containers. |

## Phase 10 review findings

| Finding | Severity | Resolution |
| --- | --- | --- |
| `react-router` 6: open redirect via backslash paths, and SSR hydration issue (GHSA-wrjc-x8rr-h8h6, GHSA-337j-9hxr-rhxg) | Moderate; low here, because links are built from ids and there is no SSR | Upgraded to react-router 7.18.4; full browser regression run |
| `nodemon` → `braces` DoS (dev only) | High in development tooling, none in production | Removed; `npm run dev` now uses Node's built-in `--watch` |
| Tailwind build chain: `braces`, `postcss-selector-parser` | Build-time only, against our own config | Accepted: not shipped to users. Revisit with a Tailwind 4 upgrade |
| Simulator reachable in production if the mock driver was left on | Medium | Simulator is always disabled when `NODE_ENV=production` |
| Development mail or WhatsApp drivers silently usable in production | Medium: messages would never reach customers | Start-up refuses unless `ALLOW_DEV_DRIVERS=true` (staging only) |
| API responses cacheable by browsers or proxies | Low | `Cache-Control: no-store` on all API responses |
| Session cookie could be overwritten from a subdomain | Low | `__Host-` cookie prefix in production |
| No request timeouts | Low | 120 s request and 30 s header timeouts |
| Restore script reported success while restoring nothing (found by test-restoring) | High for disaster recovery | Fixed, and it now fails loudly when 0 documents are restored; verified by a full restore and comparison |

The automated `tests/hardening.test.js` covers: production start-up refusal, the secret-length check, security headers, `no-store`, readiness, error-detail leakage, the body size limit and operator injection.

Current audit status: server production dependencies have 0 vulnerabilities. Client runtime dependencies have 0; only the build-time Tailwind chain is noted above.

## Before go-live

- Run behind HTTPS only, and confirm the session cookie shows `Secure` and the `__Host-` prefix.
- Use a long random `JWT_SECRET`, different per environment, and keep it in a secret store.
- Set `TRUST_PROXY=true` behind nginx or a load balancer, so rate limits and the audit log record real client IPs.
- Restrict MongoDB to the private network, with authentication enabled and TLS if it runs on another host.
- Change the seeded administrator password; delete demo users and `(demo)` list values.
- Consider company single sign-on (Q17) instead of passwords.
- Schedule `ops/backup.sh`, copy backups off the server, and practise a restore every quarter.
