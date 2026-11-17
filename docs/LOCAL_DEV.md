# Local Development Setup

This guide explains how to set up a local Stellar network environment for development and testing. Using a local "Standalone" node allows for faster iterations and offline contract testing without relying on the public Testnet.

## Prerequisites

- [Docker](https://www.docker.com/get-started) installed and running.
- [Stellar CLI](https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup#install-the-stellar-cli) (optional, for contract interaction).

## Running the Stellar Quickstart Container

We use the official `stellar/quickstart` Docker image. Run the following command to start a local Standalone node:

```bash
docker run --rm -it \
  -p 8000:8000 \
  --name stellar \
  stellar/quickstart \
  --standalone
```

### Configuration Details
- **Network Name:** `Standalone Network ; February 2017`
- **Horizon/RPC URL:** `http://localhost:8000`
- **Friendbot URL:** `http://localhost:8000/friendbot`

## Funding a Test Account

In Standalone mode, you must use the local Friendbot instance to fund your accounts. Replace `YOUR_PUBLIC_KEY` with your actual Stellar address:

```bash
curl "http://localhost:8000/friendbot?addr=YOUR_PUBLIC_KEY"
```

## Troubleshooting

### Container Healthcheck Timeouts
On some systems (especially those with limited resources), the container might take longer to initialize the ledger. 

- **Symptoms:** The container logs show "waiting for stellar-core to initialize" for an extended period or the healthcheck fails.
- **Solution:** 
  1. Increase Docker's allocated memory to at least 4GB.
  2. Wait for the log message: `entering stellar-core`.
  3. If the timeout persists, you can try running with the `--limit-core-history` flag to reduce disk I/O.

### Port Conflicts
If port `8000` is already in use by another service, map it to a different local port:
`-p 8080:8000` and update your RPC URL to `http://localhost:8080`.

---
