# Demo mode and the seeded demo environment

Demo mode lets you run OphirPay end-to-end without funding a Stellar account
and without a Freighter wallet. It exists for hackathon demos, CI previews and
reviewer walkthroughs.

**A demo deployment must never point at mainnet.** See
[Security](#security-review-notes) below.

---

## The flag

`NEXT_PUBLIC_DEMO_MODE=true` — declared in `.env.example` (line 133, commented
out by default) and read in `src/lib/demo-mode.ts`:

```ts
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
```

The comparison is exact and case-sensitive. `"True"`, `"1"` and `"yes"` all
leave demo mode **off**. Because the variable is `NEXT_PUBLIC_`-prefixed it is
inlined into the client bundle at build time — it is a build-time switch, not a
runtime one. Changing it requires a rebuild, not just a restart.

It is validated as an optional string in `src/lib/env.ts` and surfaced on the
parsed env object.

### What the flag changes today

This is the part worth reading twice, so: **as of this commit, setting the flag
changes nothing in request handling.**

`src/lib/demo-mode.ts` exports the helpers and fixtures below, but a repo-wide
search for `isDemoMode` finds it referenced only in `src/lib/env.ts` (where it
is passed through as a string) and in `src/__tests__/docs-changelog-guide.test.ts`.
No component, route handler, or server action imports the module yet. No file
under `src/app/api/` branches on it.

So today the flag is wired at the environment layer and not yet at the
application layer. Anything the module exports is currently reachable only by a
caller that imports it directly.

| Helper                                    | Behaviour                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `isDemoMode()`                            | Returns whether the flag is set                                                                                |
| `simulatePayment({payee, amount})`        | Returns a `DemoPaymentResult` with status `RECORDED`, `demo: true`, and a synthetic `txHash` — no ledger write |
| `simulateBatchPayment({payees, amounts})` | As above, per payee                                                                                            |
| `generateDemoTxHash(prefix)`              | `prefix_<base36 timestamp>_<random>` — **not** a real Stellar transaction hash                                 |
| `DEMO_WALLET`                             | Pretends to be connected: testnet address, `10,000.00` balance                                                 |
| `DEMO_PAYMENTS`                           | Three pre-generated payments for the dashboard                                                                 |
| `DEMO_EVENTS`                             | Three pre-generated `payment:created` feed entries                                                             |
| `DEMO_MULTISIG`                           | Threshold 2, three placeholder signers                                                                         |
| `DEMO_PROPOSALS`                          | Two placeholder governance proposals                                                                           |

### Disabled safeguards

**None, currently — because nothing consumes the flag yet.** That is the honest
answer, and it is the thing most likely to change.

If a future change wires `isDemoMode()` into an auth check, a rate limiter, a
CSRF guard, a signature verification or a fee path, this section must be
updated in the same PR, listing the short-circuited control explicitly. A
security review that assumes demo mode is inert will be wrong the moment
someone wires it up, so the check is: does this PR make `isDemoMode()`
reachable from a request path?

---

## Seeding

```bash
./scripts/demo-seed.sh
```

One command, and it is safe to re-run. It performs, in order:

1. Checks `node` is on `PATH` and exits if not
2. `npm install --silent`
3. `npx prisma generate`
4. `npx prisma db push --accept-data-loss`, then `npx prisma db seed`
5. Writes `.env.local` with demo mode **only if `.env.local` does not already
   exist** — an existing file is never overwritten
6. `npm run dev`

> **`--accept-data-loss` is a real data-loss flag.** `db push` will drop and
> recreate tables that drift from the schema. On a scratch database that is
> what you want. Never point this at a database you care about.

The generated `.env.local`:

```bash
NEXT_PUBLIC_DEMO_MODE=true
NEXT_PUBLIC_STELLAR_NETWORK=TESTNET
```

`npx prisma db seed` runs `prisma/seed.ts`. The script tolerates its absence —
if the seed is not wired into `package.json` it prints a warning and continues,
so a successful run does not prove seed data was written.

### Teardown

```bash
npx prisma db push --accept-data-loss --force-reset   # drop and rebuild empty
rm .env.local                                        # turn demo mode off
```

Rebuild required to turn the flag off, per the build-time note above.

---

## Verifying the seed

```bash
./scripts/demo-test.sh
```

`scripts/demo-test.sh` checks the seeded environment end-to-end: the server
answers, demo routes respond, and the database reflects the seed. Run it after
`demo-seed.sh` has brought the dev server up in a second terminal.

---

## Screenshots and video

Screenshots are captured with `scripts/capture-screenshots.js`, which drives
headless Puppeteer at a 1440×900 viewport against five routes:

| Route          | Output                                |
| -------------- | ------------------------------------- |
| `/`            | `public/screenshots/dashboard.png`    |
| `/payments`    | `public/screenshots/payments.png`     |
| `/send`        | `public/screenshots/send-payment.png` |
| `/batches`     | `public/screenshots/batches.png`      |
| `/batches/new` | `public/screenshots/batch-new.png`    |

```bash
npm run dev                  # in one terminal
node scripts/capture-screenshots.js
```

Notes that matter when re-recording:

- The server must be **up first**; each page has a 30s `networkidle2` timeout.
- `public/screenshots/` is tracked in the repo and already exists — the script
  does not create it. If it is ever missing, capture fails per page and the
  script still prints "All screenshots captured!".
- The script writes only the five routes listed above. The other tracked
  screenshots (`analytics.png`, `ci-pipeline.png`, `contracts.png`,
  `governance.png`) are captured by other means and are not regenerated here.
- `networkidle2` plus a fixed 1s settle is a heuristic, not a guarantee. On a
  cold dev server the first capture can be blank; re-run it.
- Flags are `--no-sandbox --disable-gpu`, which is why this works in a
  container.

There is no capture script for the demo video. Record it manually against the
seeded environment, or add one alongside this doc.

---

## Demo data and credentials

`DEMO_WALLET.publicKey` —
`GBH3O5IHGJ6GUKZCINS3UZGHVKDKYDLVIRKZY7GYA27B54WT3Q7H4KXO` — is a
correctly-formatted **testnet** address. It is not a funded account and holds
nothing. The `10,000.00` balance is a literal in the fixture, not a ledger
read.

No secret keys, mnemonics or API keys are committed. Nothing in the demo path
requires a credential.

---

## Security review notes

- Demo mode must not be enabled on a deployment that can reach mainnet. A
  deployment that trusts simulated results is a deployment that will happily
  report success for payments that never settled.
- `generateDemoTxHash` output is not a real transaction hash. If demo records
  ever reach an export, an audit log, or an API response consumed by a client,
  the format is not a Stellar hash and must not be treated as one.
- The `demo: true` discriminator on every `DemoPaymentResult` is the intended
  way to tell simulated records from real ones. Any persistence layer that
  stores these needs to keep that flag.
- `DEMO_MODE` is evaluated once at module load. A runtime toggle is not
  supported, and code should not assume it can flip mid-process.
