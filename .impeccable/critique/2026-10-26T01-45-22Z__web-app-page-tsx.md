---
target: web/app/page.tsx
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:C:\\Users\\spenc\\Downloads\\Claude Sessions\\gridiron-grand-gambit-gala\\web\\app\\page.tsx"
target_fingerprint: "sha256:bd9e8cd3fce99ccab3e3bbedb0f066276d96b72b38d30b1e34e089d29aa0e2db"
target_path: "C:\\Users\\spenc\\Downloads\\Claude Sessions\\gridiron-grand-gambit-gala\\web\\app\\page.tsx"
timestamp: 2026-10-26T01-45-22Z
slug: web-app-page-tsx
---
# Critique: League hub (web/app/page.tsx), in-season. Score 25/40 (Acceptable)

Method: dual-agent. A = design review (source + live JSON). B = detector over source and the live URL. No browser overlay.

## Heuristics
1 Status 3 (two disagreeing "updated" stamps; failed polls hidden) · 2 Real world 3 · 3 Control 3 · 4 Consistency 2 (win-prob bar means two things) · 5 Error prev 2 (projection toggle silently changes every number) · 6 Recognition 2 (bare win% with no team) · 7 Flexibility 3 · 8 Minimalist 2 (crowded above the fold) · 9 Error recovery 1 (dead error line, no retry) · 10 Help 2

## Specificity
The live engine is authored for this league; the frame around it is a generic dashboard. The punishment race and rivalries are buried mid-page.

## Detector
Source scan: 4 side-tab hits (page.tsx:291 is a false positive because it's a status stripe on alert rows; page.tsx:654, league-sections.tsx:37 and primitives.tsx:215 are real).
Live URL scan: 97 undersized text (9px chips, "You" badges, position codes, table headers, head-to-head names), 2 tiny text, 3 low-contrast (#bb5752 red on tinted cells, 3.3-4.0:1).

## Priority issues
- [P1] Punishment race and stakes buried below Standings, Power Rankings and the 520px tweet feed. Fix: lift Punish Watch top 3 into ThisWeek; push the feed below on mobile. layout
- [P1] Win-prob bar is ambiguous: bare pa%, switches between win% and score share, right label flips between % and margin. Fix: always win% for both sides with team names. clarify
- [P2] 9-10px functional text, 24px tap targets, injury shown by red letter + tooltip, 3 red-on-tint contrast fails. harden/typeset
- [P2] Status bar overloaded at 375px (5-6 items + instruction note). distill
- [P2] Error/loading/stale states generic: no retry, skeleton doesn't match layout, lost connection still looks fresh. harden
- Bug: literal "&amp;" renders in SectionLabel subs (page.tsx:587, 742).

## Personas
Casey: status bar + 4 tiles before 2nd matchup; tiny links. Sam: 9px, color-only injury, unlabeled %. Trash-talker: nothing cleanly screenshot-able; no in-season shame stat.
