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
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

# ─── runtime ───
FROM base AS runtime
ENV NODE_ENV=production
# SQLite lives on the /data volume so upgrades keep your books
ENV DATABASE_URL="file:/data/forgerp.db"
COPY --from=build /app /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /data \
    && useradd -m forgerp \
    && chown -R forgerp:forgerp /app /data
USER forgerp
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["npm", "start"]
