/**
 * Closed trips (`trip_closed` table). A row's presence means the trip is done and
 * belongs in the settled sector; deleting it reopens the trip.
 *
 * This is explicit rather than inferred because a trip that only ever holds personal
 * expenses nets to zero from its first row — inferring "settled" from balance alone
 * files a solo expense tracker away before the trip has even started.
 */
import { useEffect, useState } from 'react';
import * as StDB from '../spacetimedb';

const readClosed = (): Set<string> => {
  try {
    const rows = (StDB.conn as any)?.db?.trip_closed?.iter?.() ?? [];
    return new Set([...rows].map((r: any) => String(r.tripId ?? r.trip_id)));
  } catch { return new Set(); }
};

/** Ids of every trip currently closed. */
export const useClosedTrips = (): Set<string> => {
  const [closed, setClosed] = useState<Set<string>>(readClosed);

  useEffect(() => {
    let destroyed = false;
    const load = () => { if (!destroyed) setClosed(readClosed()); };

    let detach: (() => void) | undefined;
    const u1 = StDB.withConnection(c => {
      detach?.();
      const t = (c.db as any).trip_closed;
      if (!t) return;
      t.onInsert(load); t.onDelete(load);
      load();
      detach = () => {
        try { t.removeOnInsert(load); t.removeOnDelete(load); }
        catch { /* connection already torn down */ }
      };
    });
    const u2 = StDB.onSubscriptionApplied(load);

    return () => { destroyed = true; u1(); u2(); detach?.(); };
  }, []);

  return closed;
};

/** Close or reopen a trip for every member. */
export const setTripClosed = async (tripId: string, closed: boolean): Promise<void> => {
  const c = StDB.conn as any;
  if (!c) throw new Error('Not connected.');
  await c.reducers.setTripClosed({ tripId, closed });
};
