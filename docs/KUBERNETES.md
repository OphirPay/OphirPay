# ☸️ Kubernetes & Helm Deployment Guide

> Authoritative operational guide for deploying, configuring, scaling, and managing OphirPay on Kubernetes using Helm or standalone manifests.

---

> [!NOTE]
> **Reference Architecture Notice**: The Helm chart located at `helm/ophirpay/` and the standalone manifests in `k8s/` are provided as an extensible reference architecture and starting point for operators, rather than an SLA-backed, turnkey managed cloud product. Customize resource requests, autoscaling thresholds, ingress classes, network policies, and secret management integrations to align with your production infrastructure standards.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Required Values & Secret Provisioning](#3-required-values--secret-provisioning)
4. [Critical Caveat: Build-Time vs. Runtime Inlining (`NEXT_PUBLIC_*`)](#4-critical-caveat-build-time-vs-runtime-inlining-next_public_)
5. [Database Migrations (Job vs. Init Container)](#5-database-migrations-job-vs-init-container)
6. [Ingress, TLS & Domain Routing](#6-ingress-tls--domain-routing)
7. [Health Probes & Lifecycle Tuning](#7-health-probes--lifecycle-tuning)
8. [Pre-Flight Checklist & Deployment Runbook](#8-pre-flight-checklist--deployment-runbook)
9. [Standalone Manifests (`kubectl apply -f k8s/`)](#9-standalone-manifests-kubectl-apply--f-k8s)
10. [Troubleshooting & Rollback](#10-troubleshooting--rollback)

---

## 1. Architecture Overview

When deployed via Helm, OphirPay provisions a resilient, multi-pod architecture designed for high availability:

```mermaid
flowchart TD
    Ingress["Ingress Controller<br>(ingress-nginx + cert-manager TLS)"]
    Service["ClusterIP Service<br>(port 80 → targetPort 3000)"]
    
    subgraph OphirPay Pods ["OphirPay Deployment (Replicas: 2-10)"]
        Pod1["Pod 1<br>(Next.js Standalone Runner)"]
        Pod2["Pod 2<br>(Next.js Standalone Runner)"]
        HPA["HPA (CPU > 70%, Mem > 80%)"]
        PDB["PDB (minAvailable: 1)"]
    end

    subgraph Data & Blockchain
        DB[(PostgreSQL 14+)]
        Redis[(Redis 7+)]
        Horizon["Stellar Horizon API"]
        Soroban["Soroban RPC Node"]
    end

    subgraph Probes
        LiveProbe["/api/health/live<br>(Liveness: Process Only)"]
        ReadyProbe["/api/health<br>(Readiness: DB/RPC/Redis)"]
    end

    Ingress --> Service
    Service --> OphirPay Pods
    Pod1 --> LiveProbe
    Pod1 --> ReadyProbe
    Pod1 --> DB
    Pod1 --> Redis
    Pod1 --> Horizon
    Pod1 --> Soroban
```

---

## 2. Prerequisites

Before installing the chart or applying manifests, ensure your Kubernetes cluster meets the following requirements:

* **Kubernetes Cluster:** v1.26 or newer.
* **Helm:** v3.10+ installed locally.
* **Ingress Controller:** Ingress controller installed (default template targets `ingress-nginx`).
* **TLS Certificate Manager:** `cert-manager` v1.12+ with an active `ClusterIssuer` (e.g. `letsencrypt-prod`).
* **PostgreSQL Database:** Dedicated PostgreSQL 14+ database instance (Neon, Amazon RDS, Google Cloud SQL, or in-cluster crunchy/cloudnative-pg). SQLite is strictly unsupported in containerized production.
* **Optional Redis:** Redis 7+ instance for distributed sliding-window rate limiting. If omitted, in-memory rate limiting is applied per-pod.

---

## 3. Required Values & Secret Provisioning

The default configuration values are maintained in [`helm/ophirpay/values.yaml`](../helm/ophirpay/values.yaml).

### 3.1 Required vs. Optional Configuration

| Parameter | Type | Default | Description |
|---|---|---|---|
| `replicaCount` | Integer | `2` | Minimum initial replica count. |
| `image.repository` | String | `ghcr.io/ophirpay/ophirpay` | Container image repository. |
| `image.tag` | String | `latest` | Image tag (or Git commit SHA / semver release). |
| `config.DATABASE_PROVIDER` | String | `postgresql` | Database provider (`postgresql`). |
| `config.NODE_ENV` | String | `production` | Node environment. |
| `config.NEXT_PUBLIC_STELLAR_NETWORK` | String | `TESTNET` | Target Stellar network (`TESTNET` or `PUBLIC`). |
| `config.NEXT_PUBLIC_STELLAR_HORIZON_URL` | String | `https://horizon-testnet.stellar.org` | Stellar Horizon REST endpoint. |
| `config.NEXT_PUBLIC_STELLAR_RPC_URL` | String | `https://soroban-testnet.stellar.org` | Soroban JSON-RPC endpoint. |
| `config.STELLAR_NETWORK_PASSPHRASE` | String | `Test SDF Network ; September 2015` | Stellar network passphrase. |
| `config.NEXT_PUBLIC_APP_URL` | String | `https://ophirpay.com` | Public base URL used for canonical metadata and OAuth/auth callbacks. |
| `secrets.DATABASE_URL` | String | *Empty* (**Required**) | PostgreSQL connection string. |
| `secrets.AUTH_SECRET` | String | *Empty* (**Required**) | 32+ character random secret for JWT session encryption. |
| `secrets.NEXT_PUBLIC_CONTRACT_ID` | String | *Empty* (**Required**) | Soroban contract ID for the OphirPay core contract (`C...`). |
| `secrets.NEXT_PUBLIC_EMITTER_CONTRACT_ID` | String | *Empty* (**Required**) | Soroban contract ID for the OphirPay Emitter contract (`C...`). |

### 3.2 Secret Provisioning Strategies

By design, all `secrets:` fields in `values.yaml` default to empty strings to prevent sensitive credentials from being committed to version control. You must supply them using one of the following methods:

#### Method A: Custom Values File via Secrets Manager (Recommended for CI/CD)
Create a `values-production.yaml` that is populated at deploy time from a vault or secrets manager:

```yaml
secrets:
  DATABASE_URL: "postgresql://app_user:StrongPassword123@postgres-prod.internal:5432/ophirpay?sslmode=require"
  AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  NEXT_PUBLIC_CONTRACT_ID: "CB2Q573O54WAG3V7Z2V45A63QW772YUXZ7G6K5U7C3JDX5E2U76X2AAL"
  NEXT_PUBLIC_EMITTER_CONTRACT_ID: "CA3L4O5K6J7H8G9F0E1D2C3B4A5Z6Y7X8W9V0U1T2S3R4Q5P6O7N8M9L"
```

#### Method B: Helm Command-Line Injection
Supply secrets via `--set-string` during invocation:
```bash
helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay \
  --create-namespace \
  --set-string secrets.DATABASE_URL="$PROD_DATABASE_URL" \
  --set-string secrets.AUTH_SECRET="$PROD_AUTH_SECRET" \
  --set-string secrets.NEXT_PUBLIC_CONTRACT_ID="$CONTRACT_ID" \
  --set-string secrets.NEXT_PUBLIC_EMITTER_CONTRACT_ID="$EMITTER_ID"
```

#### Method C: Pre-Existing Kubernetes Secret
If your platform uses External Secrets Operator, Sealed Secrets, or Vault Agent Injector:
1. Create the Secret `ophirpay-secrets` manually or via CRD:
   ```bash
   kubectl create secret generic ophirpay-secrets -n ophirpay \
     --from-literal=DATABASE_URL="postgresql://..." \
     --from-literal=AUTH_SECRET="..." \
     --from-literal=NEXT_PUBLIC_CONTRACT_ID="..." \
     --from-literal=NEXT_PUBLIC_EMITTER_CONTRACT_ID="..."
   ```
2. Disable the chart's internal Secret generation in `values.yaml` by omitting `secrets` keys or setting them empty.

---

## 4. Critical Caveat: Build-Time vs. Runtime Inlining (`NEXT_PUBLIC_*`)

> [!WARNING]
> **CRITICAL ARCHITECTURAL CONSTRAINT: Next.js Client Bundle Inlining**
>
> Next.js inlines all environment variables prefixed with `NEXT_PUBLIC_*` directly into the JavaScript/HTML client bundles **at `next build` time**.
>
> Consequently:
> * Changing `NEXT_PUBLIC_STELLAR_NETWORK`, `NEXT_PUBLIC_STELLAR_HORIZON_URL`, `NEXT_PUBLIC_STELLAR_RPC_URL`, `NEXT_PUBLIC_CONTRACT_ID`, or `NEXT_PUBLIC_APP_URL` in a Kubernetes `ConfigMap` or `Secret` has **NO EFFECT on browser client bundles** when using prebuilt images (`ghcr.io/ophirpay/ophirpay:latest`).
> * The client browser bundle will continue connecting to the network and contract addresses that were present when the Docker container was compiled.
> * Runtime environment variables in the ConfigMap are only read by the Node.js SSR runtime on the server.
>
> **Action Required for Mainnet / Custom Deployments:**
> When deploying to Stellar Public Mainnet or using customized smart contract IDs, you **must build your own container image** with the appropriate build arguments:
> ```bash
> docker build -t my-registry.com/ophirpay:1.0.0 \
>   --build-arg NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC \
>   --build-arg NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org \
>   --build-arg NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban.stellar.org:443 \
>   --build-arg NEXT_PUBLIC_CONTRACT_ID=<mainnet-contract-id> \
>   --build-arg NEXT_PUBLIC_EMITTER_CONTRACT_ID=<mainnet-emitter-id> \
>   --build-arg NEXT_PUBLIC_APP_URL=https://ophirpay.com \
>   .
> ```

---

## 5. Database Migrations (Job vs. Init Container)

Because Next.js standalone runner pods run concurrently and horizontally scale up to 10 replicas, **database migrations (`prisma migrate deploy`) must never be executed on pod startup inside the application container**. Doing so causes concurrent migration lock collisions and connection timeouts.

Choose one of the following two recommended migration patterns:

### Pattern A: Helm Post-Install / Pre-Upgrade Job (Recommended)

Create a dedicated Kubernetes Job template in your deployment pipeline or Helm hooks (`templates/migration-job.yaml`):

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: "{{ include "ophirpay.fullname" . }}-migrate-{{ .Release.Revision }}"
  namespace: {{ .Release.Namespace }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-1"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: 2
  template:
    metadata:
      name: "{{ include "ophirpay.fullname" . }}-migrate"
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          command: ["npx", "prisma", "migrate", "deploy"]
          envFrom:
            - configMapRef:
                name: {{ include "ophirpay.fullname" . }}-config
            - secretRef:
                name: {{ include "ophirpay.fullname" . }}-secrets
```

### Pattern B: Migration Init Container

If you prefer migrations run immediately before the app pod starts:

```yaml
initContainers:
  - name: run-migrations
    image: ghcr.io/ophirpay/ophirpay:latest
    command: ["npx", "prisma", "migrate", "deploy"]
    envFrom:
      - configMapRef:
          name: ophirpay-config
      - secretRef:
          name: ophirpay-secrets
```

---

## 6. Ingress, TLS & Domain Routing

The Helm chart includes an `ingress.yaml` resource tailored for `ingress-nginx` and `cert-manager`.

### 6.1 Configuration Snippet (`values.yaml`)
```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m" # Required for CSV batch imports
  hosts:
    - host: ophirpay.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: ophirpay-tls
      hosts:
        - ophirpay.com
```

> [!NOTE]
> The annotation `nginx.ingress.kubernetes.io/proxy-body-size: "10m"` is essential. OphirPay supports bulk payment batch uploads via CSV (see [`docs/CSV_FORMAT.md`](./CSV_FORMAT.md)). Omitting this annotation causes Nginx to return `413 Request Entity Too Large` on batches exceeding the default 1MB limit.

---

## 7. Health Probes & Lifecycle Tuning

OphirPay exposes two dedicated health endpoints with distinct operational meanings. Do **not** conflate them:

| Probe | Path | Port | Target Behavior | Rationale |
|---|---|---|---|---|
| **Liveness** | `/api/health/live` | 3000 | Checks process event loop only. Returns `200 OK`. | Does NOT perform database, RPC, or Redis I/O. If PostgreSQL has a transient failover, the liveness probe remains green, preventing cascading pod restarts. |
| **Readiness** | `/api/health` | 3000 | Validates database connectivity (`SELECT 1`), Horizon, and Soroban RPC. Returns `503 Service Unavailable` if database is down. | Pulls the pod out of the Service endpoint routing table without killing the container. Traffic is diverted until database connectivity recovers. |

Both endpoints are exempt from rate limiting in `src/proxy.ts`.

---

## 8. Pre-Flight Checklist & Deployment Runbook

Follow this checklist before running production rollouts.

### Pre-Flight Checklist

1. [ ] **Lint Helm Chart:** Ensure template syntax is sound:
   ```bash
   helm lint ./helm/ophirpay
   ```
2. [ ] **Render Templates (Dry-Run):** Verify rendered output against cluster schema:
   ```bash
   helm template ophirpay ./helm/ophirpay \
     -f values-production.yaml \
     --validate
   ```
3. [ ] **Verify Secret Keys:** Confirm that `DATABASE_URL` and `AUTH_SECRET` are non-empty.
4. [ ] **Verify Next.js Inlined Image:** Confirm that the image tag was built with matching `NEXT_PUBLIC_*` arguments if running outside of testnet.
5. [ ] **Check Ingress Class:** Confirm your cluster has an active Ingress controller matching `ingress.className`.

### Installation Command

```bash
# 1. Add namespace
kubectl create namespace ophirpay --dry-run=client -o yaml | kubectl apply -f -

# 2. Deploy Helm release
helm upgrade --install ophirpay ./helm/ophirpay \
  --namespace ophirpay \
  --values values-production.yaml \
  --wait \
  --timeout 5m
```

### Post-Deployment Verification

```bash
# Verify pod rollout status
kubectl rollout status deployment/ophirpay -n ophirpay

# Check pod statuses and ready counts
kubectl get pods -n ophirpay -l app.kubernetes.io/name=ophirpay

# Test readiness probe directly in-cluster
kubectl run test-curl --image=curlimages/curl --rm -it --restart=Never -n ophirpay -- \
  curl -i http://ophirpay.ophirpay.svc.cluster.local/api/health
```

---

## 9. Standalone Manifests (`kubectl apply -f k8s/`)

For environments where Helm is not permitted, the `k8s/` directory contains standard Kubernetes manifests:

```bash
# 1. Apply namespace, ConfigMap, and base secrets
kubectl apply -f k8s/namespace-config.yaml

# 2. Apply deployment, service, ingress, HPA, PDB, and network policy
kubectl apply -f k8s/deployment.yaml
```

Keep manifest keys synchronized with `.env.example` as guarded by `src/__tests__/helm-config.test.ts`.

---

## 10. Troubleshooting & Rollback

### Common Failure Modes

* **CrashLoopBackOff with `Missing required environment variable`:**
  * Check container logs: `kubectl logs deployment/ophirpay -n ophirpay`.
  * Ensure all mandatory variables in Section 3 are present in `ophirpay-config` or `ophirpay-secrets`.
* **Pod unready (`0/1 Ready`):**
  * Check readiness probe failure reasons: `kubectl describe pod -l app=ophirpay -n ophirpay`.
  * If `/api/health` returns `503`, verify PostgreSQL network reachability from within the pod:
    ```bash
    kubectl exec -it deployment/ophirpay -n ophirpay -- npx prisma db execute --stdin <<< "SELECT 1;"
    ```
* **Client connects to Testnet instead of Mainnet:**
  * Review Section 4. The container image was compiled with testnet variables inlined. Rebuild the image with `NEXT_PUBLIC_STELLAR_NETWORK=PUBLIC`.

### Immediate Rollback
To immediately revert an unhealthy release to the previous working revision:
```bash
helm rollback ophirpay -n ophirpay
```
