# Performance

Measured on the development container (4 vCPU, MongoDB 8 single-node replica set on the same machine) with `scripts/perf-seed.js`. The test data was 10,000 complaints over 22 months, 40 FRPs, about 12,000 root causes, 12,000 CAPA records and 60,000 audit entries. Load was generated with `autocannon`: 10 concurrent connections for 8 seconds per endpoint, signed in.

| Endpoint | p50 before | p50 after | p99 after | Requests/s after |
| --- | --- | --- | --- | --- |
| Complaint list (page 1) | 255 ms | 83 ms | 165 ms | 115 |
| Search 'Broken seal' | 440 ms | 248 ms | 328 ms | 39 |
| Filter: status + country, sorted | 65 ms | 62 ms | 90 ms | 156 |
| Complaint detail | 37 ms | 35 ms | 95 ms | 258 |
| Complaint history | 30 ms | 29 ms | 68 ms | 319 |
| FRP: my complaints (visibility) | 66 ms | 64 ms | 102 ms | 154 |
| Dashboard summary | 930 ms | 187 ms | 309 ms | 52 |
| Reports summary (all 10,000) | timed out | 15 ms | 47 ms | 527 |

There were no errors in any run after the fixes.

## What was changed, and why

All four fixes were found by measuring. Query plans were checked with `scripts/profile-queries.mjs`.

1. **Complaint list sort.** Sorting by "last updated" read all 10,000 documents and sorted them in memory (`COLLSCAN` + `SORT`). New indexes `{ lastActivityAt: -1, _id: -1 }` and `{ complaintDate: -1, _id: -1 }` match the sort exactly, so page 1 now reads 20 index entries and 20 documents.
2. **Dashboard counts.**
   - Grouping every complaint by status was replaced by one indexed count per status.
   - The "overdue" check had examined 7,999 documents; it now uses a partial index on `stageDueAt` and examines 0 while no deadlines are set.
3. **Reports: unnecessary filtering.** Child records (root causes, CAPA) were filtered by a list of every complaint id in scope. With full visibility and no filters, that list was all 10,000 ids, so the filter is now skipped.
4. **Reports: simultaneous requests.** When many users opened the page at once, each started the same heavy calculation (a "thundering herd") and all of them timed out. Results are now cached for 60 seconds per visibility scope and filter set, and simultaneous requests share one calculation in progress (single-flight). The response includes `calculatedAt`. A fresh calculation over 10,000 complaints takes about 1 second; cached responses take a few milliseconds.

## Known limits

**Search** matches any part of the complaint number, requester, description, customer, product or batch, so typing "Sun" finds "Sunil". That needs a scan, which costs about 45–70 ms for one user at 10,000 complaints and grows in proportion to the number of complaints. It is fine for an internal team. Above roughly 100,000 complaints, switch to MongoDB Atlas Search or a text index (whole-word matching).

**Reports** are up to 60 seconds behind live data, by design.

**Scaling.** A single API process handled 100–300 requests a second on list and detail pages in this test. Running several API containers behind nginx is safe:
- sessions are stateless cookies;
- the email worker claims each message atomically;
- the report and role caches are per process, with short lifetimes.

## Repeating the test

```bash
cd server
MONGODB_URI='mongodb://127.0.0.1:27017/sfa_cms_perf?replicaSet=rs0' JWT_SECRET=<32+ chars> node scripts/perf-seed.js 10000
MONGODB_URI='mongodb://127.0.0.1:27017/sfa_cms_perf?replicaSet=rs0' PORT=4100 RATE_LIMIT_PER_MINUTE=10000000 NOTIFY_WORKER=false node src/server.js
# sign in as admin@perf.test / Perf-pass-2026, then e.g.:
npx autocannon -c 10 -d 8 -H "Cookie=sfa_session=<cookie>" http://localhost:4100/api/complaints
```

The seed script refuses to run unless the database name ends in `_perf`.
