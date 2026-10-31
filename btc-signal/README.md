# BTC Signal System (BUY / SELL / WAIT, 24–72h horizon)

Quantitative research pipeline + live paper-trading monitor for a
three-state Bitcoin signal.

**Research verdict (2026-09-17): NO ROBUST EDGE FOUND YET.**
The discovered trend/momentum system was robust on 2016–2023 data but
failed the untouched 2024–2026 out-of-sample test after realistic costs.
Full details, data sources, methodology and all numbers:
[reports/RESEARCH_REPORT.md](reports/RESEARCH_REPORT.md).

## Layout

```
btc-signal/
├── README.md
├── reports/RESEARCH_REPORT.md   # phases 0-12, all results, verdict
├── requirements.txt
├── models/                      # production LightGBM + feature list
├── data/
│   ├── raw/                     # Coin Metrics community CSVs (fetched)
│   ├── processed/               # daily dataset, features, scores, positions
│   └── signals.db               # (created at runtime) live signal log
└── src/
    ├── build_dataset.py         # Phase 1: aligned, leakage-safe dataset
    ├── features.py              # Phase 1b: 40 candidate features
    ├── screen_ic.py             # Phase 2: train-only screening (NW t-stats)
    ├── research_models.py       # Phases 2b/5: composite + walk-forward GBM
    ├── experiments.py           # Phases 4/6/11: grids, permutation, regimes
    ├── experiments2.py          # final candidates + funding hypothesis
    ├── robustness_final.py      # robustness battery on frozen system
    ├── final_test.py            # single-shot untouched test (already spent)
    ├── backtest.py              # execution realism + metrics
    ├── train_live_model.py      # fit production model
    └── live_monitor.py          # daily signal: prints BUY/SELL/WAIT,
                                 # score 0-100, factors, setup stats;
                                 # records signal + outcomes to SQLite
```

## Running the live monitor (paper trading only)

```
pip install -r requirements.txt
cd src && python3 live_monitor.py
```

Run daily shortly after 00:00 UTC. It refreshes Coin Metrics community data
and Bitstamp prices (GitHub mirror fallback where APIs are blocked), rebuilds
features with the same leakage-safe code used in research, and appends the
signal + BTC price to `data/signals.db`, later backfilling realized
24/48/72h outcomes so live performance can be compared against the backtest.

It does **not** place trades. Output is a research record, not investment
advice.
