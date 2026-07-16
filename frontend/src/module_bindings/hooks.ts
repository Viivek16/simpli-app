import { useEffect, useState } from 'react';
import * as StDB from '../spacetimedb';
import { User, ExpenseSplit, Expense } from './types';

// These hooks use a module-namespace import (* as StDB) so they always read
// the live value of StDB.conn — NOT a stale snapshot captured at import time.

/**
 * Mirror a table into React state, staying attached across reconnects.
 *
 * A reconnect yields a brand-new connection object with a fresh row cache, so
 * handlers registered on the previous one never fire again. `withConnection`
 * re-runs this attacher on every (re)connect; we drop the prior handlers first
 * and re-read the table so the UI reflects whatever changed while we were away.
 */
function useTable<T>(table: 'user' | 'expense' | 'expense_split'): T[] {
  const [rows, setRows] = useState<T[]>([]);

  useEffect(() => {
    let detach: (() => void) | undefined;

    const unsub = StDB.withConnection(conn => {
      detach?.();
      const t = (conn.db as any)[table];
      const loadData = () => setRows([...t.iter()]);

      t.onInsert(loadData);
      t.onUpdate(loadData);
      t.onDelete(loadData);
      loadData();

      detach = () => {
        try {
          t.removeOnInsert(loadData);
          t.removeOnUpdate(loadData);
          t.removeOnDelete(loadData);
        } catch { /* connection already torn down */ }
      };
    });

    return () => { unsub(); detach?.(); };
  }, [table]);

  return rows;
}

export function useUser() {
  return useTable<User>('user');
}

export function useExpenseSplit() {
  return useTable<ExpenseSplit>('expense_split');
}

export function useExpense() {
  return useTable<Expense>('expense');
}
