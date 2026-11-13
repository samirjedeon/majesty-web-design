"""
Phase 2a — Univariate screening on the TRAINING SET ONLY (2012..2021).

For every feature and horizon: Spearman rank IC vs forward return, with a
Newey-West-corrected t-statistic (overlapping multi-day labels induce serial
correlation), plus per-year IC to check sign stability.

Multiple-testing posture: with ~40 features x 3 horizons (~120 tests) we
expect ~6 |t|>1.96 by chance. We therefore require |t_NW| >= 3 AND majority
same-sign yearly ICs before a feature graduates to the model stage.
"""
import os
import numpy as np
import pandas as pd
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")

TRAIN_END = "2021-12-31"


def nw_tstat(x: np.ndarray, y: np.ndarray, lags: int) -> float:
    """t-stat of slope in y ~ x (both rank-transformed), HAC/Newey-West."""
    xr = stats.rankdata(x) / len(x)
    yr = stats.rankdata(y) / len(y)
    xr = (xr - xr.mean())
    yr = (yr - yr.mean())
    beta = (xr * yr).sum() / (xr * xr).sum()
    u = yr - beta * xr
    s = xr * u
    n = len(s)
    g0 = (s * s).mean()
    v = g0
    for L in range(1, lags + 1):
        w = 1 - L / (lags + 1)
        v += 2 * w * (s[:-L] * s[L:]).mean()
    se = np.sqrt(v / n) / (xr * xr).mean()
    return beta / se


def main():
    df = pd.read_csv(os.path.join(PROC, "features.csv"), parse_dates=["date"]).set_index("date")
    train = df.loc[:TRAIN_END]
    feats = [c for c in df.columns if not c.startswith("fwd_ret") and c != "close"]
    rows = []
    for h, lab in [(1, "fwd_ret_1d"), (2, "fwd_ret_2d"), (3, "fwd_ret_3d")]:
        for c in feats:
            sub = train[[c, lab]].dropna()
            if len(sub) < 500:
                continue
            ic = stats.spearmanr(sub[c], sub[lab]).statistic
            t = nw_tstat(sub[c].values, sub[lab].values, lags=2 * h)
            yearly = sub.groupby(sub.index.year).apply(
                lambda g: stats.spearmanr(g[c], g[lab]).statistic if len(g) > 60 else np.nan
            )
            ys = yearly.dropna()
            sign_cons = (np.sign(ys) == np.sign(ic)).mean() if len(ys) else np.nan
            rows.append(dict(feature=c, h=h, n=len(sub), ic=ic, t_nw=t,
                             yr_sign_consistency=sign_cons, n_years=len(ys)))
    res = pd.DataFrame(rows)
    res.to_csv(os.path.join(PROC, "screen_ic_train.csv"), index=False)
    strong = res[(res.t_nw.abs() >= 3) & (res.yr_sign_consistency >= 0.6)]
    pd.set_option("display.width", 200)
    print("=== candidates passing |t_NW|>=3 & >=60% yearly sign consistency ===")
    print(strong.sort_values("t_nw", key=abs, ascending=False).to_string(index=False))
    print("\n=== top 20 by |t| overall (for reference) ===")
    print(res.reindex(res.t_nw.abs().sort_values(ascending=False).index).head(20).to_string(index=False))


if __name__ == "__main__":
    main()
