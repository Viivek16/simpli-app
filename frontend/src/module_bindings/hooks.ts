import { useEffect, useState } from 'react';
import { conn } from '../spacetimedb';
import { User, ExpenseSplit, Expense } from './types';

export function useUser() {
  const [users, setUsers] = useState<User[]>([]);

  useEffect(() => {
    if (!conn) return;

    const loadData = () => {
      setUsers([...conn!.db.user.iter()]);
    };

    conn.db.user.onInsert(loadData);
    conn.db.user.onUpdate(loadData);
    conn.db.user.onDelete(loadData);

    loadData();

    return () => {
      conn!.db.user.removeOnInsert(loadData);
      conn!.db.user.removeOnUpdate(loadData);
      conn!.db.user.removeOnDelete(loadData);
    };
  }, []);

  return users;
}

export function useExpenseSplit() {
  const [splits, setSplits] = useState<ExpenseSplit[]>([]);

  useEffect(() => {
    if (!conn) return;

    const loadData = () => {
      setSplits([...conn!.db.expense_split.iter()]);
    };

    conn.db.expense_split.onInsert(loadData);
    conn.db.expense_split.onUpdate(loadData);
    conn.db.expense_split.onDelete(loadData);

    loadData();

    return () => {
      conn!.db.expense_split.removeOnInsert(loadData);
      conn!.db.expense_split.removeOnUpdate(loadData);
      conn!.db.expense_split.removeOnDelete(loadData);
    };
  }, []);

  return splits;
}

export function useExpense() {
  const [expenses, setExpenses] = useState<Expense[]>([]);

  useEffect(() => {
    if (!conn) return;

    const loadData = () => {
      setExpenses([...conn!.db.expense.iter()]);
    };

    conn.db.expense.onInsert(loadData);
    conn.db.expense.onUpdate(loadData);
    conn.db.expense.onDelete(loadData);

    loadData();

    return () => {
      conn!.db.expense.removeOnInsert(loadData);
      conn!.db.expense.removeOnUpdate(loadData);
      conn!.db.expense.removeOnDelete(loadData);
    };
  }, []);

  return expenses;
}
