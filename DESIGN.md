---
name: The Gridiron Grand Gambit Gala
description: A private fantasy league's own sports desk — warm-dark, tabular, hairline-ruled.
colors:
  press-tan: "oklch(74% 0.085 68)"
  press-tan-ink: "oklch(15.5% 0.014 62)"
  booth-dark: "oklch(15.5% 0.014 62)"
  booth-card: "oklch(19.5% 0.016 62)"
  booth-rail: "oklch(18.5% 0.016 62)"
  booth-raised: "oklch(23.5% 0.017 62)"
  newsprint: "oklch(96.5% 0.006 90)"
  margin-gray: "oklch(66% 0.015 70)"
  hairline: "oklch(92% 0.03 70 / 0.12)"
  win-green: "oklch(72% 0.11 158)"
  amber-flag: "oklch(66% 0.11 62)"
  loss-red: "oklch(58% 0.13 25)"
  kicker-violet: "oklch(63% 0.07 295)"
typography:
  display:
    fontFamily: "Axis Extrabold, Archivo, sans-serif"
    fontSize: "2.25rem"
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Axis Extrabold, Archivo, sans-serif"
    fontSize: "1.5rem"
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  stat:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
    fontFeature: "tnum"
  label:
    fontFamily: "Archivo, Helvetica Neue, Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    letterSpacing: "0.13em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
spacing:
  card-x: "12px"
  card-x-sm: "16px"
  card-y: "10px"
  card-y-sm: "12px"
components:
  button-primary:
    backgroundColor: "{colors.press-tan}"
    textColor: "{colors.press-tan-ink}"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.booth-raised}"
    textColor: "{colors.newsprint}"
    rounded: "{rounded.md}"
    height: "36px"
  stat-card:
    backgroundColor: "{colors.booth-card}"
    textColor: "{colors.newsprint}"
    rounded: "{rounded.lg}"
    padding: "10px 12px"
  pos-pill:
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
---

# Design System: The Gridiron Grand Gambit Gala

## Overview

**Creative North Star: "The Press Box"**

GGGG is a working reporter's booth above the field: a warm, low-lit room of hairline rules, tabular numbers and one tan accent for the on-air graphics. Information density is a feature. Managers come mid-game on a phone, so every surface is a scannable sheet of figures rather than a showpiece. Personality comes from the broadcast voice and the precision of the details, not from decoration.

The room is dark by default (warm brown, hue 62, never neutral gray or blue-black). Light mode is the same family run through the lightness axis, opt-in and sticky. Surfaces are flat. Depth comes from small tonal steps and near-invisible borders. The one exception is live game-day modules, which may lift or glow to say "this is happening now."

**Key Characteristics:**
- Warm-dark ground, single tan brand accent, semantic green/amber/red/violet for meaning only.
- Axis Extrabold for headings only; Archivo with tabular figures for everything else.
- Tiny tracked uppercase labels over bold tabular values: the stat-sheet grammar.
- Flat hairline surfaces; lift reserved for live state.
- Per-team accent (`--team`) can tint a page when a manager picks their team.

## Colors

A warm-brown booth with one tan on-air color, plus four semantic signals that always mean the same thing.

### Primary
- **Press Tan** (`press-tan`): The GGGG brand. Primary buttons, accent labels, active nav, link hover, the left rule on Notes. Unchanged since the vanilla site. In light mode it drops to `oklch(48% 0.09 58)` to stay legible on paper.

### Neutral
- **Booth Dark** (`booth-dark`): Page ground.
- **Booth Card** (`booth-card`): Cards and popovers, one step lighter than the page.
- **Booth Rail** (`booth-rail`): The sidebar. Lighter than the page in dark mode, darker in light mode.
- **Booth Raised** (`booth-raised`): Secondary/muted fills, segmented-control tracks, hover states.
- **Newsprint** (`newsprint`): Primary text.
- **Margin Gray** (`margin-gray`): Secondary text, eyebrows, stat labels.
- **Hairline** (`hairline`): Every border. A low-alpha near-white, never a solid fill.

### Semantic
- **Win Green** (`win-green`): Wins, positive deltas, RB pill.
- **Amber Flag** (`amber-flag`): Warnings, TE pill, warn Notes.
- **Loss Red** (`loss-red`): Losses, negative deltas, QB pill.
- **Kicker Violet** (`kicker-violet`): Info, K pill.

### Named Rules
**The One Tan Rule.** Press Tan is the only brand color. Green, amber, red and violet carry meaning (win, warn, loss, info, position) and never decorate.

**The Team Tint Rule.** A picked team's color arrives only through `--team`, which falls back to Press Tan. Never hardcode a franchise color in a page.

**The Token Rule.** No hex literals in components. Every color is a token from `web/app/globals.css`.

