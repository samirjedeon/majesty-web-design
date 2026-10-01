"""
Phases 2b/4/5 — Models with purged walk-forward training; evaluation on
TRAIN (walk-forward, 2016..2021) and VALIDATION (2022..2023).
The 2024+ TEST window is not touched here.

Models
------
A. COMPOSITE: interpretable equal-weight average of past-rank-transformed
   screened features (orientation fixed from training ICs).
B. GBM: LightGBM regression on fwd_ret_2d, retrained each Jan 1 on all data
   ending 3 days before the prediction window (purge gap >= label horizon).

Positioning: score -> trailing 1y percentile; BUY above q_hi, SELL below
q_lo, else WAIT (hysteresis: keep position until score crosses back through
neutral band edge +/- hyst). Thresholds are chosen on VALIDATION later; here
we scan a coarse grid on TRAIN walk-forward only.
"""
import os
import numpy as np
import pandas as pd
import lightgbm as lgb

from backtest import run_strategy, ann_metrics, trade_stats

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")

TRAIN_END = pd.Timestamp("2021-12-31")
VAL_END = pd.Timestamp("2023-12-31")
PURGE = 3

COMPOSITE_FEATS = [  # from screen_ic.py train-only results; all oriented +
    "ma_z_30", "ret_14d", "volu_z_7_90", "upvol_share_7",
    "mvrv_rank", "mvrv_ch_30", "flowin_z", "spotvol_z", "rv_rank",
]
GBM_FEATS_EXCLUDE = {"funding", "funding_3d", "funding_z_30"}  # short history


def past_rank(s, win=730, mp=180):
    return s.rolling(win, min_periods=mp).rank(pct=True)


def composite_score(df):
    ranked = [past_rank(df[c]) for c in COMPOSITE_FEATS]
    return pd.concat(ranked, axis=1).mean(axis=1).rename("score")


def gbm_walkforward(df, feats, label="fwd_ret_2d", start_year=2016, end=VAL_END):
    """Expanding window, retrain each Jan 1. Purge PURGE days before test."""
    preds = pd.Series(index=df.index, dtype=float)
    for year in range(start_year, end.year + 1):
        t0 = pd.Timestamp(f"{year}-01-01")
        t1 = min(pd.Timestamp(f"{year}-12-31"), end)
        tr = df.loc[: t0 - pd.Timedelta(days=PURGE + 1)].dropna(subset=[label])
        tr = tr.dropna(subset=feats, thresh=int(0.7 * len(feats)))
        if len(tr) < 700:
            continue
        m = lgb.LGBMRegressor(
            n_estimators=300, learning_rate=0.03, num_leaves=15,
            min_child_samples=100, subsample=0.8, subsample_freq=1,
            colsample_bytree=0.7, reg_lambda=5.0, random_state=7, verbose=-1,
        )
        m.fit(tr[feats], tr[label])
        te = df.loc[t0:t1]
        if len(te):
            preds.loc[te.index] = m.predict(te[feats])
    return preds


def positions_from_score(score, q_hi=0.7, q_lo=0.3, hyst=0.05, win=365):
    """Trailing-percentile thresholds with hysteresis; long/short/flat."""
    pct = score.rolling(win, min_periods=180).rank(pct=True)
    pos = np.zeros(len(pct))
    p = 0
    for i, x in enumerate(pct.values):
        if np.isnan(x):
            p = 0
        elif x >= q_hi:
            p = 1
        elif x <= q_lo:
            p = -1
        elif p == 1 and x < q_hi - hyst:
            p = 0
        elif p == -1 and x > q_lo + hyst:
            p = 0
        pos[i] = p
    return pd.Series(pos, index=score.index)


def evaluate(open_px, score, label, cost_bps, spans, q_hi=0.7, q_lo=0.3):
    pos = positions_from_score(score, q_hi=q_hi, q_lo=q_lo)
    out = []
    for span_name, (a, b) in spans.items():
        res = run_strategy(open_px, pos.loc[a:b], cost_bps)
        m = ann_metrics(res["net"], f"{label}|{span_name}|cost={cost_bps}bps")
        m.update({f"t_{k}": v for k, v in trade_stats(res).items()})
        m["pct_long"] = (res["pos"] > 0).mean()
        m["pct_short"] = (res["pos"] < 0).mean()
        m["pct_wait"] = (res["pos"] == 0).mean()
        out.append(m)
    return pd.DataFrame(out)


def main():
    df = pd.read_csv(os.path.join(PROC, "features.csv"), parse_dates=["date"]).set_index("date")
    ohlc = pd.read_csv(os.path.join(PROC, "btc_daily_ohlcv.csv"), index_col=0, parse_dates=True)
    open_px = ohlc["open"]

    spans = {
        "trainWF 2016-2021": ("2016-01-01", "2021-12-31"),
        "VALID 2022-2023": ("2022-01-01", "2023-12-31"),
    }

    # ---- Model A: composite
    score_a = composite_score(df)
    score_a.to_csv(os.path.join(PROC, "score_composite.csv"))

    # ---- Model B: GBM walk-forward
    feats = [c for c in df.columns
             if not c.startswith("fwd_ret") and c != "close" and c not in GBM_FEATS_EXCLUDE]
    score_b = gbm_walkforward(df, feats)
    score_b.to_csv(os.path.join(PROC, "score_gbm.csv"))

    # ---- Benchmarks
    lr_open = np.log(open_px.shift(-2) / open_px.shift(-1))
    rows = []
    for nm, (a, b) in spans.items():
        m = ann_metrics(lr_open.loc[a:b], f"buy&hold|{nm}")
        rows.append(m)
        # MA cross 20/100
        ma_pos = (ohlc["close"].rolling(20).mean() > ohlc["close"].rolling(100).mean()).astype(float)
        res = run_strategy(open_px, ma_pos.loc[a:b], 15)
        rows.append(ann_metrics(res["net"], f"MA20/100 long/flat|{nm}|15bps"))
        rng = np.random.default_rng(11)
        rnd_sh = []
        for _ in range(200):
            rp = pd.Series(rng.choice([-1, 0, 1], size=len(lr_open.loc[a:b])), index=lr_open.loc[a:b].index)
            rr = run_strategy(open_px, rp, 15)["net"]
            rnd_sh.append(ann_metrics(rr).get("sharpe", np.nan))
        rows.append(dict(name=f"random +-1/0|{nm}|15bps", sharpe=float(np.nanmean(rnd_sh)),
                         ann_ret=np.nan))
    bench = pd.DataFrame(rows)

    pd.set_option("display.width", 250)
    cols = ["name", "ann_ret", "ann_vol", "sharpe", "sortino", "max_dd_log",
            "t_n_trades", "t_win_rate", "t_expectancy", "t_profit_factor",
            "pct_long", "pct_short", "pct_wait"]
    for label, score in [("COMPOSITE", score_a), ("GBM", score_b)]:
        for cost in (0, 15, 30):
            r = evaluate(open_px, score, label, cost, spans)
            print(r.reindex(columns=[c for c in cols if c in r.columns]).round(3).to_string(index=False))
        print()
    print(bench.round(3).to_string(index=False))


if __name__ == "__main__":
    main()
