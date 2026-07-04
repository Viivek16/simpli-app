export function pairNet(owes: Record<string, Record<string, number>>, meId: string, otherId: string): number {
  const meOwesOther = (owes[meId] && owes[meId][otherId]) || 0;
  const otherOwesMe = (owes[otherId] && owes[otherId][meId]) || 0;
  return otherOwesMe - meOwesOther;
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
