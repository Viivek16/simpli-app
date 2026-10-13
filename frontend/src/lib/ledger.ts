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

/**
 * Does a trip belong in the distant "settled" sector rather than the active home screen?
 *
 * A zero balance is not enough on its own. A trip holding only personal expenses nets to
 * zero from its very first row, so inferring settlement from balance alone would file a
 * solo expense tracker away before the trip had started. Two routes in:
 *   - `closed`: someone closed the trip by hand. The only route for a solo trip.
 *   - the trip carried real debt between members and that debt has cleared — the
 *     settle-up path.
 * `owes` holds cross-member debt only (buildOwesMap drops self-splits), so a non-empty
 * map is exactly "this trip had something to settle".
 */
export function isTripSettled(
  owes: Record<string, Record<string, number>>,
  meId: string,
  otherIds: string[],
  closed: boolean,
): boolean {
  if (closed) return true;
  if (Object.keys(owes).length === 0) return false;
  return otherIds.every(id => id === meId || Math.abs(pairNet(owes, meId, id)) <= 0.5);
}
