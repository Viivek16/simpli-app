import { useEffect, useState } from 'react';
import * as SpacetimeDB from '../spacetimedb';

export interface Trip {
  id: string;
  name: string;
}

// Field names differ between raw rows and generated bindings (user_id vs userId).
// Read both so this is robust to either.
const memberUserId = (m: any): string => m.userId ?? m.user_id ?? '';
const memberTripId = (m: any): string => m.tripId ?? m.trip_id ?? '';

/** Trips the local user is a member of. */
export function useTrip(): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);

  useEffect(() => {
    let destroyed = false;

    const load = (c: any) => {
      if (destroyed || !c) return;
      try {
        const me = SpacetimeDB.localIdentity;
        if (!me) {
          // Identity not resolved yet — try again shortly
          setTimeout(() => {
            if (!destroyed) load(SpacetimeDB.conn as any);
          }, 300);
          return;
        }
        const myTripIds = new Set(
          [...c.db.trip_member.iter()]
            .filter((m: any) => memberUserId(m) === me)
            .map(memberTripId)
        );
        const rows = [...c.db.trip.iter()]
          .filter((t: any) => myTripIds.has(t.id))
          .map((t: any) => ({ id: t.id, name: t.name }));
        if (!destroyed) setTrips(rows);
      } catch (e) {
        console.warn('[useTrip] load error', e);
        if (!destroyed) setTrips([]);
      }
    };

    const subscribe = () => {
      const c = SpacetimeDB.conn as any;
      if (!c) return false;
      const handler = () => load(c);
      try {
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
        console.warn('[useTrip] subscribe error', e);
        return false;
      }
    };

    const cleanup = subscribe();
    if (cleanup) return () => { destroyed = true; cleanup(); };

    // Not connected yet — wait for connection
    let inner: (() => void) | undefined;
    const unsub = SpacetimeDB.onSpacetimeConnect(() => {
      inner = subscribe() || undefined;
    });
    return () => {
      destroyed = true;
      unsub();
      inner?.();
    };
  }, []);

  return trips;
}

/** Unique user ids that are members of the given trip. */
export function useTripMember(tripId: string): string[] {
  const [members, setMembers] = useState<string[]>([]);

  useEffect(() => {
    if (!tripId) {
      setMembers([]);
      return;
    }
    let destroyed = false;

    const load = (c: any) => {
      if (destroyed || !c) return;
      try {
        const ids = [...c.db.trip_member.iter()]
          .filter((m: any) => memberTripId(m) === tripId)
          .map(memberUserId)
          .filter(Boolean);
        if (!destroyed) setMembers([...new Set(ids)] as string[]);
      } catch {
        if (!destroyed) setMembers([]);
      }
    };

    const subscribe = () => {
      const c = SpacetimeDB.conn as any;
      if (!c) return false;
      const handler = () => load(c);
      try {
        c.db.trip_member.onInsert(handler);
        c.db.trip_member.onDelete(handler);
        load(c);
        return () => {
          c.db.trip_member.removeOnInsert(handler);
          c.db.trip_member.removeOnDelete(handler);
        };
      } catch {
        return false;
      }
    };

    const cleanup = subscribe();
    if (cleanup) return () => { destroyed = true; cleanup(); };

    let inner: (() => void) | undefined;
    const unsub = SpacetimeDB.onSpacetimeConnect(() => {
      inner = subscribe() || undefined;
    });
    return () => {
      destroyed = true;
      unsub();
      inner?.();
    };
  }, [tripId]);

  return members;
}
