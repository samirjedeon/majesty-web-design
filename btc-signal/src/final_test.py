"""
Phases 5/9/10 — SINGLE-SHOT evaluation on the untouched TEST set.

Frozen configuration (decided on train walk-forward + validation ONLY,
before this script was ever run on 2024+ data):

  FINAL SYSTEM "AGREE-65/35"
  - Composite score: equal-weight mean of trailing-730d percentile ranks of
    [ma_z_30, ret_14d, volu_z_7_90, upvol_share_7, mvrv_rank, mvrv_ch_30,
     flowin_z, spotvol_z, rv_rank]
  - GBM score: LightGBM (300 trees, lr .03, 15 leaves, mcs 100, ss .8,
    cs .7, l2 5, seed 7) on fwd_ret_2d, expanding walk-forward retrain each
    Jan 1, purge 3d.
  - Each score -> trailing-365d percentile; per-model position BUY>=.65 /
    SELL<=.35 with .05 hysteresis; final position only when both agree,
    else WAIT.
  - Execution: fill at next UTC day's open; baseline cost 15 bps one-way.

TEST WINDOW: 2024-01-01 .. 2026-05-24 (end of on-chain data coverage).
This script is run ONCE and its output recorded verbatim in the report.
"""
import os
import numpy as np
import pandas as pd

from backtest import run_strategy, ann_metrics, trade_stats
from research_models import positions_from_score, gbm_walkforward, GBM_FEATS_EXCLUDE
from robustness_final import agree_pos

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
TEST = ("2024-01-01", "2026-05-24")


def main():
    df = pd.read_csv(os.path.join(PROC, "features.csv"), parse_dates=["date"]).set_index("date")
    ohlc = pd.read_csv(os.path.join(PROC, "btc_daily_ohlcv.csv"), index_col=0, parse_dates=True)
    open_px = ohlc["open"]
    sa = pd.read_csv(os.path.join(PROC, "score_composite.csv"), index_col=0, parse_dates=True).iloc[:, 0]

    feats = [c for c in df.columns
             if not c.startswith("fwd_ret") and c != "close" and c not in GBM_FEATS_EXCLUDE]
    sb = gbm_walkforward(df, feats, end=pd.Timestamp(TEST[1]))
    sb.to_csv(os.path.join(PROC, "score_gbm_full.csv"))

    pos = agree_pos(sa, sb)
    pos.to_csv(os.path.join(PROC, "positions_final.csv"))

    print("==== FINAL TEST (untouched, single shot) 2024-01-01..2026-05-24 ====")
    for cost in (0, 15, 30):
        res = run_strategy(open_px, pos.loc[TEST[0]:TEST[1]], cost)
        m = ann_metrics(res["net"], f"AGREE|TEST|{cost}bps")
        t = trade_stats(res)
        print(f"\n--- cost {cost} bps one-way ---")
        for k, v in {**m, **{f"trade_{k}": v for k, v in t.items()}}.items():
            print(f"  {k}: {v:.4f}" if isinstance(v, (int, float, np.floating)) and not isinstance(v, bool) else f"  {k}: {v}")
        print(f"  pct_long={float((res.pos>0).mean()):.3f} pct_short={float((res.pos<0).mean()):.3f} "
              f"pct_wait={float((res.pos==0).mean()):.3f}")

    # benchmarks on identical window/execution
    lr_open = np.log(open_px.shift(-2) / open_px.shift(-1)).loc[TEST[0]:TEST[1]]
    print("\n--- benchmarks (same window) ---")
    print({k: round(v, 3) for k, v in ann_metrics(lr_open, "buy&hold").items() if isinstance(v, (int, float))})
    ma_pos = (ohlc["close"].rolling(20).mean() > ohlc["close"].rolling(100).mean()).astype(float)
    res = run_strategy(open_px, ma_pos.loc[TEST[0]:TEST[1]], 15)
    print({k: round(v, 3) for k, v in ann_metrics(res["net"], "MA20/100@15bps").items() if isinstance(v, (int, float))})
    rng = np.random.default_rng(21)
    rnd = [ann_metrics(run_strategy(open_px,
            pd.Series(rng.choice([-1, 0, 1], size=len(lr_open)), index=lr_open.index), 15)["net"]).get("sharpe")
           for _ in range(200)]
    print(f"random +-1/0 @15bps: mean Sharpe {np.nanmean(rnd):.2f} ± {np.nanstd(rnd):.2f}")

    # yearly breakdown in test
    res15 = run_strategy(open_px, pos.loc[TEST[0]:TEST[1]], 15)["net"]
    print("\nyearly net Sharpe in TEST:",
          res15.groupby(res15.index.year).apply(lambda x: round(ann_metrics(x).get("sharpe", np.nan), 2)).to_dict())

    # Phase 9 historical setup stats (train+val+test, BUY and SELL states)
    print("\n--- historical comparable setups (2016..2026-05, net of 15bps entry+exit ignored; gross fwd returns) ---")
    c = ohlc["close"]
    for state, mask in [("BUY", pos == 1), ("SELL", pos == -1)]:
        idx = pos.index[(mask) & (pos.index >= "2016-01-01") & (pos.index <= TEST[1])]
        for h in (1, 2, 3):
            fwd = np.log(c.shift(-h) / c).reindex(idx) * (1 if state == "BUY" else -1)
            fwd = fwd.dropna()
            print(f"  {state} h={h*24}h: n={len(fwd)} hit={float((fwd>0).mean()):.3f} "
                  f"median={fwd.median():+.4f} mean={fwd.mean():+.4f} "
                  f"worst={fwd.min():+.4f} best={fwd.max():+.4f}")


if __name__ == "__main__":
    main()
