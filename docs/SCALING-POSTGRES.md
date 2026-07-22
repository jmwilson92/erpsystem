# Scaling ForgeRP: SQLite → PostgreSQL

ForgeRP ships on SQLite, which is perfect for a single instance (one shop,
dozens of users) and for the instance-per-customer beta. Move to PostgreSQL
when you need concurrent-write throughput, network access, replication, or
managed backups/point-in-time recovery.

Prisma makes the swap mechanical. This guide is the checklist.

## When to switch

- SQLite is fine: single instance, self-host, desktop app, one company's users.
- Move to Postgres when: a hosted instance gets write-heavy, you want managed
  backups/PITR, read replicas, or you consolidate onto shared infrastructure.

> Instance-per-customer with **Postgres-per-instance** keeps the strong data
> isolation (nothing shared) while removing SQLite's single-writer limit. This
> is the recommended first scaling step — no application changes beyond the
> datasource.

## 1. Provision Postgres

Any Postgres 14+ works (RDS, Cloud SQL, Neon, Supabase, self-managed). Create a
database and a user, and get a connection string:

```
postgresql://USER:PASSWORD@HOST:5432/forgerp?schema=public
```

## 2. Point Prisma at Postgres

In `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"   // was "sqlite"
  url      = env("DATABASE_URL")
}
```

Set `DATABASE_URL` to the connection string above (in `.env` / your host's env).

> Keep a `schema.sqlite.prisma` copy if you want to keep SQLite for local dev;
> select it with `prisma --schema`. Most teams just use Postgres everywhere once
> they switch.

## 3. Create the schema and generate the client

```bash
npx prisma generate
npx prisma migrate deploy      # or: npx prisma db push (no migration history)
```

If you have no migration history yet (this repo uses `db push`), run:

```bash
npx prisma db push
```

## 4. Seed or migrate data

- **Fresh instance:** `npm run db:seed:prod` (production seed — starts on a
  30-day trial, GFP module off).
- **Existing SQLite data to carry over:** export from SQLite and import into
  Postgres. The reliable path is a small Prisma script that reads from the old
  SQLite client and writes to the new Postgres client, table by table in FK
  order — or use `pgloader` for a direct SQLite→Postgres copy:

  ```bash
  pgloader ./prisma/dev.db postgresql://USER:PASSWORD@HOST/forgerp
  ```

  Verify row counts and a few key records afterward.

## 5. Bump the client epoch

`src/lib/db.ts` has `PRISMA_CLIENT_EPOCH`. Bump it on any schema change so
sandbox copies re-materialize against the new schema. (SQLite-only sandbox logic
in `db.ts` is a no-op on Postgres, but the epoch bump is still good hygiene.)

## 6. Connection pooling (important on serverless)

Postgres has a connection limit. On serverless/edge or many instances, put a
pooler in front (PgBouncer, RDS Proxy, or Neon/Supabase's pooled URL) and point
`DATABASE_URL` at the pooled endpoint. Prisma also supports
`?connection_limit=` in the URL.

## 7. Backups

Turn on automated backups + point-in-time recovery on your Postgres provider.
This replaces the SQLite volume snapshot approach from `DEPLOY.md`.

## Rollback

The app is storage-agnostic — switching the provider back to `sqlite` and
restoring the `DATABASE_URL` returns you to the previous setup. Keep a backup of
`prisma/dev.db` before migrating.
