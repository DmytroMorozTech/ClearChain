# Deploying ClearChain

A single small VM runs the whole application in Docker — PostgreSQL, the API, and nginx
serving the built frontend and proxying `/api` on the same origin. Cloudflare sits in
front for DNS and TLS. Same origin is the point: it keeps CORS out of the picture and
lets the session cookie behave as an ordinary first-party cookie.

These steps were run end to end on a **Hetzner Cloud** VPS, which is where the live demo
runs. Nothing here is provider-specific beyond step 2 — any Ubuntu 24.04 box with Docker
and ports 22/80/443 open will do.

Target host: `https://clearchain.dmoroz.dev`. Substitute your own domain throughout.

---

## 1 — SSH key

On your local machine, if you don't already have one:

```bash
ssh-keygen -t ed25519 -C "clearchain"
cat ~/.ssh/id_ed25519.pub          # copy the whole line — needed in step 2
```

---

## 2 — Create the server

In your provider's console:

- **Image:** Ubuntu 24.04.
- **Size:** 2 GB RAM minimum. The build compiles TypeScript and runs Vite, which is
  heavier than the app is at runtime — 1 GB gets OOM-killed partway through.
- **Architecture:** Arm64 or x86 both work. Every base image here (Node, Postgres, nginx)
  is multi-arch, and the only architecture-specific packages in the lockfile — `esbuild`
  and `rollup` — are build-time only and ship real binaries for both.
- **SSH key:** paste the public key from step 1.
- **Location:** anywhere near your users.

**Firewall** — inbound TCP **22**, **80**, **443**, IPv4 and IPv6. On Hetzner this is a
separate *Firewalls → Create Firewall* step, then attach it to the server; a firewall
can't be created inline during server creation if the project has none yet.

Note the server's public IPv4 address — step 5 needs it.

---

## 3 — Install Docker

```bash
ssh root@<server-ip>

export DEBIAN_FRONTEND=noninteractive
apt update && apt install -y docker.io docker-compose-v2 git
```

`DEBIAN_FRONTEND=noninteractive` matters on Ubuntu 24.04 — without it, `needrestart`
opens an interactive prompt that hangs the session.

**Add swap.** On a 2 GB box the image build can spike past available RAM. Swap turns a
potential OOM-kill during the build into "briefly slower":

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab   # persist across reboots
free -h                                            # confirm Swap: 2.0Gi
```

---

## 4 — Code and configuration

```bash
git clone https://github.com/DmytroMorozTech/ClearChain.git
cd ClearChain
cp .env.prod.example .env
```

**Generate the database password before starting any container.** Postgres refuses to
initialise with an empty `POSTGRES_PASSWORD` and will crash-loop, taking any command that
depends on it down with `dependency failed to start: container ... is unhealthy`.

```bash
openssl rand -base64 24
```

Then generate the auth values. This builds the backend image on first run:

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm \
  --entrypoint "npm run auth:hash -w @clearchain/backend --" migrate "<your-demo-password>"
```

Edit `.env` and fill in:

| Variable | Value |
|---|---|
| `POSTGRES_PASSWORD` | the `openssl` output |
| `AUTH_PASSWORD_HASH` | from the `auth:hash` output, quotes included |
| `AUTH_SECRET` | from the `auth:hash` output, quotes included |
| `PUBLIC_ORIGIN` | your host, `https://` included, matching exactly |

Two things to get right:

- **`AUTH_SECRET` must not be the value in `backend/.env.example`.** That one is public in
  this repo, and anyone holding it can mint a valid session cookie.
- **`PUBLIC_ORIGIN` must match how the site is actually reached**, scheme included, or
  the browser rejects the CORS responses.

---

## 5 — Cloudflare: DNS and TLS

The session cookie is `Secure`, so the site must be served over HTTPS — otherwise sign-in
fails silently, with the cookie set but never sent back.

**5a. DNS.** DNS → Add record: type **A**, name `clearchain`, IPv4 = the server's address,
proxy status **Proxied** (orange cloud). The orange cloud is what routes traffic through
Cloudflare's edge, which is what lets Cloudflare terminate TLS and keep the origin IP out
of public DNS.

**5b. Origin certificate.** SSL/TLS → Origin Server → Create Certificate. Defaults are
fine (RSA, 15 years — nothing to renew). You get two blocks; the private key is shown
once only.

**5c. Install them on the server:**

```bash
mkdir -p docker/nginx/certs
nano docker/nginx/certs/origin.pem     # paste the certificate block
nano docker/nginx/certs/origin.key     # paste the private key block
chmod 600 docker/nginx/certs/origin.key
```

`docker/nginx/certs/` is gitignored — these are never committed.

**5d. Encryption mode.** SSL/TLS → Overview → **Full (strict)**. Not Flexible, which
leaves the Cloudflare→origin leg unencrypted; not plain Full, which accepts any origin
certificate including a self-signed one. Strict verifies the certificate Cloudflare
itself issued.

---

## 6 — Build and launch

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml build
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --profile tools run --rm seed
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d api web
```

Two details in there:

- **Both `-f` flags** are required on `build` and on the final `up`. The TLS overlay is
  what swaps nginx onto `:443` with the origin certificate; without it the stack comes up
  plain HTTP only.
- **`migrate` and `seed` are one-shot services** targeting the builder stage, because they
  need the Prisma CLI that the runtime image deliberately doesn't carry. Migrations are
  never run on application start, where a slow or failed migration would take the service
  down with it.

Check the stack came up:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs api | tail
```

`db` and `api` report healthy almost immediately; `web` takes about 30 seconds.

> **Known cosmetic issue.** Under the TLS overlay, `web` can report `unhealthy` while
> serving traffic perfectly. Its healthcheck requests `http://localhost/`, which now
> 301-redirects to HTTPS, and the redirect lands on a TLS handshake for a hostname the
> origin certificate isn't issued for. Real traffic arrives via Cloudflare on 443 and
> never takes that path. Confirm in a browser before treating it as a real failure.

---

## 7 — Verify

Open your host and sign in with the demo credentials from the README. Walk the five
screens. Upload a certificate on a supplier detail page and confirm the risk score moves.
Press **Run sync** twice — the second run should report *0 created, 0 updated*.

---

## Day-two operations

**Deploy a code change:**

```bash
cd ClearChain
git pull origin main
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml build
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d api web
```

Only the containers whose image changed are recreated; `db` keeps running. Expect a few
seconds of downtime while the new containers pass their healthcheck.

**If the change includes a Prisma migration**, run it *before* the final `up`, so the new
code never queries a schema it doesn't match yet:

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

Don't re-run `seed` on a routine deploy — it is one-time demo data.

**Logs and restart:**

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml restart api
```

**Where the data lives.** No managed database, no object store, no load balancer — the
storage driver stays `local`, so both the database and the uploads are Docker volumes
(`pgdata` and `uploads`) on the instance itself. If the instance is ever recreated, those
hold the state; snapshot the disk first if it matters. Here everything is reproducible
from the seed, so it does not.
