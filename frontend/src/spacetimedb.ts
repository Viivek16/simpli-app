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

export const initSpacetimeDB = () => {
  if (conn) return conn;

  seedActiveAccount();

  conn = DbConnection.builder()
    .withUri(SPACETIMEDB_URI)
    .withDatabaseName(DATABASE_NAME)
    .withToken(localStorage.getItem(LEGACY_TOKEN_KEY) || "")
    .onConnect((_connection, identity, token) => {
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
