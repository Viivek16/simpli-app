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
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px', padding: '10px 14px',
    color: 'white', fontSize: '0.9rem', outline: 'none',
    fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums',
    transition: 'border-color 180ms ease',
  },
  btnPrimary: {
    background: 'linear-gradient(135deg, #9bafa4 0%, #6d8f84 100%)',
    color: '#050a08', border: 'none', borderRadius: '10px',
    padding: '11px 22px', fontWeight: 700, fontSize: '0.9rem',
    cursor: 'pointer', flexShrink: 0, display: 'flex',
    alignItems: 'center', justifyContent: 'center', gap: '8px',
    fontFamily: 'inherit', transition: 'opacity 160ms ease',
  },
  btnGhost: {
    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#999', borderRadius: '10px', padding: '11px 18px', fontWeight: 600,
    fontSize: '0.9rem', cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
    transition: 'background 160ms ease',
  },
};

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
        transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
        style={{
          position: 'relative', width: '100%', maxWidth: '560px',
          maxHeight: '56vh', overflowY: 'auto',
          background: 'rgba(12,14,13,0.92)', borderTop: '1px solid rgba(255,255,255,0.08)',
          borderLeft: '1px solid rgba(255,255,255,0.08)', borderRight: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '22px 22px 0 0', padding: '24px 28px',
          display: 'flex', flexDirection: 'column', gap: '20px',
          boxShadow: '0 -20px 80px rgba(0,0,0,0.8)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)'
        }}
      >
        <div style={{ width: '40px', height: '4px', background: 'rgba(255,255,255,0.15)', borderRadius: '2px', margin: '-10px auto 10px' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#e0e8e5' }}>
            {isEdit ? 'Edit expense' : 'Add expense'}
          </h2>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: '1.5rem', cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>×</button>
        </div>

        {/* Split mode tabs */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.04)', borderRadius: '10px', padding: '3px', gap: '2px' }}>
          {modes.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setMode(key)} style={{
              flex: 1, padding: '7px 8px', borderRadius: '7px', border: 'none',
              cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem', fontFamily: 'inherit',
              transition: 'background 180ms ease, color 180ms ease',
              background: mode === key ? 'rgba(156,174,169,0.18)' : 'transparent',
              color: mode === key ? '#9bafa4' : '#666',
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* Description */}
        <div>
          <label htmlFor={`${uid}-d`} style={{ display: 'block', fontSize: '0.75rem', color: '#8e8e93', marginBottom: '6px', fontWeight: 600 }}>Description</label>
          <input id={`${uid}-d`} value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Airbnb, dinner, taxi…" style={S.input} autoFocus />
        </div>

        {/* Amount */}
        <div>
          <label htmlFor={`${uid}-a`} style={{ display: 'block', fontSize: '0.75rem', color: '#8e8e93', marginBottom: '6px', fontWeight: 600 }}>Amount (₹)</label>
          <input id={`${uid}-a`} type="number" min="0.01" step="0.01" value={amt}
            onChange={e => setAmt(e.target.value)} placeholder="0.00" style={S.input} />
        </div>

        {/* Participants (show unless personal) */}
        {mode !== 'personal' && tripMembers.length > 0 && (
          <div>
            <div style={{ fontSize: '0.75rem', color: '#8e8e93', marginBottom: '8px', fontWeight: 600 }}>Participants</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {tripMembers.map(m => (
                <button key={m.id} type="button" onClick={() => toggleMember(m.id)} style={{
                  padding: '5px 12px', borderRadius: '20px', border: '1px solid',
                  borderColor: selected.has(m.id) ? '#9bafa4' : 'rgba(255,255,255,0.1)',
                  background: selected.has(m.id) ? 'rgba(156,174,169,0.15)' : 'transparent',
                  color: selected.has(m.id) ? '#9bafa4' : '#666',
                  fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 150ms ease',
                }}>
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Unequal inputs */}
        {mode === 'unequal' && selectedArr.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedArr.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ flex: 1, fontSize: '0.88rem', color: '#c8d8d4', fontWeight: 500 }}>{m.name}</span>
                <input type="number" min="0" step="0.01"
                  value={unequalAmts[m.id] ?? ''}
                  onChange={e => setUnequalAmts(prev => ({ ...prev, [m.id]: e.target.value }))}
                  placeholder="0.00"
                  style={{ ...S.input, width: '110px', textAlign: 'right' }} />
              </div>
            ))}
            <div style={{
              textAlign: 'right', fontSize: '0.8rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: Math.abs(remaining) < 0.005 ? '#6fba8a' : '#d98a6c',
            }}>
              {Math.abs(remaining) < 0.005 ? '✓ Balanced' : `${remaining > 0 ? '+' : ''}${INR(remaining)} remaining`}
            </div>
          </div>
        )}

        {/* Shares inputs */}
        {mode === 'shares' && selectedArr.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {selectedArr.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ flex: 1, fontSize: '0.88rem', color: '#c8d8d4', fontWeight: 500 }}>{m.name}</span>
                <div style={{ fontSize: '0.8rem', color: '#8e8e93', width: '70px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {totalAmt > 0 ? INR(shareAmounts[m.id] ?? 0) : ''}
                </div>
                <input type="number" min="1" step="1"
                  value={shares[m.id] ?? '1'}
                  onChange={e => setShares(prev => ({ ...prev, [m.id]: e.target.value }))}
                  style={{ ...S.input, width: '64px', textAlign: 'center' }} />
                <span style={{ color: '#555', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>share{parseInt(shares[m.id] || '1') !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}

        {/* Equally info */}
        {mode === 'equally' && selectedArr.length > 0 && totalAmt > 0 && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#9bafa4', background: 'rgba(156,174,169,0.07)', padding: '10px 12px', borderRadius: '8px' }}>
            {INR(totalAmt / selectedArr.length)} each across {selectedArr.length} participant{selectedArr.length !== 1 ? 's' : ''}
          </p>
        )}

        {/* Personal info */}
        {mode === 'personal' && (
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#8e8e93', background: 'rgba(255,255,255,0.03)', padding: '10px 12px', borderRadius: '8px' }}>
            Tracked for you only — not split with anyone.
          </p>
        )}

        {err && <p style={{ margin: 0, color: '#d98a6c', fontSize: '0.85rem', fontWeight: 600 }}>⚠ {err}</p>}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
          <button type="button" onClick={onClose} style={S.btnGhost}>Cancel</button>
          <button type="submit" disabled={loading || !canSubmit} style={{ ...S.btnPrimary, flex: 1, opacity: (loading || !canSubmit) ? 0.5 : 1 }}>
            {loading ? <Spinner /> : isEdit ? 'Save Changes' : 'Add Expense'}
          </button>
        </div>
      </motion.form>
    </div>
  );
};
