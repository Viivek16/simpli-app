# SpacetimeDB Developer Experience Feedback
## From building SIMPLI (real-time expense splitting, TypeScript module, CLI 2.6.1)

This is candid, constructive feedback from shipping a production app against SpacetimeDB in July 2026.

---

### 1. The Two-API-Generations Trap

The single biggest obstacle: SpacetimeDB has two incompatible TypeScript server APIs — the decorator/class-based API (older documentation, tutorials) and the builder API (`schema()`, `table()`, `t.reducer()`). They do not interoperate and produce incompatible `spacetime generate` output. The CLI gives no clear error when you mix them; it either silently fails or produces a module that crashes at runtime.

The fix is simple: **a clear banner in the docs** at the top of every server-side API page: "This is the builder API (current). If you see decorators (`@table`, `@reducer`), that is the legacy API and will not compile on CLI 2.6.1+."

---

### 2. Splits as a JSON String

The `splits` argument on `addExpense` is `t.string()` containing a JSON array. This is the right call for now — SpacetimeDB doesn't expose array-of-struct reducer args in the builder API — but it creates a footgun: the client can pass malformed JSON and the error surfaces server-side as a runtime throw (not a type error), with no type safety at the call site. A first-class `t.array(t.object({...}))` in reducer args would eliminate this class of bugs.

---

### 3. camelCase / snake_case Binding Drift

The server defines `trip_id`, `user_id`, `payer_id`. The generated TypeScript bindings expose `tripId`, `userId`, `payerId`. This is correct and good — but it's not documented. I spent debugging time comparing `m.user_id === localIdentity` (always false) before discovering the bindings silently camelCase everything. A one-sentence note in "generate" output docs would save hours.

---

### 4. Silent Fire-and-Forget Reducer Failures

`c.reducers.createTrip(args)` (without `await`) returns `void` in the generated types. If the module throws, the error is swallowed. The SDK should expose a `Promise`-returning variant by default, or at minimum surface reducer errors on a subscribable error channel. `await`ing reducers works when you know to do it; the ergonomic default should be loud failure, not silent success.

---

### 5. Identity Is Connection-Scoped (Multi-Device Data Loss)

`ctx.sender` is the connection-level identity, derived from a token stored in `localStorage`. If a user clears storage, changes browsers, or opens on mobile, they get a new identity and lose access to their trips. For a social app where you share invite links, this is a severe usability cliff.

**Suggestion:** First-class OIDC/OAuth identity binding. The user should be able to associate their Google identity with a stable SpacetimeDB identity, not the ephemeral connection token. Even a "link external identity" reducer pattern in the docs would help.

---

### 6. Fabricated-Identity Fatal Errors

Calling `ctx.db.user.insert({ id: "fake_hex_string" as Identity, ... })` from a reducer crashes the module instance with a fatal error (not a reducer error — the whole module dies). There is no runtime guard at the reducer boundary. The `seedDemo` pattern is therefore a loaded gun. This should throw a reducer error instead of a process crash.

---

### 7. Subscription Query Scoping Limits

`SELECT * FROM trip` returns all trips for all users. For a multi-tenant app, you need row-level security or user-scoped queries. The current workaround is client-side filtering, which means the client sees data it should not (all trips, all expenses). A `SELECT * FROM trip WHERE id IN (SELECT trip_id FROM trip_member WHERE user_id = :sender)` pattern in subscriptions would be the correct solution.

---

### What Genuinely Delighted

- **Zero-API real-time sync.** Writing `ctx.db.expense.insert(...)` in a reducer and seeing the React component update on another browser within milliseconds, with no WebSocket handler, no Redux action, no API endpoint — this is the right model. It is genuinely impressive.
- **`spacetime sql server-simpli "SELECT * FROM expense"`** — this command saved hours of debugging. Direct SQL introspection against the live module is exactly the right developer tool.
- **`updateExpense` as a single ACID transaction.** Delete old splits, reinsert new ones, replace the expense row — all in one reducer, atomically. No saga, no compensating transaction, no eventual consistency. This is the pitch, and it works exactly as advertised.
- **The publish latency.** `spacetime publish server-simpli` completes in under 10 seconds. Iteration is genuinely fast once you have the API surface right.

---

*Filed July 2026. Happy to discuss any of these in detail.*
