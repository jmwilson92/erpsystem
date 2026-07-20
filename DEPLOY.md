# Deploying ForgeRP

Two ways to run it: **local** (your own machine, to try it out) and
**production** (a server with a domain, login + HTTPS, for real users).
Both use Docker.

Prerequisite for both: [Docker](https://docs.docker.com/get-docker/)
installed. Run every command from the repo root.

---

## A. Local — try it on your own machine

```bash
docker compose up -d --build
```

Open **http://localhost:3000**. This is the evaluation build: the persona
switcher is open (no login) and the full demo dataset is loaded, so you
can click around every module immediately.

Stop it: `docker compose down` (your data persists in a Docker volume).
Wipe and start fresh: `docker compose down -v`.

### Testing Plaid (live bank feeds) locally

Plaid's **sandbox** works on localhost — you don't need a server. Get free
keys at [dashboard.plaid.com](https://dashboard.plaid.com):

```bash
cp .env.production.example .env
# edit .env — set at minimum:
#   PLAID_CLIENT_ID=...
#   PLAID_SECRET=...
#   PLAID_ENV=sandbox
docker compose up -d --build
```

Then in the app: **Accounting → Banking → Connect company bank via Plaid**.
In sandbox, log in to the fake bank with username `user_good` /
password `pass_good`, pick accounts, and the feed pulls in. Categorize a
few transactions to see them post to the GL.

> Sandbox = Plaid's fake test banks. Linking a *real* company bank needs
> `PLAID_ENV=production` and Plaid approving your app for production access
> — request that from your Plaid dashboard once you're ready.

---

## B. Production — real beta, on a server

For real users you want login required, clean books (no demo data), HTTPS,
and a public URL. This runs on a small VPS ($6–12/mo — Hetzner,
DigitalOcean, Linode all work).

### 1. Point a domain at the server

Create a DNS **A record** for your hostname (e.g. `erp.yourcompany.com`)
pointing at the server's public IP. Wait for it to resolve.

### 2. Get the code + Docker onto the server

SSH into the server, install Docker, then:

```bash
git clone <your-repo-url> forgerp && cd forgerp
```

### 3. Configure

```bash
cp .env.production.example .env
nano .env
```

Fill in:

| Variable | What to set |
|---|---|
| `DOMAIN` | Your hostname, e.g. `erp.yourcompany.com` (Caddy gets TLS for it) |
| `NEXT_PUBLIC_APP_URL` | `https://` + your domain |
| `DEMO_MODE` | `0` (login required — already the default) |
| `SEED_ON_FIRST_BOOT` | `prod` (essentials only, no demo data) |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | From dashboard.plaid.com (blank = file import only) |
| `PLAID_ENV` | `sandbox` to test, `production` for real banks |
| `RESEND_API_KEY` / `EMAIL_FROM` | From resend.com, for invite emails (optional) |

### 4. Launch

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Caddy fetches the TLS certificate automatically on first request.

### 5. Claim the instance

Open **https://your-domain**. The first screen says *"claim this
instance."* Set your admin email + password there — that account becomes
the admin, on clean books (chart of accounts, UoMs, approval pipeline, no
fake data). Invite the rest of your team from **Admin → Users**.

---

## Day-to-day operations

| Task | Command |
|---|---|
| View logs | `docker compose logs -f forgerp` |
| Restart | `docker compose restart forgerp` |
| Stop | `docker compose down` (data persists) |
| Update to latest code | `git pull && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` |
| Back up the database | `scripts/backup-db.sh` (nightly, 30-day retention) |
| Health check | `curl https://your-domain/api/health` |

The SQLite database lives on the `forgerp-data` Docker volume, so rebuilds
and updates keep your books. Back it up before major upgrades.

---

## First-boot data modes (`SEED_ON_FIRST_BOOT`)

| Value | Loads |
|---|---|
| `prod` | Config essentials only — chart of accounts (zero balances), UoMs, permissions, approval pipeline, default settings. **Recommended for production.** |
| `1` | Full demo dataset (parts, suppliers, orders, fake money). Good for evaluation. |
| `0` | Completely empty. |

Only applies on the **first** boot of an empty database; ignored after
that (a `.seeded` marker guards it).
