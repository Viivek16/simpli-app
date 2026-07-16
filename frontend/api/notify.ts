/**
 * SIMPLI — Web Push fan-out (Vercel Serverless Function)
 * ------------------------------------------------------
 * SpacetimeDB modules are deterministic and cannot make outbound network calls, so
 * a push can never originate inside the module. The acting client pings this endpoint
 * once its reducer has committed; we read the resulting row back out of the database
 * and push it to every *other* member of the trip — whether or not their app is open.
 *
 * The request only names WHICH event to announce. Every word a notification contains
 * is read back from the database here, and an event the database does not actually
 * contain is refused, so this endpoint cannot be coaxed into delivering arbitrary
 * text to someone. The worst a forged request achieves is re-announcing something
 * that genuinely happened.
 *
 * Without VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY this is an inert no-op and the app
 * falls back to in-app + tab-alive notifications, exactly as before.
 */
import webpush from 'web-push';

const STDB_HTTP = process.env.STDB_HTTP_URI || 'https://maincloud.spacetimedb.com';
const STDB_DB = process.env.STDB_DB || 'server-simpli';
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:notifications@simpliapp.example';

// Every id this app mints — exp-<ms>-<rand>, settle_<micros>_<a>_<b>, trip-<ms>-<rand>,
// Google subs, hex identities — fits this alphabet. SpacetimeDB's SQL endpoint takes a
// query string rather than bound parameters, so anything outside it is refused rather
// than interpolated.
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

// A settlement's row id is minted inside the reducer, so the client cannot tell us
// which row it created. We instead match the newest settlement it could plausibly be
// and require it to be this recent.
const SETTLE_WINDOW_MICROS = 120_000_000;

type Row = Record<string, any>;

const norm = (s: any) => String(s ?? '').toLowerCase().trim();
const first = (n: string) => (n || 'Someone').split(' ')[0];
const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);

/** Identity columns arrive as ["0x<hex>"]; user_device stores that same hex unprefixed. */
const identHex = (v: any): string => norm(Array.isArray(v) ? v[0] : v).replace(/^0x/, '');
/** Timestamps arrive as [microsSinceUnixEpoch]. */
const tsMicros = (v: any): number => Number(Array.isArray(v) ? v[0] : v) || 0;

/** Run SQL and map the positional rows onto their column names. */
const sql = async (query: string): Promise<Row[]> => {
  const res = await fetch(`${STDB_HTTP}/v1/database/${STDB_DB}/sql`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: query,
  });
  if (!res.ok) throw new Error(`stdb sql ${res.status}: ${await res.text()}`);
  const out = await res.json();
  const block = Array.isArray(out) ? out[0] : null;
  if (!block) return [];
  const cols: string[] = (block.schema?.elements ?? []).map((e: any) => e?.name?.some ?? '');
  return (block.rows ?? []).map((r: any[]) => {
    const row: Row = {};
    cols.forEach((c, i) => { row[c] = r[i]; });
    return row;
  });
};

/**
 * Resolve a member id to a display name. Ids are Google subs post-linkDevice, but
 * legacy rows are keyed by the raw connection identity — so try identity first, then
 * hop sub -> device identity -> name, mirroring the in-app notifier.
 */
const buildNameLookup = async (): Promise<(id: string) => string> => {
  const [users, devices] = await Promise.all([
    sql('SELECT * FROM user'),
    sql('SELECT * FROM user_device'),
  ]);

  const byIdentity = new Map<string, string>();
  for (const u of users) {
    const hex = identHex(u.id);
    if (hex && !byIdentity.has(hex)) byIdentity.set(hex, u.name || 'Someone');
  }

  const bySub = new Map<string, string>();
  for (const d of devices) {
    const sub = norm(d.google_sub);
    const name = byIdentity.get(norm(d.device_identity));
    if (sub && name && !bySub.has(sub)) bySub.set(sub, name);
  }

  return (id: string) => {
    const t = norm(id);
    return byIdentity.get(t) || bySub.get(t) || 'Someone';
  };
};

