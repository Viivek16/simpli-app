# SIMPLI

> **Every group is a galaxy. Every friend is a star. Debt is light.**

SIMPLI is a real-time expense-splitting app where each group of friends is rendered as a star constellation in 3D space. Powered by SpacetimeDB for zero-latency sync — changes from one browser appear on all others in under a millisecond, with no polling, no WebSocket plumbing, and no API layer.

---

## The Metaphor

Your home screen is a **cosmos**: every group floats as a swirling galaxy of particles. Click a galaxy and the camera flies you into a **member constellation** — each person is a glowing star, debt modulates the glow intensity, settled members become ringed planets, and pairwise balances are rendered as dashed lines whose thickness scales with how much money flows along them.

---

## Architecture

```
Client (React + Three.js)  ←→  SpacetimeDB Module (TypeScript)
        ↕                              ↕
  Live subscriptions          ACID reducer transactions
  (no polling, no REST)       (server-simpli on maincloud)
```

### Tables

| Table | Key Columns |
|-------|------------|
| `user` | `id: Identity` (primary), `name: string` |
| `trip` | `id: string` (primary), `name: string`, `created_at: timestamp` |
| `trip_member` | `trip_id: string (index)`, `user_id: string (index)` |
| `expense` | `id: string` (primary), `trip_id: string (index)`, `payer_id: string`, `amount: f64`, `description: string`, `timestamp` |
| `expense_split` | `expense_id: string (index)`, `debtor_id: string (index)`, `amount_owed: f64` |

### Reducers

| Reducer | Args | Notes |
|---------|------|-------|
| `createUser` | `name` | Idempotent — called on each login |
| `createTrip` | `trip_id, name` | Auto-inserts caller as member |
| `joinTrip` | `trip_id` | Idempotent membership |
| `addExpense` | `expense_id, trip_id, amount, description, splits: JSON` | Splits = `[{debtor_id, amount_owed}]`; `"[]"` = personal |
| `updateExpense` | `expense_id, amount, description, splits` | ACID replace: deletes old splits, reinserts; preserves payer + timestamp |
| `deleteExpense` | `expense_id` | Cascades splits; membership-gated |
| `settleDebt` | `trip_id, debtor_id, payee_id, amount` | Creates synthetic expense with description `"Debt settlement"` |
| `deleteTrip` | `trip_id` | Full cascade: splits → expenses → members → trip; ACID |

---

## Local Development

```bash
# 1. Install dependencies
cd frontend && npm install

# 2. Run dev server
npm run dev

# 3. Open http://localhost:5173
```

### Publishing the Server Module

```bash
# Prerequisites: spacetime CLI 2.6.1, logged in to maincloud
cd server
spacetime publish server-simpli
```

### Regenerating Client Bindings

```bash
cd server
spacetime generate --lang typescript --out-dir ../frontend/src/module_bindings --module-path ./spacetimedb
```

---

## Why SpacetimeDB

SpacetimeDB removes the entire API layer. There is no Express, no Fastify, no REST endpoints, no WebSocket event handler, no Redis pubsub. The client subscribes to SQL queries; the server writes ACID transactions. The client cache updates automatically, and React re-renders from that. For a real-time collaborative app like expense splitting, this is the correct architecture — not a clever shortcut.

The `spacetime sql server-simpli "SELECT * FROM trip"` command is a great debugging tool that proved invaluable during development.

---

## Tech Stack

- **Frontend:** React 18, TypeScript, React Three Fiber, Drei, Framer Motion
- **Backend:** SpacetimeDB (TypeScript module, builder API, CLI 2.6.1)
- **Auth:** Google OAuth (JWT decode client-side; identity linked to SpacetimeDB connection)
- **Deployment:** Vercel (frontend), SpacetimeDB Maincloud (module)
