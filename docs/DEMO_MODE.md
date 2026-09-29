# Demo mode and seeded walkthrough

OphirPay has a demo flag and standalone simulation helpers, plus a Prisma seed
for populating a database. These are separate mechanisms: seeding adds example
database rows, while `NEXT_PUBLIC_DEMO_MODE` is a build-time frontend flag.

> **Important:** the demo flag is not a global mock or safety boundary. The
> simulator functions in `src/lib/demo-mode.ts` are not currently called by the
> app's payment flows. Setting the flag alone does not make payment submission
> skip the wallet, authentication, API, database, or Stellar contract, and it
> does not make real transactions safe to submit. Do not use it to test with
> real funds.

## Prepare a local walkthrough

First configure a working database using the relevant instructions in
[`LOCAL_DEV.md`](./LOCAL_DEV.md). In particular, use a disposable local
database: `scripts/demo-seed.sh` runs `prisma db push --accept-data-loss`.

Once the database connection is available to Prisma, initialize it and seed
the sample data:

```bash
npx prisma generate
npx prisma db push
npm run db:seed
```

`npm run db:seed` runs `prisma/seed.ts`. It creates or updates one demo user,
then adds sample payment, batch, refund, and notification-hook rows. The
specific records and seed repeat behavior are listed below.

To enable the frontend flag for a local Next.js run, add this to `.env.local`
before starting or rebuilding the app:

```dotenv
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
```

Then start the app:

```bash
npm run dev
```

`NEXT_PUBLIC_*` values are exposed to the browser and inlined at build time.
Restart the dev server after changing the flag; rebuild and redeploy after
changing it in a production build. Keep Stellar on Testnet for demos.

`bash scripts/demo-seed.sh` is an alternative convenience script. It installs
dependencies, generates Prisma, pushes the schema with `--accept-data-loss`,
seeds the database, creates `.env.local` only if it does not already exist,
and starts `npm run dev`. The database must already be configured and
reachable by the Prisma commands. If `.env.local` already exists, the script
does not change it. For manual setup and provider-specific configuration, use
[`LOCAL_DEV.md`](./LOCAL_DEV.md).

## Seed contents and repeat behavior

`prisma/seed.ts` creates the following example data:

| Records | Details |
|---|---|
| User | `seed-user-1`, named "OphirPay Demo", with a sample Stellar address |
| Payments | Five XLM records: three `COMPLETED`, one `PENDING`, and one `FAILED`; each uses the placeholder transaction hash `seed-tx-hash` |
| Batch | One completed "Demo Batch — Monthly Payroll" |
| Refunds | Four records attached to the first four seeded payments, with varied reasons, reason codes, and statuses |
| Notification hooks | Three active hooks for payment, refund, and escrow events pointing to `example.com` |

Only the user is upserted. Payments, batch, refunds, and hooks use `create`,
so running the seed more than once adds duplicate rows. Use a disposable
database or reset it before reseeding; the SQLite and PostgreSQL reset
procedures are in [`LOCAL_DEV.md`](./LOCAL_DEV.md#4-what-the-seed-script-does).
The placeholder transaction hashes and `example.com` webhook destinations are
illustrative data, not real chain records or delivery endpoints.

## What the flag changes (and does not change)

`src/lib/demo-mode.ts` exports `isDemoMode`, payment and batch simulation
helpers, a demo wallet, and sample dashboard data. The flag is true only when
`NEXT_PUBLIC_DEMO_MODE` is exactly `"true"`. At present, application payment
flows do not import these helpers, so enabling the flag alone does not switch
the product into a fully simulated application.

The flag does **not** disable or bypass:

- API authentication, authorization, CSRF protection, or server validation;
- database writes or the need to configure a reachable database;
- wallet signing, Stellar RPC/Horizon requests, or smart-contract calls in
  flows that invoke them;
- production safeguards or the risk of submitting a real transaction.

Do not treat demo-mode UI data as evidence that an API, seeded row, or
transaction exists on-chain. The screenshots and video under `public/` are
captured assets; the seed does not generate or refresh them. The roadmap item
to record fresh media against the seeded environment remains open in
[`ROADMAP.md`](../ROADMAP.md).
