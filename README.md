# token-radar-01-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ilhamw05/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ilhamw05/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads the sealed DefiLlama snapshot, finds the protocols that record no token yet, prices what a launch would be worth with a peer-multiple model (TVL x the median market-cap/TVL of listed peers in the same category x 7-day growth x time tracked with no token), and presents a sortable, filterable dashboard of 160 ranked protocols — every one with a detail view and a concrete farm plan with costs and timings.

## Run it

```sh
node main.ts
# reads /input/snapshot.json (or --input <file|dir>), writes board.json, data.js,
# dashboard/, screenshots/ and dossier.json to /output (or $MAKEFUN_OUTPUT_DIR)
```

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

# Token Launch Radar

An entry for make.fun's **token-radar-01** bounty: a radar that finds the protocols in a sealed
DefiLlama snapshot that record no token yet, ranks them by an implied launch value, and gives every
one of them a concrete farm plan.

## The board

The snapshot holds 758 protocols. 342 of them record no token (no CoinGecko id, no symbol, no market
cap); the 158 whose token already trades are set aside and never ranked. The board carries **160
rows**: all 40 protocols on the snapshot's watchlist (the floor, never the ceiling) plus the 120
strongest below-floor pre-token protocols by implied value, excluding wrapper-like products —
bridges, liquid staking and restaking wrappers, CEX products, names carrying a whole word *wrapped*,
*staked* or *staking*, names ending in a version marker, and names that begin with an exchange's
name.

## The value model (peer-multiple-1)

Every implied value is one multiplication, computed from the snapshot's own figures at run time:

```
implied = max(1, round(TVL × category multiple × growth factor × maturity factor))
```

- **Category multiple** — the median market-cap/TVL of the snapshot's live protocols in the same
  category, when at least 3 live protocols price that category; otherwise the overall live median.
  It is the price the market already pays for a dollar of TVL in that category, derived fresh from
  the snapshot on every run — never a hardcoded per-name value.
- **Growth factor** — `1 + clamp(change_7d, -30, +50) × 0.006`; a protocol with no reported 7-day
  change gets 1.
- **Maturity factor** — `0.70 + 0.30 × min(age in days, 1095) / 1095`, where age runs from the day
  DefiLlama began tracking the protocol to the snapshot date; no listing date gives 0.85.

The factors are rounded (multiple to 3 decimals, growth and maturity to 4) before they multiply, so
the arithmetic on each protocol's detail page is exactly the arithmetic that produced its value.
One function scores every row; the model is a pure function of the snapshot, so two runs write
byte-identical output.

## Farm plans

Each row carries a 4–5 step farm plan generated from the protocol's own record: its category family
(vault/curator, lending/CDP, DEX, RWA, chain, payments, restaking, basis/yield, or a default), its
first chain, its TVL and a hash of its slug. Every step names the chain, a specific action, an amount
or a frequency, an estimated cost in dollars (gas priced by chain class: Ethereum dear, the big L2s
cheap, Solana near-free) and a time. Wording follows the snapshot's own caution: a protocol
*records no token* — the record is not proof that none exists.

## The dashboard

`dashboard/` is a static page (no framework, no network) in a dark radar theme: a masthead with a
pure-CSS sweeping scope and the snapshot's headline counts, a methodology band that states the model
in plain words, and the board itself — searchable, filterable by chain, category and segment
(watchlist / early finds), and sortable by rank, implied value, TVL, 7-day growth or age. Every row
opens a detail view (`#/p/<slug>`) with a stat grid, the full "why this value" arithmetic, and the
numbered farm plan. The footer states plainly that implied values are this radar's own model claims
from one snapshot, not predictions of a launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|input directory>
```

`main.ts` (Node 22, standard library only) reads the snapshot, builds the board, checks it against
the gate's shape with `boardIssue` and exits non-zero on any issue, then writes `board.json`,
`data.js` (the dashboard's data, from the same board, so page and board always agree), copies
`dashboard/` and `screenshots/`, and writes `dossier.json` with the vendored `buildDossier`.

## Layout

- `main.ts` — the entry program.
- `lib/model.ts` — the model: snapshot parsing, peer multiples, scoring, board building, farm plans.
- `vendor/makefun-board.ts` — the kit's dossier library, vendored unchanged.
- `dashboard/` — `index.html`, `app.css`, `app.js`.
- `screenshots/` — the board, a detail view, and a filtered view.

MIT licensed; see `LICENSE`.
