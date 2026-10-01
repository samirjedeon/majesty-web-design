"""
Phases 4/6/11 — threshold grid, blend, permutation tests, yearly/regime
breakdowns. TRAIN walk-forward + VALIDATION only; TEST stays untouched.
"""
import os
import numpy as np
import pandas as pd

from backtest import run_strategy, ann_metrics
from research_models import positions_from_score, past_rank

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
COST = 15.0

SPANS = {"WF16-21": ("2016-01-01", "2021-12-31"), "VAL22-23": ("2022-01-01", "2023-12-31")}


def load():
    ohlc = pd.read_csv(os.path.join(PROC, "btc_daily_ohlcv.csv"), index_col=0, parse_dates=True)
    sa = pd.read_csv(os.path.join(PROC, "score_composite.csv"), index_col=0, parse_dates=True).iloc[:, 0]
    sb = pd.read_csv(os.path.join(PROC, "score_gbm.csv"), index_col=0, parse_dates=True).iloc[:, 0]
    blend = (past_rank(sa) + past_rank(sb)) / 2
    return ohlc, {"COMP": sa, "GBM": sb, "BLEND": blend}


def sharpe_of(open_px, pos, span, cost=COST):
    r = run_strategy(open_px, pos.loc[span[0]:span[1]], cost)["net"]
    m = ann_metrics(r)
    return m.get("sharpe", np.nan), r


def main():
    ohlc, scores = load()
    open_px = ohlc["open"]

    print("=== 1) threshold grid (net Sharpe @15bps, WF | VAL) ===")
    grid = [(0.6, 0.4), (0.65, 0.35), (0.7, 0.3), (0.75, 0.25), (0.8, 0.2)]
    for nm, s in scores.items():
        line = [nm]
        for qh, ql in grid:
            pos = positions_from_score(s, q_hi=qh, q_lo=ql)
            a, _ = sharpe_of(open_px, pos, SPANS["WF16-21"])
            b, _ = sharpe_of(open_px, pos, SPANS["VAL22-23"])
            line.append(f"{qh:.2f}/{ql:.2f}: {a:5.2f}|{b:5.2f}")
        print("  ".join(line))

    print("\n=== 2) permutation test (circularly shift positions vs returns), q=0.7/0.3 ===")
    rng = np.random.default_rng(3)
    for nm, s in scores.items():
        pos = positions_from_score(s)
        for span_name, span in SPANS.items():
            real, r = sharpe_of(open_px, pos, span)
            p_slice = pos.loc[span[0]:span[1]]
            null = []
            for _ in range(500):
                k = rng.integers(30, len(p_slice) - 30)
                shifted = pd.Series(np.roll(p_slice.values, k), index=p_slice.index)
                sh, _ = sharpe_of(open_px, shifted, span)
                null.append(sh)
            null = np.array(null)
            pval = (np.sum(null >= real) + 1) / (len(null) + 1)
            print(f"{nm:6s} {span_name}: Sharpe={real:5.2f}  null mean={null.mean():5.2f} "
                  f"sd={null.std():4.2f}  p={pval:.3f}")

    print("\n=== 3) yearly net Sharpe (q=0.7/0.3, 15bps) ===")
    for nm, s in scores.items():
        pos = positions_from_score(s)
        res = run_strategy(open_px, pos, COST)["net"]
        yr = res.loc["2016":"2023"].groupby(res.loc["2016":"2023"].index.year).apply(
            lambda x: ann_metrics(x).get("sharpe", np.nan))
        print(nm, yr.round(2).to_dict())

    print("\n=== 4) regime breakdown on WF+VAL (2016-2023) ===")
    c = ohlc["close"]
    trend_up = c > c.rolling(200).mean()
    rv = pd.read_csv(os.path.join(PROC, "btc_daily_merged.csv"), parse_dates=["date"]).set_index("date")["rv_5m"]
    hi_vol = rv > rv.rolling(365, min_periods=180).median()
    for nm, s in scores.items():
        pos = positions_from_score(s)
        res = run_strategy(open_px, pos, COST)["net"].loc["2016-01-01":"2023-12-31"]
        for rn, mask in [("trend_up", trend_up), ("trend_dn", ~trend_up),
                         ("hi_vol", hi_vol), ("lo_vol", ~hi_vol)]:
            m = mask.reindex(res.index).fillna(False)
            sh = ann_metrics(res[m]).get("sharpe", np.nan)
            print(f"{nm:6s} {rn}: n={int(m.sum()):4d} sharpe={sh:5.2f}", end="   ")
        print()

    print("\n=== 5) long-only vs short-only decomposition (2016-2023, 15bps) ===")
    for nm, s in scores.items():
        pos = positions_from_score(s)
        for side, p in [("long", pos.clip(lower=0)), ("short", pos.clip(upper=0))]:
            res = run_strategy(open_px, p, COST)["net"]
            for span_name, span in SPANS.items():
                sh = ann_metrics(res.loc[span[0]:span[1]]).get("sharpe", np.nan)
                print(f"{nm:6s} {side:5s} {span_name}: {sh:5.2f}", end="   ")
            print()


if __name__ == "__main__":
    main()
