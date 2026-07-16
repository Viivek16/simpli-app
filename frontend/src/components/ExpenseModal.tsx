import { useState, useId, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import * as StDB from '../spacetimedb';
import { toast } from './Toast';
import type { Expense, ExpenseSplit } from '../module_bindings/types';
import { AudioService } from '../audio';
import { notifyServer } from '../push';

const INR = (v: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(v);

const S: Record<string, React.CSSProperties> = {
  input: {
    width: '100%', boxSizing: 'border-box',
    background: 'var(--glass)',
    border: '1px solid var(--glass-brd)',
    borderRadius: '12px', padding: '12px 16px',
    color: 'var(--text)', fontSize: '1rem', outline: 'none',
    fontFamily: 'inherit', fontVariantNumeric: 'tabular-nums',
    transition: 'border-color var(--dur-micro) ease',
  },
};

const norm = (s: any) => String(s ?? '').toLowerCase().trim();

type SplitMode = 'equally' | 'unequal' | 'personal';

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

  const localId = norm(StDB.getLocalId() ?? '');
  const [payerId, setPayerId] = useState(() => editExpense ? norm(editExpense.payerId) : localId);

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

  const totalAmt = parseFloat(amt) || 0;
  const selectedArr = tripMembers.filter(m => selected.has(m.id));

  // Live "remaining" for unequal
  const unequalSum = selectedArr.reduce((s, m) => s + (parseFloat(unequalAmts[m.id] || '0') || 0), 0);
  const remaining = Math.round((totalAmt - unequalSum) * 100) / 100;

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
    return [];
  };

  const canSubmit = (() => {
    if (!desc.trim() || !totalAmt || totalAmt <= 0) return false;
    if (mode === 'personal') return true;
    if (mode === 'equally') return selectedArr.length > 0;
    if (mode === 'unequal') return Math.abs(remaining) < 0.005 && selectedArr.length > 0;
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
    const splitsJson = JSON.stringify({ payer_id: payerId, splits: splitsArr });

    setLoading(true);
    try {
      if (isEdit && editExpense) {
        await c.reducers.updateExpense({
          expenseId: editExpense.id,
          amount: totalAmt,
          description: desc.trim(),
          splits: splitsJson,
        });
        AudioService.playBlip();
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
        // The reducer has committed, so the row is readable by the push sender.
        notifyServer({ kind: 'expense', tripId, expenseId });
        AudioService.playBlip();
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
    { key: 'personal', label: 'Personal' },
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px',
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
        initial={{ y: 20, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="glass-panel"
        style={{
          position: 'relative', width: '100%', maxWidth: '520px',
          maxHeight: '85vh', overflowY: 'auto',
          borderRadius: '18px', padding: '24px', margin: '0 16px',
          display: 'flex', flexDirection: 'column', gap: '20px',
          background: 'rgba(10, 12, 16, 0.95)',
          boxShadow: '0 32px 64px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.05)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="font-clash" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--text)' }}>
            {isEdit ? 'Edit expense' : 'Add expense'}
          </h2>
          <button type="button" onClick={onClose} className="btn-ghost" style={{ fontSize: '1.5rem', width: 32, height: 32, padding: 0 }}>×</button>
        </div>

        {/* Split mode tabs */}
        <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid var(--glass-brd)', paddingBottom: '8px' }}>
          {modes.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setMode(key)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: '0.85rem', fontFamily: 'inherit',
              padding: '4px 0', position: 'relative',
              color: mode === key ? 'var(--text)' : 'var(--text-dim)',
              transition: 'color var(--dur-micro) ease',
            }}>
              {label}
              {mode === key && (
                <motion.div
                  layoutId="activeTab"
                  style={{ position: 'absolute', bottom: -9, left: 0, right: 0, height: 2, background: 'var(--owed)', borderRadius: 2 }}
                />
              )}
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

        {/* Paid By (show unless personal) */}
        {mode !== 'personal' && tripMembers.length > 0 && (
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 600 }}>Paid by</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
              {tripMembers.map(m => (
                <button key={'payer-' + m.id} type="button" onClick={() => setPayerId(m.id)} style={{
                  padding: '6px 14px', borderRadius: '12px',
                  border: '1px solid',
                  borderColor: payerId === m.id ? 'var(--owed)' : 'var(--glass-brd)',
                  background: payerId === m.id ? 'rgba(111,186,138,0.1)' : 'transparent',
                  color: payerId === m.id ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all var(--dur-micro) ease',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  {payerId === m.id && <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--owed)' }}>✓</span>}
                  {m.id === localId ? 'You' : m.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Participants (show unless personal) */}
        {mode !== 'personal' && tripMembers.length > 0 && (
          <div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '8px', fontWeight: 600 }}>Participants</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {tripMembers.map(m => (
                <button key={m.id} type="button" onClick={() => toggleMember(m.id)} style={{
                  padding: '6px 14px', borderRadius: '12px',
                  border: '1px solid',
                  borderColor: selected.has(m.id) ? 'var(--owed)' : 'var(--glass-brd)',
                  background: selected.has(m.id) ? 'rgba(111,186,138,0.1)' : 'transparent',
                  color: selected.has(m.id) ? 'var(--text)' : 'var(--text-dim)',
                  fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all var(--dur-micro) ease',
                  display: 'flex', alignItems: 'center', gap: '6px'
                }}>
                  {selected.has(m.id) && <span style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--owed)' }}>✓</span>}
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
        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
          <button type="button" onClick={onClose} className="btn-secondary" style={{ flex: 1, height: '44px', borderRadius: '12px', fontSize: '0.95rem' }}>Cancel</button>
          <button type="submit" disabled={loading || !canSubmit} className="btn-primary" style={{ flex: 1, height: '44px', borderRadius: '12px', fontSize: '0.95rem', opacity: (loading || !canSubmit) ? 0.5 : 1, background: '#FFB74D', color: '#ffffff', boxShadow: '0 0 24px rgba(255, 183, 77, 0.4)' }}>
            {loading ? <Spinner /> : isEdit ? 'Save Changes' : 'Add Expense'}
          </button>
        </div>
      </motion.form>
    </div>
  );
};
