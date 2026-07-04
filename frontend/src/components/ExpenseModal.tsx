import { useState, useId, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import * as StDB from '../spacetimedb';
import { toast } from './Toast';
import type { Expense, ExpenseSplit } from '../module_bindings/types';

const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v);

const S: Record<string, React.CSSProperties> = {
  input: {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--glass)',
    border: '1px solid var(--glass-brd)',
    borderRadius: '14px', padding: '12px 16px',
    color: 'var(--text)', fontSize: '1rem', outline: 'none',
    fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums',
    transition: 'border-color var(--dur-micro) ease',
  },
};

const norm = (s: any) => String(s ?? '').toLowerCase().trim();

type SplitMode = 'equally' | 'unequal' | 'shares' | 'personal';

interface MemberRow { id: string; name: string; }
interface Props {
  tripId: string;
  tripMembers: MemberRow[];
  onClose: () => void;
  editExpense?: Expense & { splits: ExpenseSplit[] };
}

const Spinner = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ animation: 's-spin 0.7s linear infinite' }}>
    <style>{`@keyframes s-spin{to{transform:rotate(360deg)}}`}</style>
    <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" strokeWidth="2" />
    <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const ExpenseModal = ({ tripId, tripMembers, onClose, editExpense }: Props) => {
  const uid = useId();
  const isEdit = !!editExpense;

  // Infer initial split mode from editExpense
  const inferMode = (): SplitMode => {
    if (!editExpense) return 'equally';
    if (editExpense.splits.length === 0) return 'personal';
    const amounts = editExpense.splits.map(s => s.amountOwed);
    const allEqual = amounts.every(a => Math.abs(a - amounts[0]) < 0.01);
    return allEqual ? 'equally' : 'unequal';
  };

  const [desc, setDesc] = useState(editExpense?.description ?? '');
  const [amt, setAmt] = useState(editExpense ? String(editExpense.amount) : '');
  const [mode, setMode] = useState<SplitMode>(inferMode);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const localId = norm(StDB.localIdentity ?? '');

  // Selected participants (default: all members)
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (editExpense && editExpense.splits.length > 0) {
      return new Set(editExpense.splits.map(s => s.debtorId));
    }
    return new Set(tripMembers.map(m => m.id));
  });

  // Per-member unequal amounts
  const [unequalAmts, setUnequalAmts] = useState<Record<string, string>>(() => {
    if (editExpense && editExpense.splits.length > 0) {
      const obj: Record<string, string> = {};
      editExpense.splits.forEach(s => { obj[s.debtorId] = String(s.amountOwed); });
      return obj;
    }
    return {};
  });

  // Per-member shares
  const [shares, setShares] = useState<Record<string, string>>(() => {
    const obj: Record<string, string> = {};
    tripMembers.forEach(m => { obj[m.id] = '1'; });
    return obj;
  });

  const totalAmt = parseFloat(amt) || 0;
  const selectedArr = tripMembers.filter(m => selected.has(m.id));

  // Live "remaining" for unequal
  const unequalSum = selectedArr.reduce((s, m) => s + (parseFloat(unequalAmts[m.id] || '0') || 0), 0);
  const remaining = Math.round((totalAmt - unequalSum) * 100) / 100;

  // Computed amounts for shares mode
  const totalShares = selectedArr.reduce((s, m) => s + (parseInt(shares[m.id] || '1') || 1), 0);
  const shareAmounts: Record<string, number> = {};
  if (mode === 'shares' && selectedArr.length > 0) {
    let accum = 0;
    selectedArr.forEach((m, i) => {
      const s = parseInt(shares[m.id] || '1') || 1;
      const a = i === selectedArr.length - 1
        ? Math.round((totalAmt - accum) * 100) / 100
        : Math.round((totalAmt * s / totalShares) * 100) / 100;
      shareAmounts[m.id] = a;
      accum += a;
    });
  }

  const buildSplitsArr = (): { debtor_id: string; amount_owed: number }[] => {
    if (mode === 'personal') return [];
    if (mode === 'equally') {
      const per = Math.floor((totalAmt / selectedArr.length) * 100) / 100;
      const drift = Math.round((totalAmt - per * selectedArr.length) * 100) / 100;
      return selectedArr.map((m, i) => ({
        debtor_id: m.id,
        amount_owed: i === 0 ? Math.round((per + drift) * 100) / 100 : per,
      }));
    }
    if (mode === 'unequal') {
      return selectedArr.map(m => ({
        debtor_id: m.id,
        amount_owed: Math.round((parseFloat(unequalAmts[m.id] || '0') || 0) * 100) / 100,
      }));
    }
    if (mode === 'shares') {
      return selectedArr.map(m => ({ debtor_id: m.id, amount_owed: shareAmounts[m.id] || 0 }));
    }
    return [];
  };

  const canSubmit = (() => {
    if (!desc.trim() || !totalAmt || totalAmt <= 0) return false;
    if (mode === 'equally' || mode === 'personal') return true;
    if (mode === 'unequal') return Math.abs(remaining) < 0.005 && selectedArr.length > 0;
    if (mode === 'shares') return selectedArr.length > 0;
    return false;
  })();

  // Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const submit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setErr(null);
    const c = StDB.conn as any;
    if (!c) { setErr('Not connected.'); return; }

    const splitsArr = buildSplitsArr();
    const splitsJson = JSON.stringify(splitsArr);

    setLoading(true);
    try {
      if (isEdit && editExpense) {
        await c.reducers.updateExpense({
          expenseId: editExpense.id,
          amount: totalAmt,
          description: desc.trim(),
          splits: splitsJson,
        });
        toast.success('Expense updated');
      } else {
        const expenseId = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await c.reducers.addExpense({
          expenseId,
          tripId,
          amount: totalAmt,
          description: desc.trim(),
          splits: splitsJson,
        });
        toast.success(`Added ${INR(totalAmt)}`);
      }
      onClose();
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to save expense';
      setErr(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [canSubmit, desc, totalAmt, mode, selectedArr, isEdit, editExpense, tripId, onClose]);

  const toggleMember = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) { if (next.size > 1) next.delete(id); }
      else next.add(id);
      return next;
    });
  };

  const modes: { key: SplitMode; label: string }[] = [
    { key: 'equally', label: 'Equally' },
    { key: 'unequal', label: 'Unequal' },
    { key: 'shares', label: 'Shares' },
    { key: 'personal', label: 'Personal' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      pointerEvents: 'all',
    }}>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onClick={onClose}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
      />
      <motion.form
        onSubmit={submit}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="glass-panel"
        style={{
          position: 'relative', width: '100%', maxWidth: '560px',
          maxHeight: '70vh', overflowY: 'auto',
          borderRadius: '26px 26px 0 0', padding: '24px',
          display: 'flex', flexDirection: 'column', gap: '20px',
          background: 'rgba(5, 6, 10, 0.95)',
          boxShadow: '0 -24px 64px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      >
        <div style={{ width: '40px', height: '4px', background: 'var(--glass-hi)', borderRadius: '2px', margin: '-8px auto 12px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="font-clash" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}>
            {isEdit ? 'Edit expense' : 'Add expense'}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: '1.5rem', width: 32, height: 32, padding: 0 }}>×</button>
        </div>

        {/* Split mode tabs */}
        <div className="glass-pill" style={{ display: 'flex', padding: '4px', gap: '4px' }}>
          {modes.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setMode(key)} style={{
              flex: 1, padding: '8px 12px', borderRadius: '999px', border: 'none',
              cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', fontFamily: 'inherit',
              transition: 'all var(--dur-micro) ease',
              background: mode === key ? 'var(--glass)' : 'transparent',
              color: mode === key ? 'var(--text)' : 'var(--text-dim)',
              boxShadow: mode === key ? 'inset 0 1px 0 var(--glass-hi)' : 'none',
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* Description */}
        <div>
          <label htmlFor={`${uid}-d`} style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 600 }}>Description</label>
          <input id={`${uid}-d`} value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Airbnb, dinner, taxi…" style={S.input} autoFocus />
        </div>

        {/* Amount */}
        <div>
          <label htmlFor={`${uid}-a`} style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 600 }}>Amount (₹)</label>
          <input id={`${uid}-a`} type="number" min="0.01" step="0.01" value={amt}
            onChange={e => setAmt(e.target.value)} placeholder="0.00" style={S.input} className="money" />
        </div>

        {/* Participants (show unless personal) */}
        {mode !== 'personal' && tripMembers.length > 0 && (
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 600 }}>Participants</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {tripMembers.map(m => (
                <button key={m.id} type="button" onClick={() => toggleMember(m.id)} style={{
                  padding: '6px 14px', borderRadius: '999px', border: '1px solid',
                  borderColor: selected.has(m.id) ? 'transparent' : 'var(--glass-brd)',
                  background: selected.has(m.id) ? 'var(--primary)' : 'transparent',
                  color: selected.has(m.id) ? '#050a08' : 'var(--text-dim)',
                  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all var(--dur-micro) ease',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  {selected.has(m.id) && <span style={{ fontSize: '0.75rem', fontWeight: 800 }}>✓</span>}
                  {m.id === localId ? 'You' : m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Unequal inputs */}
        {mode === 'unequal' && selectedArr.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {selectedArr.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text)', fontWeight: 500 }}>{m.id === localId ? 'You' : m.name}</span>
                <input type="number" min="0" step="0.01"
                  value={unequalAmts[m.id] ?? ''}
                  onChange={e => setUnequalAmts(prev => ({ ...prev, [m.id]: e.target.value }))}
                  placeholder="0.00"
                  style={{ ...S.input, width: '120px', textAlign: 'right' }} className="money" />
              </div>
            ))}
            <div className="money" style={{
              textAlign: 'right', fontSize: '0.85rem', fontWeight: 700,
              color: Math.abs(remaining) < 0.005 ? 'var(--owed)' : 'var(--owe)',
            }}>
              {Math.abs(remaining) < 0.005 ? '✓ Balanced' : `${remaining > 0 ? '+' : ''}${INR(remaining)} remaining`}
            </div>
          </div>
        )}

        {/* Shares inputs */}
        {mode === 'shares' && selectedArr.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {selectedArr.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text)', fontWeight: 500 }}>{m.id === localId ? 'You' : m.name}</span>
                <div className="money" style={{ fontSize: '0.85rem', color: 'var(--text-dim)', width: '80px', textAlign: 'right' }}>
                  {totalAmt > 0 ? INR(shareAmounts[m.id] ?? 0) : ''}
                </div>
                <input type="number" min="1" step="1"
                  value={shares[m.id] ?? '1'}
                  onChange={e => setShares(prev => ({ ...prev, [m.id]: e.target.value }))}
                  style={{ ...S.input, width: '70px', textAlign: 'center' }} />
                <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>share{parseInt(shares[m.id] || '1') !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* Equally info */}
        {mode === 'equally' && selectedArr.length > 0 && totalAmt > 0 && (
          <p className="glass-panel" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--glass-brd)' }}>
            <span className="money">{INR(totalAmt / selectedArr.length)}</span> each across {selectedArr.length} participant{selectedArr.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* Personal info */}
        {mode === 'personal' && (
          <p className="glass-panel" style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-dim)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--glass-brd)' }}>
            Tracked for you only — not split with anyone.
          </p>
        )}

        {err && <p style={{ margin: 0, color: 'var(--owe)', fontSize: '0.85rem', fontWeight: 600 }}>⚠ {err}</p>}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1 }}>Cancel</button>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary" style={{ flex: 2, opacity: (loading || !canSubmit) ? 0.5 : 1 }}>
            {loading ? <Spinner /> : isEdit ? 'Save Changes' : 'Add Expense'}
          </button>
        </div>
      </motion.form>
    </div>
  );
};
