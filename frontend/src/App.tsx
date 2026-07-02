import { useEffect, useState } from 'react';
import {
  initSpacetimeDB,
  onSpacetimeConnect,
  onSpacetimeConnectError,
  onSpacetimeDisconnect,
} from './spacetimedb';
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

      const activeConn = SpacetimeDB.conn;
      if (activeConn) {
        activeConn
          .subscriptionBuilder()
          .onApplied(() => {
            console.log('[SIMPLI] ✅ Subscription applied — local cache is live.');
          })
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

    const activeConn = SpacetimeDB.conn as any;

    if (!activeConn) {
      setUiError('Not connected. Please wait.');
      return;
    }

    try {
      // create_user uses ctx.sender as the user ID — so we just pass the name.
      // "Alice" and "Bob" will be created with this session's identity and a 2nd identity
      // (in a multi-user flow). For the single-user demo we create one user with this identity.
      console.log('[SIMPLI] → createUser("Alice")');
      activeConn.reducers.createUser({ name: 'Alice' });

      // Create a test trip
      console.log('[SIMPLI] → createTrip("trip-1", "Vegas Trip")');
      activeConn.reducers.createTrip({ tripId: 'trip-1', name: 'Vegas Trip' });

      setStatusMsg('✓ Created user & trip — constellation will populate when data arrives');
    } catch (error: any) {
      console.error('[SIMPLI] handleCreateTestUsers error:', error);
      setUiError(error?.message ?? 'Error creating test users.');
    }
  };

  const handleSimulateExpense = () => {
    setUiError(null);
    setStatusMsg(null);

    const activeConn = SpacetimeDB.conn as any;
    const myIdentity = SpacetimeDB.localIdentity;

    if (!activeConn) {
      setUiError('Not connected. Please wait.');
      return;
    }

    if (!myIdentity) {
      setUiError('Identity not yet established. Wait a moment and try again.');
      return;
    }

    try {
      // The server's add_expense reducer accepts splits as Split[] — a BSATN array.
      // The generated binding has splits: __t.string() which means the SDK
      // will serialize this as a string field. We pass JSON so the server
      // can decode it. The server Split struct has debtor_id & amount_owed.
      // We reference the current user's own identity as both payer & debtor
      // for the single-user demo (just to populate the DB and show the UI working).
      console.log('[SIMPLI] → addExpense(exp-1, trip-1, 100, "Dinner")');
      activeConn.reducers.addExpense({
        expenseId: 'exp-1',
        tripId: 'trip-1',
        amount: 100,
        description: 'Dinner',
        // splits is encoded as a JSON string because the generated binding treats it as string
        splits: JSON.stringify([{ debtor_id: myIdentity, amount_owed: 100 }]),
      });

      setStatusMsg('✓ Expense added — check constellation for debt lines');
    } catch (error: any) {
      console.error('[SIMPLI] handleSimulateExpense error:', error);
      setUiError(error?.message ?? 'Error adding expense.');
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────────

  const dotColor = isConnected ? '#6fba8a' : connectionError ? '#c0715a' : '#888';
  const dotGlow = isConnected ? '0 0 10px #6fba8a' : 'none';

  return (
    <div className="container" style={{ paddingBottom: '108px' }}>
      <header style={{ marginBottom: 'var(--space-48)' }}>
        <h1>SIMPLI</h1>
        <p style={{ fontSize: 'var(--font-size-h3)', color: 'var(--color-sage)' }}>
          Fair, transparent, and seamless expense splitting.
        </p>
      </header>

      <main>
        <section style={{ marginBottom: 'var(--space-48)' }}>
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
        {uiError && (
          <p style={{ margin: 0, color: '#e07070', fontWeight: 600, fontSize: '0.85rem', textAlign: 'center' }}>
            ⚠ {uiError}
          </p>
        )}
        {statusMsg && !uiError && (
          <p style={{ margin: 0, color: '#6fba8a', fontWeight: 500, fontSize: '0.85rem', textAlign: 'center' }}>
            {statusMsg}
          </p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-16)' }}>
          <button onClick={handleCreateTestUsers} disabled={!isReady}>
            Create Test Users
          </button>
          <button className="primary" onClick={handleSimulateExpense} disabled={!isReady}>
            Simulate Expense
          </button>
        </div>

        {!isReady && (
          <p style={{ margin: 0, color: '#666', fontSize: '0.75rem', textAlign: 'center' }}>
            {connectionError ? 'Connection failed — check console.' : 'Establishing secure connection…'}
          </p>
        )}
      </div>
    </div>
  );
}

export default App;
