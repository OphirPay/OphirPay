# OphirPay Helm Chart

This Helm chart deploys OphirPay on a Kubernetes cluster.

## Configuration

The following table lists configurable parameters of the OphirPay chart and default values.

| Parameter | Description | Default |
| --- | --- | --- |
| `config.NEXT_PUBLIC_STELLAR_HORIZON_URL` | Horizon server URL | `https://horizon-testnet.stellar.org` |
| `config.NEXT_PUBLIC_STELLAR_RPC_URL` | Soroban RPC server URL | `https://soroban-testnet.stellar.org` |
| `config.NEXT_PUBLIC_CONTRACT_ID` | Primary contract ID | `CCQGGUJRR...` |
| `config.NEXT_PUBLIC_EMITTER_CONTRACT_ID` | Event emitter contract ID | `CDAVU2XJ7...` |
| `config.NEXT_PUBLIC_CHAIN_READ_SOURCE` | Chain read account source | `GACNKEDGJ...` |
| `config.STELLAR_NETWORK_PASSPHRASE` | Stellar network passphrase | `Test SDF Network ; September 2015` |

> **IMPORTANT**: `NEXT_PUBLIC_*` environment variables are baked into the frontend bundle at Next.js **build time**.
> Setting or modifying `NEXT_PUBLIC_*` values in this Helm ConfigMap at runtime will **NOT** update the client-side JavaScript bundle of a pre-built Docker image.
> To change frontend configuration (e.g. switching from testnet to mainnet), the container image must be built with those `NEXT_PUBLIC_*` environment variables passed as build arguments during `docker build`.
