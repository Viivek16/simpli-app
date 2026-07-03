import { useEffect, useState } from 'react';
import * as SpacetimeDB from '../spacetimedb';

export interface Trip {
  id: string;
  name: string;
}

// Field names differ between raw rows and generated bindings (user_id vs userId).
// Read both so this is robust to either.
const memberUserId = (m: any): string => m.userId ?? m.user_id;
const memberTripId = (m: any): string => m.tripId ?? m.trip_id;

/** Trips the local user is a member of. */
export function useTrip(): Trip[] {
  const [trips, setTrips] = useState<Trip[]>([]);
  useEffect(() => {
    const subscribe = () => {
      const c = SpacetimeDB.conn as any;
      if (!c) return false;
      const load = () => {
        try {
          const me = SpacetimeDB.localIdentity;
          const myTripIds = new Set(
            [...c.db.trip_member.iter()]
              .filter((m: any) => memberUserId(m) === me)
              .map(memberTripId)
          );
          const rows = [...c.db.trip.iter()]
            .filter((t: any) => myTripIds.has(t.id))
            .map((t: any) => ({ id: t.id, name: t.name }));
          setTrips(rows);
        } catch {
          setTrips([]);
        }
      };
      try {
        c.db.trip.onInsert(load);
        c.db.trip.onUpdate(load);
        c.db.trip.onDelete(load);
        c.db.trip_member.onInsert(load);
        c.db.trip_member.onDelete(load);
        load();
        return () => {
          c.db.trip.removeOnInsert(load);
          c.db.trip.removeOnUpdate(load);
          c.db.trip.removeOnDelete(load);
          c.db.trip_member.removeOnInsert(load);
          c.db.trip_member.removeOnDelete(load);
        };
      } catch {
        return false;
      }
    };
    const cleanup = subscribe();
    if (cleanup) return cleanup;
    let inner: (() => void) | undefined;
    const u = SpacetimeDB.onSpacetimeConnect(() => {
      inner = subscribe() || undefined;
    });
    return () => {
      u();
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
    const subscribe = () => {
      const c = SpacetimeDB.conn as any;
      if (!c) return false;
      const load = () => {
        try {
          const ids = [...c.db.trip_member.iter()]
            .filter((m: any) => memberTripId(m) === tripId)
            .map(memberUserId);
          setMembers([...new Set(ids)] as string[]);
        } catch {
          setMembers([]);
        }
      };
      try {
        c.db.trip_member.onInsert(load);
        c.db.trip_member.onDelete(load);
        load();
        return () => {
          c.db.trip_member.removeOnInsert(load);
          c.db.trip_member.removeOnDelete(load);
        };
      } catch {
        return false;
      }
    };
    const cleanup = subscribe();
    if (cleanup) return cleanup;
    let inner: (() => void) | undefined;
    const u = SpacetimeDB.onSpacetimeConnect(() => {
      inner = subscribe() || undefined;
    });
    return () => {
      u();
      inner?.();
    };
  }, [tripId]);
  return members;
}
