"use client";

/* Per-team colour pairs.
 *
 * Sleeper assigns every team a colour, but all twelve come out at the SAME
 * lightness and saturation (L 0.62 / S 0.55) with only hue moving — and the
 * hues are not spread. Five teams sat inside a 59-degree green-teal band, with
 * ComeComeInc (163) and Maher's Masterclass (168) five degrees apart. Fine for
 * a dot beside a name; useless as a theme driver, and no amount of lightening
 * or darkening separates two colours that differ only in hue by five degrees.
 *
 * So these are authored, not derived. Each hue was respread to a 22-degree
 * minimum gap (seven teams moved, the largest by 17 degrees; five kept their
 * original hue), then split into a pair:
 *
 *   bright  oklch(78% 0.15 H)   carries on the dark ground
 *   deep    oklch(45% 0.13 H)   carries on the light one
 *
 * Both halves are needed because a single colour cannot do both jobs: the
 * bright half on paper is invisible, the deep half on the dark rail is mud.
 *
 * Keyed by owner_id rather than team name — managers rename their teams and
 * the colour should not follow the rename. */

export type TeamPair = { bright: string; deep: string };

export const TEAM_PAIRS: Record<string, TeamPair> = {
  "865838323556532224":  { bright: "#ff9b50", deep: "#893c00" }, // team beast mode
  "1052433402583986176": { bright: "#e3ae28", deep: "#764c00" }, // Jolly Green Giants
  "1028025229290946560": { bright: "#bebf3a", deep: "#5b5a00" }, // Ram Ranch Cowboys
  "1052435364662722560": { bright: "#93cb60", deep: "#386300" }, // Rassel's Rascals
  "1028010692307226624": { bright: "#59d38c", deep: "#006933" }, // ComeComeInc
  "1099478733125197824": { bright: "#00d6b6", deep: "#006b54" }, // Maher's Masterclass
  "1028023491355942912": { bright: "#00d3dd", deep: "#006871" }, // The Fanclub
  "1052431510193700864": { bright: "#00cafe", deep: "#00628a" }, // Bloomington 69ers
  "1028007224301477888": { bright: "#79b8ff", deep: "#21539c" }, // Payton's Powerhouse
  "1052435508162383872": { bright: "#aea8ff", deep: "#504799" }, // The Unlimiteds
  "1028006706866921472": { bright: "#db98f9", deep: "#703a86" }, // Eggwolls
  "1028019198414483456": { bright: "#f68fd5", deep: "#82326c" }, // stink feet balls
};

export const pairFor = (ownerId?: string | null): TeamPair | null =>
  (ownerId && TEAM_PAIRS[ownerId]) || null;

/* Both halves are published as separate properties and globals.css picks
   between them per theme. Choosing in JS would mean re-running on every theme
   toggle — and the toggle is a class on <html>, which CSS can see and a React
   effect cannot without subscribing to it. */
export function teamVars(ownerId?: string | null): React.CSSProperties | undefined {
  const p = pairFor(ownerId);
  if (!p) return undefined;
  return { "--team-bright": p.bright, "--team-deep": p.deep } as React.CSSProperties;
}
