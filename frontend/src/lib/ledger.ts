export function pairNet(owes: Record<string, Record<string, number>>, meId: string, otherId: string): number {
  const meOwesOther = (owes[meId] && owes[meId][otherId]) || 0;
  const otherOwesMe = (owes[otherId] && owes[otherId][meId]) || 0;
  return Math.round((otherOwesMe - meOwesOther) * 100) / 100;
}

export function buildOwesMap(expenses: any[], splits: any[]): Record<string, Record<string, number>> {
  const owes: Record<string, Record<string, number>> = {};
  splits.forEach(split => {
    const exp = expenses.find(e => e.id === split.expenseId);
    if (!exp) return;
    const debtor = String(split.debtorId).toLowerCase().trim();
    const payee = String(exp.payerId).toLowerCase().trim();
    if (debtor !== payee) {
      if (!owes[debtor]) owes[debtor] = {};
      owes[debtor][payee] = (owes[debtor][payee] || 0) + split.amountOwed;
    }
  });
  return owes;
}

export const SETTLEMENT_DESC = 'Debt settlement';

/**
 * Total each member actually paid out in a trip, personal expenses included.
 *
 * Debt is pairwise, so an expense split with nobody — a solo metro card, a SIM —
 * nets to zero and is invisible to `buildOwesMap`. This is what makes a solo
 * traveller's spend countable: it answers "how much have I spent here", not
 * "who owes whom". Settlements are excluded — moving money to clear a debt is
 * not new spend.
 */
export function spentByMember(expenses: any[]): Record<string, number> {
  const spent: Record<string, number> = {};
  expenses.forEach(e => {
    if (e.description === SETTLEMENT_DESC) return;
    const payer = String(e.payerId).toLowerCase().trim();
    spent[payer] = Math.round(((spent[payer] || 0) + (e.amount || 0)) * 100) / 100;
  });
  return spent;
}
