import { useEffect, useState } from 'react';
import {
  initSpacetimeDB,
  onSpacetimeConnect,
  onSpacetimeConnectError,
  onSpacetimeDisconnect,
} from './spacetimedb';
// We import the module namespace so we can always read the LATEST conn value
// (it's a mutable `export let`, so re-reading it after connection is established
// gives us the actual DbConnection instance).
import * as SpacetimeDB from './spacetimedb';
import { LiveDebtConstellation } from './components/LiveDebtConstellation';
import { KarmaBar } from './components/KarmaBar';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    initSpacetimeDB();

    const onConnectUnsub = onSpacetimeConnect(() => {
      setIsConnected(true);
      setConnectionError(null);
      setIsReady(true);
      setUiError(null);

      // SpacetimeDB.conn is now the live DbConnection instance
      const activeConn = SpacetimeDB.conn;
      if (activeConn) {
        activeConn
          .subscriptionBuilder()
          .onApplied(() => {})
          .subscribe([
            'SELECT * FROM user',
            'SELECT * FROM expense_split',
            'SELECT * FROM expense',
            'SELECT * FROM trip',
          ]);
      }
    });

    const onConnectErrorUnsub = onSpacetimeConnectError((err) => {
      setConnectionError(err.message || 'Failed to connect');
      setIsReady(false);
    });

    const onDisconnectUnsub = onSpacetimeDisconnect(() => {
      setIsConnected(false);
      setIsReady(false);
    });

    return () => {
      onConnectUnsub();
      onConnectErrorUnsub();
      onDisconnectUnsub();
    };
  }, []);

  // ─── Handlers ────────────────────────────────────────────────────────────────

  const handleCreateTestUsers = () => {
    setUiError(null);
    setStatusMsg(null);

    // Always read SpacetimeDB.conn at call-time so we get the latest value.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeConn = SpacetimeDB.conn as any;

    if (!activeConn) {
      setUiError('No active database connection. Please wait and try again.');
      return;
    }

    try {
      console.log('[SIMPLI] → createUser(Alice)');
      activeConn.reducers.createUser({ name: 'Alice' });

      console.log('[SIMPLI] → createUser(Bob)');
      activeConn.reducers.createUser({ name: 'Bob' });

      console.log('[SIMPLI] → createTrip(trip-1, "Vegas Trip")');
      activeConn.reducers.createTrip({ tripId: 'trip-1', name: 'Vegas Trip' });

      setStatusMsg('✓ Dispatched: Create Alice, Bob & Vegas Trip');
    } catch (error: any) {
      console.error('[SIMPLI] handleCreateTestUsers error:', error);
      setUiError(error?.message ?? 'Unknown error creating test users.');
    }
  };

  const handleSimulateExpense = () => {
    setUiError(null);
    setStatusMsg(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const activeConn = SpacetimeDB.conn as any;

    if (!activeConn) {
      setUiError('No active database connection. Please wait and try again.');
      return;
    }

    try {
      const splits = JSON.stringify([
        { debtor_id: 'alice-1', amount_owed: 50 },
        { debtor_id: 'bob-1', amount_owed: 50 },
      ]);

      console.log('[SIMPLI] → addExpense(exp-1, trip-1, 100, "Dinner")');
      activeConn.reducers.addExpense({
        expenseId: 'exp-1',
        tripId: 'trip-1',
        amount: 100,
        description: 'Dinner',
        splits,
      });

      setStatusMsg('✓ Dispatched: Add Expense $100 (Dinner)');
    } catch (error: any) {
      console.error('[SIMPLI] handleSimulateExpense error:', error);
      setUiError(error?.message ?? 'Unknown error simulating expense.');
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  const dotColor = isConnected ? '#6fba8a' : connectionError ? '#c0715a' : '#888';
  const dotGlow = isConnected ? '0 0 10px #6fba8a' : 'none';

  return (
    <div className="container" style={{ paddingBottom: '108px' }}>
      {/* ── Header ── */}
      <header style={{ marginBottom: 'var(--space-48)' }}>
        <h1>SIMPLI</h1>
        <p style={{ fontSize: 'var(--font-size-h3)', color: 'var(--color-sage)' }}>
          Fair, transparent, and seamless expense splitting.
        </p>
      </header>

      {/* ── Main ── */}
      <main>
        <section style={{ marginBottom: 'var(--space-48)' }}>
          {/* Connection status */}
          <div
            className="card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-16)',
              marginBottom: 'var(--space-32)',
            }}
          >
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                backgroundColor: dotColor,
                boxShadow: dotGlow,
                flexShrink: 0,
                transition: 'background-color 0.3s ease, box-shadow 0.3s ease',
              }}
            />
            <span style={{ fontWeight: 500 }}>
              {isConnected
                ? 'Connected to simpli-db'
                : connectionError
                ? `Connection Error: ${connectionError}`
                : 'Connecting to maincloud.spacetimedb.com…'}
            </span>
          </div>

          <KarmaBar />
        </section>

        <section>
          <LiveDebtConstellation />
        </section>
      </main>

      {/* ── Glassmorphic Control Panel ── */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 'var(--space-16) var(--space-24)',
          paddingBottom: 'calc(var(--space-16) + env(safe-area-inset-bottom))',
          background: 'rgba(22, 22, 24, 0.85)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 'var(--space-8)',
          zIndex: 100,
        }}
      >
        {/* Error banner */}
        {uiError && (
          <p
            style={{
              margin: 0,
              color: '#e07070',
              fontWeight: 600,
              fontSize: '0.85rem',
              textAlign: 'center',
            }}
          >
            ⚠ {uiError}
          </p>
        )}

        {/* Success feedback */}
        {statusMsg && !uiError && (
          <p
            style={{
              margin: 0,
              color: '#6fba8a',
              fontWeight: 500,
              fontSize: '0.85rem',
              textAlign: 'center',
            }}
          >
            {statusMsg}
          </p>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 'var(--space-16)' }}>
          <button
            onClick={handleCreateTestUsers}
            disabled={!isReady}
            title={!isReady ? 'Waiting for database connection…' : 'Create Alice, Bob & a test trip'}
          >
            Create Test Users
          </button>
          <button
            className="primary"
            onClick={handleSimulateExpense}
            disabled={!isReady}
            title={!isReady ? 'Waiting for database connection…' : 'Add a $100 dinner expense'}
          >
            Simulate Expense
          </button>
        </div>

        {/* Not-ready hint */}
        {!isReady && (
          <p
            style={{
              margin: 0,
              color: '#666',
              fontSize: '0.75rem',
              textAlign: 'center',
            }}
          >
            {connectionError ? 'Connection failed — check console for details.' : 'Establishing secure connection…'}
          </p>
        )}
      </div>
    </div>
  );
}

export default App;
