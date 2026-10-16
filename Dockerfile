# Stage 1: Dependencies (full install — the build needs devDependencies:
# TypeScript, Prisma CLI, Tailwind, ESLint are all required by `next build`)
#
# NOTE: Use the Debian (glibc) image, not Alpine (musl). Tailwind v4's
# `@tailwindcss/postcss` and its native `lightningcss`/`oxide` binaries crash
# the Turbopack PostCSS loader on musl, which fails `next build` in Docker.
FROM node:24-slim AS deps
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
FROM node:24-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* variables are inlined into client bundles during `next build`
# (issue #1329). Defaults match the testnet values in `.env.example`; override
# via `--build-arg` when building staging or mainnet images.
ARG NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
ARG NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443
ARG NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
ARG NEXT_PUBLIC_CONTRACT_ID=CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET
ARG NEXT_PUBLIC_EMITTER_CONTRACT_ID=CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG NEXT_PUBLIC_GA_ID=""
ARG NEXT_PUBLIC_ANCHOR_DOMAIN=""
ARG NEXT_PUBLIC_ANCHOR_FIAT_CURRENCY=""
ARG NEXT_PUBLIC_CHAIN_READ_SOURCE=""
ARG NEXT_PUBLIC_FEATURE_MULTI_ASSET=""
ARG NEXT_PUBLIC_FEATURE_RECURRING=""
ARG NEXT_PUBLIC_FEATURE_WEBHOOKS=""
ARG NEXT_PUBLIC_FEATURE_API_KEYS=""
ARG NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS=""
ARG NEXT_PUBLIC_DEMO_MODE=""
ARG NEXT_PUBLIC_APP_VERSION=""
ARG NEXT_PUBLIC_FEE_AGGRESSIVENESS=""

ENV NEXT_PUBLIC_STELLAR_NETWORK=$NEXT_PUBLIC_STELLAR_NETWORK \
    NEXT_PUBLIC_STELLAR_RPC_URL=$NEXT_PUBLIC_STELLAR_RPC_URL \
    NEXT_PUBLIC_STELLAR_HORIZON_URL=$NEXT_PUBLIC_STELLAR_HORIZON_URL \
    NEXT_PUBLIC_CONTRACT_ID=$NEXT_PUBLIC_CONTRACT_ID \
    NEXT_PUBLIC_EMITTER_CONTRACT_ID=$NEXT_PUBLIC_EMITTER_CONTRACT_ID \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN \
    NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID \
    NEXT_PUBLIC_ANCHOR_DOMAIN=$NEXT_PUBLIC_ANCHOR_DOMAIN \
    NEXT_PUBLIC_ANCHOR_FIAT_CURRENCY=$NEXT_PUBLIC_ANCHOR_FIAT_CURRENCY \
    NEXT_PUBLIC_CHAIN_READ_SOURCE=$NEXT_PUBLIC_CHAIN_READ_SOURCE \
    NEXT_PUBLIC_FEATURE_MULTI_ASSET=$NEXT_PUBLIC_FEATURE_MULTI_ASSET \
    NEXT_PUBLIC_FEATURE_RECURRING=$NEXT_PUBLIC_FEATURE_RECURRING \
    NEXT_PUBLIC_FEATURE_WEBHOOKS=$NEXT_PUBLIC_FEATURE_WEBHOOKS \
    NEXT_PUBLIC_FEATURE_API_KEYS=$NEXT_PUBLIC_FEATURE_API_KEYS \
    NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS=$NEXT_PUBLIC_FEATURE_ADVANCED_ANALYTICS \
    NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE \
    NEXT_PUBLIC_APP_VERSION=$NEXT_PUBLIC_APP_VERSION \
    NEXT_PUBLIC_FEE_AGGRESSIVENESS=$NEXT_PUBLIC_FEE_AGGRESSIVENESS

# Generate the Prisma client before building (required at runtime)
RUN npx prisma generate
RUN npm run build

# Stage 3: Runner
FROM node:24-slim AS runner
# `apt-get upgrade` is what keeps the image-scan step green: the node:24-slim
# base ships snapshot versions of system libraries (libcap2, gnutls, pcre2)
# that Debian has since revised, and every finding has a fix in the distro's
# -updates pocket.
RUN apt-get update -qq \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
USER node
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --chown=node:node --from=builder /app/public ./public
# .next/standalone already contains a pruned node_modules with exactly the
# runtime dependencies Next's output tracer selected.  Copying the full
# builder node_modules on top would double the layer size and ship every
# devDependency (TypeScript, Prisma CLI, Tailwind, Playwright, Puppeteer …)
# into the distroless runner image — defeating the purpose of standalone
# output and widening the attack surface.
#
# The ONE subset the standalone tracer intentionally omits is the native
# Prisma query engine binary: it is platform-specific and copied separately
# so the correct linux-musl / linux-openssl variant ends up in the image.
# If you switch database providers or change the Prisma binaryTargets you
# may need to adjust the glob below.
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
# Prisma query engine — copy only the native binary, not the whole CLI.
# The glob matches the openssl-3.x variant produced by `prisma generate` on
# the node:24-slim (Debian) builder.  The destination mirrors where
# standalone's own node_modules/.prisma/client/ expects to find the engine.
COPY --chown=node:node --from=builder /app/node_modules/.prisma/client/*.node ./node_modules/.prisma/client/
COPY --chown=node:node --from=builder /app/node_modules/@prisma/engines-version ./node_modules/@prisma/engines-version

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
