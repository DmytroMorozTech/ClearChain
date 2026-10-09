# Design notes

The reasoning behind ClearChain's rules, invariants and infrastructure. The
[README](README.md) is the overview; this is the detail.

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

The API is complete CRUD; the UI deliberately exposes a subset. `DELETE /suppliers/:id`
exists to enforce and prove the hierarchy rule — it refuses with 409 when children exist —
rather than because the interface needs a delete button. The database says the same thing
independently: the parent relation is `onDelete: Restrict`, so even a write that bypasses
the application cannot orphan a branch. Certificates, by contrast, do cascade, because
they belong to the supplier rather than standing on their own.

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

The demo credentials are documented in the README, and the sign-in screen offers an
"Autofill demo credentials" button. That would be hanging the key on the door handle if
the key guarded anything: it does not. The credentials were already public, so the
button changes no exposure — it only saves a reviewer the trip to GitHub. What makes
public credentials acceptable is that the damage they allow is bounded: the demo data is
reseeded every night (see DEPLOY.md), and AI extraction has daily limits of its own. To
change the password:

```bash
npm run auth:hash -w @clearchain/backend -- "your password"
```

which prints a fresh `AUTH_PASSWORD_HASH` and `AUTH_SECRET` for `backend/.env`. The
password itself is never stored anywhere.

---

## AI-assisted extraction

Choosing a file in the upload dialog sends the certificate to Claude, and the form
opens already filled in — type, issuer, number and both dates — for the user to review.
It is a **suggestion**: nothing is saved until the user presses Save, through the same
endpoint and the same validation as a hand-filled form. Manual entry is one click away
at every step, and any failure (feature off, limit reached, unreadable file) lands on
the empty form with the reason, never on a dead end. The frontend only sees "suggested
values", so the model behind them could be replaced by plain OCR without touching it. `POST /api/suppliers/:id/certificates/extract` writes no certificate
and stores no file.

The rule throughout is *the model proposes, the existing invariants dispose*. A model
reading a scanned audit certificate will sometimes be wrong, and the cost of a wrong
expiry date in a compliance tool is a supplier shown as covered when it is not. So the
output is treated like any other untrusted input, and a person confirms every value.

**One call, no framework.** The task is a single extraction: one request, one answer.
There is no agent loop, no retrieval and no orchestration library, because nothing here
needs them. `backend/src/llm/` holds a client behind an interface (tests use a fake and
never need a key), the prompt, the output schema and the checks.

**Structured output, checked twice.** The request constrains the reply to a JSON Schema
(`output_config.format`), and the server re-parses it with the same zod schema anyway —
unknown keys are dropped, a reply that does not fit is an error and never reaches the
form. Forced tool use was the older way to get JSON back; the current models reject a
forced `tool_choice`, and native structured output is the supported path.

**Every value needs a quote.** Alongside each field the model returns a short verbatim
quote from the document. `validate.ts` then:

- drops impossible or implausible dates (not a real calendar day, issued before 1990 or
  in the future, expiring more than 30 years out) and an expiry that is not after the
  issue date;
- checks each quote against the PDF's text layer (normalised for line breaks, dashes and
  spacing that extraction mangles) and flags values whose quote is not there — or whose
  quote is there but does not contain the value, since "Certificate No." is a genuine
  line that vouches for no number in particular;
- flags a date whose quote does not show both its year and its day — the eval caught a
  model turning "Issued: March 2026" into 2026-03-01 with a perfectly genuine quote;
