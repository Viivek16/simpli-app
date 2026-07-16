import { useEffect, useState } from 'react';
import * as StDB from '../spacetimedb';

// Reactive reader for the user_device table (device identity <-> Google sub links).
// Used to resolve member Google subs back to display names.
export function useUserDevice(): any[] {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    let destroyed = false;
    const load = (c: any) => {
      if (destroyed || !c) return;
      try { setRows([...c.db.user_device.iter()]); } catch { setRows([]); }
    };

    const attach = (c: any): (() => void) | false => {
      if (!c) return false;
      try {
        const handler = () => load(c);
        c.db.user_device.onInsert(handler);
        c.db.user_device.onDelete(handler);
        load(c);
        return () => {
          try {
            c.db.user_device.removeOnInsert(handler);
            c.db.user_device.removeOnDelete(handler);
          } catch {}
        };
      } catch { return false; }
    };

    // Re-attach on every (re)connect; handlers on a superseded connection are dead.
    let detach: (() => void) | undefined;
    const un = StDB.withConnection((c) => {
      detach?.();
      detach = attach(c as any) || undefined;
    });
    const u2 = StDB.onSubscriptionApplied(() => load(StDB.conn as any));
    return () => {
      destroyed = true;
      un(); u2(); detach?.();
    };
  }, []);

  return rows;
}
