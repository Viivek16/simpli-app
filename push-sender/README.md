# SIMPLI push-sender

An always-on worker that delivers **Web Push** notifications for SIMPLI so members get
notified about new expenses / joins **even when the app is fully closed** on their phone.

## Why this exists

SpacetimeDB modules are deterministic and cannot make outbound network calls, so they
can't send pushes themselves. The app's in-page `NotificationsManager` only fires while a
tab is alive. This service closes that gap: it connects to the same database as a read
client and, on new `expense` / `trip_member` rows, sends Web Push messages to the affected
members' stored subscriptions.

## Prerequisites

1. **VAPID keys** (one-time):
   ```bash
   npm install
   npm run gen-vapid
   ```
   Copy the printed `publicKey` / `privateKey` into `.env` (see `.env.example`).
   The **same public key** must be set on the frontend as `VITE_VAPID_PUBLIC_KEY`.

2. **Republish the module + regenerate bindings** (adds the `push_subscription` table and
   `savePushSubscription` / `deletePushSubscription` reducers used here). From `server/`:
   ```bash
   spacetime publish server-simpli --yes
   spacetime generate --lang typescript --out-dir ../frontend/src/module_bindings --module-path .
   ```
   This service imports those regenerated bindings from `../frontend/src/module_bindings`.

## Run

```bash
cp .env.example .env   # then fill in the VAPID keys
npm install
npm start
```

You should see `[sender] live — watching for activity`. Add an expense from one account and
a second account with notifications enabled (and app closed) should receive a push.

## Deploy

Use any always-on host — **not** Vercel serverless (needs a persistent WebSocket):

- **Railway / Render**: new service from this folder, start command `npm start`, set the
  env vars from `.env` in the dashboard.
- **Fly.io / a VPS**: run under a process manager (pm2/systemd).

Keep exactly **one** instance running to avoid duplicate notifications.

## Notes

- Stale endpoints (HTTP 404/410) are auto-removed via `deletePushSubscription`.
- The message copy mirrors the in-app `NotificationsManager` so notifications read
  consistently across foreground and background.
