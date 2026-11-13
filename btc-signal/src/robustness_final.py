"""
Phases 6/7/11 — robustness of the FINAL candidate before touching TEST.

Final candidate ("AGREE"): position = composite position when composite and
GBM positions agree, else WAIT. Both use trailing-percentile thresholds
q_hi/q_lo with hysteresis h and rank window w.

Checks: parameter perturbation (thresholds, hysteresis, rank window),
composite drop-one-feature, GBM seed/hyperparameter jitter, cost grid,
circular-shift permutation test.
"""
import os
import numpy as np
import pandas as pd
import lightgbm as lgb

from backtest import run_strategy, ann_metrics
from research_models import positions_from_score, composite_score, gbm_walkforward, \
    COMPOSITE_FEATS, GBM_FEATS_EXCLUDE, past_rank

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
SPANS = {"WF16-21": ("2016-01-01", "2021-12-31"), "VAL22-23": ("2022-01-01", "2023-12-31")}
Q_HI, Q_LO, HYST, WIN = 0.65, 0.35, 0.05, 365


def agree_pos(sa, sb, qh=Q_HI, ql=Q_LO, hyst=HYST, win=WIN):
    pa = positions_from_score(sa, qh, ql, hyst, win)
    pb = positions_from_score(sb, qh, ql, hyst, win)
    return pa.where(pa == pb, 0.0)


def sh(open_px, pos, span, cost=15.0):
    r = run_strategy(open_px, pos.loc[span[0]:span[1]], cost)["net"]
    return ann_metrics(r).get("sharpe", np.nan)


def main():
    df = pd.read_csv(os.path.join(PROC, "features.csv"), parse_dates=["date"]).set_index("date")
    ohlc = pd.read_csv(os.path.join(PROC, "btc_daily_ohlcv.csv"), index_col=0, parse_dates=True)
    open_px = ohlc["open"]
    sa = pd.read_csv(os.path.join(PROC, "score_composite.csv"), index_col=0, parse_dates=True).iloc[:, 0]
    sb = pd.read_csv(os.path.join(PROC, "score_gbm.csv"), index_col=0, parse_dates=True).iloc[:, 0]

    base = agree_pos(sa, sb)
    print("=== baseline ===")
    for nm, span in SPANS.items():
        print(f"  {nm}: {sh(open_px, base, span):5.2f}")

    print("\n=== 1) threshold perturbation (WF | VAL) ===")
    for dq in (-0.05, -0.025, 0.0, 0.025, 0.05):
        p = agree_pos(sa, sb, Q_HI + dq, Q_LO - dq)
        print(f"  q={Q_HI+dq:.3f}/{Q_LO-dq:.3f}: "
              f"{sh(open_px,p,SPANS['WF16-21']):5.2f} | {sh(open_px,p,SPANS['VAL22-23']):5.2f}")
    print("=== hysteresis ===")
    for hy in (0.0, 0.025, 0.05, 0.1):
        p = agree_pos(sa, sb, hyst=hy)
        print(f"  h={hy}: {sh(open_px,p,SPANS['WF16-21']):5.2f} | {sh(open_px,p,SPANS['VAL22-23']):5.2f}")
    print("=== rank window ===")
    for w in (270, 365, 500):
        p = agree_pos(sa, sb, win=w)
        print(f"  w={w}: {sh(open_px,p,SPANS['WF16-21']):5.2f} | {sh(open_px,p,SPANS['VAL22-23']):5.2f}")

    print("\n=== 2) composite drop-one-feature ===")
    for drop in COMPOSITE_FEATS:
        keep = [c for c in COMPOSITE_FEATS if c != drop]
        s2 = pd.concat([past_rank(df[c]) for c in keep], axis=1).mean(axis=1)
        p = agree_pos(s2, sb)
        print(f"  -{drop:14s}: {sh(open_px,p,SPANS['WF16-21']):5.2f} | {sh(open_px,p,SPANS['VAL22-23']):5.2f}")

    print("\n=== 3) GBM seed & hyperparameter jitter ===")
    feats = [c for c in df.columns
             if not c.startswith("fwd_ret") and c != "close" and c not in GBM_FEATS_EXCLUDE]
    import research_models as rm
    for tag, params in [
        ("seed13", dict(random_state=13)),
        ("seed99", dict(random_state=99)),
        ("leaves31", dict(num_leaves=31)),
        ("leaves7", dict(num_leaves=7)),
        ("lr0.06", dict(learning_rate=0.06, n_estimators=150)),
        ("label1d", dict()),  # trained on fwd_ret_1d
        ("label3d", dict()),  # trained on fwd_ret_3d
    ]:
        orig = lgb.LGBMRegressor
        def patched(**kw):
            kw.update(params)
            return orig(**kw)
        lgb_backup, rm_lgb = lgb.LGBMRegressor, None
        lgb.LGBMRegressor = patched
        label = "fwd_ret_2d"
        if tag == "label1d":
            label = "fwd_ret_1d"
        if tag == "label3d":
            label = "fwd_ret_3d"
        s2 = gbm_walkforward(df, feats, label=label)
        lgb.LGBMRegressor = lgb_backup
        p = agree_pos(sa, s2)
        print(f"  {tag:10s}: {sh(open_px,p,SPANS['WF16-21']):5.2f} | {sh(open_px,p,SPANS['VAL22-23']):5.2f}")

    print("\n=== 4) cost grid (one-way bps) ===")
    for cost in (0, 5, 10, 15, 30, 50):
        a = sh(open_px, base, SPANS["WF16-21"], cost)
        b = sh(open_px, base, SPANS["VAL22-23"], cost)
        print(f"  {cost:2d}bps: {a:5.2f} | {b:5.2f}")

    print("\n=== 5) permutation test (circular shift, 1000 draws) ===")
    rng = np.random.default_rng(5)
    for nm, span in SPANS.items():
        real = sh(open_px, base, span)
        p_slice = base.loc[span[0]:span[1]]
        null = []
        for _ in range(1000):
            k = rng.integers(30, len(p_slice) - 30)
            shifted = pd.Series(np.roll(p_slice.values, k), index=p_slice.index)
            null.append(sh(open_px, shifted, span))
        null = np.array(null)
        pval = (np.sum(null >= real) + 1) / (len(null) + 1)
        print(f"  {nm}: Sharpe={real:.2f} null={null.mean():.2f}±{null.std():.2f} p={pval:.4f}")

    print("\n=== 6) execution delay stress: fill at NEXT day's open (24h late) ===")
    delayed = base.shift(1)
    for nm, span in SPANS.items():
        print(f"  {nm}: {sh(open_px, delayed, span):5.2f}")


if __name__ == "__main__":
    main()
