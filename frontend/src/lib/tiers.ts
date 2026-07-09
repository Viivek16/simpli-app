// Single source of truth for gamification tiers.
//
// Both the profile modal and the leaderboard resolve a user's tier through THIS
// function so the same person always shows the same tier in both places. All
// inputs are server-derived (never localStorage), so tiers are consistent across
// devices and between users.
//
// Signals (all from the live SpacetimeDB tables):
//   added   = number of non-settlement expenses this user PAID
//   settled = number of settlement payments this user made
//   trips   = number of distinct groups this user belongs to
//
// Ladder, highest → lowest. resolveTier checks top-down and returns the first
// match, so the boundaries below are the exact thresholds for each tier:
//   Cosmic Legend — added ≥ 10 AND settled ≥ 3   (mastery: heavy activity + settling)
//   Initiator     — trips ≥ 3  OR  added ≥ 6      (starts/drives multiple groups)
//   Controller    — added ≥ 3                     (actively manages expenses)
//   Peacemaker    — settled ≥ 2                   (keeps the group settled up)
//   Explorer      — added ≥ 1  OR  trips ≥ 1      (has joined in)
//   Newbie        — otherwise                     (no activity yet)

export interface Tier {
  key: string;
  name: string;
  color: string;
  prefix: string;      // e.g. "Congrats, you are a"
  description: string;
}

export const TIERS: Record<string, Tier> = {
  cosmicLegend: {
    key: 'cosmicLegend', name: 'Cosmic Legend', color: '#FFC46B',
    prefix: 'Congrats, you are a',
    description: 'A legendary master of the cosmos — vast groups, flawless settlements, every debt cleared with ease.',
  },
  initiator: {
    key: 'initiator', name: 'Initiator', color: '#B79CFF',
    prefix: 'Congrats, you are an',
    description: 'You bring people together and spark new journeys across the universe.',
  },
  controller: {
    key: 'controller', name: 'Controller', color: '#5EE6FF',
    prefix: 'Congrats, you are a',
    description: 'You like to manage groups, stay on top of every expense, and settle them up ASAP.',
  },
  peacemaker: {
    key: 'peacemaker', name: 'Peacemaker', color: '#6FE29B',
    prefix: 'Congrats, you are a',
    description: 'You restore balance to the cosmos by swiftly settling debts and keeping the peace.',
  },
  explorer: {
    key: 'explorer', name: 'Explorer', color: '#FFB74D',
    prefix: 'Nice, you are an',
    description: 'You are charting new territory and joining group adventures.',
  },
  newbie: {
    key: 'newbie', name: 'Newbie', color: '#9AA3B2',
    prefix: 'Welcome, you are a',
    description: 'Go explore the trenches of SIMPLI — join a galaxy and start adding expenses.',
  },
};

export function resolveTier(added: number, settled: number, trips: number): Tier {
  if (added >= 10 && settled >= 3) return TIERS.cosmicLegend;
  if (trips >= 3 || added >= 6) return TIERS.initiator;
  if (added >= 3) return TIERS.controller;
  if (settled >= 2) return TIERS.peacemaker;
  if (added >= 1 || trips >= 1) return TIERS.explorer;
  return TIERS.newbie;
}
