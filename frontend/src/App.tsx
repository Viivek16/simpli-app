import { useEffect, useState } from 'react';
import { 
  initSpacetimeDB, 
  onSpacetimeConnect, 
  onSpacetimeConnectError, 
  onSpacetimeDisconnect,
  conn
} from './spacetimedb';
import { LiveDebtConstellation } from './components/LiveDebtConstellation';
import { KarmaBar } from './components/KarmaBar';
import { useUser } from './module_bindings/hooks';

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const users = useUser();

  useEffect(() => {
    initSpacetimeDB();

    const onConnectUnsub = onSpacetimeConnect(() => {
      setIsConnected(true);
      setConnectionError(null);
      // We must subscribe to tables to receive data in V2
      if (conn) {
        conn.subscriptionBuilder().onApplied(() => {}).subscribe(["SELECT * FROM user", "SELECT * FROM expense_split", "SELECT * FROM expense", "SELECT * FROM trip"]);
      }
    });

    const onConnectErrorUnsub = onSpacetimeConnectError((err) => {
      setConnectionError(err.message || 'Failed to connect');
    });

    const onDisconnectUnsub = onSpacetimeDisconnect(() => {
      setIsConnected(false);
    });

    return () => {
      onConnectUnsub();
      onConnectErrorUnsub();
      onDisconnectUnsub();
    };
  }, []);

  const handleCreateTestUsers = () => {
    if (!conn) return;
    // Alice and Bob
    conn.reducers.createUser({ name: 'Alice' });
    conn.reducers.createUser({ name: 'Bob' });
  };

  const handleSimulateExpense = () => {
    if (!conn) return;
    
    // Find Alice and Bob
    const alice = users.find(u => u.name === 'Alice');
    const bob = users.find(u => u.name === 'Bob');
    
    if (!alice || !bob) {
      alert("Please create test users first!");
      return;
    }

    const amount = Math.floor(Math.random() * 41) + 10; // $10 - $50
    const half = amount / 2;

    const splits = [
      { debtor_id: alice.id.toHexString(), amount_owed: half },
      { debtor_id: bob.id.toHexString(), amount_owed: half }
    ];

    conn.reducers.addExpense({
      expenseId: `exp_${Date.now()}`,
      tripId: 'default_trip',
      amount,
      description: 'Random Expense',
      splits: JSON.stringify(splits) // We defined splits as a JSON string in the backend
    });
  };

  return (
    <div className="container" style={{ paddingBottom: '100px' }}>
      <header style={{ marginBottom: 'var(--space-48)' }}>
        <h1>SIMPLI</h1>
        <p style={{ fontSize: 'var(--font-size-h3)', color: 'var(--color-sage)' }}>
          Fair, transparent, and seamless expense splitting.
        </p>
      </header>

      <main>
        <section style={{ marginBottom: 'var(--space-48)' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-16)', marginBottom: 'var(--space-32)' }}>
            <div style={{
              width: '12px',
              height: '12px',
              borderRadius: '50%',
              backgroundColor: isConnected ? 'var(--color-sage)' : connectionError ? 'var(--color-terracotta)' : 'var(--color-text-muted)',
              boxShadow: isConnected ? '0 0 10px var(--color-sage)' : 'none',
              transition: 'all 0.3s ease'
            }} />
            <span style={{ fontWeight: 500 }}>
              {isConnected ? 'Connected to simpli-db' : connectionError ? `Connection Error: ${connectionError}` : 'Connecting to maincloud.spacetimedb.com...'}
            </span>
          </div>

          <KarmaBar />
        </section>

        <section>
          <LiveDebtConstellation />
        </section>
      </main>

      {/* Glassmorphic Control Panel */}
      <div style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 'var(--space-16) var(--space-24)',
        paddingBottom: 'calc(var(--space-16) + env(safe-area-inset-bottom))',
        background: 'rgba(26, 26, 28, 0.75)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'center',
        gap: 'var(--space-16)',
        zIndex: 100
      }}>
        <button onClick={handleCreateTestUsers}>Create Test Users</button>
        <button className="primary" onClick={handleSimulateExpense}>Simulate Expense</button>
      </div>
    </div>
  );
}

export default App;
