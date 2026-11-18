# OphirPay Helm Chart Deployment Guide

Production-grade Helm chart for deploying OphirPay payment infrastructure on Kubernetes (Minikube, K3s, Kind, AWS EKS, Google GKE, Azure AKS).

---

## Table of Contents

- [Overview & Architecture](#overview--architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
  - [1. Local Cluster (Minikube / K3s)](#1-local-cluster-minikube--k3s)
  - [2. Cloud Cluster (EKS / GKE / AKS)](#2-cloud-cluster-eks--gke--aks)
- [Values Reference Table](#values-reference-table)
- [Secrets Management](#secrets-management)
  - [Option A: External Secret (Recommended for Production)](#option-a-external-secret-recommended-for-production)
  - [Option B: Direct Helm Values](#option-b-direct-helm-values)
- [Ingress and TLS Configuration](#ingress-and-tls-configuration)
- [Autoscaling & Pod Disruption Budget](#autoscaling--pod-disruption-budget)
- [Health Probes & Lifecycle](#health-probes--lifecycle)
- [Database Migrations Hook](#database-migrations-hook)
- [Network Policies & Security](#network-policies--security)
- [Upgrades and Rollbacks](#upgrades-and-rollbacks)
- [Troubleshooting](#troubleshooting)

---

## Overview & Architecture

The OphirPay chart deploys a production-ready Next.js application integrated with Soroban smart contracts on the Stellar network.

```
                         ┌────────────────────────┐
                         │   Ingress Controller   │ (TLS termination,
                         │    (nginx / cloud)     │  cert-manager)
                         └───────────┬────────────┘
                                     │
                                     ▼
                         ┌────────────────────────┐
                         │   OphirPay Service     │ (ClusterIP :80)
                         └───────────┬────────────┘
                                     │
                ┌────────────────────┴────────────────────┐
                ▼                                         ▼
   ┌────────────────────────┐                ┌────────────────────────┐
   │    OphirPay Pod 1      │                │    OphirPay Pod 2      │
   │  (readiness / live)    │                │  (readiness / live)    │
   └───────────┬────────────┘                └───────────┬────────────┘
               │                                         │
               ├────────────────────┬────────────────────┤
               ▼                    ▼                    ▼
     ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
     │  PostgreSQL 14+  │  │   Redis Store    │  │   Stellar RPC    │
     │   (Prisma ORM)   │  │ (distributed RL) │  │  (Soroban test)  │
     └──────────────────┘  └──────────────────┘  └──────────────────┘
```

The chart manifests include:
- **Deployment**: Next.js application container with unprivileged user (`runAsUser: 1001`), read-only root filesystem, dropped Linux capabilities, and rolling update strategy.
- **Service**: Internal `ClusterIP` exposing port 80 (forwarding to port 3000).
- **Ingress**: TLS-enabled ingress routing with cert-manager integration and SSL redirects.
- **HorizontalPodAutoscaler (HPA)**: Metric-driven autoscaling based on CPU and memory utilization.
- **PodDisruptionBudget (PDB)**: High availability guarantee ensuring minimum pod availability during cluster drains.
- **NetworkPolicy**: Zero-trust network segmentation restricting ingress and allowing only required egress (PostgreSQL, Redis, Stellar RPC).
- **ConfigMap & Secret**: Strict runtime configuration matching documented environment variables.
- **Migration Job (Hook)**: Pre-upgrade / pre-install hook running `prisma migrate deploy` before traffic shifts.

---

## Prerequisites

- **Kubernetes**: Version 1.27 or higher.
- **Helm**: Version 3.10 or higher.
- **kubectl**: Configured with cluster-admin access.
- **Ingress Controller**: e.g., `ingress-nginx` installed and bound to an external load balancer.
- **cert-manager**: (Optional but recommended) for automatic Let's Encrypt TLS provisioning.
- **PostgreSQL**: Version 14 or higher reachable from the Kubernetes cluster.
- **Redis**: (Optional) required only if distributed rate-limiting is enabled (`REDIS_URL`).

---

## Quick Start

### 1. Local Cluster (Minikube / K3s)

#### Step 1: Start Minikube with Ingress
```bash
minikube start --cpus=4 --memory=8192
minikube addons enable ingress
```

#### Step 2: Create Namespace & Secret
```bash
kubectl create namespace ophirpay

kubectl create secret generic ophirpay-secrets \
  --namespace ophirpay \
  --from-literal=DATABASE_URL="postgresql://postgres:postgres@postgres.ophirpay.svc.cluster.local:5432/ophirpay" \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=NEXT_PUBLIC_CONTRACT_ID="CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET" \
  --from-literal=NEXT_PUBLIC_EMITTER_CONTRACT_ID="CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN"
```

#### Step 3: Deploy Chart
```bash
helm upgrade --install ophirpay helm/ophirpay \
  --namespace ophirpay \
  --set secrets.existingSecret=ophirpay-secrets \
  --set ingress.hosts[0].host=ophirpay.local \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix \
  --set ingress.tls=null \
  --set autoscaling.enabled=false \
  --set replicaCount=1
```

---

### 2. Cloud Cluster (EKS / GKE / AKS)

#### Step 1: Create Namespace & External Secret
In cloud production, provision secrets via External Secrets Operator or Sealed Secrets:

```bash
kubectl create namespace ophirpay
```

#### Step 2: Deploy Production Release
```bash
helm upgrade --install ophirpay helm/ophirpay \
  --namespace ophirpay \
  --set image.tag="1.0.0" \
  --set secrets.existingSecret="ophirpay-production-secrets" \
  --set ingress.enabled=true \
  --set ingress.className="nginx" \
  --set ingress.annotations."cert-manager\.io/cluster-issuer"="letsencrypt-prod" \
  --set ingress.hosts[0].host="api.ophirpay.com" \
  --set ingress.hosts[0].paths[0].path="/" \
  --set ingress.hosts[0].paths[0].pathType="Prefix" \
  --set ingress.tls[0].secretName="ophirpay-api-tls" \
  --set ingress.tls[0].hosts[0]="api.ophirpay.com" \
  --set migrations.enabled=true \
  --wait
```

---

## Values Reference Table

The following table documents all configurable parameters in `helm/ophirpay/values.yaml`:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `replicaCount` | integer | `2` | Number of pod replicas (ignored when `autoscaling.enabled=true`) |
| `image.repository` | string | `ghcr.io/ophirpay/ophirpay` | Container image repository |
| `image.tag` | string | `""` (falls back to `Chart.appVersion`) | Container image tag (never use `latest`) |
| `image.digest` | string | `""` | Immutable `sha256:...` container digest (takes precedence over tag) |
| `image.pullPolicy` | string | `IfNotPresent` | Image pull policy |
| `imagePullSecrets` | list | `[]` | Secrets for private registry authentication |
| `serviceAccount.create` | boolean | `true` | Create dedicated Kubernetes ServiceAccount |
| `serviceAccount.name` | string | `""` | Name of ServiceAccount to use |
| `serviceAccount.annotations` | object | `{}` | Annotations for ServiceAccount (e.g. AWS IAM Roles for Service Accounts) |
| `podAnnotations` | object | Prometheus scrape annotations | Annotations attached to pod spec |
| `podSecurityContext.fsGroup` | integer | `1001` | Pod filesystem group ID |
| `securityContext.runAsNonRoot` | boolean | `true` | Run container as unprivileged user |
| `securityContext.runAsUser` | integer | `1001` | User ID running the container process |
| `securityContext.readOnlyRootFilesystem` | boolean | `true` | Mount container filesystem as read-only |
| `securityContext.allowPrivilegeEscalation` | boolean | `false` | Prevent privilege escalation |
| `service.type` | string | `ClusterIP` | Kubernetes Service type |
| `service.port` | integer | `80` | Service exposed port |
| `service.targetPort` | integer | `3000` | Port container listens on |
| `ingress.enabled` | boolean | `true` | Enable Ingress resource creation |
| `ingress.className` | string | `nginx` | Ingress controller class name |
| `ingress.annotations` | object | TLS and proxy annotations | Ingress annotations (cert-manager, body size) |
| `ingress.hosts` | list | `[{ host: "ophirpay.com", ... }]` | Ingress hostname routing rules |
| `ingress.tls` | list | TLS certificate configurations | Ingress TLS secret mappings |
| `resources.requests.cpu` | string | `250m` | CPU request |
| `resources.requests.memory` | string | `256Mi` | Memory request |
| `resources.limits.cpu` | string | `1000m` | CPU limit |
| `resources.limits.memory` | string | `512Mi` | Memory limit |
| `autoscaling.enabled` | boolean | `true` | Enable Horizontal Pod Autoscaler |
| `autoscaling.minReplicas` | integer | `2` | Minimum HPA replicas |
| `autoscaling.maxReplicas` | integer | `10` | Maximum HPA replicas |
| `autoscaling.targetCPUUtilizationPercentage` | integer | `70` | Target CPU percentage for scaling |
| `autoscaling.targetMemoryUtilizationPercentage` | integer | `80` | Target Memory percentage for scaling |
| `pdb.enabled` | boolean | `true` | Enable Pod Disruption Budget |
| `pdb.minAvailable` | integer | `1` | Minimum available pods during eviction |
| `networkPolicy.enabled` | boolean | `true` | Enable default-deny NetworkPolicy |
| `networkPolicy.metrics.enabled` | boolean | `true` | Allow Prometheus namespace to scrape metrics |
| `networkPolicy.redis.enabled` | boolean | `true` | Allow egress to Redis port 6379 |
| `config.NEXT_PUBLIC_STELLAR_NETWORK` | string | `"TESTNET"` | Target Stellar network (`TESTNET` or `PUBLIC`) |
| `config.NEXT_PUBLIC_STELLAR_HORIZON_URL` | string | Horizon URL | Horizon API endpoint |
| `config.NEXT_PUBLIC_STELLAR_RPC_URL` | string | Soroban RPC URL | Soroban RPC endpoint |
| `config.RATE_LIMIT_RPM` | string | `"120"` | Global proxy rate limit per IP per minute |
| `config.AUTH_RATE_LIMIT_IP_RPM` | string | `"30"` | Auth endpoint limit per IP per minute |
| `config.AUTH_RATE_LIMIT_WALLET_RPM` | string | `"10"` | Auth endpoint limit per wallet account per minute |
| `secrets.existingSecret` | string | `""` | Name of pre-existing Secret (recommended) |
| `secrets.DATABASE_URL` | string | `""` | PostgreSQL connection string (if not using existingSecret) |
| `secrets.AUTH_SECRET` | string | `""` | NextAuth session secret (32+ random hex characters) |
| `secrets.NEXT_PUBLIC_CONTRACT_ID` | string | Contract ID | Soroban payment contract ID |
| `secrets.NEXT_PUBLIC_EMITTER_CONTRACT_ID` | string | Emitter ID | Soroban event emitter contract ID |
| `secrets.REDIS_URL` | string | `""` | Redis connection URL for distributed rate limiting |
| `migrations.enabled` | boolean | `false` | Enable pre-install/pre-upgrade migration Job |
| `migrations.backoffLimit` | integer | `0` | Number of migration job retries |
| `migrations.activeDeadlineSeconds` | integer | `600` | Migration job timeout (seconds) |
| `livenessProbe.httpGet.path` | string | `"/api/health/live"` | Liveness probe HTTP path |
| `readinessProbe.httpGet.path` | string | `"/api/health/ready"` | Readiness probe HTTP path |

---

## Secrets Management

OphirPay supports two methods for managing sensitive environment variables:

### Option A: External Secret (Recommended for Production)

Set `secrets.existingSecret: <secret-name>` in values. When configured:
- The Helm chart **does not render any Secret object**.
- The Deployment loads all credentials directly from the pre-existing Secret.
- Sensitive credentials never appear in Helm revision history (`helm get values`), values files, or Git repositories.

Example using `kubectl`:
```bash
kubectl -n ophirpay create secret generic ophirpay-production-secrets \
  --from-literal=DATABASE_URL="postgresql://user:pass@db.internal:5432/ophirpay?sslmode=require" \
  --from-literal=AUTH_SECRET="$(openssl rand -hex 32)" \
  --from-literal=NEXT_PUBLIC_CONTRACT_ID="CCQGGUJRRVXMHNEX2RYPODGJE2YRMYY4Y7A3KTJH3QP2LWZLTCOPRPET" \
  --from-literal=NEXT_PUBLIC_EMITTER_CONTRACT_ID="CDAVU2XJ7C2Y52GRJZKRG3HDI7AJ2K2FHAFH5FPDTSUQAV7XNBQNNVAN" \
  --from-literal=REDIS_URL="redis://redis.internal:6379"
```

Then deploy with:
```bash
helm upgrade --install ophirpay helm/ophirpay \
  --namespace ophirpay \
  --set secrets.existingSecret=ophirpay-production-secrets
```

### Option B: Direct Helm Values

If `secrets.existingSecret` is empty, the chart renders a release-scoped Secret. Both `DATABASE_URL` and `AUTH_SECRET` are strictly required; rendering fails if either is missing:

```bash
helm upgrade --install ophirpay helm/ophirpay \
  --namespace ophirpay \
  --set secrets.DATABASE_URL='postgresql://...' \
  --set secrets.AUTH_SECRET="$(openssl rand -hex 32)"
```

> [!WARNING]
> Never commit unencrypted secrets or populated `values.yaml` files to version control. Use Helm Secrets with SOPS or sealed-secrets if storing values in Git.

---

## Ingress and TLS Configuration

The chart supports NGINX Ingress and `cert-manager` automated certificate issuance:

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/proxy-body-size: "10m"
  hosts:
    - host: payments.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: payments-tls
      hosts:
        - payments.example.com
```

---

## Autoscaling & Pod Disruption Budget

### Horizontal Pod Autoscaler (HPA)
When `autoscaling.enabled` is `true` (the default), the chart creates an `HorizontalPodAutoscaler` resource and **omits `spec.replicas` from the Deployment**.

This design prevents a common Helm issue where `helm upgrade` resets the replica count back to `replicaCount` under peak load, inadvertently terminating active pods while traffic is high.

### Pod Disruption Budget (PDB)
The chart includes a `PodDisruptionBudget` configured with `minAvailable: 1` by default. During node upgrades, cluster maintenance, or spot instance rotation, Kubernetes guarantees that at least one OphirPay replica remains active and serving traffic.

---

## Health Probes & Lifecycle

The chart configures decoupled liveness and readiness probes hitting dedicated health endpoints:

- **Liveness Probe (`/api/health/live`)**:
  - Validates process responsiveness and event loop execution.
  - Does **not** perform database, Redis, or external RPC calls.
  - A transient database blip will **never** cause Kubernetes to kill and restart otherwise healthy pods.
- **Readiness Probe (`/api/health/ready`)**:
  - Verifies that PostgreSQL is reachable and answering queries.
  - Slow or unavailable public Stellar RPC or Redis instances will **not** drain traffic from a functioning pod.

---

## Database Migrations Hook

To automate database schema updates safely before application traffic shifts, enable the migration job hook:

```yaml
migrations:
  enabled: true
  backoffLimit: 0
  activeDeadlineSeconds: 600
```

When enabled:
1. Helm executes a Kubernetes `Job` annotated with `helm.sh/hook: pre-install,pre-upgrade`.
2. The Job runs `prisma migrate deploy` using a dedicated `-migrator` image (e.g. `1.0.0-migrator`).
3. If the migration fails, the Helm deployment halts immediately, preventing the new application pods from receiving traffic. The failed Job is retained for diagnostic inspection (`kubectl logs -n ophirpay job/ophirpay-migration-...`).
4. If the migration succeeds, the Job is automatically cleaned up and the rolling update proceeds.

---

## Network Policies & Security

When `networkPolicy.enabled: true`:
1. **Default Deny Ingress**: Blocks all ingress traffic except traffic from the Ingress controller and Prometheus scrapers.
2. **Scraper Isolation**: Prometheus scraping is restricted to pods within the designated monitoring namespace (`networkPolicy.metrics.namespaceSelector`).
3. **Restricted Egress**: Pods are permitted to connect only to DNS (UDP/TCP port 53), HTTPS for external RPC / Horizon APIs (TCP port 443), PostgreSQL, and Redis (TCP port 6379).

---

## Upgrades and Rollbacks

### Upgrading a Release
```bash
# Preview changes before applying
helm diff upgrade ophirpay helm/ophirpay --values my-values.yaml

# Apply upgrade
helm upgrade ophirpay helm/ophirpay --values my-values.yaml --wait
```

### Rolling Back a Release
If an upgrade causes issues, roll back to the previous stable revision:

```bash
# Check revision history
helm history ophirpay -n ophirpay

# Roll back to revision 2
helm rollback ophirpay 2 -n ophirpay
```

---

## Troubleshooting

### Pods in `CrashLoopBackOff`
Check pod logs and describe status:
```bash
kubectl logs -n ophirpay -l app.kubernetes.io/instance=ophirpay --tail=100
kubectl describe pod -n ophirpay -l app.kubernetes.io/instance=ophirpay
```
Common causes:
- `DATABASE_URL` is unreachable or rejected by network policy.
- `AUTH_SECRET` is missing or fewer than 32 characters.

### Chart Rendering / Validation Fails
Test manifest generation locally without touching the cluster:
```bash
helm lint helm/ophirpay --set secrets.existingSecret=ophirpay-secrets
helm template ophirpay helm/ophirpay --set secrets.existingSecret=ophirpay-secrets --dry-run
```
