# Running the Playwright E2E suite

`playwright.config.ts` intentionally has no `webServer` block. Playwright does
not start the application, prepare a database, or seed test data. The default
`baseURL` is `http://localhost:3000`; `E2E_BASE_URL` overrides it. The server
must be ready before the test command runs.

## Local setup

1. Install the app dependencies and Playwright browsers:

   ```bash
   npm ci
   npx playwright install chromium firefox
   ```

2. Configure a reachable database and app environment using
   [`LOCAL_DEV.md`](./LOCAL_DEV.md). `npm run dev` must be able to connect to
   the database. For API tests that expect seeded records, initialize the
   schema and seed it:

   ```bash
   npx prisma generate
   npx prisma db push
   npm run db:seed
   ```

   Seeding is not idempotent: repeated runs add duplicate payment, batch,
   refund, and hook rows. Use a disposable database and see
   [`DEMO_MODE.md`](./DEMO_MODE.md#seed-contents-and-repeat-behavior) before
   reseeding. Most UI specs use browser-side fixtures and do not require these
   sample rows; only seed when the spec under test depends on server-side
   records.

3. Set `AUTH_SECRET` to a random value of at least 32 bytes (for example,
   `openssl rand -hex 32`). Set the Stellar network and contract IDs to match
   the environment being tested. `.env.example` supplies the current Testnet
   contract IDs; use your own valid `NEXT_PUBLIC_CONTRACT_ID` and
   `NEXT_PUBLIC_EMITTER_CONTRACT_ID` if testing another deployment. The
   browser-based contract flows use Testnet by default and the E2E suite does
   not need a funded signing secret.

4. Start the application in one terminal and wait for it to respond:

   ```bash
   npm run dev
   ```

   In another terminal:

   ```bash
   curl --fail --silent http://localhost:3000/api/health
   ```

   A connection-refused error means the server is not listening at the
   configured `E2E_BASE_URL`; it is not a Playwright setup or test assertion
   failure.

5. Run the suite in a second terminal:

   ```bash
   npm run test:e2e
   ```

   To run one browser or spec while iterating:

   ```bash
   npm run test:e2e -- --project=chromium
   npm run test:e2e -- e2e/multisig-flow.spec.ts --project=chromium
   ```

The default run includes Chromium, Firefox, mobile Chromium, and the
service-worker project. Tests that make HTTP requests through Playwright's
`request` fixture go directly to `E2E_BASE_URL`; `page.route()` does not
intercept those requests. The API, critical-flow, error-code, and contract
specs therefore need a running app and any external services their assertion
requires.

For a staging deployment you control, override the target explicitly:

```bash
E2E_BASE_URL=https://staging.example.test npm run test:e2e
```

Only use a deployment you are authorized to test. Prefer local or staging
environments for tests that might exercise mutations or real Stellar services.

## Which state is real and which is mocked?

Many browser-driven UI specs install deterministic route mocks before
navigation. The shared helpers currently cover these boundaries:

| Helper | Mocked boundary |
|---|---|
| `installMultisigMocks` in `e2e/helpers/stellar-mock.ts` | Wallet-session endpoints, `GET /api/multisig` and `/api/multisig/requests`, Soroban RPC, and Horizon transaction confirmation |
| `installAdminMocks` in `e2e/helpers/admin-mocks.ts` | The multisig mocks plus CSRF, pause state, timelock, hooks, fee config, RBAC, and API-key routes |
| `installRefundsMocks` in `e2e/helpers/refunds-mock.ts` | Wallet-session and CSRF endpoints, a stateful in-memory `/api/refunds` ledger, Soroban RPC, and Horizon transaction confirmation |
| `installSseMock` in `e2e/helpers/sse-mock.ts` | `GET /api/events`, proxied to a local streaming HTTP server so the test can emit and reconnect to SSE events |

The UI tests that use these helpers exercise the browser UI and client
integration against controlled responses; they do not verify a live database
write or a live contract transaction. A fake wallet and mocked RPC/Horizon are
used for those flows. Tests that do not install route handlers make their
requests against the configured app and its configured dependencies.

`contracts.spec.ts` expects contract IDs pointing to the deployed Testnet
contracts when checking Stellar health/configuration. The mocked multisig,
admin, and refund flows do not require a funded Testnet account. Never add a
real signing secret to E2E environment variables.

## CI behavior

Pull-request CI does not run Playwright. The separate
[`e2e-nightly.yml`](../.github/workflows/e2e-nightly.yml) workflow runs nightly
and on manual dispatch; it builds and starts a local app against its
PostgreSQL service before invoking Playwright. Local contributors must start
their own server because the config deliberately does not do so.
