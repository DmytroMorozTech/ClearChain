# Deploying ClearChain

A single small VM runs the whole application in Docker — PostgreSQL, the API, and nginx
serving the built frontend and proxying `/api` on the same origin. Cloudflare sits in
front for TLS and DNS.

The stack was verified end to end on a local machine before any of this: build, migrate,
seed, sign in, read every screen, upload a certificate and download it back, and the same
again over HTTPS with the `-f docker-compose.tls.yml` overlay. Nothing below is untested.

Target: `https://clearchain.dmoroz.dev`. Substitute your own host throughout.

---

## 1 — EC2 instance

In the AWS console, region **eu-central-1** (Frankfurt):

- **AMI:** Ubuntu Server 24.04 LTS, **Arm** architecture.
- **Type:** `t4g.small` (2 GB). The frontend image build needs more than the 1 GB a
  `micro` gives; on `micro` the build gets OOM-killed.
- **Key pair:** create one, download the `.pem`, keep it safe — it is your only SSH key.
- **Security group**, inbound:
  | Port | Source | Why |
  |---|---|---|
  | 22 | **your IP only** | SSH. Never `0.0.0.0/0`. |
  | 80 | anywhere | HTTP → redirected to HTTPS |
  | 443 | anywhere | HTTPS |
- After launch, allocate an **Elastic IP** and associate it. Without it the public IP
  changes on stop/start and DNS breaks.

---

## 2 — Server prerequisites

```bash
ssh -i your-key.pem ubuntu@<elastic-ip>

sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker ubuntu
exit                                   # reconnect so the docker group applies
ssh -i your-key.pem ubuntu@<elastic-ip>

docker --version && docker compose version   # sanity check
```

---

## 3 — Code and secrets

```bash
git clone https://github.com/DmytroMorozTech/ClearChain.git
cd ClearChain
cp .env.prod.example .env
```

Generate the three real values:

```bash
# database password
openssl rand -base64 24

# password hash + a fresh AUTH_SECRET (do NOT reuse the repo's example secret)
docker compose -f docker-compose.prod.yml --profile tools run --rm \
  --entrypoint "npm run auth:hash -w @clearchain/backend --" migrate "ClearChain-Demo-7fQ2"
```

Edit `.env`:

- `POSTGRES_PASSWORD` — the `openssl` output.
- `AUTH_PASSWORD_HASH` and `AUTH_SECRET` — from the `auth:hash` output. **`AUTH_SECRET`
  must not be the value in `backend/.env.example`**: that one is public, and anyone with
  it can mint a valid session cookie.
- `PUBLIC_ORIGIN=https://clearchain.dmoroz.dev` — exactly, `https://` included, or the
  browser rejects the CORS responses.

---

## 4 — TLS: Cloudflare Origin Certificate

Full (strict) means the browser→Cloudflare and Cloudflare→origin legs are both
encrypted. Cloudflare issues the origin certificate, so there is nothing to renew.

**4a. Issue the certificate.** Cloudflare dashboard → your zone → **SSL/TLS → Origin
Server → Create Certificate**. Accept the defaults (RSA, 15 years). You get two blocks:
the certificate and the private key.

**4b. Put them on the server:**

```bash
mkdir -p docker/nginx/certs
nano docker/nginx/certs/origin.pem     # paste the certificate block
nano docker/nginx/certs/origin.key     # paste the private key block
chmod 600 docker/nginx/certs/origin.key
```

The `docker/nginx/certs/` directory is gitignored — these never get committed.

**4c. DNS.** Cloudflare dashboard → **DNS** → add an **A record**: name `clearchain`,
value your Elastic IP, proxy **on** (orange cloud). The orange cloud is what routes the
domain through Cloudflare's TLS.

**4d. Encryption mode.** **SSL/TLS → Overview → Full (strict)**. Not Flexible (that
leaves the origin leg unencrypted), not Full (that accepts any origin cert) — strict
verifies the origin certificate Cloudflare itself issued.

---

## 5 — Launch

```bash
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml build
docker compose -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose -f docker-compose.prod.yml --profile tools run --rm seed
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d api web
```

The two `-f` flags matter on the last line: the overlay is what swaps nginx onto `:443`
with the certificate. `migrate` and `seed` are one-shot services on the builder stage —
they carry the Prisma CLI the runtime image deliberately does not.

Check it came up:

```bash
docker compose -f docker-compose.prod.yml ps          # all healthy
docker compose -f docker-compose.prod.yml logs api | tail
```

---

## 6 — Verify

Open `https://clearchain.dmoroz.dev`, sign in with `testUser / ClearChain-Demo-7fQ2`,
and walk the five screens. Upload a certificate on a supplier detail page and confirm the
risk score moves; press **Run sync** twice and confirm the second run reports 0 created,
0 updated.

Then send the recruiter the link.

---

## Day-two operations

**Deploy an update:**

```bash
cd ClearChain
git pull
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml build
docker compose -f docker-compose.prod.yml --profile tools run --rm migrate   # if the schema changed
docker compose -f docker-compose.prod.yml -f docker-compose.tls.yml up -d
```

**Reset the demo data** (wipes uploads too):

```bash
docker compose -f docker-compose.prod.yml --profile tools run --rm seed
```

**Logs / restart:**

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml restart api
```

---

## Cost

`t4g.small` on-demand is roughly €12/month in eu-central-1; a reserved instance or
savings plan cuts that. The domain is €12/year. No RDS, no S3, no load balancer — the
storage driver stays `local` on a Docker volume, so uploads live on the instance.

If the instance is ever recreated, the `pgdata` and `uploads` Docker volumes are what
hold the data; snapshot the EBS volume before touching the instance if that data matters.
Here it is all reproducible from the seed, so it does not.
