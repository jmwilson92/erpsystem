# ─── Protessera self-host image ─────────────────────────────────────
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
# --omit=optional skips the SQLite native module (better-sqlite3) — Protessera
# runs on PostgreSQL via the pure-JS pg driver.
RUN npm ci --omit=optional
COPY . .
# Air-gapped images are a BUILD-time variant, not just a runtime flag: with
# AIRGAP=1 next.config aliases the analytics package to a local stub, so the
# third-party collector URL never enters the client bundle. Setting the flag at
# runtime alone would leave that URL shipped, and `npm run verify:airgap` exists
# precisely because that distinction is invisible otherwise.
ARG AIRGAP=0
ENV AIRGAP=$AIRGAP
RUN npx prisma generate && npm run build

# ─── runtime ───
FROM base AS runtime
ENV NODE_ENV=production
# Carried into the runtime so the image is self-describing: an image built
# air-gapped also BEHAVES air-gapped by default, instead of depending on whoever
# runs it remembering to pass the flag.
ARG AIRGAP=0
ENV AIRGAP=$AIRGAP
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
