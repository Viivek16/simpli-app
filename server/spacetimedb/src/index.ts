import { schema, table, t } from 'spacetimedb/server';

const spacetimedb = schema({
  user: table(
    { public: true },
    {
      id: t.identity().primaryKey(),
      name: t.string(),
    }
  ),
  trip: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      name: t.string(),
      created_at: t.timestamp(),
    }
  ),
  expense: table(
    { public: true },
    {
      id: t.string().primaryKey(),
      trip_id: t.string().index(),
      payer_id: t.string(),
      amount: t.f64(),
      description: t.string(),
      timestamp: t.timestamp(),
    }
  ),
  expense_split: table(
    { public: true },
    {
      expense_id: t.string().index(),
      debtor_id: t.string().index(),
      amount_owed: t.f64(),
    }
  ),
  trip_member: table(
    { public: true },
    {
      trip_id: t.string().index(),
      user_id: t.string().index(),
    }
  ),
});
export default spacetimedb;

export const init = spacetimedb.init(_ctx => {});
export const onConnect = spacetimedb.clientConnected(_ctx => {});
export const onDisconnect = spacetimedb.clientDisconnected(_ctx => {});

export const createUser = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    ctx.db.user.insert({ id: ctx.sender, name });
  }
);

export const createTrip = spacetimedb.reducer(
  { trip_id: t.string(), name: t.string() },
  (ctx, { trip_id, name }) => {
    ctx.db.trip.insert({ id: trip_id, name, created_at: ctx.timestamp });
    ctx.db.trip_member.insert({ trip_id, user_id: ctx.sender.toHexString() });
  }
);

export const joinTrip = spacetimedb.reducer(
  { trip_id: t.string() },
  (ctx, { trip_id }) => {
    for (const m of ctx.db.trip_member.trip_id.filter(trip_id)) {
      if (m.user_id === ctx.sender.toHexString()) return;
    }
    ctx.db.trip_member.insert({ trip_id, user_id: ctx.sender.toHexString() });
  }
);

export const addExpense = spacetimedb.reducer(
  {
    expense_id: t.string(),
    trip_id: t.string(),
    amount: t.f64(),
    description: t.string(),
    splits: t.string(), // JSON array of splits
  },
  (ctx, { expense_id, trip_id, amount, description, splits }) => {
    const parsedSplits = JSON.parse(splits) as { debtor_id: string; amount_owed: number }[];
    let sum = 0;
    for (const split of parsedSplits) {
      sum += split.amount_owed;
    }

    if (parsedSplits.length > 0 && Math.abs(sum - amount) > 0.0001) {
      throw new Error("Splits amount_owed must sum up to the total amount");
    }

    ctx.db.expense.insert({
      id: expense_id,
      trip_id,
      payer_id: ctx.sender.toHexString(),
      amount,
      description,
      timestamp: ctx.timestamp
    });

    if (parsedSplits.length > 0) {
      for (const split of parsedSplits) {
        ctx.db.expense_split.insert({
          expense_id,
          debtor_id: split.debtor_id,
          amount_owed: split.amount_owed
        });
      }
    }
  }
);

export const settleDebt = spacetimedb.reducer(
  { trip_id: t.string(), debtor_id: t.string(), payee_id: t.string(), amount: t.f64() },
  (ctx, { trip_id, debtor_id, payee_id, amount }) => {
    const synthetic_expense_id = `settle_${ctx.timestamp}_${debtor_id}_${payee_id}`;
    
    ctx.db.expense.insert({
      id: synthetic_expense_id,
      trip_id,
      payer_id: debtor_id,
      amount,
      description: "Debt settlement",
      timestamp: ctx.timestamp
    });

    ctx.db.expense_split.insert({
      expense_id: synthetic_expense_id,
      debtor_id: payee_id,
      amount_owed: amount
    });
  }
);

// Helper: throws if the calling user is not a member of the trip
const requireMember = (ctx: any, trip_id: string) => {
  const sender = ctx.sender.toHexString();
  for (const m of ctx.db.trip_member.trip_id.filter(trip_id)) {
    if (m.user_id === sender) return;
  }
  throw new Error("Not a member of this trip");
};

export const deleteExpense = spacetimedb.reducer(
  { expense_id: t.string() },
  (ctx, { expense_id }) => {
    const exp = ctx.db.expense.id.find(expense_id);
    if (!exp) throw new Error("Expense not found");
    requireMember(ctx, exp.trip_id);
    for (const s of ctx.db.expense_split.expense_id.filter(expense_id)) {
      ctx.db.expense_split.delete(s);
    }
    ctx.db.expense.delete(exp);
  }
);

export const updateExpense = spacetimedb.reducer(
  {
    expense_id: t.string(),
    amount: t.f64(),
    description: t.string(),
    splits: t.string(), // JSON array, same contract as addExpense
  },
  (ctx, { expense_id, amount, description, splits }) => {
    const exp = ctx.db.expense.id.find(expense_id);
    if (!exp) throw new Error("Expense not found");
    requireMember(ctx, exp.trip_id);

    const parsed = JSON.parse(splits) as { debtor_id: string; amount_owed: number }[];
    let sum = 0;
    for (const s of parsed) sum += s.amount_owed;
    if (parsed.length > 0 && Math.abs(sum - amount) > 0.0001) {
      throw new Error("Splits amount_owed must sum up to the total amount");
    }

    // Replace splits atomically
    for (const s of ctx.db.expense_split.expense_id.filter(expense_id)) {
      ctx.db.expense_split.delete(s);
    }
    for (const s of parsed) {
      ctx.db.expense_split.insert({ expense_id, debtor_id: s.debtor_id, amount_owed: s.amount_owed });
    }

    // Update: delete + reinsert preserving payer_id and original timestamp
    ctx.db.expense.delete(exp);
    ctx.db.expense.insert({
      id: exp.id,
      trip_id: exp.trip_id,
      payer_id: exp.payer_id,
      amount,
      description,
      timestamp: exp.timestamp,
    });
  }
);

export const deleteTrip = spacetimedb.reducer(
  { trip_id: t.string() },
  (ctx, { trip_id }) => {
    requireMember(ctx, trip_id);
    // Cascade: splits -> expenses -> members -> trip (ACID transaction)
    for (const e of ctx.db.expense.trip_id.filter(trip_id)) {
      for (const s of ctx.db.expense_split.expense_id.filter(e.id)) {
        ctx.db.expense_split.delete(s);
      }
      ctx.db.expense.delete(e);
    }
    for (const m of ctx.db.trip_member.trip_id.filter(trip_id)) {
      ctx.db.trip_member.delete(m);
    }
    const trip = ctx.db.trip.id.find(trip_id);
    if (trip) ctx.db.trip.delete(trip);
  }
);
