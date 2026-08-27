<div align="center">
  <img src="https://raw.githubusercontent.com/OphirPay/OphirPay/main/public/ophirpay-banner.svg" alt="OphirPay Banner" width="100%" />

  <h1>🏦 OphirPay</h1>

  <h3><em>La Couche d'Orchestration de Paiements Open Source pour Stellar</em></h3>

  <p>
    Envoyez, regroupez, planifiez et suivez les paiements blockchain — tout depuis un tableau de bord puissant.
    Construit nativement sur <strong>Stellar</strong> et <strong>Soroban</strong> pour les particuliers, les startups,
    les associations et les DAOs qui exigent rapidité, transparence et frais réduits.
  </p>

  <br />

  <p>
    <a href="README.md">🇬🇧 English</a> · <a href="README.es.md">🇪🇸 Español</a> · <strong>🇫🇷 Français</strong> · <a href="README.ja.md">🇯🇵 日本語</a>
  </p>
</div>

---

## 📑 Table des Matières

- [✨ Pourquoi OphirPay ?](#-pourquoi-ophirpay)
- [🚀 Démo en Direct](#-démo-en-direct)
- [🧭 Architecture du Système](#-architecture-du-système)
- [⚡ Démarrage Rapide](#-démarrage-rapide)
- [🔐 Intégration de Portefeuille](#-intégration-de-portefeuille)
- [📡 Événements en Temps Réel](#-événements-en-temps-réel)
- [🧪 Contrats Intelligents](#-contrats-intelligents)
- [📊 Tests et Qualité](#-tests-et-qualité)
- [🛠 Stack Technique](#-stack-technique)
- [🤝 Contribuer](#-contribuer)
- [📄 Licence et Crédits](#-licence-et-crédits)

---

## ✨ Pourquoi OphirPay ?

La plupart des outils de paiement blockchain sont soit des SDKs orientés développeurs, soit des tableaux de bord d'entreprise complexes. **OphirPay comble le fossé** — une plateforme de paiement de niveau production, open source, suffisamment puissante pour les trésoreries de DAO et suffisamment intuitive pour un freelancer envoyant son premier paiement en crypto.

| Capacité | OphirPay | dApp Typique |
|---|---|---|
| Paiements individuels | ✅ | ✅ |
| **Paiements par lots** (multi-destinataires en 1 tx) | ✅ | ❌ |
| **Horaires de paiements récurrents** | ✅ | ❌ |
| **Demandes de paiement** (style facture, QR codes) | ✅ | ❌ |
| **Diffusion d'événements en temps réel** (SSE) | ✅ | ❌ |
| **Livraison de webhooks** (HMAC signé, réessais) | ✅ | ❌ |
| **Communication inter-contrats** | ✅ | ❌ |
| **Support multi-portefeuille** (6 portefeuilles) | ✅ | ❌ |
| **Support multi-actifs** (USDC, tokens personnalisés) | ✅ | ❌ |
| **Approbations multisig** (signataires N-sur-M) | ✅ | ❌ |
| **Limites de dépense + niveaux d'escalade** | ✅ | ❌ |
| **RBAC** (rôles Admin/Opérateur/Auditeur) | ✅ | ❌ |
| **Journal d'audit on-chain** (piste immuable) | ✅ | ❌ |
| **Configuration des frais** (bps par opération) | ✅ | ❌ |
| **Actions admin avec timelock** (délai de 24h) | ✅ | ❌ |
| **Gouvernance DAO** (proposer→voter→exécuter) | ✅ | ❌ |

> Toutes les fonctionnalités ci-dessus ont des pages d'interface dans le tableau de bord. Voir la [feuille de route](#-feuille-de-route) pour plus de détails.

---

## 🚀 Démo en Direct

<div align="center">

### 🔗 **[ophirpay.vercel.app](https://ophirpay.vercel.app)**

*Déployé sur Vercel — compilations automatiques depuis `main` à chaque push. PostgreSQL (Neon), contrats testnet Soroban et flux de portefeuille en direct.*

### 🎥 Vidéo de Présentation (3 min)

**▶️ Regarder sur [Loom](https://www.loom.com/share/0d59c50285c04224a4857720b3640018)** · [Regarder sur Vercel](https://ophirpay.vercel.app/demo.mp4)

*11 scènes : Problème → Tableau de bord en direct → Déploiement Vercel → Contrats Soroban → Envoyer un paiement → Événements en temps réel → GitHub README → Pipeline CI → Sécurité Multisig → Open Source → Crédits*

</div>

---

## 🧭 Architecture du Système

```
┌─────────────────────────────────────────────────────────────┐
│                   PLATEFORME OPHIRPAY                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │ Trésorerie│  │ Envoyer  │   │  Lots    │   │Contrats │ │
│  │ Tableau  │   │ Paiement │   │ (multi)  │   │ Page    │ │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬────┘ │
│       │              │              │              │       │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐  │
│  │              useWallet() / WalletProvider             │  │
│  │        Persistance session · Solde · Authentification │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┼─────────────────────────────┐  │
│  │              Couche Stellar SDK                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │  │
│  │  │ Horizon  │  │ Soroban  │  │  Constructeur TX / │  │  │
│  │  │ (solde)  │  │   RPC    │  │  Signeur           │  │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘  │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┴─────────────────────────────┐  │
│  │          Contrats Intelligents Soroban                │  │
│  │                                                       │  │
│  │  ┌──────────────────┐  événements natifs ┌─────────┐ │  │
│  │  │ OphirPayContract │  + cross-contract  │ Contrat │ │  │
│  │  │  · record_payment│  pause/unpause     │ Émetteur│ │  │
│  │  │  · propose_pay.  │  orchestration     │· events │ │  │
│  │  │  · grant_role    │                    └────┬────┘ │  │
│  │  │  · set_fee_config│                         │      │  │
│  │  │  · 60+ fonctions │                         │      │  │
│  │  └──────────────────┘                         │      │  │
│  └────────────────────────────────────────────────┼──────┘  │
│                                                   │         │
│  ┌────────────────────────────────────────────────┴──────┐  │
│  │    Flux d'événements SSE (GET /api/events)            │  │
│  │    Interroge le contrat émetteur → diffuse au UI      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Couche de Données                        │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │  Prisma  │  │PostgreSQL│  │  Routes API      │   │   │
│  │  │  (ORM)   │  │ (Neon)   │  │  /api/batches    │   │   │
│  │  │          │  │SQLite dev│  │  /api/health     │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ Démarrage Rapide (60 secondes)

```bash
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay
npm install && npx prisma db push && npx prisma generate
cp .env.example .env && npm run dev
```

**C'est tout !** Ouvre http://localhost:3000, connecte Freighter, et tu es en direct sur Stellar Testnet.

### Configuration en 5 Minutes

```bash
# 1. Cloner et entrer
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay

# 2. Installer tout
npm install

# 3. Initialiser la base de données
npx prisma db push && npx prisma generate

# 4. Copier le modèle d'environnement
cp .env.example .env

# 5. Lancer !
npm run dev
```

Ouvre **[http://localhost:3000](http://localhost:3000)** — connecte ton portefeuille Freighter et tu es prêt à envoyer du XLM Testnet.

---

## 🔐 Intégration de Portefeuille

OphirPay prend en charge plusieurs portefeuilles Stellar grâce à une abstraction unifiée de connecteurs. Notre contexte `MultiWalletProvider` enveloppe l'application entière, offrant :

| Fonctionnalité | Implémentation |
|---|---|
| **Multi-portefeuille** | Interface connecteur pour Freighter, Albedo, xBull, Rabet, Lobstr, Ledger |
| **Connexion** | Modal sélectionneur de portefeuille → `connector.connect()` |
| **Déconnexion** | Réinitialisation complète de l'état + nettoyage spécifique au connecteur |
| **Persistance de session** | Détection automatique des connexions existantes au chargement |

**Portefeuilles pris en charge :**

| Portefeuille | Type | Statut |
|---|---|---|
| Freighter | Extension navigateur | ✅ Supporté |
| xBull | Extension navigateur | ✅ Supporté |
| Rabet | Extension navigateur | ✅ Supporté |
| Albedo | Basé sur web (sans extension) | ✅ Supporté |
| Lobstr | Basé sur web (SEP-7) | ✅ Supporté |
| Ledger | Matériel (WebUSB/HID) | ✅ Supporté |

---

## 📡 Événements en Temps Réel

OphirPay diffuse des **événements en direct de la blockchain** via Server-Sent Events (SSE). L'endpoint interroge le contrat `PaymentEventEmitter` déployé toutes les 10 secondes, détectant les nouveaux événements de paiement et les diffusant aux clients connectés.

```
Navigateur ←──flux SSE─── GET /api/events ──interroge──→ PaymentEventEmitter (Soroban)
                                                         ↓
                                                    get_event_count()
                                                    get_event(id)
```

**Événements émis :**

| Événement | Déclencheur |
|---|---|
| `connected` | Flux établi |
| `heartbeat` | Toutes les 15 secondes (keep-alive) |
| `payment:created` | Nouvel événement de paiement détecté on-chain |

Visite **`/events`** dans l'application pour voir le flux en direct avec indicateur de statut de connexion, badges de type d'événement, horodatages et défilement automatique.

---

## 🧪 Contrats Intelligents

OphirPay déploie **deux contrats Soroban**. Le `OphirPayContract` principal gère toute la logique de paiement et publie des événements natifs on-chain, tandis que le `PaymentEventEmitter` stocke les enregistrements d'événements de paiement que le flux SSE de l'application interroge — séparant la logique de paiement et l'émission d'événements pour une architecture plus propre.

```bash
# Exécuter les tests des contrats
cd contracts/ophirpay && cargo test
cd contracts/emitter && cargo test
```

---

## 📊 Tests et Qualité

```bash
# Tous les tests de l'application (806 cas dans 33 suites)
npm test

# Rapport de couverture (87.6% global)
npm run coverage

# Tests E2E (97 cas dans 7 specs Playwright)
npx playwright test

# Pipeline CI complet
npm run ci   # typecheck → lint → test → build
```

---

## 🛠 Stack Technique

| Couche | Technologie | Pourquoi |
|---|---|---|
| **Framework** | [Next.js 16](https://nextjs.org) | App Router, SSR, routes API, Vercel natif |
| **Langage** | [TypeScript](https://www.typescriptlang.org) | Mode strict, sécurité totale des types |
| **Styles** | [Tailwind CSS v4](https://tailwindcss.com) | Utility-first, mode sombre, thème personnalisé |
| **Blockchain** | [Stellar SDK v13](https://stellar.org) + [Soroban](https://soroban.stellar.org) | Horizon, Soroban RPC, construction TX |
| **Contrats** | [Rust](https://www.rust-lang.org) + `soroban-sdk` 27 | Compilation WASM, invocation cross-contract |
| **Portefeuille** | Freighter · xBull · Rabet · Albedo · Lobstr · Ledger | Abstraction de 6 connecteurs |
| **Base de données** | [Prisma](https://prisma.io) + PostgreSQL (Neon) / SQLite | ORM typé, commutation de fournisseur |
| **Tests** | [Vitest](https://vitest.dev) + React Testing Library + [Playwright](https://playwright.dev) | Couverture unitaire, intégration et E2E |
| **CI/CD** | [GitHub Actions](https://github.com/features/actions) | Pipeline de 22 jobs à chaque push |
| **Hébergement** | [Vercel](https://vercel.com) | Déploiement auto depuis `main`, réseau edge |

---

## 🤝 Contribuer

Nous accueillons les contributions ! Voici comment commencer :

1. **Fork** le dépôt
2. **Créer** une branche feature : `git checkout -b feat/amazing-feature`
3. **Commit** vos changements : `git commit -m 'feat: add amazing feature'`
4. **Push** vers votre fork : `git push origin feat/amazing-feature`
5. **Ouvrir** un Pull Request contre `main`

### Convention de Commits

Nous suivons [Conventional Commits](https://www.conventionalcommits.org) :
- `feat:` — nouvelle fonctionnalité
- `fix:` — correction de bug
- `docs:` — documentation
- `test:` — tests
- `ci:` — changements CI/CD
- `chore:` — maintenance

---

## 📄 Licence et Crédits

### Licence

Open source sous la **[Licence MIT](LICENSE)** — libre pour un usage personnel, commercial et éducatif.

### Construit Avec

- [Stellar](https://stellar.org) et [Soroban](https://soroban.stellar.org) — La blockchain qui rend tout possible
- [Next.js](https://nextjs.org) — Le framework React pour la production
- [Tailwind CSS](https://tailwindcss.com) — Construisez rapidement des sites web modernes
- [Prisma](https://prisma.io) — ORM nouvelle génération pour Node.js
- [Vitest](https://vitest.dev) · [Playwright](https://playwright.dev) — Frameworks de tests unitaires et E2E
- [Freighter](https://freighter.app) — Extension navigateur pour portefeuille Stellar

### Remerciements

Un grand merci à la **Stellar Development Foundation** pour leur excellente documentation, leurs SDKs et la plateforme de contrats intelligents Soroban.

---

<div align="center">

**[🐛 Signaler un Bug](https://github.com/OphirPay/OphirPay/issues)** · **[💡 Demander une Fonctionnalité](https://github.com/OphirPay/OphirPay/issues)** · **[📖 Lire la Documentation](https://github.com/OphirPay/OphirPay#readme)**

<br />

<sub>Construit avec ❤️ pour l'écosystème Stellar</sub>

</div>
