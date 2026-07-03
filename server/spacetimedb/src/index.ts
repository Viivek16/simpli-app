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

export const seedDemo = spacetimedb.reducer(
  { trip_id: t.string() },
  (ctx, { trip_id }) => {
    const demoUsers = [
      { id: "0000000000000000000000000000000000000000000000000000000000000001", name: "Neeraj" },
      { id: "0000000000000000000000000000000000000000000000000000000000000002", name: "Paji" },
      { id: "0000000000000000000000000000000000000000000000000000000000000003", name: "Aisha" }
    ];

    for (const u of demoUsers) {
      if (!ctx.db.user.id.find(u.id as any)) {
        ctx.db.user.insert({ id: u.id as any, name: u.name });
      }
      ctx.db.trip_member.insert({ trip_id, user_id: u.id });
    }

    const localIdentity = ctx.sender.toHexString();

    const exp1 = `exp-demo-1`;
    ctx.db.expense.insert({ id: exp1, trip_id, payer_id: localIdentity, amount: 300, description: "Airbnb", timestamp: ctx.timestamp });
    ctx.db.expense_split.insert({ expense_id: exp1, debtor_id: demoUsers[0].id, amount_owed: 100 });
    ctx.db.expense_split.insert({ expense_id: exp1, debtor_id: demoUsers[1].id, amount_owed: 100 });
    ctx.db.expense_split.insert({ expense_id: exp1, debtor_id: demoUsers[2].id, amount_owed: 100 });

    const exp2 = `exp-demo-2`;
    ctx.db.expense.insert({ id: exp2, trip_id, payer_id: demoUsers[0].id, amount: 150, description: "Dinner", timestamp: ctx.timestamp });
    ctx.db.expense_split.insert({ expense_id: exp2, debtor_id: localIdentity, amount_owed: 50 });
    ctx.db.expense_split.insert({ expense_id: exp2, debtor_id: demoUsers[1].id, amount_owed: 50 });
    ctx.db.expense_split.insert({ expense_id: exp2, debtor_id: demoUsers[2].id, amount_owed: 50 });

    const exp3 = `exp-demo-3`;
    ctx.db.expense.insert({ id: exp3, trip_id, payer_id: demoUsers[1].id, amount: 60, description: "Drinks", timestamp: ctx.timestamp });
    ctx.db.expense_split.insert({ expense_id: exp3, debtor_id: demoUsers[0].id, amount_owed: 30 });
    ctx.db.expense_split.insert({ expense_id: exp3, debtor_id: localIdentity, amount_owed: 30 });
    
    const exp4 = `exp-demo-4`;
    ctx.db.expense.insert({ id: exp4, trip_id, payer_id: demoUsers[2].id, amount: 150, description: "Settlement", timestamp: ctx.timestamp });
    ctx.db.expense_split.insert({ expense_id: exp4, debtor_id: localIdentity, amount_owed: 100 });
    ctx.db.expense_split.insert({ expense_id: exp4, debtor_id: demoUsers[0].id, amount_owed: 50 });
  }
);