- flags documents whose text addresses the model ("ignore previous instructions", "note
  for automated processing") rather than the reader.

A value we cannot trust is dropped with a warning; a value we cannot *confirm* is kept
and highlighted, with its source quote on hover. Either way the human decides.

If the supplier already holds a certificate of the same type with the same number, the
review step says so before saving. It is a warning, not a constraint: certification bodies
often keep the number across a renewal, so a match is as likely a new cycle as a re-upload,
and only the person saving it can tell which.

**Prompt injection.** A document is data, and the system prompt says so — but a prompt
is not a guarantee, and nothing here relies on it alone. The model has no tools, so the
only thing a malicious document can change is a value in the JSON, which then has to
survive the schema, the range checks and the quote check, and is shown to a person
before anything is saved. What can still slip through is a *plausible* override — a
believable date whose quote really is in the document; the instruction-text warning
exists for exactly that case, and it is a heuristic that a careful attacker can phrase
around. The worst outcome is one wrong suggested value in the form of the person who
uploaded the document.

**Cost control.** One call reads a 1–2 page certificate for about 3,500 input tokens.
Limits are counted in the database, so they survive a restart: 8 calls per client per
UTC day (IPv6 grouped per /64, so one subscriber cannot rotate through addresses) and 15
for the whole site, reserved under an advisory lock so a burst cannot overshoot. PDFs over
five pages are refused before the call, `max_tokens` is 1,024, and the provider-side
workspace has its own monthly spend cap. Prompt caching is deliberately not used: the
system prompt is too short to be worth caching and every document is different, so there
is no repeated prefix to reuse.

**Privacy.** The document is sent to Anthropic, which the dialog says before a file is chosen.
Each attempt is logged — outcome, model, tokens, latency — for abuse visibility and as the
rate-limit counter itself. An IP address is personal data, so nothing on the server keeps
one. The log stores only an HMAC of it — keyed, because a plain hash of an IPv4 address can
be reversed by trying all 2³² — and the key changes at every UTC midnight. The limits are
daily, so counting still works; once the day is over, a row can no longer be matched to an
address or even to the same client's other days, by anyone. The remaining rows are, in
effect, anonymous usage statistics, kept for 90 days. nginx restores the real address for
rate limiting but writes only a truncated one (`/24`) to its access log, and container logs
rotate at 30 MB per service. Rate limiting by IP rests on legitimate interest in preventing
misuse; a production system would also list it, and the processors involved (hosting, CDN,
the model provider), in its privacy policy. `npm run llm:attempts` summarises the log.
Read-only demo mode leaves the feature on, since it writes nothing a visitor could see.

**Which model, and how we know.** `npm run eval:extract` runs a synthetic set of 25
invented certificates (English and German, every supported type, several date formats,
missing fields, competing dates, a non-certificate, three injection attempts) through the
production code path and scores each field against ground truth. The committed PDFs are
checked against their specs by a test, so the set cannot drift silently.

| 25 documents, 2026-10-09 | Haiku 4.5 | Sonnet 5.5 |
|---|---|---|
| All five fields correct | 23 / 25 | **25 / 25** |
| Values invented where the document has none | 2 | **0** |
| Injection attempts resisted | 3 / 3 | 3 / 3 |
| Latency p50 / max | 3.0 s / 8.1 s | 2.6 s / 4.1 s |
| Cost per document | **$0.0040** | $0.0094 |

On the first eighteen documents both models scored 100%, which said more about the set
than the models, so seven harder cases were added: a duration instead of an expiry date,
a month without a day, `03/04/2026` in a German document, the issuer named only in the
signature, a reissued number that prints the one it replaces, two standards on one
certificate, and an injection phrased as a processing note. Haiku computed a date from
"valid for three years" and completed "March 2026" to the 1st; Sonnet did neither. The
default is therefore Sonnet 5.5, and the site-wide limit of 15 keeps the worst possible
month (15 × 30 × $0.0094 ≈ $4.20) under the workspace cap. Full results, including every
mismatch, are in `backend/eval/results/`.

**Known limits.** The set is synthetic and every PDF has a clean text layer; real
certificates are scans with stamps, tables and handwriting, where quotes cannot be
checked and both models will do worse. A scan-like fixture would need a rasteriser, i.e.
a native dependency, so it is absent. The instruction-text heuristic missed the disguised
injection (the model resisted it anyway). These numbers show the pipeline behaves; they
are not an accuracy claim for production documents.

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

---

## Deployment

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
the runtime image carries no Prisma CLI. They are never run on application start, where a
slow or failed migration would take the service down with it.

**TLS.** The session cookie is `Secure`, so the site must be served over HTTPS or sign-in
silently fails — the cookie is set but never sent back. The simplest path with a domain
on Cloudflare is a Cloudflare origin certificate (valid 15 years, no renewal) with the
zone in Full (strict) mode; point an nginx `443` server block at the mounted cert. A
plain Let's Encrypt certificate on the host works equally well.

`DEMO_READONLY=true` remains available — every mutating route returns 403 — for a
deployment that would rather show the data than accept uploads. With the sign-in gate in
place it can stay `false`, which keeps certificate upload and ERP sync working.

A single small VM runs all three containers comfortably; the storage driver stays `local`
on a Docker volume, so no object store is involved. The `s3` driver is written and
type-checked as a real seam, but has never been exercised against a live bucket — the
honest state to know before relying on it.

**[DEPLOY.md](DEPLOY.md)** is the step-by-step runbook: server setup, Cloudflare DNS and
origin certificate in Full (strict), the exact commands to bring the stack up, and the
day-two redeploy flow.

---

## Scoped out

Multi-tenancy, a real ERP connector, risk-score history and dark mode are all out of
scope for this MVP — considered and set aside rather than overlooked. So are retrieval,
agents and LLM orchestration frameworks for the AI extraction above: one document, one
call, one answer needs none of them.

The country risk bands in `backend/data/country-risk.json` are invented to produce a
varied dataset. They are not an assessment of any country; a real system would derive
them from a published, citable index and record which edition it used.
