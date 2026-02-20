# ── Stage 1: install dependencies ──────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Stage 2: runtime image ──────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Runtime essentials only
COPY --from=deps /app/node_modules ./node_modules

# Application source
COPY . .

# Ensure mutable directories exist (data store + uploads)
RUN mkdir -p data uploads data/messages && \
    touch uploads/.gitkeep && \
    chmod +x scripts/start.sh scripts/stop.sh scripts/truncate.sh scripts/docker-entrypoint.sh

# The app reads PORT from the env; default is 3000
ENV PORT=3000 \
    NODE_ENV=production

EXPOSE 3000

# Wipe data then start fresh on every container boot
CMD ["sh", "scripts/docker-entrypoint.sh"]
