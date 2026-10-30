---
target: league homepage and site-wide pattern
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\spenc\\Downloads\\Claude Sessions\\gridiron-grand-gambit-gala\\web\\app\\page.tsx"
target_fingerprint: "sha256:b981bcbac06fef452f0f2d4121e6777eef35dde5d52fa7195b593531b7232130"
target_path: "C:\\Users\\spenc\\Downloads\\Claude Sessions\\gridiron-grand-gambit-gala\\web\\app\\page.tsx"
timestamp: 2026-10-30T13-35-57Z
slug: web-app-page-tsx
---
# Critique: league homepage and site-wide pattern (AI tells). Score 26/40 (Acceptable)

Method: dual-agent. A = design review (live-site screenshots + code; its "375px" captures were 500px layouts, so overflow claims discarded). B = detector over source and live URLs (/ , /matchups, /teams; /ledger timed out). No browser overlay.

## Heuristics
1 Status 3 · 2 Real world 3 · 3 Control 3 · 4 Consistency 3 · 5 Error prev 3 · 6 Recognition 2 (12 similar line colors) · 7 Flexibility 2 (no "my team first") · 8 Minimalist 2 (equal weight) · 9 Error recovery 3 · 10 Help 2

## Specificity
Mostly interchangeable. Authored for this league: the punishment race, the 12 real avatars/names, all-play/luck stats, the "You" tint.

## Detector
Source: 6 side-stripe sites (primitives.tsx:215, league-sections.tsx:37, page.tsx:569 [preseason banner], draft/page.tsx:59, ledger/page.tsx:238 and :318). None show on the in-season homepage. Live: / 81 findings (69 undersized-ui-text, ~7 low-contrast, 1 tiny-text, 1 skipped-heading h1->h3); /matchups 18; /teams 3; kicker-above-heading on /matchups and /teams. Real a11y: muted-foreground ~3.4:1, 9px "My team", red loss cells 3.3-4.0:1.

## AI tells and replacements
1 Equal-weight stack, same 12 teams 3x -> your-week strip + data-chosen lead + merged standings/power table. 2 Tracked 10px caps headings (22 SectionLabels, em-dash filler, eyebrows above h1, 91 sub-11px spots) -> sentence-case Axis headings, no eyebrows, 11-12px floor. 3 One container for everything -> cards only for tappable things. 4 border-l-4 stripes (6 sites) -> tint band / bold lead-in; update DESIGN.md. 5 Tan marks everything -> tan = "you", green/red on W-L, one league-owned loud color. 6 Templated quips ("Head. Number. Quip." x10) -> 3-5 ranked by drama, one headline-sized item naming the punishment, vary form. 7 Chart/badge noise (12 colors, SAFE x8) -> highlight you + leader, fade the rest; show only at-risk teams. 8 Axis as costume (DESIGN.md Chyron Rule, mine from a code comment) -> team names + lead score. 9 Icon per nav item, trophy emoji.
Cheap: 2,4,6,7,9. Structural: 1,3,5,8.

## Priority issues
[P1] No lead story / equal weight (layout, shape). [P1] Label system: eyebrows, filler subtitles, sub-11px (typeset). [P2] Templated quips (clarify, bolder). [P2] Stripes + uniform cards (quieter, distill). [P3] Chart + pill noise (polish).

## Personas
Casey: own matchup not pinned, 11px footnotes, no one-tap to my team. Trash-talker: nothing screenshot-ready. Sam: 9-11px muted text, color-only meaning, contrast.

## Minor
0.0 rows for unstarted games (show kickoff); "Updated" shown twice on desktop; right rail is four tweet-account links.
