import { DbConnection } from "./module_bindings";

const SPACETIMEDB_URI = "wss://maincloud.spacetimedb.com";
const DATABASE_NAME = "server-simpli";

export let conn: DbConnection | null = null;
export let localIdentity: string | null = null;

export const getLocalId = () => {
  try {
    const raw = localStorage.getItem('simpli_user');
    if (raw) {
      const p = JSON.parse(raw);
      if (p.sub) return String(p.sub).toLowerCase().trim();
    }
  } catch {}
  return localIdentity;
};
export let subscriptionApplied = false;

// ── Per-account identity isolation ───────────────────────────────────────────
// SpacetimeDB hands out a device-bound anonymous identity persisted as a token. Without
// scoping, a second Google account on the same browser reuses the first account's identity
// (and therefore its galaxies). We persist one token PER Google account and bind the live
// connection to the signed-in account, so each email gets its own isolated cosmos.
const LEGACY_TOKEN_KEY = 'spacetimedb_token'; // token the current connection was built with
const ACTIVE_SUB_KEY = 'simpli_active_sub';   // Google sub the current connection belongs to
const tokenKeyForSub = (sub: string) => `simpli_token_${sub}`;

const readProfileSub = (): string | null => {
  try { const p = JSON.parse(localStorage.getItem('simpli_user') || 'null'); return p && p.sub ? String(p.sub) : null; }
  catch { return null; }
};

/** The Google sub of the signed-in account, or null when logged out. */
export const currentSub = readProfileSub;

/** Namespace a localStorage key to the signed-in account so state never leaks across emails. */
export const accountKey = (base: string): string => {
  const s = readProfileSub();
  return s ? `${base}::${s}` : base;
};

/**
 * Bind the app to a Google account's own SpacetimeDB identity before we use the connection.
 * Returns true if it triggered a reload to swap identity (caller must stop). A brand-new
 * account gets a fresh identity (blank cosmos); a returning account restores its own.
 */
export const ensureAccount = (sub: string): boolean => {
  const active = localStorage.getItem(ACTIVE_SUB_KEY);
  if (active === sub) return false;                        // already this account

  if (!active) {
    // First account to claim this browser — adopt the current (fresh) identity as its own.
    localStorage.setItem(ACTIVE_SUB_KEY, sub);
    const cur = localStorage.getItem(LEGACY_TOKEN_KEY);
    if (cur) localStorage.setItem(tokenKeyForSub(sub), cur);
    return false;
  }

  // Switching to a DIFFERENT account: never reuse the previous account's identity.
  localStorage.setItem(ACTIVE_SUB_KEY, sub);
  const saved = localStorage.getItem(tokenKeyForSub(sub));
  if (saved) localStorage.setItem(LEGACY_TOKEN_KEY, saved); // returning account → its identity
  else localStorage.removeItem(LEGACY_TOKEN_KEY);           // new account → fresh identity
  window.location.reload();
  return true;
};

// One-time back-compat: bind an already-signed-in account (from before this change) to the
// existing device identity, so returning users keep — and can restore — their galaxies.
const seedActiveAccount = () => {
  const sub = readProfileSub();
  if (!sub) return;
  if (!localStorage.getItem(ACTIVE_SUB_KEY)) localStorage.setItem(ACTIVE_SUB_KEY, sub);
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy && !localStorage.getItem(tokenKeyForSub(sub))) localStorage.setItem(tokenKeyForSub(sub), legacy);
};

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
        'SELECT * FROM user_device',
      ]);
  } catch (e) {
    console.error('[SIMPLI] Subscription setup failed', e);
  }
};

// ── Reconnect ──────────────────────────────────────────────────────────────────
// The SDK does not resurrect a dropped socket, and it hands back a brand-new
// DbConnection object per attempt rather than reviving the old one. Mobile
// browsers close the WebSocket whenever the PWA is backgrounded, so without this
// the app silently shows stale data until the process is killed and relaunched.
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
// A socket suspended by the OS often stays half-open: `isActive` still reads true
// while no data can flow, and the close event only lands minutes later. Past this
// much time backgrounded we stop trusting the old socket and just rebuild.
const STALE_AFTER_HIDDEN_MS = 10_000;

