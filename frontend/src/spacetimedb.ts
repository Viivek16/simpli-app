import { DbConnection } from "./module_bindings";

const SPACETIMEDB_URI = "wss://maincloud.spacetimedb.com";
const DATABASE_NAME = "server-simpli";

export let conn: DbConnection | null = null;
export let localIdentity: string | null = null;
export let subscriptionApplied = false;

// ── Event bus ──────────────────────────────────────────────────────────────────
type Cb = () => void;
type ErrCb = (err: Error) => void;

let connectCbs: Cb[] = [];
let disconnectCbs: Cb[] = [];
let errorCbs: ErrCb[] = [];
let subAppliedCbs: Cb[] = [];
let identityReadyCbs: Cb[] = [];

const fire = (cbs: Cb[]) => cbs.forEach(fn => { try { fn(); } catch(e) { console.error('[SIMPLI]', e); } });
const fireErr = (cbs: ErrCb[], err: Error) => cbs.forEach(fn => { try { fn(err); } catch(e) { console.error('[SIMPLI]', e); } });

export const onSpacetimeConnect = (cb: Cb) => { connectCbs.push(cb); return () => { connectCbs = connectCbs.filter(x => x !== cb); }; };
export const onSpacetimeDisconnect = (cb: Cb) => { disconnectCbs.push(cb); return () => { disconnectCbs = disconnectCbs.filter(x => x !== cb); }; };
export const onSpacetimeConnectError = (cb: ErrCb) => { errorCbs.push(cb); return () => { errorCbs = errorCbs.filter(x => x !== cb); }; };
export const onSubscriptionApplied = (cb: Cb) => { subAppliedCbs.push(cb); return () => { subAppliedCbs = subAppliedCbs.filter(x => x !== cb); }; };
export const onIdentityReady = (cb: Cb) => {
  // If identity already available, call immediately
  if (localIdentity) { try { cb(); } catch(e) { console.error('[SIMPLI]', e); } }
  identityReadyCbs.push(cb);
  return () => { identityReadyCbs = identityReadyCbs.filter(x => x !== cb); };
};

const setupSubscription = (c: DbConnection) => {
  try {
    (c as any).subscriptionBuilder()
      .onApplied(() => {
        subscriptionApplied = true;
        console.log('[SIMPLI] Subscription applied — data live');
        fire(subAppliedCbs);
      })
      .subscribe([
        'SELECT * FROM user',
        'SELECT * FROM trip',
        'SELECT * FROM expense',
        'SELECT * FROM expense_split',
        'SELECT * FROM trip_member',
      ]);
  } catch (e) {
    console.error('[SIMPLI] Subscription setup failed', e);
  }
};

export const initSpacetimeDB = () => {
  if (conn) return conn;

  conn = DbConnection.builder()
    .withUri(SPACETIMEDB_URI)
    .withDatabaseName(DATABASE_NAME)
    .withToken(localStorage.getItem("spacetimedb_token") || "")
    .onConnect((_connection, identity, token) => {
      localIdentity = identity.toHexString().toLowerCase();
      console.log("✅ Connected to SpacetimeDB:", DATABASE_NAME, "Identity:", localIdentity);
      if (token) localStorage.setItem("spacetimedb_token", token);
      fire(connectCbs);
      fire(identityReadyCbs);
      setupSubscription(_connection);
    })
    .onConnectError((_ctx, err) => {
      console.error("❌ SpacetimeDB connection error:", err);
      fireErr(errorCbs, err);
    })
    .onDisconnect((_ctx, _err) => {
      console.log("🔌 Disconnected from SpacetimeDB.");
      subscriptionApplied = false;
      fire(disconnectCbs);
    })
    .build();

  return conn;
};
