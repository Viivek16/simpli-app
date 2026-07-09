/**
 * SIMPLI — Web Push sender service
 * ---------------------------------
 * A tiny always-on worker that mirrors the client's NotificationsManager logic, but
 * delivers real Web Push notifications so members are notified even when their app is
 * fully closed (the case SpacetimeDB modules cannot handle — they are deterministic and
 * cannot make outbound network calls).
 *
 * It connects to the same SpacetimeDB database as a read client, subscribes to the
 * relevant tables, and on new `expense` / `trip_member` inserts computes the recipients
 * and pushes to their stored `push_subscription` rows.
 *
 * Deploy this on an always-on host (Railway / Render / Fly.io / a small VPS). It is NOT
 * suited to Vercel serverless — it needs a persistent WebSocket connection.
 *
 * Required env (see .env.example): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 */
import 'dotenv/config';
import webpush from 'web-push';
import WebSocket from 'ws';
// SpacetimeDB's browser client expects a global WebSocket; provide one for Node.
// @ts-ignore
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket as any;

// Reuse the app's generated bindings so this stays in lockstep with the schema.
import { DbConnection } from '../frontend/src/module_bindings';

const {
  VAPID_PUBLIC_KEY = '',
  VAPID_PRIVATE_KEY = '',
  VAPID_SUBJECT = 'mailto:notifications@simpliapp.example',
  STDB_URI = 'wss://maincloud.spacetimedb.com',
  STDB_DB = 'server-simpli',
  STDB_TOKEN = '',
} = process.env;

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('[sender] Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY. Run `npm run gen-vapid`.');
  process.exit(1);
}
webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ── helpers ──────────────────────────────────────────────────────────────────
const norm = (s: any) => String(s ?? '').toLowerCase().trim();
const first = (n: string) => (n || 'Someone').split(' ')[0];
const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const eTrip = (r: any) => r.tripId ?? r.trip_id;
const ePayer = (r: any) => norm(r.payerId ?? r.payer_id);
const mUser = (r: any) => norm(r.userId ?? r.user_id);
const mTrip = (r: any) => r.tripId ?? r.trip_id;
const sExp = (r: any) => r.expenseId ?? r.expense_id;
const sDebtor = (r: any) => norm(r.debtorId ?? r.debtor_id);
const subUser = (r: any) => norm(r.userId ?? r.user_id);

const nameOf = (c: any, id: string): string => {
  const target = norm(id);
  const byIdentity = new Map<string, string>();
  for (const u of c.db.user.iter()) {
    const uid = (u.id && typeof u.id === 'object' && 'toHexString' in u.id) ? norm(u.id.toHexString()) : norm(u.id);
    if (uid && !byIdentity.has(uid)) byIdentity.set(uid, u.name || 'Someone');
  }
  if (byIdentity.has(target)) return byIdentity.get(target) as string;
  try {
    for (const d of c.db.user_device.iter()) {
      const sub = norm(d.googleSub ?? d.google_sub);
      if (sub === target) {
        const nm = byIdentity.get(norm(d.deviceIdentity ?? d.device_identity));
        if (nm) return nm;
      }
    }
  } catch {}
  return 'Someone';
};
const tripNameOf = (c: any, id: string): string => {
  for (const t of c.db.trip.iter()) if (t.id === id) return t.name || 'a group';
  return 'a group';
};
const membersOfTrip = (c: any, tripId: string): string[] =>
  [...new Set([...c.db.trip_member.iter()].filter((m: any) => mTrip(m) === tripId).map(mUser))] as string[];
const subsForUser = (c: any, uid: string): any[] =>
  [...c.db.push_subscription.iter()].filter((s: any) => subUser(s) === norm(uid));

type Payload = { title: string; body: string; url?: string };

