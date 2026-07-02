import { useState, useId } from 'react';
import { motion } from 'framer-motion';
import * as SpacetimeDB from '../spacetimedb';

const EO = [0.23, 1, 0.32, 1] as const;

const INPUT: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: '10px', padding: '10px 14px',
  color: 'white', fontSize: '0.9rem', outline: 'none',
  transition: 'border-color 180ms ease',
  fontFamily: 'inherit',
};
const BTN_PRIMARY: React.CSSProperties = {
  background: 'linear-gradient(135deg, #d98a6c 0%, #bf6645 100%)', // Terracotta theme
  color: '#ffffff', border: 'none', borderRadius: '10px',
  padding: '10px 20px', fontWeight: 700, fontSize: '0.9rem',
  cursor: 'pointer', flexShrink: 0, display: 'flex',
  alignItems: 'center', justifyContent: 'center', gap: '8px', whiteSpace: 'nowrap',
  transition: 'opacity 160ms ease, transform 160ms ease',
  fontFamily: 'inherit',
};
const BTN_GHOST: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#999', borderRadius: '10px',
  padding: '10px 18px', fontWeight: 600,
  fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0,
  transition: 'background 160ms ease, color 160ms ease',
  fontFamily: 'inherit',
};

const Spinner = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ animation: 'simpli-spin 0.7s linear infinite' }}>
    <style>{`@keyframes simpli-spin { to { transform:rotate(360deg) } }`}</style>
    <circle cx="9" cy="9" r="7" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
    <path d="M9 2a7 7 0 0 1 7 7" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

interface Props {
  tripId: string;
  tripName: string;
  onClose: () => void;
}

export const ExpenseModal = ({ tripId, tripName, onClose }: Props) => {
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [expenseType, setExpenseType] = useState<'group' | 'personal'>('group');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const uid = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const c = SpacetimeDB.conn as any;
    if (!c) { setErr('Not connected.'); return; }
    
    const amount = parseFloat(amt);
    if (!desc.trim() || isNaN(amount) || amount <= 0) {
      setErr('Enter a valid description and amount.'); 
      return;
    }
    
    setLoading(true);
    try {
      const identity = SpacetimeDB.localIdentity ?? 'unknown';
      const isPersonal = expenseType === 'personal';
      
      c.reducers.addExpense({
        expenseId: `exp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        tripId, 
        amount,
        description: desc.trim(),
        isPersonal: isPersonal,
        splits: isPersonal ? '[]' : JSON.stringify([{ debtor_id: identity, amount_owed: amount }]),
      });
      onClose();
    } catch (e: any) { 
      setErr(e?.message ?? 'Failed to add expense.'); 
    } finally { 
      setLoading(false); 
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }} onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 300,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
      }}
    >
      <motion.form
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.22, ease: EO }}
        onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{
          width: '100%', maxWidth: '440px',
          background: 'rgba(14,18,16,0.97)',
          border: '1px solid rgba(156,174,169,0.18)',
          borderRadius: '20px', padding: '32px',
          display: 'flex', flexDirection: 'column', gap: '24px',
          boxShadow: '0 32px 80px rgba(0,0,0,0.9), 0 0 0 1px rgba(156,174,169,0.05)',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f8f9fa' }}>Manage Expenses</h2>
          <p style={{ margin: '4px 0 0', color: '#8e8e93', fontSize: '0.85rem' }}>{tripName}</p>
        </div>

        {/* Group / Personal Toggle */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '12px', padding: '4px', gap: '4px' }}>
          {(['group', 'personal'] as const).map(opt => (
            <button key={opt} type="button" onClick={() => setExpenseType(opt)}
              style={{
                flex: 1, padding: '8px 12px', borderRadius: '8px', border: 'none',
                cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                fontFamily: 'inherit', textTransform: 'capitalize',
                transition: 'background 200ms ease, color 200ms ease',
                background: expenseType === opt ? 'rgba(156,174,169,0.15)' : 'transparent',
                color: expenseType === opt ? '#9bafa4' : '#8e8e93',
              }}>
              {opt === 'group' ? 'Group Split' : 'Personal'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label htmlFor={`${uid}-d`} style={{ display: 'block', fontSize: '0.8rem', color: '#8e8e93', marginBottom: '8px', fontWeight: 500 }}>Description</label>
            <input id={`${uid}-d`} value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="Dinner, Airbnb, taxi…" style={INPUT} autoFocus />
          </div>
          <div>
            <label htmlFor={`${uid}-a`} style={{ display: 'block', fontSize: '0.8rem', color: '#8e8e93', marginBottom: '8px', fontWeight: 500 }}>Amount ($)</label>
            <input id={`${uid}-a`} type="number" min="0.01" step="0.01" value={amt}
              onChange={e => setAmt(e.target.value)} placeholder="0.00" style={INPUT} />
          </div>
        </div>

        {expenseType === 'group' && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#9bafa4', background: 'rgba(156,174,169,0.08)', padding: '12px 14px', borderRadius: '10px', lineHeight: 1.4 }}>
            Amount will be split equally among all current trip members.
          </p>
        )}

        {err && <p style={{ margin: 0, color: '#d98a6c', fontSize: '0.85rem', fontWeight: 600 }}>⚠ {err}</p>}

        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button type="button" onClick={onClose} style={BTN_GHOST}>Cancel</button>
          <button type="submit" disabled={loading} style={{ ...BTN_PRIMARY, flex: 1 }}>
            {loading ? <Spinner /> : 'Add Expense'}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
};
