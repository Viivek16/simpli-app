/**
 * Live read/write of a trip's display currency (`trip_currency` table).
 * The currency list and the formatter itself are pure and live in `lib/currency.ts`.
 */
import { useEffect, useState } from 'react';
import * as StDB from '../spacetimedb';
import { DEFAULT_CURRENCY } from '../lib/currency';

/** Current currency code for a trip, read straight off the live connection. */
export const tripCurrency = (tripId: string): string => {
  try {
    const row = (StDB.conn as any)?.db?.trip_currency?.trip_id?.find(tripId);
    return row?.code || DEFAULT_CURRENCY;
  } catch { return DEFAULT_CURRENCY; }
};

/**
 * Reactive version: re-renders when any member changes the trip's currency.
 * Mirrors the attach/re-attach pattern the other table hooks use, because a
 * reconnect hands back a new connection and handlers on the old one are dead.
 */
export const useTripCurrency = (tripId: string): string => {
  const [code, setCode] = useState(() => tripCurrency(tripId));

  useEffect(() => {
    if (!tripId) { setCode(DEFAULT_CURRENCY); return; }
    let destroyed = false;
    const load = () => { if (!destroyed) setCode(tripCurrency(tripId)); };

    let detach: (() => void) | undefined;
    const u1 = StDB.withConnection(c => {
      detach?.();
      const t = (c.db as any).trip_currency;
      if (!t) return;
      t.onInsert(load); t.onUpdate(load); t.onDelete(load);
      load();
      detach = () => {
        try { t.removeOnInsert(load); t.removeOnUpdate(load); t.removeOnDelete(load); }
        catch { /* connection already torn down */ }
      };
    });
    const u2 = StDB.onSubscriptionApplied(load);

    return () => { destroyed = true; u1(); u2(); detach?.(); };
  }, [tripId]);

  return code;
};

/** Persist a trip's currency for every member. No-ops when unchanged. */
export const setTripCurrency = async (tripId: string, code: string): Promise<void> => {
  const c = StDB.conn as any;
  if (!c || tripCurrency(tripId) === code) return;
  await c.reducers.setTripCurrency({ tripId, code });
};
