# ── Multi-architecture builds (issue #1438) ─────────────────────
#
# This file is built for linux/amd64 AND linux/arm64 by
# .github/workflows/docker-multiarch.yml. Nothing here is architecture-specific:
# every stage runs per target platform (under QEMU for the non-native one), so
# `prisma generate` produces the native query engine for the platform being
# built, and that engine is what the runner stage copies. The implicit buildx
# build args (TARGETPLATFORM/TARGETARCH/TARGETOS) are not consumed here — they
# do not need to be, because buildx already runs every stage for the target
# platform.
#
# There is deliberately no `--platform=` pin and no architecture-conditional
# `apt-get install`: node:24-slim publishes both architectures, and the only
# native artifacts (Prisma engines, Next's SWC binary) are resolved by npm for
# the target platform inside the builder stage.

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
# Only the scripts `npm ci` actually invokes are copied here — `preinstall`
# (`check-node.mjs`) and `prepare` (`install-git-hooks.mjs`). Keeping the copy
# minimal preserves layer caching; any new lifecycle script must be added here
# too or `npm ci` fails with "Cannot find module".
COPY scripts/check-node.mjs scripts/install-git-hooks.mjs ./scripts/
# Puppeteer (dev-only demo/screenshot scripts) downloads Chrome in its
# postinstall; skip it — it isn't needed to build or run the server and the
# download is a flaky network dependency in Docker.
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN npm ci

# Stage 2: Builder
FROM node:24-slim AS builder
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
ENV NEXT_PUBLIC_GIT_SHA=$GIT_SHA
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
# Generate the Prisma client before building (required at runtime).
#
# NOTE (multi-arch): this must stay inside the per-platform builder stage. The
# generated client is resolved from BUILD time for the architecture of *this*
# stage, which buildx/qemu guarantees is the target platform; moving it to a
# host-side step would silently ship an amd64 engine inside an arm64 image.
RUN npx prisma generate
RUN npm run build

# Dedicated migration image: includes the Prisma CLI and schema, but is never
# used as the production application runtime image.
FROM node:24-slim AS migrator
RUN apt-get update -qq \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node prisma ./prisma
USER node
ENTRYPOINT ["./node_modules/.bin/prisma"]
CMD ["migrate", "deploy"]

# Stage 4: Runner
FROM node:24-slim AS runner
ARG GIT_SHA
ENV GIT_SHA=$GIT_SHA
ENV NEXT_PUBLIC_GIT_SHA=$GIT_SHA
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
ENV HOSTNAME="0.0.0.0"

COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node --from=builder /app/package.json ./package.json
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

COPY --chown=node:node --from=builder /app/scripts/healthcheck.js ./scripts/healthcheck.js

EXPOSE 3000

ENV PORT=3000

# ── Container health (issue #1424) ────────────────────────────────
# Uses lightweight native Node.js probe script (scripts/healthcheck.js).
# Probes the liveness endpoint (/api/health/live) by default, ensuring the Node
# process is responsive without coupling container status to external dependencies.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["node", "scripts/healthcheck.js", "/api/health/live"]

CMD ["server.js"]
