# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ethan-Zen/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Ethan-Zen/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar for protocols that record no token: it reads DefiLlama's sealed protocol snapshot, prices every
pre-token protocol by what a token would be worth if the protocol's record stayed as it is, ranks the
board, and gives each protocol a farm plan with what each step costs and how long it takes.

## How it prices a protocol

The model is in `lib/model.ts` (`scoreProtocol`, `comparableMultiples`) and the page recomputes it in
`dashboard/app.js` (`impliedValue`), so the board and the page can be checked against each other:

```
implied = TVL x peer multiple x 0.60 x growth x maturity
```

- **peer multiple**: the median market cap per dollar of TVL of the snapshot's own protocols in the same
  category whose token already trades. No multiple is hardcoded; a category with fewer than three live
  tokens borrows the snapshot-wide median.
- **0.60**: the pre-token discount, for a protocol with no float and no liquidity yet.
- **growth**: `1 + clamp(7d change, -50%, +100%) x 0.35`.
- **maturity**: `0.75 + min(age, 1460d) / 1460d x 0.35` — a longer record with no token.

The board carries every protocol on the house watchlist (the floor, never the ceiling) plus the
pre-token protocols below the floor: 198 rows here, all derived, none named by hand.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json   # the grader mounts the snapshot there
open out/dashboard/index.html
```

`main.ts` writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and
`out/dossier.json`; the dashboard reads `../data.js` and needs no network. Node 22 or newer, no
dependencies.

---

<sub>Entered on [make.fun](https://make.fun/?ref=rywn2b8e&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