let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let hiddenAt = 0;
// True while a handshake is in flight. `isActive` is false during one too, so
// without this `wake()` would mistake a connecting socket for a dead one and tear
// it down — pageshow fires on every load, so that would double-connect every time.
let connecting = false;

const clearReconnect = () => {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
};

const scheduleReconnect = () => {
  if (reconnectTimer) return;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; build(); }, delay);
};

const build = (): DbConnection => {
  connecting = true;
  // Re-read the token on every attempt: ensureAccount may have swapped it to a
  // different account's identity since the last connect.
  conn = DbConnection.builder()
    .withUri(SPACETIMEDB_URI)
    .withDatabaseName(DATABASE_NAME)
    .withToken(localStorage.getItem(LEGACY_TOKEN_KEY) || "")
    .onConnect((_connection, identity, token) => {
      // A superseded connection can still finish its handshake after we replaced it.
      if (_connection !== (conn as any)) return;
      connecting = false;
      reconnectAttempt = 0;
      localIdentity = identity.toHexString().toLowerCase();
      console.log("✅ Connected to SpacetimeDB:", DATABASE_NAME, "Identity:", localIdentity);
      if (token) {
        localStorage.setItem(LEGACY_TOKEN_KEY, token);
        const sub = localStorage.getItem(ACTIVE_SUB_KEY);
        if (sub) localStorage.setItem(tokenKeyForSub(sub), token);
      }
      fire(connectCbs);
      fire(identityReadyCbs);
      setupSubscription(_connection);
    })
    .onConnectError((_ctx, err) => {
      if (_ctx !== (conn as any)) return;
      connecting = false;
      console.error("❌ SpacetimeDB connection error:", err);
      fireErr(errorCbs, err);
      scheduleReconnect();
    })
    .onDisconnect((_ctx, _err) => {
      if (_ctx !== (conn as any)) return;
      connecting = false;
      console.log("🔌 Disconnected from SpacetimeDB.");
      subscriptionApplied = false;
      fire(disconnectCbs);
      scheduleReconnect();
    })
    .build();

  return conn;
};

/** Drop the current socket (alive or half-open) and start a fresh one immediately. */
const rebuildNow = () => {
  clearReconnect();
  reconnectAttempt = 0;
  const old = conn as any;
  build(); // reassigns `conn` first, so the old socket's close event is ignored above
  try { old?.disconnect(); } catch { /* already gone */ }
};

// Returning to the foreground / regaining network is the moment the user expects
// to see the truth, so resolve it there rather than waiting out the backoff.
const wake = () => {
  if (!started) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (connecting) return; // a handshake is already in flight; let it finish
  if (!(conn as any)?.isActive) { rebuildNow(); return; }
  if (hiddenFor > STALE_AFTER_HIDDEN_MS) rebuildNow();
};

const onVisibility = () => {
  if (typeof document === 'undefined') return;
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  wake();
};

export const initSpacetimeDB = () => {
  if (started) return conn;
  started = true;

  // One-time back-compat seed; must not re-run per reconnect.
  seedActiveAccount();

  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', wake);
    window.addEventListener('pageshow', wake);
  }

  return build();
};

/**
 * Run `fn` against the live connection now and again after every reconnect.
 * Each reconnect produces a NEW DbConnection, so row handlers registered on the
 * previous object are dead and every caller has to re-register them. Callers
 * should drop their old handlers when re-invoked. Returns an unsubscribe.
 */
export const withConnection = (fn: (c: DbConnection) => void): (() => void) => {
  const run = () => {
    if (!conn) return;
    try { fn(conn); } catch (e) { console.error('[SIMPLI]', e); }
  };
  run();
  return onSpacetimeConnect(run);
};
