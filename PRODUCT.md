# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The managers of a private Sleeper fantasy football league. They visit on their phones, mostly during live games, around waivers, and while trash-talking in the group chat. Phones are the majority of traffic.

## Product Purpose

The Gridiron Grand Gambit Gala (GGGG) is the league's own site, built on the Sleeper API. It gives the league what the Sleeper app doesn't:

- **League history and lore:** all-time records, the ledger, punishments, recaps. The league's memory across seasons.
- **A live game-day hub:** live matchups, win probability, playoff watch and punishment watch while games are on.
- **Fuel for trash talk:** rivalries, records and bragging rights made visible and easy to screenshot or link in the group chat.

Success means managers open it on game day and talk about it in the chat.

## Positioning

It is built for this one league: its own history chain, its own punishment, its own ledger and its own rivalries. A generic fantasy app cannot copy that.

## Operating Context

- Checked one-handed on phones, often mid-game, between other apps.
- Data refreshes on its own schedule: every 5 minutes during NFL game windows, every few hours otherwise. Pages fetch JSON at runtime.
- The site changes with the season: preseason, draft, in-season and offseason each change what the home page shows.

## Capabilities and Constraints

- Next.js static export with no server runtime. Two bundles come from one source: `/sleeper` on the personal site and the flattened `gridirongrandgambitgala.xyz` mirror.
- 17 routes, including League hub, Matchups, Teams/Team, Player, Recap, Ledger, Punish, Playoff, Projections, Draft, Keepers, Trade Lab, Waivers, Consensus, What-If, Changelog.
- Decision tools (projections, Trade Lab, waivers, consensus ranks) exist but are secondary to lore, live game day and trash talk.
- Per-team theming (TeamTheme, TeamSwitcher) and a remembered "me" team.
- Ranking data drawn from FantasyPros must never name FantasyPros anywhere a user sees it. It is "consensus".

## Brand Commitments

- Name: The Gridiron Grand Gambit Gala, shortened to GGGG.
- Voice: broadcast/sports desk. It speaks with a pro sports outlet's authority, with a wink.
- Existing brand face: Axis Extrabold, used for headings only.

## Evidence on Hand

Real league data from Sleeper (rosters, matchups, transactions, history), generated as `data/*.json` on the server. No invented stats, quotes or league events.

## Product Principles

1. Game day first: the live state of the league outranks everything else in season.
2. The league's memory is the moat. History and lore get the care a generic app can't give.
3. Make it shareable: every stat worth bragging about should be easy to screenshot or link.
4. Phone first, always: design and verify at 375px.
5. The broadcast voice carries the jokes. Keep the authority, let the wink land.
