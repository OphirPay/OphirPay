<div align="center">
  <img src="https://raw.githubusercontent.com/OphirPay/OphirPay/main/public/ophirpay-banner.svg" alt="OphirPay Banner" width="100%" />

  <h1>🏦 OphirPay</h1>

  <h3><em>Stellar向けオープンソース決済オーケストレーションレイヤー</em></h3>

  <p>
    ブロックチェーン決済を送信、バッチ処理、スケジュール、トラッキング — 全てを強力なダッシュボードから。
    <strong>Stellar</strong> と <strong>Soroban</strong> 上にネイティブ構築。個人、スタートアップ、
    NPO、DAO のためにスピード、透明性、低手数料を求める方々向け。
  </p>

  <br />

  <p>
    <a href="README.md">🇬🇧 English</a> · <a href="README.es.md">🇪🇸 Español</a> · <a href="README.fr.md">🇫🇷 Français</a> · <strong>🇯🇵 日本語</strong>
  </p>
</div>

---

## 📑 目次

- [✨ なぜOphirPay？](#-なぜophirpay)
- [🚀 ライブデモ](#-ライブデモ)
- [🧭 システムアーキテクチャ](#-システムアーキテクチャ)
- [⚡ クイックスタート](#-クイックスタート)
- [🔐 ウォレット統合](#-ウォレット統合)
- [📡 リアルタイムイベント](#-リアルタイムイベント)
- [🧪 スマートコントラクト](#-スマートコントラクト)
- [📊 テストと品質](#-テストと品質)
- [🛠 技術スタック](#-技術スタック)
- [🤝 コントリビュート](#-コントリビュート)
- [📄 ライセンスとクレジット](#-ライセンスとクレジット)

---

## ✨ なぜOphirPay？

ほとんどのブロックチェーン決済ツールは、開発者向けSDKか複雑なエンタープライズダッシュボードです。**OphirPayはそのギャップを埋めます** — DAOトレジャリーにも十分な機能を持ち、初のクリプト決済を送信するフリーランサーにも直感的に使える、本格級のオープンソース決済プラットフォーム。

| 機能 | OphirPay | 一般的なdApp |
|---|---|---|
| 個別決済 | ✅ | ✅ |
| **バッチ決済**（1トランザクションで複数受取人） | ✅ | ❌ |
| **定期決済スケジュール** | ✅ | ❌ |
| **決済リクエスト**（請求書スタイル、QRコード） | ✅ | ❌ |
| **リアルタイムイベントストリーミング**（SSE） | ✅ | ❌ |
| **Webhook配信**（HMAC署名、リトライ） | ✅ | ❌ |
| **クロスコントラクト通信** | ✅ | ❌ |
| **マルチウォレット対応**（6つのウォレット） | ✅ | ❌ |
| **マルチアセット対応**（USDC、カスタムトークン） | ✅ | ❌ |
| **マルチシグ承認**（N-of-M署名者） | ✅ | ❌ |
| **支出制限 + エスカレーション階層** | ✅ | ❌ |
| **RBAC**（管理者/オペレーター/監査者ロール） | ✅ | ❌ |
| **オンチェーン監査ログ**（不変の追跡） | ✅ | ❌ |
| **手数料設定**（操作ごとのbps） | ✅ | ❌ |
| **タイムロック管理アクション**（24時間遅延） | ✅ | ❌ |
| **DAOガバナンス**（提案→投票→実行） | ✅ | ❌ |

> 上記のすべての機能にはダッシュボードUIページがあります。詳細は[ロードマップ](#-ロードマップ)を参照。

---

## 🚀 ライブデモ

<div align="center">

### 🔗 **[ophirpay.vercel.app](https://ophirpay.vercel.app)**

*Vercelにデプロイ — すべてのプッシュで`main`から自動ビルド。PostgreSQL（Neon）、Sorobanテストネットコントラクト、ライブウォレットフローが接続済み。*

### 🎥 ピッチ動画（3分）

**▶️ [Loomで視聴](https://www.loom.com/share/0d59c50285c04224a4857720b3640018)** · [Vercelで視聴](https://ophirpay.vercel.app/demo.mp4)

*11シーン：問題 → ライブダッシュボード → Vercelデプロイ → Sorobanコントラクト → 決済送信 → リアルタイムイベント → GitHub README → CIパイプライン → マルチシグセキュリティ → オープンソース → クレジット*

</div>

---

## 🧭 システムアーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                   OPHIRPAYプラットフォーム                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │トレジャリー│  │  決済    │   │ バッチ   │   │コントラクト│ │
│  │ ダッシュボード│ │  送信   │   │ (マルチ) │   │ ページ  │ │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬────┘ │
│       │              │              │              │       │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐  │
│  │              useWallet() / WalletProvider             │  │
│  │        セッション永続化 · 残高 · 認証                    │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┼─────────────────────────────┐  │
│  │              Stellar SDK レイヤー                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │  │
│  │  │ Horizon  │  │ Soroban  │  │  TXビルダー/       │  │  │
│  │  │ (残高)   │  │   RPC    │  │  サイナー          │  │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘  │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┴─────────────────────────────┐  │
│  │           Sorobanスマートコントラクト                    │  │
│  │                                                       │  │
│  │  ┌──────────────────┐ ネイティブイベント ┌─────────┐  │  │
│  │  │ OphirPayContract │ + クロスコントラクト│ エミッター│  │  │
│  │  │  · record_payment│   pause/unpause   │コントラクト│  │  │
│  │  │  · propose_pay.  │   オーケストレーション│· events │  │  │
│  │  │  · grant_role    │                   └────┬────┘  │  │
│  │  │  · set_fee_config│                        │       │  │
│  │  │  · 60以上の関数  │                        │       │  │
│  │  └──────────────────┘                        │       │  │
│  └────────────────────────────────────────────────┼──────┘  │
│                                                   │         │
│  ┌────────────────────────────────────────────────┴──────┐  │
│  │      SSEイベントストリーム (GET /api/events)            │  │
│  │      エミッターコントラクトをポーリング → UIにストリーム   │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              データレイヤー                             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │  Prisma  │  │PostgreSQL│  │  APIルート        │   │   │
│  │  │  (ORM)   │  │ (Neon)   │  │  /api/batches    │   │   │
│  │  │          │  │SQLite dev│  │  /api/health     │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ クイックスタート（60秒）

```bash
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay
npm install && npx prisma db push && npx prisma generate
cp .env.example .env && npm run dev
```

**これだけ！** http://localhost:3000 を開き、Freighterを接続すれば、Stellarテストネットでライブ状態になります。

### 5分セットアップ

```bash
# 1. クローン＆进入
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay

# 2. すべてインストール
npm install

# 3. データベース初期化
npx prisma db push && npx prisma generate

# 4. 環境変数テンプレートをコピー
cp .env.example .env

# 5. 起動！
npm run dev
```

**[http://localhost:3000](http://localhost:3000)** を開き、Freighterウォレットを接続すれば、テストネットXLMの送信准备完了です。

---

## 🔐 ウォレット統合

OphirPayは、統合コネクターアブストラクションを通じて複数のStellarウォレットをサポートしています。`MultiWalletProvider`コンテキストがアプリケーション全体をラップし、以下を提供します：

| 機能 | 実装 |
|---|---|
| **マルチウォレット** | Freighter、Albedo、xBull、Rabet、Lobstr、Ledgerのコネクターインターフェース |
| **接続** | ウォレットセレクターモーダル → `connector.connect()` |
| **切断** | 完全な状態リセット + コネクター固有のクリーンアップ |
| **セッション永続化** | ページ読み込み時に既存の接続を自動検出 |

**サポートされているウォレット：**

| ウォレット | タイプ | ステータス |
|---|---|---|
| Freighter | ブラウザ拡張機能 | ✅ サポート済み |
| xBull | ブラウザ拡張機能 | ✅ サポート済み |
| Rabet | ブラウザ拡張機能 | ✅ サポート済み |
| Albedo | Webベース（拡張機能不要） | ✅ サポート済み |
| Lobstr | Webベース（SEP-7） | ✅ サポート済み |
| Ledger | ハードウェア（WebUSB/HID） | ✅ サポート済み |

---

## 📡 リアルタイムイベント

OphirPayはServer-Sent Events (SSE) を通じて**ブロックチェーンのライブイベント**をストリーミングします。エンドポイントはデプロイされた`PaymentEventEmitter`コントラクトを10秒ごとにポーリングし、新しい決、新しい決済イベントを検出すると接続されたクライアントにプッシュします。

```
ブラウザ ←──SSEストリーム─── GET /api/events ──ポーリング──→ PaymentEventEmitter (Soroban)
                                                              ↓
                                                         get_event_count()
                                                         get_event(id)
```

**発行されるイベント：**

| イベント | トリガー |
|---|---|
| `connected` | ストリーム確立 |
| `heartbeat` | 15秒ごと（キープアライブ） |
| `payment:created` | オンチェーンで新しい決済イベントを検出 |

アプリの**`/events`**で、接続状態インジケーター、イベントタイプバッジ、タイムスタンプ、自動スクロール付きのライブフィードを確認できます。

---

## 🧪 スマートコントラクト

OphirPayは**2つのSorobanコントラクト**をデプロイしています。メインの`OphirPayContract`はすべての決済ロジックを処理し、ネイティブのオンチェーンイベントを発行します。一方、`PaymentEventEmitter`はアプリのSSEストリームがクエリする決済イベントレコードを保存します — 決済ロジックとイベント発行を分離し、よりクリーンなアーキテクチャを実現しています。

```bash
# コントラクトテストを実行
cd contracts/ophirpay && cargo test
cd contracts/emitter && cargo test
```

---

## 📊 テストと品質

```bash
# すべてのアプリテスト（33スイートで806ケース）
npm test

# カバレッジレポート（全体87.6%）
npm run coverage

# E2Eテスト（7つのPlaywright仕様で97ケース）
npx playwright test

# 完全なCIパイプライン
npm run ci   # typecheck → lint → test → build
```

---

## 🛠 技術スタック

| レイヤー | 技術 | 理由 |
|---|---|---|
| **フレームワーク** | [Next.js 16](https://nextjs.org) | App Router、SSR、APIルート、Vercelネイティブ |
| **言語** | [TypeScript](https://www.typescriptlang.org) | 厳格モード、完全な型安全性 |
| **スタイリング** | [Tailwind CSS v4](https://tailwindcss.com) | ユーティリティファースト、ダークモード、カスタムテーマ |
| **ブロックチェーン** | [Stellar SDK v13](https://stellar.org) + [Soroban](https://soroban.stellar.org) | Horizon、Soroban RPC、TXビルド |
| **コントラクト** | [Rust](https://www.rust-lang.org) + `soroban-sdk` 27 | WASMコンパイル、クロスコントラクト呼び出し |
| **ウォレット** | Freighter · xBull · Rabet · Albedo · Lobstr · Ledger | 6コネクターの統合アブストラクション |
| **データベース** | [Prisma](https://prisma.io) + PostgreSQL (Neon) / SQLite | 型安全ORM、プロバイダー切り替え |
| **テスト** | [Vitest](https://vitest.dev) + React Testing Library + [Playwright](https://playwright.dev) | ユニット、統合、E2Eカバレッジ |
| **CI/CD** | [GitHub Actions](https://github.com/features/actions) | 各プッシュで22ジョブのパイプライン |
| **ホスティング** | [Vercel](https://vercel.com) | `main`から自動デプロイ、エッジネットワーク |

---

## 🤝 コントリビュート

コントリビューション歓迎！始め方：

1. リポジトリを**フォーク**
2. フィーチャーブランチを作成：`git checkout -b feat/amazing-feature`
3. 変更をコミット：`git commit -m 'feat: add amazing feature'`
4. フォークにプッシュ：`git push origin feat/amazing-feature`
5. `main`に対してPull Requestを作成

### コミット規約

[Conventional Commits](https://www.conventionalcommits.org)に従います：
- `feat:` — 新機能
- `fix:` — バグ修正
- `docs:` — ドキュメント
- `test:` — テスト
- `ci:` — CI/CD変更
- `chore:` — メンテナンス

---

## 📄 ライセンスとクレジット

### ライセンス

**[MITライセンス](LICENSE)**の下でオープンソース — 個人、商業、教育目的で自由にお使いいただけます。

### 構築に使用した技術

- [Stellar](https://stellar.org) と [Soroban](https://soroban.stellar.org) — すべてを可能にするブロックチェーン
- [Next.js](https://nextjs.org) — 本番環境向けのReactフレームワーク
- [Tailwind CSS](https://tailwindcss.com) — モダンなWebサイトを高速構築
- [Prisma](https://prisma.io) — 次世代Node.js ORM
- [Vitest](https://vitest.dev) · [Playwright](https://playwright.dev) — ユニット＆E2Eテストフレームワーク
- [Freighter](https://freighter.app) — Stellarウォレットブラウザ拡張機能

### 謝辞

**Stellar Development Foundation**の優れたドキュメント、SDK、Sorobanスマートコントラクトプラットフォームに特別な感謝を。

---

<div align="center">

**[🐛 バグを報告](https://github.com/OphirPay/OphirPay/issues)** · **[💡 機能をリクエスト](https://github.com/OphirPay/OphirPay/issues)** · **[📖 ドキュメントを読む](https://github.com/OphirPay/OphirPay#readme)**

<br />

<sub>Stellarエコシステムのために ❤️ を込めて構築</sub>

</div>
