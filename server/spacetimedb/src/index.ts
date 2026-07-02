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
      created_at: t.u64(),
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
      timestamp: t.u64(),
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
    ctx.db.trip.insert({ id: trip_id, name, created_at: BigInt(ctx.timestamp.toString()) });
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

    if (Math.abs(sum - amount) > 0.0001) {
      throw new Error("Splits amount_owed must sum up to the total amount");
    }

    ctx.db.expense.insert({
      id: expense_id,
      trip_id,
      payer_id: ctx.sender.toHexString(),
      amount,
      description,
      timestamp: BigInt(ctx.timestamp.toString())
    });

    for (const split of parsedSplits) {
      ctx.db.expense_split.insert({
        expense_id,
        debtor_id: split.debtor_id,
        amount_owed: split.amount_owed
      });
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
      timestamp: BigInt(ctx.timestamp.toString())
    });

    ctx.db.expense_split.insert({
      expense_id: synthetic_expense_id,
      debtor_id: payee_id,
      amount_owed: amount
    });
  }
);
