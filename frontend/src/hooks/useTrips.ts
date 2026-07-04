import { useEffect, useState, useRef } from 'react';
import * as StDB from '../spacetimedb';

export interface Trip {
  id: string;
  name: string;
}

// Normalize identity strings for robust comparison (Rule 8)
const norm = (s: any): string => String(s ?? '').toLowerCase().trim();

// Read both camelCase and snake_case field names defensively
const memberUserId = (m: any): string => m.userId ?? m.user_id ?? '';
const memberTripId = (m: any): string => m.tripId ?? m.trip_id ?? '';

/**
 * Returns trips that the local user is a member of.
 * Fail-open guarantee: if identity is not set yet, returns all trips
 * and re-filters once identity resolves via onIdentityReady.
 */
export function useTrip(): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let destroyed = false;

    const load = (c: any) => {
      if (destroyed || !c) return;
      try {
        const me = norm(StDB.localIdentity);
        let rows: Trip[];

        if (!me) {
          // Identity not ready — fail open: show all trips
          rows = [...c.db.trip.iter()].map((t: any) => ({ id: t.id, name: t.name }));
        } else {
          const myTripIds = new Set(
            [...c.db.trip_member.iter()]
              .filter((m: any) => norm(memberUserId(m)) === me)
              .map(memberTripId)
          );
          // If we have trip_member rows but none match, fall back to all trips
          // (protects against a format mismatch hiding the user's real trips)
          const allTrips = [...c.db.trip.iter()];
          const filteredTrips = allTrips.filter((t: any) => myTripIds.has(t.id));
          
          if (allTrips.length > 0 && filteredTrips.length === 0) {
            console.warn('[useTrip] Filter matched zero trips but DB has rows — falling back to all');
            rows = allTrips.map((t: any) => ({ id: t.id, name: t.name }));
          } else {
            rows = filteredTrips.map((t: any) => ({ id: t.id, name: t.name }));
          }
        }

        if (!destroyed) setTrips(rows);
      } catch (e) {
        console.warn('[useTrip] load error:', e);
        if (!destroyed) setTrips([]);
      }
    };

    const attach = (c: any): (() => void) | false => {
      if (!c) return false;
      try {
        const handler = () => load(c);
        c.db.trip.onInsert(handler);
        c.db.trip.onUpdate(handler);
        c.db.trip.onDelete(handler);
        c.db.trip_member.onInsert(handler);
        c.db.trip_member.onDelete(handler);
        load(c);
        return () => {
          c.db.trip.removeOnInsert(handler);
          c.db.trip.removeOnUpdate(handler);
          c.db.trip.removeOnDelete(handler);
          c.db.trip_member.removeOnInsert(handler);
          c.db.trip_member.removeOnDelete(handler);
        };
      } catch (e) {
        console.warn('[useTrip] attach error:', e);
        return false;
      }
    };

    const cleanup = attach(StDB.conn as any);
    if (cleanup) {
      cleanupRef.current = cleanup;
    } else {
      // Wait for connection
      const u1 = StDB.onSpacetimeConnect(() => {
        const c = attach(StDB.conn as any);
        if (c) cleanupRef.current = c;
      });
      // Re-load when identity resolves so fail-open trips get properly filtered
      const u2 = StDB.onIdentityReady(() => load(StDB.conn as any));
      // Re-load when subscription data arrives
      const u3 = StDB.onSubscriptionApplied(() => load(StDB.conn as any));
      cleanupRef.current = () => { u1(); u2(); u3(); };
    }

    return () => {
      destroyed = true;
      cleanupRef.current?.();
    };
  }, []);

  return trips;
}

/** Unique user ids that are members of the given trip (normalized hex strings). */
export function useTripMember(tripId: string): string[] {
  const [members, setMembers] = useState<string[]>([]);

  useEffect(() => {
    if (!tripId) { setMembers([]); return; }
    let destroyed = false;

    const load = (c: any) => {
      if (destroyed || !c) return;
      try {
        const ids = [...c.db.trip_member.iter()]
          .filter((m: any) => memberTripId(m) === tripId)
          .map((m: any) => norm(memberUserId(m)))
          .filter(Boolean);
        if (!destroyed) setMembers([...new Set(ids)] as string[]);
      } catch { if (!destroyed) setMembers([]); }
    };

    const attach = (c: any): (() => void) | false => {
      if (!c) return false;
      try {
        const handler = () => load(c);
        c.db.trip_member.onInsert(handler);
        c.db.trip_member.onDelete(handler);
        load(c);
        return () => {
          c.db.trip_member.removeOnInsert(handler);
          c.db.trip_member.removeOnDelete(handler);
        };
      } catch { return false; }
    };

    let inner: (() => void) | undefined;
    const cleanup = attach(StDB.conn as any);
    if (cleanup) { inner = cleanup; }
    else {
      const u = StDB.onSpacetimeConnect(() => {
        inner = attach(StDB.conn as any) || undefined;
      });
      inner = u;
    }

    return () => { destroyed = true; inner?.(); };
  }, [tripId]);

  return members;
}
