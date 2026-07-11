/**
 * Onboarding — a short, gated, cinematic first-run journey.
 *
 * Client-side only: no DB writes, no reducer calls, no second WebGL canvas. It layers
 * DOM + SVG + framer-motion over the live cosmos (App keeps the canvas animating). All
 * gating and mounting is decided in App(); this component just plays the beats and, on
 * completion or global skip, calls onDone (which sets simpli_onboarded and hands off to
 * the real create field). Reduced motion drops bloom, drift, and constellation draws and
 * renders each motif in its final static state via initial={false}.
 */
import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

const EO = [0.22, 1, 0.36, 1] as const;

const FREQ = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'On trips and vacations', value: 'trips' },
  { label: 'Now and then', value: 'sometimes' },
];

// ── Motifs (SVG + framer). initial={false} => final static state (reduced motion). ──
const StarMotif = ({ reduce }: { reduce: boolean }) => (
  <svg width="128" height="104" viewBox="0 0 128 104" className="onb-motif" aria-hidden="true">
    <defs>
      <radialGradient id="onbStarGlow">
        <stop offset="0%" style={{ stopColor: 'var(--self)', stopOpacity: 0.85 }} />
        <stop offset="55%" style={{ stopColor: 'var(--self)', stopOpacity: 0.14 }} />
        <stop offset="100%" style={{ stopColor: 'var(--self)', stopOpacity: 0 }} />
      </radialGradient>
    </defs>
    <motion.circle cx="64" cy="52" r="34" fill="url(#onbStarGlow)"
      initial={reduce ? false : { opacity: 0, scale: 0.5 }} animate={{ opacity: 0.75, scale: 1 }}
      transition={{ duration: 1.1, ease: EO }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
    <motion.circle cx="64" cy="52" r="5.5" fill="#ffffff"
      initial={reduce ? false : { opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.8, ease: EO, delay: reduce ? 0 : 0.15 }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
  </svg>
);

// Three stars, the centre one clearly brighter (mirrors the app's weighted glow).
const GalaxyMotif = ({ reduce }: { reduce: boolean }) => (
  <svg width="184" height="112" viewBox="0 0 184 112" className="onb-motif" aria-hidden="true">
    <defs>
      <radialGradient id="onbCoreGlow">
        <stop offset="0%" style={{ stopColor: 'var(--self)', stopOpacity: 0.8 }} />
        <stop offset="60%" style={{ stopColor: 'var(--self)', stopOpacity: 0.12 }} />
        <stop offset="100%" style={{ stopColor: 'var(--self)', stopOpacity: 0 }} />
      </radialGradient>
    </defs>
    <motion.g initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, ease: EO }}>
      <ellipse cx="92" cy="56" rx="68" ry="20" fill="none" style={{ stroke: 'var(--accent)' }} strokeOpacity="0.14" strokeWidth="1" transform="rotate(-16 92 56)" />
      <ellipse cx="92" cy="56" rx="46" ry="13" fill="none" style={{ stroke: 'var(--accent)' }} strokeOpacity="0.10" strokeWidth="1" transform="rotate(-16 92 56)" />
    </motion.g>
    <motion.circle cx="44" cy="64" r="3.2" fill="#dfe6ff"
      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 0.55 }} transition={{ delay: reduce ? 0 : 0.2, duration: 0.6 }} />
    <circle cx="94" cy="48" r="19" fill="url(#onbCoreGlow)" />
    <motion.circle cx="94" cy="48" r="6" fill="#ffffff"
      initial={reduce ? false : { opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: reduce ? 0 : 0.35, duration: 0.7, ease: EO }} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
    <motion.circle cx="136" cy="66" r="3.6" fill="#dfe6ff"
      initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 0.6 }} transition={{ delay: reduce ? 0 : 0.28, duration: 0.6 }} />
  </svg>
);