const sendTo = async (c: any, userId: string, payload: Payload) => {
  for (const s of subsForUser(c, userId)) {
    const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(subscription as any, JSON.stringify(payload));
    } catch (err: any) {
      const code = err?.statusCode;
      if (code === 404 || code === 410) {
        // Endpoint gone — drop the stale subscription.
        try { c.reducers.deletePushSubscription({ endpoint: s.endpoint }); } catch {}
      } else {
        console.warn('[sender] push failed', code, err?.body || err?.message);
      }
    }
  }
};

// ── event handling ───────────────────────────────────────────────────────────
let ready = false;
const seenExpense = new Set<string>();
const seenMember = new Set<string>();

const seed = (c: any) => {
  for (const e of c.db.expense.iter()) seenExpense.add(e.id);
  for (const m of c.db.trip_member.iter()) seenMember.add(`${mTrip(m)}::${mUser(m)}`);
};

const onExpense = async (c: any, row: any) => {
  const payer = ePayer(row);
  const tripId = eTrip(row);
  const tName = tripNameOf(c, tripId);
  const isSettle = (row.description || '') === 'Debt settlement';
  const recipients = membersOfTrip(c, tripId).filter(u => u && u !== payer);
  for (const uid of recipients) {
    let body: string;
    if (isSettle) {
      let other = '';
      for (const s of c.db.expense_split.iter()) { if (sExp(s) === row.id) { other = sDebtor(s); break; } }
      body = other === uid
        ? `${first(nameOf(c, payer))} settled ${INR(row.amount)} with you in ${tName}. All settled up.`
        : `${first(nameOf(c, payer))} settled up in ${tName}`;
    } else {
      body = `${first(nameOf(c, payer))} added ${row.description || 'an expense'} · ${INR(row.amount)} in ${tName}`;
    }
    await sendTo(c, uid, { title: 'SIMPLI', body, url: `/t/${tripId}` });
  }
};

const onMember = async (c: any, row: any) => {
  const tripId = mTrip(row);
  const joined = mUser(row);
  const members = membersOfTrip(c, tripId);
  if (members.length < 2) return; // solo group creation stays silent
  const tName = tripNameOf(c, tripId);
  for (const uid of members.filter(u => u && u !== joined)) {
    await sendTo(c, uid, { title: 'SIMPLI', body: `${first(nameOf(c, joined))} joined ${tName}`, url: `/t/${tripId}` });
  }
};

const attach = (c: any) => {
  c.db.expense.onInsert((_ctx: any, row: any) => {
    if (!ready || seenExpense.has(row.id)) return;
    seenExpense.add(row.id);
    void onExpense(c, row);
  });
  c.db.trip_member.onInsert((_ctx: any, row: any) => {
    const key = `${mTrip(row)}::${mUser(row)}`;
    if (!ready || seenMember.has(key)) return;
    seenMember.add(key);
    void onMember(c, row);
  });
};

// ── connect ──────────────────────────────────────────────────────────────────
DbConnection.builder()
  .withUri(STDB_URI)
  .withDatabaseName(STDB_DB)
  .withToken(STDB_TOKEN)
  .onConnect((connection: any, identity: any) => {
    console.log('[sender] connected as', identity?.toHexString?.() ?? '(anon)');
    attach(connection);
    connection.subscriptionBuilder()
      .onApplied(() => {
        seed(connection);
        setTimeout(() => { ready = true; console.log('[sender] live — watching for activity'); }, 800);
      })
      .subscribe([
        'SELECT * FROM user',
        'SELECT * FROM trip',
        'SELECT * FROM expense',
        'SELECT * FROM expense_split',
        'SELECT * FROM trip_member',
        'SELECT * FROM user_device',
        'SELECT * FROM push_subscription',
      ]);
  })
  .onConnectError((_ctx: any, err: any) => console.error('[sender] connect error:', err))
  .onDisconnect(() => { ready = false; console.log('[sender] disconnected'); })
  .build();

console.log('[sender] starting — db:', STDB_DB, 'uri:', STDB_URI);
