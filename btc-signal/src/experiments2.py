"""
Phase 4/5 continued — candidate final configurations (train-WF + validation),
plus the funding-rate hypothesis on its 2020-2023 data window.
TEST (2024+) remains untouched.
"""
import os
import numpy as np
import pandas as pd
from scipy import stats

from backtest import run_strategy, ann_metrics, trade_stats
from research_models import positions_from_score

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
SPANS = {"WF16-21": ("2016-01-01", "2021-12-31"), "VAL22-23": ("2022-01-01", "2023-12-31")}


def report(open_px, pos, label, costs=(15,)):
    for cost in costs:
        for nm, (a, b) in SPANS.items():
            res = run_strategy(open_px, pos.loc[a:b], cost)
            m = ann_metrics(res["net"])
            t = trade_stats(res)
            print(f"{label:28s} {nm} @{cost}bps: Sharpe={m['sharpe']:5.2f} "
                  f"ann={m['ann_ret']:6.2f} mdd={m['max_dd_log']:5.2f} "
                  f"trades={t.get('n_trades',0):3d} wr={t.get('win_rate',np.nan):.2f} "
                  f"pf={t.get('profit_factor',np.nan):4.2f} "
                  f"wait={float((res['pos']==0).mean()):.2f}")


def main():
    ohlc = pd.read_csv(os.path.join(PROC, "btc_daily_ohlcv.csv"), index_col=0, parse_dates=True)
    open_px = ohlc["open"]
    sa = pd.read_csv(os.path.join(PROC, "score_composite.csv"), index_col=0, parse_dates=True).iloc[:, 0]
    sb = pd.read_csv(os.path.join(PROC, "score_gbm.csv"), index_col=0, parse_dates=True).iloc[:, 0]

    pos_a = positions_from_score(sa, 0.65, 0.35)
    pos_b = positions_from_score(sb, 0.65, 0.35)

    print("--- candidates ---")
    report(open_px, pos_b, "GBM 0.65/0.35")
    report(open_px, positions_from_score(sb, 0.65, 0.25), "GBM asym 0.65/0.25")
    agree = pos_a.where(pos_a == pos_b, 0.0)
    report(open_px, agree, "AGREE(comp,gbm) 0.65/0.35")
    # long/flat versions
    report(open_px, pos_b.clip(lower=0), "GBM long/flat")
    report(open_px, agree.clip(lower=0), "AGREE long/flat")
    # min-hold 2 days on GBM
    ph = pos_b.copy()
    held = 0
    prev = 0.0
    vals = []
    for x in ph.values:
        if x != prev and held < 2 and prev != 0:
            x = prev
            held += 1
        elif x != prev:
            held = 0
        else:
            held += 1
        prev = x
        vals.append(x)
    report(open_px, pd.Series(vals, index=ph.index), "GBM min-hold2")

    print("\n--- funding hypothesis (2020-2023 only) ---")
    df = pd.read_csv(os.path.join(PROC, "features.csv"), parse_dates=["date"]).set_index("date")
    sub = df.loc["2020-01-01":"2023-12-31"]
    for c in ["funding", "funding_3d", "funding_z_30"]:
        for lab in ["fwd_ret_1d", "fwd_ret_2d", "fwd_ret_3d"]:
            s2 = sub[[c, lab]].dropna()
            ic = stats.spearmanr(s2[c], s2[lab]).statistic
            print(f"{c:14s} vs {lab}: IC={ic:6.3f} n={len(s2)}")
    # does funding add value conditional on GBM score? interaction check:
    q = sub.copy()
    q["gbm"] = sb
    q = q.dropna(subset=["gbm", "funding_3d", "fwd_ret_2d"])
    for gname, g in [("gbm_hi", q[q.gbm > q.gbm.quantile(0.65)]),
                     ("gbm_lo", q[q.gbm < q.gbm.quantile(0.35)])]:
        neg = g[g.funding_3d < 0]["fwd_ret_2d"].mean()
        pos_ = g[g.funding_3d >= 0]["fwd_ret_2d"].mean()
        print(f"{gname}: mean fwd2d | funding<0 = {neg:+.4f} (n={len(g[g.funding_3d<0])}), "
              f"funding>=0 = {pos_:+.4f} (n={len(g[g.funding_3d>=0])})")


if __name__ == "__main__":
    main()
