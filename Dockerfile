# Stage 1: Dependencies (full install — the build needs devDependencies:
# TypeScript, Prisma CLI, Tailwind, ESLint are all required by `next build`)
#
# NOTE: Use the Debian (glibc) image, not Alpine (musl). Tailwind v4's
# `@tailwindcss/postcss` and its native `lightningcss`/`oxide` binaries crash
# the Turbopack PostCSS loader on musl, which fails `next build` in Docker.
FROM node:20-slim AS deps
RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json* .nvmrc ./
COPY scripts/check-node.mjs ./scripts/
# Puppeteer (dev-only demo/screenshot scripts) downloads Chrome in its
# postinstall; skip it — it isn't needed to build or run the server and the
# download is a flaky network dependency in Docker.
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci

# Stage 2: Builder
FROM node:20-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Generate the Prisma client before building (required at runtime)
RUN npx prisma generate
RUN npm run build

# Stage 3: Runner
FROM node:20-slim AS runner
RUN apt-get update -qq && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000

# ── Container health (issue #738) ────────────────────────────────
# Probes the *liveness* endpoint: it only proves the Node process is up and
# answering HTTP, so a transient database / Soroban RPC / Redis outage never
# marks a healthy container unhealthy (and never restart-loops it). The
# dependency-aware readiness check stays at GET /api/health and is what
# Kubernetes wires to `readinessProbe` — see docs/DEPLOYMENT.md →
# "Liveness vs readiness".
#
# Exec form on purpose: the runner stage (plus any distroless variant) has no
# shell, and neither curl nor wget is installed — the bundled `node` and its
# global `fetch` are the only probe client guaranteed to exist in the image.
# `--start-period` covers the standalone server boot + Prisma client init;
# 3 failures of a 5s-timeout probe are required before the container is
# reported `unhealthy`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["server.js"]
