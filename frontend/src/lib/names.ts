// Resolves a member identifier (SpacetimeDB identity hex OR Google sub) to a display name.
// After the device-link migration, members/payers/debtors are keyed by Google sub, but the
// `user` table is still keyed by identity. We bridge sub -> identity via the `user_device`
// table, then identity -> name via the `user` table. Legacy identity-keyed rows still resolve
// directly. Returns a map keyed by BOTH identity and sub, so callers can look up either.

const norm = (s: any): string => String(s ?? '').toLowerCase().trim();

const userIdHex = (u: any): string =>
  (u?.id && typeof u.id === 'object' && 'toHexString' in u.id) ? norm(u.id.toHexString()) : norm(u.id);

const deviceHex = (d: any): string => norm(d?.deviceIdentity ?? d?.device_identity);
const deviceSub = (d: any): string => norm(d?.googleSub ?? d?.google_sub);

export function resolveNames(users: any[], devices: any[]): Map<string, string> {
  const identityToName = new Map<string, string>();
  for (const u of users) {
    const id = userIdHex(u);
    if (id && !identityToName.has(id)) identityToName.set(id, u.name || 'Member');
  }
  // Start with identity -> name so legacy identity-keyed rows still resolve.
  const map = new Map<string, string>(identityToName);
  // Add sub -> name by hopping sub -> device identity -> name.
  for (const d of devices) {
    const sub = deviceSub(d);
    if (!sub || map.has(sub)) continue;
    const name = identityToName.get(deviceHex(d));
    if (name) map.set(sub, name);
  }
  return map;
}
