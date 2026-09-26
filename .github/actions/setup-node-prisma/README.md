# Setup Node.js & Prisma Composite Action

This GitHub composite action (`.github/actions/setup-node-prisma`) encapsulates the standard Node.js preamble across OphirPay workflows:

1. **Repository Checkout** (optional input `checkout: true`, default `false` when called locally after `actions/checkout`).
2. **Node.js Setup** via `actions/setup-node` pinned to commit SHA with `.nvmrc` version specification and `npm` caching.
3. **Dependency Installation** via `npm ci`.
4. **Prisma Client Generation** via `npx prisma generate` (can be disabled with `prisma-generate: "false"` for jobs that only need runtime dependencies).

## Usage

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-node-prisma
```

### With Prisma Generate Disabled (e.g. Linting / Audit jobs)

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: ./.github/actions/setup-node-prisma
    with:
      prisma-generate: "false"
```
