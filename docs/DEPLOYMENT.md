# Deploying ForgeRP

ForgeRP runs anywhere Node 20+ runs. Two supported paths: **self-host
(Docker)** and **cloud Node**. Schema is created on first boot; demo
seed is optional.

---

## Option 1 — Self-host with Docker

### Evaluation (demo data)

```bash
git clone <your-repo> forgerp && cd forgerp
docker compose up -d --build
# → http://localhost:3000  (DEMO data, persona switcher)
```

### Production / plant pilot

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Or set env explicitly:
# DEMO_MODE=0 SEED_ON_FIRST_BOOT=0 docker compose up -d --build
```

| Variable | Evaluation | Production |
| --- | --- | --- |
| `DEMO_MODE` | unset (open) | **`0`** (required) |
| `SEED_ON_FIRST_BOOT` | `1` | **`0`** |
| `DATABASE_URL` | `file:/data/forgerp.db` | same or Postgres URL |
| `NEXT_PUBLIC_APP_URL` | optional | public HTTPS URL |

What happens on first boot:
1. Image builds (Node 22, native SQLite driver).
2. `prisma db push` creates the schema on the `/data` volume.
3. If `SEED_ON_FIRST_BOOT=1` and no `.seeded` marker → demo dataset.
4. Production: empty books → use **Setup Wizard** (`/setup`) and **Data Import**.
5. Health: `GET /api/health` (also Docker healthcheck).

Books live on the `forgerp-data` volume — image rebuilds do not wipe them.

**Backups:**

```bash
docker compose exec forgerp sh -c 'cp /data/forgerp.db /data/backup-$(date +%F).db'
docker cp forgerp:/data/backup-$(date +%F).db ./
```

Schedule nightly copies of `/data/forgerp.db` (or Postgres dumps). Test restore once before go-live.

**HTTPS:** put Caddy, nginx, or Traefik in front of port 3000. HSTS is already set by the app.

**Postgres (optional):**

```bash
docker compose --profile postgres up -d
```

Then switch `prisma/schema.prisma` provider to `postgresql`, point
`DATABASE_URL` at the service, use `@prisma/adapter-pg` in `src/lib/db.ts`,
and re-run `prisma db push`.

---

## Option 2 — Cloud (Vercel or any Node host)

```bash
npm ci
# set env from .env.production.example
npm run setup     # or db push only if not seeding
npm run build
npm start
```

| Variable | Purpose | Production value |
| --- | --- | --- |
| `DATABASE_URL` | `file:` or Postgres URL | required |
| `DEMO_MODE` | Login required when `0` | **`0`** |
| `SEED_ON_FIRST_BOOT` | Docker seed | **`0`** |
| `ALLOW_DEMO_IN_PRODUCTION` | Escape hatch for public demos | unset |
| `NEXT_PUBLIC_APP_URL` | Invite / QR absolute URLs | HTTPS origin |
| `SMTP_URL` | Real mail for invites | optional |
| `XAI_API_KEY` | AI assistant | optional |

Boot guard: if `NODE_ENV=production` and `DEMO_MODE` is not `0`, the
process **exits** unless `ALLOW_DEMO_IN_PRODUCTION=1`.

Validate env before start:

```bash
NODE_ENV=production DEMO_MODE=0 node scripts/assert-production-env.mjs
```

---

## Upgrades

```bash
git pull
# backup DB first
docker compose up -d --build
# or: npm ci && npm run db:push && npm run build && restart
```

`prisma db push` is additive-safe for the shipped schema; back up first.

---

## Going to production — checklist

- [ ] `DEMO_MODE=0` (and boot does not exit)
- [ ] Persona switcher hidden
- [ ] `SEED_ON_FIRST_BOOT=0` / empty plant path
- [ ] HTTPS reverse proxy
- [ ] Database backups + one restore drill
- [ ] Admin claimed (first-boot password or invite)
- [ ] Role permissions under **Admin → Permissions**
- [ ] `/api/health` returns `{ ok: true }`
- [ ] Modules disabled for unpurchased SKUs
- [ ] Support channel agreed with customer

See also `SECURITY.md`, `docs/BETA_FINISH_LINE.md`, `.env.production.example`.
