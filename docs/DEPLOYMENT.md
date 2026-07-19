# Deploying ForgeRP

ForgeRP runs anywhere Node 20+ runs. Two supported paths: **cloud**
(Vercel or any Node host) and **self-host** (Docker). Both are
plug-and-play — the schema is created and demo data seeded on first
boot, so you land in a working system.

---

## Option 1 — Self-host with Docker (recommended for on-prem)

```bash
git clone <your-repo> forgerp && cd forgerp
docker compose up -d --build
# → http://localhost:3000
```

What happens on first boot:
1. The image builds (Node 22, native SQLite driver compiled in).
2. `prisma db push` creates the schema on the `/data` volume.
3. The demo dataset seeds once (`SEED_ON_FIRST_BOOT=1`). Set it to `0`
   in `docker-compose.yml` to start empty, then use **Setup Wizard** and
   **Data Import** in-app to onboard your real data.

Your books live on the `forgerp-data` volume — rebuilding or upgrading
the image never touches them.

**Backups:** the whole database is one file.

```bash
docker compose exec forgerp sh -c 'cp /data/forgerp.db /data/backup-$(date +%F).db'
docker cp forgerp:/data/backup-$(date +%F).db ./
```

**HTTPS:** put any reverse proxy (Caddy, nginx, Traefik) in front of
port 3000. HSTS headers are already emitted by the app.

**Postgres (optional):** a production-like Postgres service ships in the
compose file behind the `postgres` profile:

```bash
docker compose --profile postgres up -d
```

Switch `prisma/schema.prisma`'s provider to `postgresql`, point
`DATABASE_URL` at the service, and re-run `prisma db push`.

---

## Option 2 — Cloud (Vercel or any Node host)

**Vercel:** import the repo, set `DATABASE_URL` (use a hosted database —
Turso/libSQL for the SQLite flavor, or Postgres with the provider
switch), and deploy. Build command and output are auto-detected.

**Any Node host (Render, Railway, Fly.io, a VM):**

```bash
npm ci
npm run setup     # prisma generate + db push + seed
npm run build
npm start         # serves on PORT (default 3000)
```

Environment variables:

| Variable | Purpose | Default |
| --- | --- | --- |
| `DATABASE_URL` | `file:` path or Postgres URL | `file:./prisma/dev.db` |
| `DEMO_MODE` | `0` = require real login (production); unset = demo personas | unset |
| `SEED_ON_FIRST_BOOT` | Docker only — demo data on first boot | `1` |
| `RESEND_API_KEY` | Optional — deliver invites / PO / quote e-mail via Resend | unset |
| `EMAIL_FROM` | From address for outbound e-mail (a domain verified in Resend) | `<company>@erp.local` |
| `XAI_API_KEY` | Optional — upgrades the AI Assistant | unset |

---

## Go live on a VM with HTTPS (recommended beta path)

One small VM (Hetzner / DigitalOcean / Lightsail), Docker installed
(Compose v2.24+), and a domain pointed at it:

```bash
git clone <your-repo> forgerp && cd forgerp
echo "DOMAIN=erp.example.com" > .env
# optional real e-mail delivery:
# echo "RESEND_API_KEY=re_..." >> .env
# echo "EMAIL_FROM=erp@example.com" >> .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

That's the whole deploy: Caddy terminates HTTPS (certificates are
fetched and renewed automatically), the app runs with `DEMO_MODE=0`
(real login), and the first visit shows **"claim this instance"** where
you create the admin account. Invite everyone else from
**Admin → Roles & Permissions** — invite links are e-mailed when Resend
is configured, and always visible in the Email Center either way.

**Backups:** schedule the bundled script on the host —

```bash
crontab -e
# 15 2 * * * /path/to/forgerp/scripts/backup-db.sh
```

It takes a consistent online copy nightly into `./backups/` and keeps
30 days. Copy that directory off-box (rsync/rclone) for real safety.

**Monitoring:** point a free uptime checker (UptimeRobot etc.) at
`https://erp.example.com/api/health`.

---

## Upgrades

```bash
git pull
docker compose up -d --build        # self-host
# or: npm ci && npm run db:push && npm run build && restart
```

`prisma db push` is additive-safe for the shipped schema; back up the
database file first as a habit.

## Going to production — checklist

- [ ] `DEMO_MODE=0` (built-in e-mail + password auth; the prod compose overlay sets it)
- [ ] Front with HTTPS (the `docker-compose.prod.yml` + Caddy path does this automatically)
- [ ] Decide `SEED_ON_FIRST_BOOT` — demo data for beta testers, or `0` + Setup Wizard
- [ ] Schedule `scripts/backup-db.sh` in cron
- [ ] Optional: `RESEND_API_KEY` + `EMAIL_FROM` for real invite delivery
- [ ] Review role permissions under **Admin → Roles & Permissions**
