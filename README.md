# ClearChain

A supply-chain compliance dashboard for a fictional apparel buyer, **Lindenwear GmbH**.
It tracks suppliers across three tiers, the certificates they hold, and a transparent
risk score derived from both — plus a simulated ERP feed that keeps the supplier master
data in step.

**Live demo:** [https://clearchain.dmoroz.dev/](https://clearchain.dmoroz.dev/) ·
sign in with `testUser` / `ClearChain-Demo-7fQ2`

```
React 19 · TypeScript · Vite · MUI · Recharts · react-flow
Node 24 · Express 5 · Prisma 7 · PostgreSQL 16 · Docker
```

<img width="1914" height="808" alt="image" src="https://github.com/user-attachments/assets/cc31603e-89c4-41b1-a993-250638b27e41" />

<img width="1545" height="585" alt="image" src="https://github.com/user-attachments/assets/da540408-63e7-4c46-bdab-69b277e8c301" />

<img width="1902" height="932" alt="Supplier list" src="https://github.com/user-attachments/assets/021d6cb4-b3b2-4348-a8c3-f77eaf41297e" />

<img width="1904" height="896" alt="Supplier detail with risk breakdown" src="https://github.com/user-attachments/assets/8acbbe9a-9cba-48d2-b47d-b1d95794ff83" />

<img width="1912" height="923" alt="Supply chain hierarchy" src="https://github.com/user-attachments/assets/42aa569c-0cff-4c6d-804b-918cd80f88ce" />

---

## What's worth looking at

Built as a portfolio project: the interesting parts are the rules, the invariants and
the tests, not the feature count. The reasoning behind each of these is in
**[DESIGN.md](DESIGN.md)**.

- **Nothing time-dependent is stored.** Certificate status and supplier risk are both
  functions of today's date, so a stored copy is correct the day it's written and wrong
  every day after. They're derived on read by pure functions in `backend/src/domain/` —
  no I/O, no Prisma, no clock.
- **A risk score you can audit.** Four weighted factors, no model, nothing hidden.
  `GET /api/suppliers/:id/risk` returns the full breakdown and the detail screen renders
  it. Every factor is rounded in a fixed order and the evaluation date is an explicit
  parameter, so the score is deterministic.
- **Graph invariants the database can't express.** `tier = depth + 1`, tier 1 iff no
  parent, and no cycles — enforced on every write, including reparenting, which
  renumbers a whole subtree inside one transaction.
- **Visibly idempotent ERP sync.** Run it twice and the second run reports *0 created, 0
  updated*, because a field-level comparison classifies every record. Nothing is ever
  deleted; the run log survives a failed transaction.
- **Uploads treated as hostile.** Files are validated by their leading bytes rather than
  the `Content-Type` a client sent, stored under a UUID key, and always served with
  `Content-Disposition: attachment` and `nosniff`.

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

Open <http://localhost:5173> and sign in with `testUser` / `ClearChain-Demo-7fQ2`.

Postgres is published on **5433**, not 5432, so it cannot collide with a PostgreSQL
already installed on the machine.

**Day to day**

```bash
npm run dev              # both dev servers
npm test                 # unit tests — no database needed
npm run test:integration # API tests against a separate database
npm run typecheck && npm run lint
docker compose down      # add -v to wipe the database volume
```

---

## Testing

```bash
npm test                  # 97 unit tests, no infrastructure
npm run test:integration  # 87 API tests against clearchain_test
```

The suites are split so that `npm test` works on a machine with nothing installed but
Node. Notable cases: risk scoring against the specification's own table at a frozen date;
a certificate on the exact day it expires; a hierarchy cycle rejected with 409; a
reparent that would push a grandchild past tier 3; sync run twice reporting nothing
changed; and a sync failure that still leaves a `FAILED` log row behind.

---

## Project layout

```
backend/
  src/domain/      pure functions — no I/O, no Prisma, no clock
  src/services/    business operations; transactions live here
  src/http/        routes, zod schemas, serializers, error envelope
  src/storage/     FileStorage interface + local and S3 drivers
  prisma/          schema, migrations, deterministic seed
  tests/           API tests against a real database
frontend/
  src/api/         typed client; responses validated with zod at the boundary
  src/components/  shared UI
  src/pages/       the five screens
```

---

## Further reading

- **[DESIGN.md](DESIGN.md)** — the rules, the invariants, and why each decision was made:
  scoring, compliance, ERP sync, hierarchy, storage, authentication, and the production
  image.
- **[DEPLOY.md](DEPLOY.md)** — step-by-step deployment runbook.
