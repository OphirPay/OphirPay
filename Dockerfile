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

COPY package.json package-lock.json* ./
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

# Stage 3: Runner (distroless for minimal attack surface)
FROM gcr.io/distroless/nodejs20-debian12:nonroot AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

ENV PORT=3000
CMD ["server.js"]
