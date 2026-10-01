# Bitcoin 24–72h Signal System — Research Report

**Date:** 2026-09-17 · **Verdict: NO ROBUST EDGE FOUND YET (deployable)**

A trend/momentum-with-confirmation system was discovered on 2012–2021 data,
survived validation (2022–2023) and an extensive robustness battery, and then
**failed the untouched 2024–2026 final test after realistic costs**. Per the
pre-registered kill rule (Phase 12), it is *not* presented as a tradable edge.
It ships as a paper-trading monitor so that forward, genuinely out-of-sample
performance can be accumulated before any re-judgement.

---

## 1. Data actually accessible (Phase 0)

This research ran in a network-restricted environment; every claimed source
was probed programmatically. Only these were reachable and are used:

| Source | Content | Granularity | Coverage | License |
|---|---|---|---|---|
| [ff137/bitstamp-btcusd-minute-data](https://github.com/ff137/bitstamp-btcusd-minute-data) (mirror of Kaggle [mczielinski/bitcoin-historical-data](https://www.kaggle.com/datasets/mczielinski/bitcoin-historical-data)) | BTC/USD OHLCV, Bitstamp | 1 minute | 2012-01-01 → 2026-09-16 | CC BY-SA 4.0 |
| [coinmetrics/data](https://github.com/coinmetrics/data) (Coin Metrics Community) | BTC on-chain: exchange in/out flows, supply on exchanges, MVRV, active addresses, hash rate, fees, transfer counts, reported spot volume; ETH price; USDT+USDC supply | daily | 2010 → 2026-05-24 (repo mirror lags the API) | CC BY-NC 4.0 |
| [supervik/historical-funding-rates-fetcher](https://github.com/supervik/historical-funding-rates-fetcher) | BTC perp funding, 7 exchanges (Binance, Bybit, OKX*, KuCoin, MEXC, HTX, Gate, dYdX) | 1–8h | 2020-01-01 → 2023-12-31 | repo MIT |

Also located but not needed: [chappie2054/binance-funding-history-download](https://github.com/chappie2054/binance-funding-history-download) (scripts only), [binance/binance-public-data](https://github.com/binance/binance-public-data) (data host blocked here).

**Documented as NOT accessible from this environment** (all direct exchange
and analytics APIs were egress-blocked: Binance, Bybit, Coinbase, Kraken,
Coinglass, CryptoCompare, Glassnode, Dune, blockchain.info, mempool.space,
Hyperliquid, Deribit, Zenodo, HuggingFace, Kaggle): **open interest,
liquidations, long/short positioning, basis, options IV/skew, Hyperliquid
wallet/trader cohorts, mempool activity, dormant-coin/UTXO-age/CDD (removed
from the CM community tier), prediction markets.** Nothing was fabricated;
Phase 3 (informed-participant cohorts) could not be executed at all with
public data reachable here and remains open. The live monitor includes
fetchers that work outside this sandbox.

## 2. Dataset construction (Phase 1)

- Unit of observation: UTC day `D` (00:00–24:00), built from minute bars.
  5,373 rows, 2012-01-01 → 2026-09-16. Decision time = 00:00 UTC of `D+1`.
- **Leakage controls:** on-chain metrics for day `D` complete/publish mid-day
  `D+1`, so all Coin Metrics columns are **lagged one day**; funding uses only
  prints ≤ decision time; the last (partial) day is dropped; all
  normalisations are trailing-window only (730d percentile ranks, 90d
  z-scores) — no full-sample statistics anywhere.
- **Execution model:** fills at the **open of `D+1`** (first trade after the
  decision), so backtests carry a real execution delay. Costs are charged
  per side on every position change.
- Labels: `log(close(D+h)/close(D))`, h ∈ {1,2,3} days.
- 40 candidate features across 1d–90d lookbacks: momentum, MA z-scores,
  range position, drawdown/run-up, realized vol (5-min RV + Parkinson),
  volume expansion, up-volume share, MVRV level/rank/change, exchange
  netflow & inflow z, exchange-supply change, active-address & transfer
  momentum and price divergence, hash-rate momentum, fee pressure, ETH/BTC
  momentum, stablecoin (USDT+USDC) supply growth, funding level/z.

**Splits (chronological, never shuffled):** TRAIN 2012–2021 ·
VALIDATION 2022–2023 · **FINAL TEST 2024-01-01 → 2026-05-24** (untouched
until §6; on-chain coverage ends 2026-05-24).

## 3. Signal discovery (Phase 2)

Univariate screening on TRAIN only (Spearman IC vs 24/48/72h forward
returns, **Newey–West t-stats** because overlapping labels are serially
correlated; ~120 tests ⇒ required |t| ≥ 3 *and* ≥60% same-sign yearly ICs).
33 feature×horizon pairs passed; every survivor is a *positive*-IC
continuation signal: `mvrv_rank` (t=5.7), `volu_z_7_90` (5.4), `ma_z_30/90`,
`upvol_share_7`, `spotvol_z`, `rv_rank`, `ret_14d/30d`, `flowin_z`,
`mvrv_ch_30`, `rangepos_7`. Mean-reversion, stablecoin-growth, ETH/BTC,
hash-rate and divergence features did not pass. Funding (2020+ only) showed
a weak contrarian IC (−0.03..−0.06) — see §7.

Two models were built (both walk-forward, purge gap 3d, expanding window,
retrained each Jan 1):

- **COMPOSITE** — interpretable equal-weight mean of the trailing-730d
  percentile ranks of 9 screened features.
- **GBM** — LightGBM regression on the 48h label, 37 features, deliberately
  small (15 leaves, min 100 samples/leaf, L2=5).

Positioning: score → trailing-365d percentile; BUY ≥ 0.65, SELL ≤ 0.35,
hysteresis 0.05, else WAIT. **Final system "AGREE-65/35": trade only when
both models agree; otherwise WAIT** (~60–65% of days are WAIT).

## 4. Train/validation results (net of 15 bps per side)

| System | 2016–21 WF Sharpe | 2022–23 VAL Sharpe | VAL PF | VAL trades |
|---|---|---|---|---|
| COMPOSITE | 0.55 | 0.56 | 1.37 | 62 |
| GBM | 0.74 | 0.62 | 1.44 | 103 |
| **AGREE (final)** | **0.89** | **0.73** | **1.60** | 62 |
| buy & hold | 1.00 | −0.07 | — | — |
| MA20/100 long/flat | 1.10 | 0.50 | — | — |
| random ±1/0 (200 draws) | −0.79 | −1.15 | — | — |

Yearly net Sharpe (AGREE family) was positive in 6–7 of 8 years. Long side
carried the edge in TRAIN; shorts only paid in 2022.

## 5. Robustness battery (Phases 6, 7, 11) — all before the final test

- **Threshold perturbation** (q 0.60/0.40 → 0.70/0.30): Sharpe 0.69–1.00 WF,
  0.37–0.88 VAL — graceful degradation, no cliff.
- **Hysteresis 0–0.10, rank window 270–500d:** all positive (0.61–1.30).
- **Composite drop-one-feature:** WF 0.76–1.09; VAL 0.06–0.69 (breadth
  matters in VAL but no single feature is load-bearing).
- **GBM seed/leaves/lr/label jitter:** 0.53–1.12, all positive.
- **Cost grid (per side):** 0 bps 1.09|1.00 · 10 bps 0.96|0.82 ·
  15 bps 0.89|0.73 · 30 bps 0.70|0.47 · 50 bps 0.44|0.13.
- **Execution 24h late:** still positive (0.64 WF | 0.96 VAL).
- **Permutation test** (circular position shift, 1000 draws):
  p = 0.007 (WF), p = 0.051 (VAL).
- **Regimes (2016–23):** worked in up- and down-trends (GBM), concentrated
  in **high-vol regimes** (Sharpe 1.29 hi-vol vs −0.07 lo-vol) — noted
  *before* the test as a pre-registered secondary variant.

## 6. FINAL TEST — single shot, 2024-01-01 → 2026-05-24 (Phases 5, 9, 10)

Frozen config evaluated once; numbers recorded verbatim.

| Metric | 0 bps | **15 bps (baseline)** | 30 bps |
|---|---|---|---|
| Ann. return (log) | +3.8% | **−9.1%** | −22.0% |
| Sharpe | 0.12 | **−0.28** | −0.68 |
| Sortino | 0.12 | **−0.31** | −0.75 |
| Max drawdown (log) | −0.40 | **−0.49** | −0.75 |
| Trades / win rate | 103 / 38.8% | **103 / 36.9%** | 103 / 36.9% |
| Avg win / avg loss | +4.4% / −2.6% | **+4.5% / −2.7%** | +4.3% / −2.9% |
| Expectancy per trade | +0.09% | **−0.06%** | −0.21% |
| Profit factor | 1.05 | **0.96** | 0.88 |
| Long / short / wait days | 19.5% / 23.2% / 57.3% | same | same |

Benchmarks, same window and execution: **buy & hold Sharpe +0.48**
(ann. +23%, MDD −0.69) · **MA20/100 @15 bps +0.60** · random ±1/0 @15 bps
−1.18 ± 0.64. Yearly net Sharpe: 2024 +0.37, 2025 −1.03, 2026 −0.77.

The pre-registered high-vol-gated variant was also checked once (disclosed
as a contaminated second look): WF 0.70 | VAL 0.95 | **TEST −0.17**. Same
conclusion.

**Failure analysis.** The edge was a short-horizon continuation premium.
It was genuinely there for 2016–2023 (robust to costs, parameters, delay,
permutation) and decayed structurally in 2024–2026 — a progressively more
efficient, ETF-era, range-bound market chopped a trend follower to death
(win rate fell from ~46–49% to 37%). This is regime death, not a coding or
leakage artifact: the same pipeline reproduces the historical results, and
the failure is monotone across cost assumptions including zero.

**Per Phase 12 the system is killed as a trading strategy.**

## 7. Historical comparable setups (2016 → 2026-05, gross, for reference)

| State | Horizon | n | Hit | Median | Mean | Worst | Best |
|---|---|---|---|---|---|---|---|
| BUY | 24h | 710 | 55.4% | +0.29% | +0.52% | −15.6% | +19.8% |
| BUY | 48h | 710 | 58.0% | +0.71% | +0.94% | −14.0% | +35.2% |
| BUY | 72h | 710 | 56.5% | +0.66% | +1.21% | −19.4% | +35.7% |
| SELL | 24h | 738 | 47.7% | −0.11% | +0.02% | −23.8% | +17.8% |
| SELL | 48h | 738 | 46.1% | −0.22% | +0.06% | −22.2% | +25.7% |
| SELL | 72h | 738 | 47.2% | −0.17% | +0.05% | −25.6% | +26.5% |

The SELL state has **no** edge over the full sample and should be read as
"reduce/avoid exposure", not as a profitable short.

**Funding-rate hypothesis (2020–2023 subsample only):** weak contrarian IC;
conditionally, SELL-state days with *negative* 3d funding mean-reverted UP
(+1.96% mean 48h, n=25 — tiny). A "veto SELL when funding < 0" overlay is
plausible but **unvalidated** (no post-2023 funding data here) and is NOT in
the production system.

## 8. What would change the verdict

1. **Forward evidence:** ≥ 12 months of live paper signals (the monitor
   records every signal + realized 24/48/72h outcomes in SQLite).
2. **New data families** unavailable here: open interest, liquidations,
   funding post-2023, Hyperliquid cohort positioning, options skew — the
   discovery pipeline is data-source-agnostic and ready to re-run.
3. **A materially different mechanism** (e.g., liquidation-cascade
   mean-reversion, cross-venue flow divergence). Note: the 2024–2026 window
   is now burned for selection; any new candidate must be judged on data
   after 2026-05 or on live forward results.

## 9. Reproduction

```
cd btc-signal/src
python3 build_dataset.py     # rebuild daily dataset from raw sources
python3 features.py          # 40 candidate features, leakage-safe
python3 screen_ic.py         # Phase 2 screening (train only)
python3 research_models.py   # walk-forward models + benchmarks
python3 experiments.py       # thresholds, permutation, regimes
python3 experiments2.py      # final candidates + funding hypothesis
python3 robustness_final.py  # Phase 6/7/11 battery
python3 final_test.py        # single-shot untouched test (already spent)
python3 train_live_model.py  # fit production GBM
python3 live_monitor.py      # daily paper-trading signal
```

*Backtested results are historical simulations, not guarantees of future
performance. The recorded verdict of this study is that no deployable edge
was demonstrated.*