// Two stars with a constellation line drawing between them; green owed, orange owe.
const ConstellationMotif = ({ reduce }: { reduce: boolean }) => (
  <svg width="212" height="120" viewBox="0 0 212 120" className="onb-motif" aria-hidden="true">
    <motion.line x1="58" y1="48" x2="154" y2="82" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.4" strokeLinecap="round"
      initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EO, delay: reduce ? 0 : 0.2 }} />
    <circle cx="58" cy="48" r="12" style={{ fill: 'var(--owed)' }} opacity="0.18" />
    <circle cx="58" cy="48" r="5" style={{ fill: 'var(--owed)' }} />
    <circle cx="154" cy="82" r="12" style={{ fill: 'var(--owe)' }} opacity="0.18" />
    <circle cx="154" cy="82" r="5" style={{ fill: 'var(--owe)' }} />
    <text x="58" y="28" textAnchor="middle" style={{ fill: 'var(--owed)', fontWeight: 700, fontSize: '13px', fontFamily: 'inherit' }}>+₹500</text>
    <text x="154" y="106" textAnchor="middle" style={{ fill: 'var(--owe)', fontWeight: 700, fontSize: '13px', fontFamily: 'inherit' }}>₹500</text>
  </svg>
);

export const Onboarding = ({ firstName, onDone }: { firstName: string; onDone: () => void }) => {
  const [beat, setBeat] = useState(0);
  const reduce = !!useReducedMotion();
  const next = () => setBeat(b => b + 1);

  // Selecting a frequency stores it; the per-beat Skip advances without storing.
  const pick = (value: string) => {
    try { localStorage.setItem('simpli_split_frequency', value); } catch {}
    next();
  };

  const beatMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 14 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -14 } };

  return (
    <motion.div
      className="onb-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.03 }}
      transition={{ duration: reduce ? 0.2 : 0.45, ease: EO }}
    >
      <AnimatePresence mode="wait">
        <motion.div key={beat} className="onb-beat" {...beatMotion} transition={{ duration: reduce ? 0.3 : 0.5, ease: EO }}>
          {beat === 0 && (
            <>
              <StarMotif reduce={reduce} />
              <h2 className="font-clash onb-title">Welcome to your cosmos, {firstName}.</h2>
              <p className="onb-body">A calmer way to split money with the people you travel, live, and hang out with.</p>
              <button className="onb-cta" onClick={next}>Continue</button>
            </>
          )}
          {beat === 1 && (
            <>
              <GalaxyMotif reduce={reduce} />
              <h2 className="font-clash onb-title">Every group is a galaxy.</h2>
              <p className="onb-body">Each person is a star. The more they are owed, the brighter they glow.</p>
              <button className="onb-cta" onClick={next}>Continue</button>
            </>
          )}
          {beat === 2 && (
            <>
              <h2 className="font-clash onb-title">How often do you split expenses?</h2>
              <div className="onb-pills">
                {FREQ.map(f => (
                  <button key={f.value} className="onb-pill" onClick={() => pick(f.value)}>{f.label}</button>
                ))}
              </div>
              <button className="onb-textlink" onClick={next}>Skip</button>
            </>
          )}
          {beat === 3 && (
            <>
              <ConstellationMotif reduce={reduce} />
              <h2 className="font-clash onb-title">Split anything in a tap.</h2>
              <p className="onb-body">
                Add an expense and the debts draw themselves as glowing constellations.{' '}
                <span style={{ color: 'var(--owed)', fontWeight: 600 }}>Green</span> means you are owed.{' '}
                <span style={{ color: 'var(--owe)', fontWeight: 600 }}>Orange</span> means you owe.
              </p>
              <button className="onb-cta" onClick={onDone}>Enter your cosmos.</button>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Global skip: subtle, from the metaphor beat onward (not on Welcome). */}
      {beat >= 1 && (
        <button className="onb-skip" onClick={onDone}>Skip intro</button>
      )}
    </motion.div>
  );
};
