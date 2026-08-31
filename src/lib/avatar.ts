import type { CSSProperties } from 'react';

/**
 * ===========================================================================
 *  One identity, one colour, everywhere
 * ===========================================================================
 *
 *  -- Why this is in `lib/` and not in a module -----------------------------
 *
 *  Because a person is the same person in every module, and the fallback drawn
 *  when they have no photograph is part of how colleagues recognise each other
 *  at a glance. Two modules deriving that colour differently means Ada is
 *  green in Projects and violet in Communication, which is worse than having
 *  no colour at all: it actively works against recognition.
 *
 *  Communication owned this function for one phase. It is here now because the
 *  shared `PersonAvatar` reads it, and that component is what every module
 *  should be rendering.
 */

/**
 * The tints an avatar fallback may take.
 *
 * Taken from the product's chart ramp rather than from Tailwind's palette, for
 * the reason the design system gives: `emerald-500` and friends are a
 * framework's colours, they were reached for 610 times across thirteen
 * modules, and several of them fail AA while carrying text. These are the same
 * nine hues the workspace uses for page icons, so a face and a folder sit in
 * one world.
 */
const AVATAR_TINTS = [
  '#2d9572', '#2c6fa7', '#d4a93f', '#b8730a',
  '#8b5cf6', '#0f766e', '#6366f1', '#c0392b',
];

/** A stable hue for an id. The same person is always the same colour. */
export function avatarTint(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_TINTS[Math.abs(hash) % AVATAR_TINTS.length];
}

/**
 * An avatar fallback: the hue as text on a wash of itself.
 *
 * Not a saturated block. A timeline is a column of forty of these, and forty
 * filled circles at full chroma is a screen with no focal point at all, which
 * is the fault the design system names first. The wash keeps the identity cue
 * and gives it back a tenth of the weight. It also fixes a real contrast
 * problem: white initials on the gold were 2.4:1.
 */
export function avatarStyle(id: string): CSSProperties {
  const tint = avatarTint(id);
  return {
    backgroundColor: `color-mix(in srgb, ${tint} 16%, transparent)`,
    color: tint,
  };
}
