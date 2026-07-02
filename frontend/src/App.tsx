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

// @ts-ignore - The user requested these exact imports.
import { createUser } from "./module_bindings/create_user_reducer";
// @ts-ignore
import { createTrip } from "./module_bindings/create_trip_reducer";
// @ts-ignore
import { addExpense } from "./module_bindings/add_expense_reducer";

function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const users = useUser();

  useEffect(() => {
    initSpacetimeDB();

    const onConnectUnsub = onSpacetimeConnect(() => {
      setIsConnected(true);
      setConnectionError(null);
      setIsReady(true);
      // We must subscribe to tables to receive data in V2
      if (conn) {
        conn.subscriptionBuilder().onApplied(() => {}).subscribe(["SELECT * FROM user", "SELECT * FROM expense_split", "SELECT * FROM expense", "SELECT * FROM trip"]);
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

  const handleCreateTestUsers = () => {
    setUiError(null);
    try {
      createUser("Alice");
      createUser("Bob");
      createTrip("trip-1", "Vegas Trip");
    } catch (error: any) {
      console.error("Error creating test users:", error);
      setUiError(error.message || "Failed to create test users.");
    }
  };

  const handleSimulateExpense = () => {
    setUiError(null);
    try {
      const splits = [
        { debtor_id: "alice-1", amount_owed: 50 },
        { debtor_id: "bob-1", amount_owed: 50 }
      ];
      
      addExpense("exp-1", "trip-1", 100, "Dinner", JSON.stringify(splits));
    } catch (error: any) {
      console.error("Error simulating expense:", error);
      setUiError(error.message || "Failed to simulate expense.");
    }
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
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-16)',
        zIndex: 100
      }}>
        {uiError && (
          <div style={{ color: 'var(--color-terracotta)', fontWeight: 'bold', textAlign: 'center' }}>
            {uiError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-16)' }}>
          <button onClick={handleCreateTestUsers} disabled={!isReady}>Create Test Users</button>
          <button className="primary" onClick={handleSimulateExpense} disabled={!isReady}>Simulate Expense</button>
        </div>
      </div>
    </div>
  );
}

export default App;
