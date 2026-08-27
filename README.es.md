<div align="center">
  <img src="https://raw.githubusercontent.com/OphirPay/OphirPay/main/public/ophirpay-banner.svg" alt="OphirPay Banner" width="100%" />

  <h1>🏦 OphirPay</h1>

  <h3><em>La Capa de Orquestación de Pagos de Código Abierto para Stellar</em></h3>

  <p>
    Envía, agrupa, programa y rastrea pagos en blockchain — todo desde un potente panel de control.
    Construido nativamente sobre <strong>Stellar</strong> y <strong>Soroban</strong> para individuos, startups,
    organizaciones sin fines de lucro y DAOs que exigen velocidad, transparencia y comisiones bajas.
  </p>

  <br />

  <p>
    <a href="README.md">🇬🇧 English</a> · <strong>🇪🇸 Español</strong> · <a href="README.fr.md">🇫🇷 Français</a> · <a href="README.ja.md">🇯🇵 日本語</a>
  </p>
</div>

---

## 📑 Tabla de Contenidos

- [✨ ¿Por qué OphirPay?](#-por-qué-ophirpay)
- [🚀 Demo en Vivo](#-demo-en-vivo)
- [🧭 Arquitectura del Sistema](#-arquitectura-del-sistema)
- [⚡ Inicio Rápido](#-inicio-rápido)
- [🔐 Integración de Billetera](#-integración-de-billetera)
- [📡 Eventos en Tiempo Real](#-eventos-en-tiempo-real)
- [🧪 Contratos Inteligentes](#-contratos-inteligentes)
- [📊 Pruebas y Calidad](#-pruebas-y-calidad)
- [🛠 Stack Tecnológico](#-stack-tecnológico)
- [🤝 Contribuir](#-contribuir)
- [📄 Licencia y Créditos](#-licencia-y-créditos)

---

## ✨ ¿Por qué OphirPay?

La mayoría de las herramientas de pago en blockchain son SDKs orientados a desarrolladores o paneles de control empresariales complejos. **OphirPay cierra la brecha** — una plataforma de pago de grado producción, de código abierto, lo suficientemente potente para tesorerías de DAO y lo suficientemente intuitiva para un freelancer enviando su primer pago en cripto.

| Capacidad | OphirPay | dApp Típico |
|---|---|---|
| Pagos individuales | ✅ | ✅ |
| **Pagos por lotes** (multi-destinatario en 1 tx) | ✅ | ❌ |
| **Horarios de pago recurrentes** | ✅ | ❌ |
| **Solicitudes de pago** (estilo factura, códigos QR) | ✅ | ❌ |
| **Transmisión de eventos en tiempo real** (SSE) | ✅ | ❌ |
| **Entrega de webhooks** (HMAC firmado, reintentos) | ✅ | ❌ |
| **Comunicación entre contratos** | ✅ | ❌ |
| **Soporte multi-billetera** (6 billeteras) | ✅ | ❌ |
| **Soporte multi-asset** (USDC, tokens personalizados) | ✅ | ❌ |
| **Aprobaciones multisig** (firmantes N-de-M) | ✅ | ❌ |
| **Límites de gasto + niveles de escalamiento** | ✅ | ❌ |
| **RBAC** (roles Admin/Operador/Auditor) | ✅ | ❌ |
| **Registro de auditoría on-chain** (trazabilidad inmutable) | ✅ | ❌ |
| **Configuración de comisiones** (bps por operación) | ✅ | ❌ |
| **Acciones de admin con timelock** (retraso de 24h) | ✅ | ❌ |
| **Gobernanza DAO** (proponer→votar→ejecutar) | ✅ | ❌ |

> Todas las características anteriores tienen páginas de interfaz en el panel de control. Consulta la [hoja de ruta](#-hoja-de-ruta) para más detalles.

---

## 🚀 Demo en Vivo

<div align="center">

### 🔗 **[ophirpay.vercel.app](https://ophirpay.vercel.app)**

*Desplegado en Vercel — compilaciones automáticas desde `main` en cada push. PostgreSQL (Neon), contratos de testnet Soroban y flujo de billetera en vivo.*

### 🎥 Video de Presentación (3 min)

**▶️ Ver en [Loom](https://www.loom.com/share/0d59c50285c04224a4857720b3640018)** · [Ver en Vercel](https://ophirpay.vercel.app/demo.mp4)

*11 escenas: Problema → Panel en Vivo → Despliegue en Vercel → Contratos Soroban → Enviar Pago → Eventos en Tiempo Real → GitHub README → Pipeline CI → Seguridad Multisig → Código Abierto → Créditos*

</div>

---

## 🧭 Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────────┐
│                   PLATAFORMA OPHIRPAY                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌─────────┐ │
│  │ Tesorería│   │  Enviar  │   │  Lotes   │   │Contratos│ │
│  │  Panel   │   │  Pago    │   │(multi)   │   │ Página  │ │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬────┘ │
│       │              │              │              │       │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐  │
│  │              useWallet() / WalletProvider             │  │
│  │      Persistencia de sesión · Balance · Autenticación │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┼─────────────────────────────┐  │
│  │              Capa Stellar SDK                         │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────────────┐  │  │
│  │  │ Horizon  │  │ Soroban  │  │  Constructor TX /  │  │  │
│  │  │(balance) │  │   RPC    │  │  Firmante          │  │  │
│  │  └──────────┘  └──────────┘  └────────────────────┘  │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                │
│  ┌────────────────────────┴─────────────────────────────┐  │
│  │         Contratos Inteligentes Soroban                │  │
│  │                                                       │  │
│  │  ┌──────────────────┐  eventos nativos  ┌─────────┐  │  │
│  │  │ OphirPayContract │  + cross-contract │ Emisor  │  │  │
│  │  │  · record_payment│  pause/unpause    │Contrato │  │  │
│  │  │  · propose_pay.  │  orquestación     │· eventos│  │  │
│  │  │  · grant_role    │                   └────┬────┘  │  │
│  │  │  · set_fee_config│                        │       │  │
│  │  │  · 60+ funciones │                        │       │  │
│  │  └──────────────────┘                        │       │  │
│  └────────────────────────────────────────────────┼──────┘  │
│                                                   │         │
│  ┌────────────────────────────────────────────────┴──────┐  │
│  │    Flujo de Eventos SSE (GET /api/events)             │  │
│  │    Consulta el contrato emisor → transmite al UI      │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Capa de Datos                            │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │   │
│  │  │  Prisma  │  │PostgreSQL│  │  Rutas API       │   │   │
│  │  │  (ORM)   │  │ (Neon)   │  │  /api/batches    │   │   │
│  │  │          │  │SQLite dev│  │  /api/health     │   │   │
│  │  └──────────┘  └──────────┘  └──────────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚡ Inicio Rápido (60 segundos)

```bash
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay
npm install && npx prisma db push && npx prisma generate
cp .env.example .env && npm run dev
```

**¡Eso es todo!** Abre http://localhost:3000, conecta Freighter, y estás en vivo en Stellar Testnet.

### 5 Minutos de Configuración

```bash
# 1. Clonar y entrar
git clone https://github.com/OphirPay/OphirPay.git && cd OphirPay

# 2. Instalar todo
npm install

# 3. Inicializar base de datos
npx prisma db push && npx prisma generate

# 4. Copiar plantilla de entorno
cp .env.example .env

# 5. ¡Lanzar!
npm run dev
```

Abre **[http://localhost:3000](http://localhost:3000)** — conecta tu billetera Freighter y estás listo para enviar XLM de Testnet.

---

## 🔐 Integración de Billetera

OphirPay admite múltiples billeteras Stellar a través de una abstracción unificada de conectores. Nuestro contexto `MultiWalletProvider` envuelve toda la aplicación, proporcionando:

| Característica | Implementación |
|---|---|
| **Multi-billetera** | Interfaz de conector para Freighter, Albedo, xBull, Rabet, Lobstr, Ledger |
| **Conexión** | Modal selector de billetera → `connector.connect()` |
| **Desconexión** | Reset completo del estado + limpieza específica del conector |
| **Persistencia de sesión** | Detección automática de conexiones existentes al cargar |
| **Billetera faltante** | Detección elegante — badge "No encontrada" + error accionable |

**Billeteras soportadas:**

| Billetera | Tipo | Estado |
|---|---|---|
| Freighter | Extensión de navegador | ✅ Soportado |
| xBull | Extensión de navegador | ✅ Soportado |
| Rabet | Extensión de navegador | ✅ Soportado |
| Albedo | Basado en web (sin extensión) | ✅ Soportado |
| Lobstr | Basado en web (SEP-7) | ✅ Soportado |
| Ledger | Hardware (WebUSB/HID) | ✅ Soportado |

---

## 📡 Eventos en Tiempo Real

OphirPay transmite **eventos en vivo de la blockchain** vía Server-Sent Events (SSE). El endpoint consulta el contrato `PaymentEventEmitter` desplegado cada 10 segundos, detectando nuevos eventos de pago y transmitiéndolos a los clientes conectados.

```
Navegador ←──flujo SSE─── GET /api/events ──consulta──→ PaymentEventEmitter (Soroban)
                                                        ↓
                                                   get_event_count()
                                                   get_event(id)
```

**Eventos emitidos:**

| Evento | Disparador |
|---|---|
| `connected` | Flujo establecido |
| `heartbeat` | Cada 15 segundos (keep-alive) |
| `payment:created` | Nuevo evento de pago detectado on-chain |

Visita **`/events`** en la aplicación para ver el feed en vivo con indicador de estado de conexión, badges de tipo de evento, marcas de tiempo y auto-scroll.

---

## 🧪 Contratos Inteligentes

OphirPay despliega **dos contratos Soroban**. El `OphirPayContract` principal maneja toda la lógica de pago y publica eventos nativos on-chain, mientras que el `PaymentEventEmitter` almacena registros de eventos de pago que el flujo SSE de la aplicación consulta — manteniendo la lógica de pago y la emisión de eventos separadas para una arquitectura más limpia.

```bash
# Ejecutar pruebas de contratos
cd contracts/ophirpay && cargo test
cd contracts/emitter && cargo test
```

---

## 📊 Pruebas y Calidad

```bash
# Todas las pruebas de la aplicación (806 casos en 33 suites)
npm test

# Reporte de cobertura (87.6% general)
npm run coverage

# Pruebas E2E (97 casos en 7 specs de Playwright)
npx playwright test

# Pipeline de CI completo
npm run ci   # typecheck → lint → test → build
```

---

## 🛠 Stack Tecnológico

| Capa | Tecnología | Por qué |
|---|---|---|
| **Framework** | [Next.js 16](https://nextjs.org) | App Router, SSR, rutas API, Vercel nativo |
| **Lenguaje** | [TypeScript](https://www.typescriptlang.org) | Modo estricto, seguridad total de tipos |
| **Estilos** | [Tailwind CSS v4](https://tailwindcss.com) | Utilidad-first, modo oscuro, tema personalizado |
| **Blockchain** | [Stellar SDK v13](https://stellar.org) + [Soroban](https://soroban.stellar.org) | Horizon, Soroban RPC, construcción de TX |
| **Contratos** | [Rust](https://www.rust-lang.org) + `soroban-sdk` 27 | Compilación WASM, invocación cross-contract |
| **Billetera** | Freighter · xBull · Rabet · Albedo · Lobstr · Ledger | Abstracción de 6 conectores de billetera |
| **Base de datos** | [Prisma](https://prisma.io) + PostgreSQL (Neon) / SQLite | ORM de tipos seguros, cambio de proveedor |
| **Pruebas** | [Vitest](https://vitest.dev) + React Testing Library + [Playwright](https://playwright.dev) | Cobertura unitaria, integración y E2E |
| **CI/CD** | [GitHub Actions](https://github.com/features/actions) | Pipeline de 22 trabajos en cada push |
| **Hosting** | [Vercel](https://vercel.com) | Despliegue automático desde `main`, red edge |

---

## 🤝 Contribuir

¡Bienvenimos contribuciones! Así es como puedes empezar:

1. **Bifurcar** el repositorio
2. **Crear** una rama de feature: `git checkout -b feat/amazing-feature`
3. **Commitear** tus cambios: `git commit -m 'feat: add amazing feature'`
4. **Push** a tu bifurcación: `git push origin feat/amazing-feature`
5. **Abrir** un Pull Request contra `main`

### Convención de Commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org):
- `feat:` — nueva característica
- `fix:` — corrección de error
- `docs:` — documentación
- `test:` — pruebas
- `ci:` — cambios de CI/CD
- `chore:` — mantenimiento

---

## 📄 Licencia y Créditos

### Licencia

Código abierto bajo la **[Licencia MIT](LICENSE)** — libre para uso personal, comercial y educativo.

### Construido Con

- [Stellar](https://stellar.org) y [Soroban](https://soroban.stellar.org) — La blockchain que lo hace todo posible
- [Next.js](https://nextjs.org) — El framework de React para producción
- [Tailwind CSS](https://tailwindcss.com) — Construye sitios web modernos rápidamente
- [Prisma](https://prisma.io) — ORM de nueva generación para Node.js
- [Vitest](https://vitest.dev) · [Playwright](https://playwright.dev) — Frameworks de pruebas unitarias y E2E
- [Freighter](https://freighter.app) — Extensión de navegador para billetera Stellar

### Agradecimientos

Agradecimientos especiales a la **Stellar Development Foundation** por su excelente documentación, SDKs y la plataforma de contratos inteligentes Soroban.

---

<div align="center">

**[🐛 Reportar un Error](https://github.com/OphirPay/OphirPay/issues)** · **[💡 Solicitar una Función](https://github.com/OphirPay/OphirPay/issues)** · **[📖 Leer la Documentación](https://github.com/OphirPay/OphirPay#readme)**

<br />

<sub>Construido con ❤️ para el ecosistema Stellar</sub>

</div>
