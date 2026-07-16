# Web Push setup (closed-app mobile notifications)

Members get notified about joins / expenses / settlements **even when the app is fully
closed**. Everything is code-complete; the only outstanding step is setting the two VAPID
env vars in Vercel (step 1). Until they are set, `/api/notify` answers
`{ ok: false, reason: 'push-not-configured' }` and the app quietly falls back to in-app +
tab-alive notifications, exactly as it behaved before.

## Architecture

```
 client (browser)                SpacetimeDB                /api/notify (Vercel)      push service
 ────────────────                ───────────                ────────────────────      ────────────
 PushManager.subscribe()  ──►  savePushSubscription
                               push_subscription  ◄── HTTP SQL read ──┐
 addExpense / settleDebt  ──►  reducer commits                        │
        └──────────── POST /api/notify (kind, ids) ───────────────────┘
                                                    webpush.sendNotification() ──► 📱
 sw.js 'push' handler  ◄───────────────────────────────────────────────────────────────
```

A SpacetimeDB module is deterministic and cannot make outbound network calls, so the push
must originate outside it. The acting client pings `/api/notify` once its reducer has
committed (reducer promises resolve only on commit, so the row is always readable by then).

The request only names **which** event to announce — never its contents. `/api/notify` reads
the row back out of the database and refuses anything the database does not actually contain,
so it cannot be used to deliver arbitrary text to someone.

## Steps

### 1. Set the VAPID env vars in Vercel (the only remaining step)

Generate a pair if you need a fresh one:

```bash
cd frontend
node -e "console.log(require('web-push').generateVAPIDKeys())"
```

Set all three on the **simpli-app** Vercel project (Production + Preview), then redeploy:

| Variable | Used by | Notes |
| --- | --- | --- |
| `VITE_VAPID_PUBLIC_KEY` | frontend (build-time) | public key; baked into the bundle |
| `VAPID_PUBLIC_KEY` | `/api/notify` (runtime) | same public key |
| `VAPID_PRIVATE_KEY` | `/api/notify` (runtime) | **secret** — never commit |

`VITE_` is a build-time inline, so the frontend needs a **redeploy** (not just a restart)
after changing it. Optional: `VAPID_SUBJECT` (defaults to a mailto:), `STDB_HTTP_URI`,
`STDB_DB`.

### 2. Republish the module — only if you change `server/spacetimedb/src/index.ts`

The live module already has `push_subscription` + `savePushSubscription` /
`deletePushSubscription`.

```bash
cd server
spacetime publish server-simpli --yes
spacetime generate --lang typescript --out-dir ../frontend/src/module_bindings --module-path ./spacetimedb
```

Always commit the regenerated `frontend/src/module_bindings`. Skipping that regeneration is
what silently disabled push before: `push.ts` guarded on `c.reducers.savePushSubscription`,
which did not exist in the stale bindings, so every subscription attempt was a no-op and
`push_subscription` stayed empty forever.

## Test

1. Accounts A and B are both in a group; B has granted notification permission and has the
   app **closed**.
2. A adds an expense → B receives a push; tapping it opens that group.
3. Check the fan-out result directly:
   ```bash
   curl -s -X POST https://simpliapp.vercel.app/api/notify \
     -H 'Content-Type: application/json' \
     -d '{"kind":"expense","tripId":"<trip>","expenseId":"<expense>"}'
   # -> {"ok":true,"sent":1,"gone":0,"recipients":1}
   ```
   `sent: 0` with `recipients: 1` means that member has no `push_subscription` row yet —
   they have not granted permission on a device that supports push.

## Platform limits (not app bugs)

- **Notifications can never be on by default.** Every browser requires an explicit user
  grant. The app asks on the first tap after login and auto-subscribes the moment it is
  granted; that is the ceiling on every platform.
- **iOS delivers Web Push only to a PWA installed to the Home Screen** (Share → Add to Home
  Screen), on iOS 16.4+. In a plain Safari tab iOS delivers nothing in the background.
  Android/Chrome and desktop work from a normal tab.

## `push-sender/`

Superseded by `/api/notify` and no longer referenced by anything — it is outside the Vercel
root (`frontend/`) and is not built or deployed. It was an always-on worker holding a
persistent WebSocket, which Vercel serverless cannot host. Safe to delete.
