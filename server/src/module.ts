import { spacetimedb } from "@clockworklabs/spacetimedb";

// ─── Tables ──────────────────────────────────────────────────────────────────

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

/** Tracks which users are members of a trip (powers invite-link joins). */
@spacetimedb.table()
export class TripMember {
  @spacetimedb.index()
  trip_id!: string;

  user_id!: string;
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

  /** When true this expense is personal (no splits, debtor = payer). */
  is_personal!: boolean;
}

@spacetimedb.table()
export class ExpenseSplit {
  @spacetimedb.index()
  expense_id!: string;

  @spacetimedb.index()
  debtor_id!: string;

  amount_owed!: number;
}

// ─── Structs ─────────────────────────────────────────────────────────────────

@spacetimedb.struct()
export class Split {
  debtor_id!: string;
  amount_owed!: number;
}

// ─── Reducers ────────────────────────────────────────────────────────────────

@spacetimedb.reducer()
export function create_user(ctx: spacetimedb.ReducerContext, name: string) {
  User.insert({ id: ctx.sender, name });
}

/**
 * Creates a new trip and automatically makes the creator a member.
 */
@spacetimedb.reducer()
export function create_trip(ctx: spacetimedb.ReducerContext, trip_id: string, name: string) {
  Trip.insert({ id: trip_id, name, created_at: ctx.timestamp });

  // Auto-enroll the creator as the first member.
  TripMember.insert({ trip_id, user_id: ctx.sender.toHexString() });
}

/**
 * Allows any authenticated user to join an existing trip via its ID
 * (the basis for viral invite links — just share the trip_id).
 */
@spacetimedb.reducer()
export function join_trip(ctx: spacetimedb.ReducerContext, trip_id: string) {
  TripMember.insert({ trip_id, user_id: ctx.sender.toHexString() });
}

/**
 * Records an expense.
 *
 * - `is_personal = true`:  A private expense (no split math, nothing inserted
 *   into ExpenseSplit). The expense is logged as payer = debtor.
 * - `is_personal = false`: A shared group expense. Splits must sum exactly
 *   to `amount`; each Split is persisted into ExpenseSplit.
 */
@spacetimedb.reducer()
export function add_expense(
  ctx: spacetimedb.ReducerContext,
  expense_id: string,
  trip_id: string,
  amount: number,
  description: string,
  is_personal: boolean,
  splits: Split[]
) {
  if (!is_personal) {
    // Validate that splits sum to the total amount.
    let sum = 0;
    for (const split of splits) {
      sum += split.amount_owed;
    }

    if (Math.abs(sum - amount) > 0.00001) {
      throw new Error(
        `Splits must sum to the total amount (got ${sum.toFixed(5)}, expected ${amount.toFixed(5)})`
      );
    }
  }

  Expense.insert({
    id: expense_id,
    trip_id,
    payer_id: ctx.sender.toHexString(),
    amount,
    description,
    timestamp: ctx.timestamp,
    is_personal,
  });

  if (!is_personal) {
    for (const split of splits) {
      ExpenseSplit.insert({
        expense_id,
        debtor_id: split.debtor_id,
        amount_owed: split.amount_owed,
      });
    }
  }
}

/**
 * Settles a debt between two members of a trip.
 * Creates a synthetic settlement expense + split to zero-out the balance.
 */
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
    timestamp: ctx.timestamp,
    is_personal: false,
  });

  ExpenseSplit.insert({
    expense_id: synthetic_expense_id,
    debtor_id: payee_id,
    amount_owed: amount,
  });
}
