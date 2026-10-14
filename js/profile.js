/**
 * Personal profile — the "Ask me" flow.
 *
 * A short set of questions the user answers once. The answers are stored in
 * their own Puter key-value entry and folded into the system prompt on every
 * request, so replies are tailored without the user repeating themselves.
 */

import { asText } from './ai.js';

export const KEY = 'profile';

export const TONES = [
  { id: 'concise', label: 'Concise', hint: 'Short answers, no preamble.' },
  { id: 'balanced', label: 'Balanced', hint: 'Direct, but explains when it matters.' },
  { id: 'detailed', label: 'Detailed', hint: 'Thorough, with reasoning and examples.' },
];

export const BLANK_PROFILE = {
  name: '',
  role: '',
  tone: 'balanced',
  goals: '',
  avoid: '',
};

/**
 * True when the user has answered enough for it to be worth sending.
 * A non-default tone counts on its own — picking "Concise" is a real choice
 * even if they never typed anything else.
 */
export function hasProfile(p) {
  if (!p) return false;
  const prof = normalise(p);
  if (prof.tone !== 'balanced') return true;
  return !!(prof.name || prof.role || prof.goals || prof.avoid);
}

/** Normalise whatever came out of storage into a predictable shape. */
export function normalise(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const tone = TONES.some((t) => t.id === p.tone) ? p.tone : 'balanced';
  return {
    name: asText(p.name, ''),
    role: asText(p.role, ''),
    tone,
    goals: asText(p.goals, ''),
    avoid: asText(p.avoid, ''),
  };
}

/**
 * Turn the profile into a short instruction block appended to the system
 * prompt. Returns '' when there's nothing useful to say, so an unanswered
 * profile adds no tokens to every request.
 */
export function profilePrompt(p) {
  const prof = normalise(p);
  if (!hasProfile(prof)) return '';

  const lines = [];
  if (prof.name) lines.push(`The user's name is ${prof.name}.`);
  if (prof.role) lines.push(`They work in or are interested in: ${prof.role}.`);

  const tone = TONES.find((t) => t.id === prof.tone);
  if (tone && tone.id !== 'balanced') lines.push(`They prefer ${tone.label.toLowerCase()} answers.${tone.hint ? ` ${tone.hint}` : ''}`);

  if (prof.goals) lines.push(`What they are currently trying to do: ${prof.goals}.`);
  if (prof.avoid) lines.push(`Avoid: ${prof.avoid}.`);

  if (!lines.length) return '';
  return `About the user:\n- ${lines.join('\n- ')}`;
}

/** Base prompt + profile block. */
export function effectiveSystemPrompt(basePrompt, profile) {
  const extra = profilePrompt(profile);
  const base = asText(basePrompt, '').trim();
  if (!extra) return base;
  return base ? `${base}\n\n${extra}` : extra;
}

/** One-line summary for the sidebar. */
export function profileSummary(p) {
  const prof = normalise(p);
  if (!hasProfile(prof)) return '';
  if (prof.name) return prof.name;
  if (prof.role) return prof.role;
  return 'Personalised';
}