## Typography

**Display Font:** Axis Extrabold (with Archivo, sans-serif)
**Body Font:** Archivo (with Helvetica Neue, Arial)

**Character:** A heavy, squared broadcast wordmark face over a plain grotesque with true tabular figures: the chyron over the stat sheet.

### Hierarchy
- **Display** (Axis, 2.25rem, line-height 1, tight tracking): Page titles via PageHeader. On phones it starts at 1.5rem.
- **Headline** (Axis, 1.5rem): Section-level headings where a page needs a second brand moment.
- **Body** (Archivo 400, 0.875rem, 1.5): Notes, descriptions, table text.
- **Stat** (Archivo 700, 1.125–1.25rem, tabular): StatCard values and headline figures.
- **Label** (Archivo 700, 10px, 0.13–0.2em tracking, uppercase): Eyebrows, stat labels, position pills.

### Named Rules
**The Chyron Rule.** Axis is for headings only. It never sets a number, a label, a badge or a table cell. (It once did, on 312 elements, and read as a wordmark stretched over a spreadsheet.)

**The Column Rule.** Any figure that sits in a column uses Archivo's tabular numerals so digits align.

## Layout

A flush app shell: the sidebar rail sits beside a full-bleed content area with no inset card, margin or radius. Below `md` the rail becomes a Sheet drawer behind a mobile top bar. Design and verify at 375px first. Content is a vertical stack of sections; stat cards flow in responsive grids (two columns on phones). Card padding steps up at `sm` (12→16px horizontal, 10→12px vertical). Table cells carry `min-w-0` so names truncate instead of pushing figures off the screen. No horizontal page scroll.

## Elevation & Depth

Flat. Depth is tonal: page → card is one lightness step, and edges are hairline borders. Hover on a card shifts its border toward Press Tan (`primary/40`) rather than lifting it. Buttons in the outline variant carry shadcn's `shadow-xs`, the only resting shadow.

### Named Rules
**The Live Lift Rule.** Surfaces are flat at rest. Only modules that show live game-day state (in-progress matchups, live win probability, the week pulse) may lift or glow to mark "now." Once the games end, they go flat again.

## Shapes

Gently rounded rectangles off a 10px base radius: 6px for pills and small chips, 8px for buttons and inputs, 10px for cards, 14px for sheets. Borders are 1px hairlines. The only heavier stroke is the 4px left rule on a Note. Headshots and team avatars are circles.

## Components

### Buttons
- **Shape:** Gently curved (8px).
- **Primary:** Press Tan fill, dark ink, 36px tall, 16px horizontal padding, medium weight.
- **Hover / Focus:** Fill fades to 90%. Focus draws a 3px ring at half-opacity `--ring`.
- **Secondary / Ghost / Outline:** Booth Raised fill; ghost is transparent until hover; outline adds a hairline border and `shadow-xs`.

### Stat Card (signature)
- Booth Card background, 10px radius, hairline border that warms to tan on hover.
- Tiny tracked uppercase label (Margin Gray, or Press Tan when `accent`) over a bold tabular value, optional sub-line.

### Page Header (signature)
- Tracked uppercase eyebrow in Margin Gray, then the Axis title, optional subtitle and "updated" stamp.

### Position Pill
- 6px radius, 10px bold tracked label, filled by position: QB red, RB green, WR tan, TE amber, K violet, DEF gray.

### Segmented Control
- The one filter control (positions, seasons, ownership). A raised track with the active segment filled. Used by Draft, Waivers and Consensus.

### Note
- Booth Card callout with a 4px left rule in Press Tan (or Amber Flag for `warn`), muted body text.

### Navigation
- shadcn sidebar on Booth Rail, collapsible groups (220ms open, 180ms close). The active item uses Sidebar Accent. On mobile it's a left Sheet drawer (500ms in, 300ms out).

## Do's and Don'ts

### Do:
- **Do** set every color from tokens in `web/app/globals.css`, including `--ok`/`--warn`/`--bad`/`--info` for meaning.
- **Do** use Axis only through `font-brand` on headings.
- **Do** reuse `components/gggg/primitives.tsx` (StatCard, PageHeader, PosPill, Headshot, Note) and `Segmented` rather than restyling inline.
- **Do** check dark and light mode; card stays lighter than the page in both.
- **Do** give every animation a static end state and honor `prefers-reduced-motion`.

### Don't:
- **Don't** put Axis on numbers, labels, badges or table cells.
- **Don't** add a second brand color, or use the semantic colors as decoration.
- **Don't** use drop shadows to separate resting surfaces; reserve lift for live modules.
- **Don't** default to light mode or follow `prefers-color-scheme`; dark is the house default.
- **Don't** hardcode hex values or franchise colors in a page.
