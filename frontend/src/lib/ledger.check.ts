/**
 * Self-check for the money paths. No framework — run it with:
 *
 *   node frontend/src/lib/ledger.check.ts
 *
 * Node strips the types; there is nothing to install. Keep it passing when you
 * touch split maths, spend aggregation, or currency formatting.
 */
import assert from 'node:assert/strict';
import { buildOwesMap, pairNet, spentByMember, isTripSettled, SETTLEMENT_DESC } from './ledger.ts';
import { money, currencyMeta, CURRENCIES, DEFAULT_CURRENCY } from './currency.ts';

const exp = (id: string, payerId: string, amount: number, description = 'x') =>
  ({ id, payerId, amount, description });
const split = (expenseId: string, debtorId: string, amountOwed: number) =>
  ({ expenseId, debtorId, amountOwed });

// ── Personal expenses: no splits, no debt, but real spend ────────────────────
{
  const expenses = [
    exp('e1', 'me', 10, 'Metro Card'),
    exp('e2', 'me', 15, 'Sim Card'),
    exp('e3', 'me', 12.60, 'Cab to Hotel'),
    exp('e4', 'me', 9.70, 'Breakfast & Coffee'),
  ];
  const owes = buildOwesMap(expenses, []);
  assert.deepEqual(owes, {}, 'solo expenses must create no debt');
  assert.equal(pairNet(owes, 'me', 'anyone'), 0);
  assert.equal(spentByMember(expenses)['me'], 47.30, 'solo spend must still total');
}

// ── Solo days then group days: one cumulative total per member ───────────────
{
  const expenses = [
    exp('solo1', 'me', 25),                       // day 1, nobody else here yet
    exp('g1', 'me', 100),                         // day 4, split with shubham
    exp('g2', 'shubham', 40),
  ];
  const splits = [
    split('g1', 'me', 50), split('g1', 'shubham', 50),
    split('g2', 'me', 20), split('g2', 'shubham', 20),
  ];
  const spent = spentByMember(expenses);
  assert.equal(spent['me'], 125, 'solo spend carries into the group total');
  assert.equal(spent['shubham'], 40);

  const owes = buildOwesMap(expenses, splits);
  // shubham owes 50 on g1, I owe 20 on g2 → net 30 to me.
  assert.equal(pairNet(owes, 'me', 'shubham'), 30);
  assert.equal(pairNet(owes, 'shubham', 'me'), -30);
}

// ── Settlements move money but are not spend ─────────────────────────────────
{
  const expenses = [exp('e1', 'me', 30), exp('s1', 'me', 30, 'Debt settlement')];
  assert.equal(spentByMember(expenses)['me'], 30, 'settlements must not inflate spend');
}

// ── Payer ids normalise, so casing never splits one member in two ────────────
{
  const expenses = [exp('e1', 'ME', 10), exp('e2', 'me', 5)];
  assert.equal(spentByMember(expenses)['me'], 15);
}

// ── Currency is display-only: same number, different label ───────────────────
{
  for (const code of ['INR', 'USD', 'SGD', 'AED', 'LKR']) {
    const out = money(1234.5, code);
    assert.match(out, /1,?2?3?4[.,]50/, `${code} must keep 2 decimals: ${out}`);
  }
  assert.equal(money(10, 'ZZZ'), money(10, DEFAULT_CURRENCY), 'unknown code falls back to default');
  assert.equal(currencyMeta('SGD').label, 'Singapore Dollar');

  // The dollar/yen families must never render as a bare $ or ¥ — on a Singapore
  // trip that would read as US dollars.
  assert.ok(!money(1, 'SGD').startsWith('$'), 'SGD must not look like USD');
  assert.ok(!money(1, 'CNY').startsWith('¥'), 'CNY must not look like JPY');
  assert.ok(money(1, 'USD').startsWith('$') && money(1, 'INR').startsWith('₹'));
  assert.equal(money(123456.5, 'INR'), '₹1,23,456.50', 'INR keeps lakh grouping');

  // Picker rows are identified by their symbol, so duplicates would be unreadable.
  const symbols = CURRENCIES.map(c => c.symbol);
  assert.equal(new Set(symbols).size, symbols.length, 'currency symbols must be unique');
  const codes = CURRENCIES.map(c => c.code);
  assert.equal(new Set(codes).size, codes.length, 'currency codes must be unique');
}

// ── Settled sector: zero balance alone must not banish a solo tracker ────────
{
  const personal = buildOwesMap([exp('e1', 'me', 10), exp('e2', 'me', 15)], []);
  assert.equal(isTripSettled(personal, 'me', ['me'], false), false,
    'a personal-only trip stays active');
  assert.equal(isTripSettled(personal, 'me', ['me'], true), true,
    'closing it by hand is the way out');

  // A real group: open debt stays active, clearing it settles the trip.
  const open = buildOwesMap(
    [exp('g1', 'me', 100)],
    [split('g1', 'me', 50), split('g1', 'shubham', 50)],
  );
  assert.equal(isTripSettled(open, 'me', ['me', 'shubham'], false), false);

  const cleared = buildOwesMap(
    [exp('g1', 'me', 100), exp('s1', 'shubham', 50, SETTLEMENT_DESC)],
    [
      split('g1', 'me', 50), split('g1', 'shubham', 50),
      split('s1', 'me', 50),
    ],
  );
  assert.equal(isTripSettled(cleared, 'me', ['me', 'shubham'], false), true,
    'settling up still files a real group away');

  assert.equal(isTripSettled({}, 'me', [], false), false, 'an empty trip is active');
}

console.log('ledger.check.ts — all assertions passed');
