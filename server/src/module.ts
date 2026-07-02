import { spacetimedb } from "@clockworklabs/spacetimedb";

@spacetimedb.table()
export class User {
  @spacetimedb.primaryKey()
  id!: spacetimedb.Identity;

  name!: string;
}

@spacetimedb.table()
export class Trip {
  @spacetimedb.primaryKey()
  id!: string;

  name!: string;

  created_at!: number;
}

@spacetimedb.table()
export class Expense {
  @spacetimedb.primaryKey()
  id!: string;

  @spacetimedb.index()
  trip_id!: string;

  payer_id!: string;
  amount!: number;
  description!: string;
  timestamp!: number;
}

@spacetimedb.table()
export class ExpenseSplit {
  @spacetimedb.index()
  expense_id!: string;

  @spacetimedb.index()
  debtor_id!: string;

  amount_owed!: number;
}

@spacetimedb.struct()
export class Split {
  debtor_id!: string;
  amount_owed!: number;
}

@spacetimedb.reducer()
export function create_user(ctx: spacetimedb.ReducerContext, name: string) {
  User.insert({ id: ctx.sender, name });
}

@spacetimedb.reducer()
export function create_trip(ctx: spacetimedb.ReducerContext, trip_id: string, name: string) {
  Trip.insert({ id: trip_id, name, created_at: ctx.timestamp });
}

@spacetimedb.reducer()
export function add_expense(
  ctx: spacetimedb.ReducerContext,
  expense_id: string,
  trip_id: string,
  amount: number,
  description: string,
  splits: Split[]
) {
  let sum = 0;
  for (const split of splits) {
    sum += split.amount_owed;
  }

  if (Math.abs(sum - amount) > 0.00001) {
    throw new Error("Splits amount_owed must sum up to the total amount");
  }

  Expense.insert({
    id: expense_id,
    trip_id,
    payer_id: ctx.sender.toHexString(),
    amount,
    description,
    timestamp: ctx.timestamp
  });

  for (const split of splits) {
    ExpenseSplit.insert({
      expense_id,
      debtor_id: split.debtor_id,
      amount_owed: split.amount_owed
    });
  }
}

@spacetimedb.reducer()
export function settle_debt(
  ctx: spacetimedb.ReducerContext,
  trip_id: string,
  debtor_id: string,
  payee_id: string,
  amount: number
) {
  const synthetic_expense_id = `settle_${ctx.timestamp}_${debtor_id}_${payee_id}`;
  
  Expense.insert({
    id: synthetic_expense_id,
    trip_id,
    payer_id: debtor_id,
    amount,
    description: "Debt settlement",
    timestamp: ctx.timestamp
  });

  ExpenseSplit.insert({
    expense_id: synthetic_expense_id,
    debtor_id: payee_id,
    amount_owed: amount
  });
}