const dropSubscription = (endpoint: string) =>
  fetch(`${STDB_HTTP}/v1/database/${STDB_DB}/call/delete_push_subscription`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => { /* best effort */ });

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return res.status(200).json({ ok: false, reason: 'push-not-configured' });
  }

  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const kind = String(body.kind || '');
    const tripId = String(body.tripId || '');
    if (!ID_RE.test(tripId)) return res.status(400).json({ error: 'bad tripId' });

    const [trip] = await sql(`SELECT * FROM trip WHERE id = '${tripId}'`);
    if (!trip) return res.status(404).json({ error: 'unknown trip' });
    const tName = trip.name || 'a group';

    const nameOf = await buildNameLookup();

    // `actor` is excluded from the recipients; `bodyFor` renders the text per member.
    let actor: string;
    let bodyFor: (uid: string) => string;

    if (kind === 'expense') {
      const expenseId = String(body.expenseId || '');
      if (!ID_RE.test(expenseId)) return res.status(400).json({ error: 'bad expenseId' });

      const [exp] = await sql(`SELECT * FROM expense WHERE id = '${expenseId}'`);
      if (!exp || exp.trip_id !== tripId) return res.status(404).json({ error: 'unknown expense' });

      const payer = norm(exp.payer_id);
      const amount = Number(exp.amount) || 0;
      const desc = String(exp.description || '');
      actor = payer;
      // The galaxy name is the notification title, so it is deliberately not repeated here.
      bodyFor = () => `${first(nameOf(payer))} added ${desc || 'an expense'} · ${INR(amount)}`;

    } else if (kind === 'settle') {
      const debtorId = String(body.debtorId || '');
      if (!ID_RE.test(debtorId)) return res.status(400).json({ error: 'bad debtorId' });

      // settleDebt records the settlement as an expense paid by the debtor.
      const rows = await sql(`SELECT * FROM expense WHERE trip_id = '${tripId}'`);
      const settlements = rows
        .filter(r => String(r.description || '') === 'Debt settlement' && norm(r.payer_id) === norm(debtorId))
        .sort((a, b) => tsMicros(b.timestamp) - tsMicros(a.timestamp));
      const exp = settlements[0];
      if (!exp) return res.status(404).json({ error: 'unknown settlement' });
      if (Date.now() * 1000 - tsMicros(exp.timestamp) > SETTLE_WINDOW_MICROS) {
        return res.status(409).json({ error: 'settlement too old' });
      }

      const payer = norm(exp.payer_id);
      const amount = Number(exp.amount) || 0;
      const splits = await sql(`SELECT * FROM expense_split WHERE expense_id = '${exp.id}'`);
      const other = norm(splits[0]?.debtor_id);
      actor = payer;
      bodyFor = (uid) =>
        uid === other
          ? `${first(nameOf(payer))} settled ${INR(amount)} with you. All settled up.`
          : other
            ? `${first(nameOf(payer))} settled ${INR(amount)} with ${first(nameOf(other))}`
            : `${first(nameOf(payer))} settled up`;

    } else if (kind === 'join') {
      const actorId = String(body.actorId || '');
      if (!ID_RE.test(actorId)) return res.status(400).json({ error: 'bad actorId' });

      const rows = await sql(
        `SELECT * FROM trip_member WHERE trip_id = '${tripId}' AND user_id = '${actorId}'`
      );
      if (!rows.length) return res.status(404).json({ error: 'not a member' });

      const joined = norm(actorId);
      actor = joined;
      bodyFor = () => `${first(nameOf(joined))} joined`;

    } else {
      return res.status(400).json({ error: 'bad kind' });
    }

    const members = await sql(`SELECT * FROM trip_member WHERE trip_id = '${tripId}'`);
    const recipients = new Set(
      members.map(m => norm(m.user_id)).filter(u => u && u !== actor)
    );
    if (!recipients.size) return res.status(200).json({ ok: true, sent: 0, reason: 'no recipients' });

    // SpacetimeDB SQL has no IN operator; this table holds one row per device, so
    // reading it whole and filtering here is cheaper than N queries.
    const subs = (await sql('SELECT * FROM push_subscription'))
      .filter(s => recipients.has(norm(s.user_id)));

    let sent = 0;
    let gone = 0;
    await Promise.all(subs.map(async (s) => {
      const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p_256_dh, auth: s.auth } };
      const payload = JSON.stringify({
        // Galaxy as the title, event as the body — the shade already prints "SIMPLI"
        // above it, so titling it 'SIMPLI' just said the app name twice.
        title: tName,
        body: bodyFor(norm(s.user_id)),
        url: `/t/${tripId}`,
        // Shared with the in-app notifier so the two never double up on one event.
        tag: `simpli-${tripId}`,
      });
      try {
        await webpush.sendNotification(subscription as any, payload);
        sent++;
      } catch (err: any) {
        const code = err?.statusCode;
        if (code === 404 || code === 410) {
          // The browser threw this endpoint away; stop carrying it.
          gone++;
          await dropSubscription(s.endpoint);
        } else {
          console.warn('[notify] push failed', code, err?.body || err?.message);
        }
      }
    }));

    return res.status(200).json({ ok: true, sent, gone, recipients: recipients.size });
  } catch (e: any) {
    console.error('[notify] error', e?.message || e);
    return res.status(500).json({ error: 'notify failed' });
  }
}
