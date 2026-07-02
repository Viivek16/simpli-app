import { useEffect, useState } from 'react';
import * as StDB from '../spacetimedb';
import { User, ExpenseSplit, Expense } from './types';

// These hooks use a module-namespace import (* as StDB) so they always read
// the live value of StDB.conn — NOT a stale snapshot captured at import time.

export function useUser() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    const trySubscribe = () => {
      const conn = StDB.conn;
      if (!conn) return false;

      const loadData = () => {
        setUsers([...conn.db.user.iter()]);
      };

      conn.db.user.onInsert(loadData);
      conn.db.user.onUpdate(loadData);
      conn.db.user.onDelete(loadData);
      loadData();

      return () => {
        conn.db.user.removeOnInsert(loadData);
        conn.db.user.removeOnUpdate(loadData);
        conn.db.user.removeOnDelete(loadData);
      };
    };

    // If conn is already available (connection established before this hook mounted),
    // subscribe immediately.
    const cleanup = trySubscribe();
    if (cleanup) return cleanup;

    // Otherwise, wait for the connect event and then subscribe.
    let innerCleanup: (() => void) | undefined;
    const unsub = StDB.onSpacetimeConnect(() => {
      innerCleanup = trySubscribe() || undefined;
    });
    return () => {
      unsub();
      innerCleanup?.();
    };
  }, []);

  return users;
}

export function useExpenseSplit() {
  const [splits, setSplits] = useState<ExpenseSplit[]>([]);

  useEffect(() => {
    const trySubscribe = () => {
      const conn = StDB.conn;
      if (!conn) return false;

      const loadData = () => {
        setSplits([...conn.db.expense_split.iter()]);
      };

      conn.db.expense_split.onInsert(loadData);
      conn.db.expense_split.onUpdate(loadData);
      conn.db.expense_split.onDelete(loadData);
      loadData();

      return () => {
        conn.db.expense_split.removeOnInsert(loadData);
        conn.db.expense_split.removeOnUpdate(loadData);
        conn.db.expense_split.removeOnDelete(loadData);
      };
    };

    const cleanup = trySubscribe();
    if (cleanup) return cleanup;

    let innerCleanup: (() => void) | undefined;
    const unsub = StDB.onSpacetimeConnect(() => {
      innerCleanup = trySubscribe() || undefined;
    });
    return () => {
      unsub();
      innerCleanup?.();
    };
  }, []);

  return splits;
}

export function useExpense() {
  const [expenses, setExpenses] = useState<Expense[]>([]);

  useEffect(() => {
    const trySubscribe = () => {
      const conn = StDB.conn;
      if (!conn) return false;

      const loadData = () => {
        setExpenses([...conn.db.expense.iter()]);
      };

      conn.db.expense.onInsert(loadData);
      conn.db.expense.onUpdate(loadData);
      conn.db.expense.onDelete(loadData);
      loadData();

      return () => {
        conn.db.expense.removeOnInsert(loadData);
        conn.db.expense.removeOnUpdate(loadData);
        conn.db.expense.removeOnDelete(loadData);
      };
    };

    const cleanup = trySubscribe();
    if (cleanup) return cleanup;

    let innerCleanup: (() => void) | undefined;
    const unsub = StDB.onSpacetimeConnect(() => {
      innerCleanup = trySubscribe() || undefined;
    });
    return () => {
      unsub();
      innerCleanup?.();
    };
  }, []);

  return expenses;
}
