# ClearChain

**Live demo:** [https://clearchain.dmoroz.dev/](https://clearchain.dmoroz.dev/)
**Username:** `testUser`
**Password:** `ClearChain-Demo-7fQ2`

<img width="1899" height="871" alt="image" src="https://github.com/user-attachments/assets/9901b754-63ae-4449-a17f-e7bea648de5d" />

<img width="1902" height="932" alt="image" src="https://github.com/user-attachments/assets/021d6cb4-b3b2-4348-a8c3-f77eaf41297e" />

<img width="1904" height="896" alt="image" src="https://github.com/user-attachments/assets/8acbbe9a-9cba-48d2-b47d-b1d95794ff83" />

<img width="1912" height="923" alt="image" src="https://github.com/user-attachments/assets/42aa569c-0cff-4c6d-804b-918cd80f88ce" />






A supply-chain compliance dashboard for a fictional apparel buyer, **Lindenwear GmbH**.
It tracks suppliers across three tiers, the certificates they hold, and a transparent
risk score derived from both — plus a simulated ERP feed that keeps the supplier master
data in step.

Built as a portfolio project: the interesting parts are the rules, the invariants and
the tests, not the feature count.

```
React 19 · TypeScript · Vite · MUI · Recharts · react-flow
Node 24 · Express 5 · Prisma 7 · PostgreSQL 16 · Docker
```

---

## Running it locally

**Prerequisites:** Node 24 (`.nvmrc`), Docker, and nothing else.

```bash
docker compose up -d     # PostgreSQL 16 on port 5433
npm install
cp backend/.env.example backend/.env
npm run db:setup         # migrate + seed ~34 suppliers with certificates
npm run dev              # API on :3001, UI on :5173
```

Open <http://localhost:5173> and sign in:

```
testUser / ClearChain-Demo-7fQ2
```

The credentials are documented here and travel with the link, not printed on the sign-in
screen — putting them on the page would have been hanging the key on the door handle.

To change it:

```bash
npm run auth:hash -w @clearchain/backend -- "your password"
```

which prints a fresh `AUTH_PASSWORD_HASH` and `AUTH_SECRET` for `backend/.env`. The
password itself is never stored anywhere.

Postgres is published on **5433**, not 5432, so it cannot collide with a PostgreSQL
already installed on the machine. The compose service has a `pg_isready` healthcheck,
because `docker compose up -d` returns when the container *starts*, not when the
database accepts connections.

**Day to day**

```bash
npm run dev              # both dev servers
npm test                 # unit tests — no database needed
npm run test:integration # API tests against a separate database
npm run typecheck && npm run lint
docker compose down      # add -v to wipe the database volume
```

---

## What the rules actually are

Two things are deliberately **never stored**: a supplier's risk level and a
certificate's status. Both are functions of today's date, so a stored copy is correct on
the day it is written and wrong every day after, with no write to trigger recomputation.
They are derived on read by pure functions in `backend/src/domain/`.

### Certificate status

A certificate is valid **through** its expiry date inclusive.

| Condition | Status |
|---|---|
| `today > expiryDate` | `EXPIRED` |
| `0 ≤ daysUntilExpiry ≤ 60` | `EXPIRING_SOON` |
| otherwise | `VALID` |

Where a supplier holds several certificates of one type — renewal history — the
**effective** one is the latest expiry, ties broken by creation time. Only that one
counts.

### Compliance

Each category requires a fixed set of certificates:

| Category | Required |
|---|---|
| Raw material | EUDR, CBAM, ISO 14001 |
| Manufacturing | SA8000, OEKO-TEX, ISO 14001 |
| Logistics | ISO 14001, CBAM |

A supplier is **compliant** when every required type is held and not expired. Missing
counts the same as expired.

CSRD and LkSG are absent from every list on purpose: they are company-level reporting
obligations — the reason a buyer collects supplier evidence at all — not instruments a
supplier holds. They remain uploadable as self-declarations.

Compliance is **own-level only**. It does not roll up the chain; risk does. The two
answer different questions and the UI keeps them apart.

### Risk score

Four weighted factors, no model, nothing hidden:

| Factor | Range | How |
|---|---|---|
| Country | 0–40 | Low 5 · Medium 20 · High 40. An unrecognised country fails closed at 40. |
| Certificates | 0–40 | `40 × Σpenalty ÷ requiredCount`, where valid = 0, expiring soon = 0.4, expired or missing = 1.0 |
| Tier depth | 0–10 | Tier 1 → 0, tier 2 → 5, tier 3 → 10 |
| Upstream | 0–30 | `min(30, round(0.5 × worst direct child))` |

```
score = clamp(country + certificates + tier + upstream, 0, 100)

  ≤ 29  green      30–59  yellow      ≥ 60  red
```

The certificate factor is normalised by requirement count so a category needing two
certificates stays comparable with one needing three. The upstream factor is damped at
0.5 so risk attenuates with distance instead of saturating the whole chain — but a
spotless tier-1 supplier still cannot show green while sitting on a red raw-material
source. `GET /api/suppliers/:id/risk` returns the factor breakdown, and the detail
screen renders it.

**Determinism.** Every factor is rounded before summation, in a fixed order, and the
evaluation date is an explicit parameter rather than a clock read inside the function.
The worked examples in `backend/src/domain/risk.test.ts` are the specification's own
table, carried over verbatim.

---

## ERP sync

`POST /api/erp/sync` ingests `backend/data/erp-supplier-export.json`, a checked-in file
standing in for a supplier master-data export.

Press it twice. The second run reports **0 created, 0 updated** — visible idempotency
rather than a mere absence of harm, because a field-level comparison classifies every
record as created, updated or unchanged.

The export is shaped to exercise every path in one run: 24 unchanged records, 4 with
changed fields, 4 new, and 2 that must be rejected. The very first record names a parent
that appears last in the file — the graph is resolved in memory before anything is
written, so writes follow the hierarchy rather than the file.

Other behaviour worth knowing:

- **Nothing is ever deleted.** Suppliers absent from the feed are counted and left alone.
- **Manual suppliers are out of reach.** Only records carrying an `externalId` are the
  ERP's to own.
- **One sync at a time**, enforced by a partial unique index rather than a read-then-write
  check that two callers could both pass.
- **The log survives failure.** It is written outside the data transaction, because a
  rollback would otherwise erase the only record that the sync ever ran. Conversely, a
  problem writing the summary *after* the batch commits does not mark a successful sync
  as failed.

---

## Hierarchy invariants

These hold before and after every operation, whatever sequence of calls a client makes:

- `tier = depth + 1`, constrained to 1–3, and never accepted from a client
- tier 1 if and only if there is no parent
- no cycles

A foreign key cannot express the last one: a cycle is a property of the graph, invisible
from any single row. So the application walks ancestors on every write, and the database
carries `CHECK` constraints for what it *can* express — guarding the write paths that
bypass the API entirely, such as the seed script or a manual `psql` session.

The subtle case is reparenting. Moving a supplier changes the tier of every descendant,
none of which appear in the request, so the whole subtree is measured before the write
and renumbered inside the same transaction. A rejected move leaves the hierarchy exactly
as it was.

---

## Layout

```
backend/
  src/domain/      pure functions — no I/O, no Prisma, no clock
  src/services/    business operations; transactions live here
  src/http/        routes, zod schemas, serializers, error envelope
  src/storage/     FileStorage interface + local and S3 drivers
  prisma/          schema, migrations, deterministic seed
  data/            country risk table, mock ERP export
  tests/           API tests against a real database
frontend/
  src/api/         typed client; responses validated with zod at the boundary
  src/components/  shared UI
  src/pages/       the five screens
```

The domain layer is the load-bearing choice. Because it holds no I/O, the scoring and
hierarchy rules are testable in milliseconds without a database — and the compiled output
in `dist/domain/` imports nothing from Prisma at all, since every schema import there is
`import type` and is erased at build time.

---

## Testing

```bash
npm test                  # 67 unit tests, no infrastructure
npm run test:integration  # 75 API tests against clearchain_test
```

Integration tests run against a separate database created on first boot by
`docker/initdb/`, so they can truncate freely. The suites are split so that `npm test`
works on a machine with nothing installed but Node.

Notable cases: risk scoring against the specification's own table at a frozen date; a
certificate on the exact day it expires; a hierarchy cycle rejected with 409; a reparent
that would push a grandchild past tier 3; sync run twice reporting nothing changed; and a
sync failure that still leaves a `FAILED` log row behind.

---

## Files

Uploads go through a `FileStorage` interface with two implementations, chosen by
`STORAGE_DRIVER` alone — `NODE_ENV` plays no part, because tying storage to the
environment name is what makes the S3 path untestable anywhere but production.

The interface covers reads as well as writes. The local driver streams bytes; the S3
driver returns a presigned URL and the route answers a redirect. `GET
/api/certificates/:id/file` is one stable path either way and the frontend never learns
which backend is configured.

Storage keys are built from a UUID and the *sniffed* content type. The uploaded filename
is kept as data for display and never reaches a path. Uploads are validated by their
leading bytes rather than the `Content-Type` a client chose to send, and downloads always
carry `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` — without
which an uploaded SVG would execute in the API's own origin.

---

## Production image

```bash
npm run docker:build

docker run --rm \
  --network 20260722_clearchain_default \
  -e DATABASE_URL="postgresql://clearchain:clearchain@db:5432/clearchain" \
  -v "$PWD/backend/uploads:/app/uploads" \
  -p 3001:3001 clearchain-api
```

The uploads volume is not optional when `STORAGE_DRIVER=local`: a directory inside a
container is ephemeral, and without it every certificate download returns 500.

The build is multi-stage and the runtime image carries **no TypeScript source and no
compiler**. Two details make that true:

- The generated Prisma client is build output, not a package. `npm ci` installs
  `@prisma/client` but not what `prisma generate` wrote into it, and the CLI is a
  devDependency — so `node_modules/.prisma` and `node_modules/@prisma/client` are copied
  from the builder stage explicitly. Prisma 7 compiles queries to WASM, so there are no
  engine binaries to match against the base image.
- `@prisma/client` declares `prisma` and `typescript` as *optional* peer dependencies.
  npm installs optional peers anyway, dragging in the CLI, Prisma Studio and the engine
  downloader — around 230 MB the application never reaches. They are removed, which is
  what takes the image from 894 MB to 596 MB.

Migrations are applied deliberately, from a step that carries the CLI — never on
application start, where a slow or failed migration would take the service down with it.

### Deployment

The whole application runs from one `docker-compose.prod.yml`: PostgreSQL, the API
image, and an nginx image that serves the built frontend and proxies `/api` to the API
on the same origin. Same origin is the point — it keeps CORS out of the picture and lets
the session cookie behave as an ordinary first-party cookie.

The compose file was verified end to end on a local machine before any server existed:
build, migrate, seed, sign in, read every screen, upload a certificate and download it
back, all through nginx. Two things it caught that only appear in the container — the
frontend build needs `frontend/src`, which the shared `.dockerignore` had been excluding
for the backend image; and the uploads volume must be created node-owned in both the
runtime and seed stages, or the non-root process gets `EACCES` on the first upload.

Migrations and the seed run as one-shot services that target the builder stage, because
the runtime image carries no Prisma CLI. They never run on application start, where a
slow or failed migration would take the service down with it.

```bash
# On the server, once Docker is installed and the repo is cloned:
cp .env.prod.example .env          # then fill it in — see below
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --profile tools run --rm seed
docker compose -f docker-compose.prod.yml up -d api web
```

Filling in `.env`:

- `AUTH_SECRET` **must not** be the value from `backend/.env.example`. That one is
  published here, and anyone holding it can mint a valid session cookie. Generate a real
  pair with `npm run auth:hash -w @clearchain/backend -- "<the demo password>"`.
- `POSTGRES_PASSWORD` — `openssl rand -base64 24`, not something invented.
- `PUBLIC_ORIGIN` must match exactly how the site is reached, `https://` included, or the
  browser rejects the CORS responses.

**TLS.** The session cookie is `Secure`, so the site must be served over HTTPS or sign-in
silently fails — the cookie is set but never sent back. The simplest path with a domain
on Cloudflare is a Cloudflare origin certificate (valid 15 years, no renewal) with the
zone in Full (strict) mode; point an nginx `443` server block at the mounted cert. A
plain Let's Encrypt certificate on the host works equally well.

`DEMO_READONLY=true` remains available — every mutating route returns 403 — for a
deployment that would rather show the data than accept uploads. With the sign-in gate in
place it can stay `false`, which keeps certificate upload and ERP sync working.

A single small VM (2 vCPU, 2 GB) runs all three containers comfortably; the storage
driver stays `local` on a Docker volume, so no S3 bucket is involved. The `s3` driver is
written and type-checked as a real seam, but has never been exercised against AWS — the
honest state to know before relying on it.

**[DEPLOY.md](DEPLOY.md)** is the step-by-step runbook: EC2, Cloudflare Origin
certificate in Full (strict), and the exact commands to bring the stack up.

---

## Authentication

One shared account, because the alternative was an internet-reachable file-upload
endpoint with no owner.

The password is stored as a scrypt hash and compared in constant time — a plain `===`
returns as soon as two bytes differ, and how long it took to say no is itself
information. The session is a signed, stateless cookie: `httpOnly` so an XSS cannot lift
it, `sameSite=lax` so it is not sent on the cross-site POSTs that CSRF depends on, and
seven days long so a reviewer is not asked to sign in twice.

The token is deliberately **not** a JWT library. With one account, nothing to revoke and
no third party to interoperate with, the parts of JWT that carry risk are all cost:
algorithm negotiation is where those libraries have historically been broken, and this
format has no algorithm field to confuse. What remains is a payload and an HMAC over it.
Rotating `AUTH_SECRET` invalidates every token at once, which is the only revocation a
single account needs.

Sign-in has its own, far tighter rate limit than the rest of the API — without it the
screen is a password oracle that can be worked through at network speed. A failed
attempt says the same thing whether the username or the password was wrong, so the form
cannot be used to discover valid usernames.

Everything below `app.use('/api', requireAuth)` is guarded, so a route added later is
protected by default rather than by somebody remembering. `/api/health` stays open,
because a probe cannot hold a cookie; so does `/api/auth/login`, or signing in would
require being signed in.

Keeping the demo out of search results is a *separate* problem, and the gate does not
solve it: a crawler never submits the form, but it still records the URL. `robots.txt`
and a `noindex` meta tag handle that. Two tools, two problems, neither pretending to do
the other's job.

## Scoped out

Multi-tenancy, a real ERP connector, AI document extraction, risk-score history and dark
mode are all out of scope for this MVP — considered and set aside rather than
overlooked.

The country risk bands in `backend/data/country-risk.json` are invented to produce a
varied dataset. They are not an assessment of any country; a real system would derive
them from a published, citable index and record which edition it used.
