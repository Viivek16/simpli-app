import { DbConnection } from "./module_bindings";

const SPACETIMEDB_URI = "wss://maincloud.spacetimedb.com";
const DATABASE_NAME = "simpli-db";

export let conn: DbConnection | null = null;
export let localIdentity: string | null = null;

// Use callbacks for connection state
let onConnectCbs: Array<() => void> = [];
let onConnectErrorCbs: Array<(err: Error) => void> = [];
let onDisconnectCbs: Array<() => void> = [];

export const onSpacetimeConnect = (cb: () => void) => { onConnectCbs.push(cb); return () => { onConnectCbs = onConnectCbs.filter(x => x !== cb); }};
export const onSpacetimeConnectError = (cb: (err: Error) => void) => { onConnectErrorCbs.push(cb); return () => { onConnectErrorCbs = onConnectErrorCbs.filter(x => x !== cb); }};
export const onSpacetimeDisconnect = (cb: () => void) => { onDisconnectCbs.push(cb); return () => { onDisconnectCbs = onDisconnectCbs.filter(x => x !== cb); }};

export const initSpacetimeDB = () => {
  if (conn) return conn;

  conn = DbConnection.builder()
    .withUri(SPACETIMEDB_URI)
    .withDatabaseName(DATABASE_NAME)
    .withToken(localStorage.getItem("spacetimedb_token") || "")
    .onConnect((_connection, identity, token) => {
      localIdentity = identity.toHexString();
      console.log("✅ Connected to SpacetimeDB:", DATABASE_NAME, "Identity:", localIdentity);
      if (token) {
        localStorage.setItem("spacetimedb_token", token);
      }
      onConnectCbs.forEach(cb => cb());
    })
    .onConnectError((_ctx, err) => {
      console.error("❌ Error connecting to SpacetimeDB:", err);
      onConnectErrorCbs.forEach(cb => cb(err));
    })
    .onDisconnect((_ctx, _err) => {
      console.log("🔌 Disconnected from SpacetimeDB.");
      onDisconnectCbs.forEach(cb => cb());
    })
    .build();

  return conn;
};
