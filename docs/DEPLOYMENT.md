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
| `SEED_ON_FIRST_BOOT` | Docker only — demo data on first boot | `1` |
| `XAI_API_KEY` | Optional — upgrades the AI Assistant | unset |

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

- [ ] Replace demo auth with a real provider (see `SECURITY.md`)
- [ ] Front with HTTPS (reverse proxy or platform TLS)
- [ ] Set `SEED_ON_FIRST_BOOT=0` / start from the Setup Wizard
- [ ] Schedule database file backups
- [ ] Review role permissions under **Admin → Roles & Permissions**
