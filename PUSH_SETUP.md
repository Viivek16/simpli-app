# Web Push setup (closed-app mobile notifications)

This wires true Web Push so members are notified about new expenses / joins **even when
the app is closed**. Until you complete steps 2–4, the app behaves exactly as before
(in-app + tab-alive notifications only) — the frontend push code is a guarded no-op when
`VITE_VAPID_PUBLIC_KEY` is unset, so shipping it is safe.

## Architecture

```
 client (browser)                 SpacetimeDB                  push-sender (always-on)        push service
 ────────────────                 ───────────                  ──────────────────────         ────────────
 PushManager.subscribe()  ──►  savePushSubscription reducer
                               push_subscription table   ◄── subscribes / listens ──►  webpush.sendNotification() ──►  📱
 sw.js 'push' handler  ◄──────────────────────────────────────────────────────────────────────────────────────────
```

SpacetimeDB modules can't send pushes (deterministic, no network), so a small external
`push-sender` service watches the DB and sends the pushes.

## Steps

### 1. Generate VAPID keys (once)
```bash
cd push-sender
npm install
npm run gen-vapid          # prints { publicKey, privateKey }
```

### 2. Republish the module + regenerate bindings
Adds the `push_subscription` table and `savePushSubscription` / `deletePushSubscription`
reducers.
```bash
cd server
spacetime publish server-simpli --yes
spacetime generate --lang typescript --out-dir ../frontend/src/module_bindings --module-path .
```
Commit the regenerated `frontend/src/module_bindings`.

### 3. Configure the frontend (Vercel)
Set an env var and redeploy:
```
VITE_VAPID_PUBLIC_KEY = <publicKey from step 1>
```
On the next visit, users who have granted notification permission are auto-subscribed.

### 4. Run the push-sender
```bash
cd push-sender
cp .env.example .env        # fill VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
npm start                    # local test
```
Then deploy it to an always-on host (Railway / Render / Fly / VPS — **not** Vercel
serverless). Keep exactly one instance running. See `push-sender/README.md`.

## Test
1. Account A and Account B both in a group; B has notifications enabled and app closed.
2. A adds an expense → B receives a push; tapping it opens that group.

## iOS note
iOS delivers Web Push only for a PWA **installed to the Home Screen** (Add to Home Screen),
on iOS 16.4+. In a plain Safari tab, iOS will not deliver background pushes — this is an
Apple platform limitation, not an app bug.
