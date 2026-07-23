# ─── ForgeRP self-host image ─────────────────────────────────────
# Build:  docker build -t forgerp .
# Run:    docker compose up -d      (see docker-compose.yml)
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ─── deps + build ───
FROM base AS build
COPY package.json package-lock.json ./
# --omit=optional skips the SQLite native module (better-sqlite3) — ForgeRP
# runs on PostgreSQL via the pure-JS pg driver.
RUN npm ci --omit=optional
COPY . .
RUN npx prisma generate && npm run build

# ─── runtime ───
FROM base AS runtime
ENV NODE_ENV=production
# DATABASE_URL / DIRECT_URL are provided by the environment (docker-compose
# points them at the bundled Postgres service, or set them to a managed
# Postgres like Supabase). No local database file — persistence lives in
# Postgres, and uploads are stored as data URLs in the DB.
COPY --from=build /app /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && useradd -m forgerp \
    && chown -R forgerp:forgerp /app
USER forgerp
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
