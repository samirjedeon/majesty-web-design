"""
Live paper-trading signal monitor (Phase: LIVE MONITOR DESIGN).

IMPORTANT — research verdict (see ../reports/RESEARCH_REPORT.md):
NO ROBUST EDGE FOUND YET. The frozen system was profitable and robust on
2016-2023 but FAILED the untouched 2024-2026 test after costs. This monitor
exists to record signals forward, out of sample, so the strategy can be
re-judged on genuinely unseen data. It does NOT place trades and its output
is not investment advice.

What it does on each run:
  1. refresh data (Bitstamp mirror / Bitstamp API, Coin Metrics community)
  2. rebuild daily bars + features (same leakage-safe code as research)
  3. compute composite + GBM scores, run the AGREE-65/35 state machine
  4. print BUY / SELL / WAIT, a 0-100 score (NOT a calibrated probability),
     the top factors, and historical comparable-setup statistics
  5. append the signal to signals.db (SQLite) with the BTC price at signal
     time; backfill realized 24/48/72h outcomes for earlier signals

Run daily shortly after 00:00 UTC. Live deployment needs open network
access to bitstamp.net and community-api.coinmetrics.io (or the GitHub
mirrors used as fallback).
"""
import io
import os
import sqlite3
import sys
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests
import lightgbm as lgb

import build_dataset
import features as feat_mod
from research_models import positions_from_score, COMPOSITE_FEATS, past_rank

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
RAW = os.path.join(HERE, "..", "data", "raw")
MODELS = os.path.join(HERE, "..", "models")
DB = os.path.join(HERE, "..", "data", "signals.db")

Q_HI, Q_LO, HYST, WIN = 0.65, 0.35, 0.05, 365
CM_API = ("https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
          "?assets={a}&metrics={m}&page_size=10000&start_time={s}&format=json")
CM_RAW = "https://raw.githubusercontent.com/coinmetrics/data/master/csv/{a}.csv"
BITSTAMP_OHLC = ("https://www.bitstamp.net/api/v2/ohlc/btcusd/"
                 "?step=3600&limit=1000")


def log(msg):
    print(f"[monitor] {msg}", file=sys.stderr)


def refresh_cm():
    """Fetch fresh Coin Metrics community CSVs; keep old copy on failure."""
    for a in ("btc", "eth", "usdt", "usdc"):
        try:
            r = requests.get(CM_RAW.format(a=a), timeout=120)
            r.raise_for_status()
            with open(os.path.join(RAW, f"cm_{a}.csv"), "wb") as f:
                f.write(r.content)
            log(f"coinmetrics {a}: refreshed")
        except Exception as e:
            log(f"coinmetrics {a}: refresh failed ({e}); using cached copy")


def refresh_price():
    """Top up the minute/hourly price history from the Bitstamp API."""
    try:
        r = requests.get(BITSTAMP_OHLC, timeout=60)
        r.raise_for_status()
        rows = r.json()["data"]["ohlc"]
        df = pd.DataFrame(rows).astype(float)
        df["timestamp"] = df["timestamp"].astype(int)
        out = os.path.join(RAW, "bitstamp_recent_1h.csv")
        df[["timestamp", "open", "high", "low", "close", "volume"]].to_csv(out, index=False)
        log(f"bitstamp API: {len(df)} hourly bars through "
            f"{datetime.fromtimestamp(df.timestamp.max(), tz=timezone.utc)}")
    except Exception as e:
        log(f"bitstamp API unavailable ({e}); relying on mirror data")


def compute_scores():
    df = build_dataset.build()
    f = feat_mod.build_features(df)
    booster = lgb.Booster(model_file=os.path.join(MODELS, "gbm_live.txt"))
    feats = open(os.path.join(MODELS, "gbm_features.txt")).read().splitlines()
    gbm_score = pd.Series(booster.predict(f[feats]), index=f.index)
    comp_score = pd.concat([past_rank(f[c]) for c in COMPOSITE_FEATS], axis=1).mean(axis=1)
    return df, f, feats, booster, comp_score, gbm_score


def current_state(comp_score, gbm_score):
    pa = positions_from_score(comp_score, Q_HI, Q_LO, HYST, WIN)
    pb = positions_from_score(gbm_score, Q_HI, Q_LO, HYST, WIN)
    pos = pa.where(pa == pb, 0.0)
    pct_a = comp_score.rolling(WIN, min_periods=180).rank(pct=True)
    pct_b = gbm_score.rolling(WIN, min_periods=180).rank(pct=True)
    score01 = (pct_a + pct_b) / 2
    return pos, score01


def top_factors(booster, feats, frow):
    contrib = booster.predict(frow[feats].values.reshape(1, -1), pred_contrib=True)[0][:-1]
    order = np.argsort(-np.abs(contrib))
    out = []
    for i in order[:5]:
        direction = "supports BUY" if contrib[i] > 0 else "supports SELL"
        out.append(f"{feats[i]} = {frow[feats[i]]:+.3f}  ({direction}, contrib {contrib[i]:+.5f})")
    return out


def setup_stats(pos, close, state):
    mask = pos == (1 if state == "BUY" else -1)
    idx = pos.index[mask & (pos.index >= "2016-01-01")]
    lines = []
    for h in (1, 2, 3):
        fwd = np.log(close.shift(-h) / close).reindex(idx)
        fwd = (fwd if state == "BUY" else -fwd).dropna()
        if not len(fwd):
            continue
        eq = fwd.cumsum()
        lines.append(
            f"  {h*24}h: n={len(fwd)}  hit={float((fwd > 0).mean()):.1%}  "
            f"median={fwd.median():+.2%}  mean={fwd.mean():+.2%}  "
            f"worst={fwd.min():+.2%}  best={fwd.max():+.2%}  "
            f"maxDD={float((eq - eq.cummax()).min()):+.2%}"
        )
    return lines


def record(date, state, score, price):
    con = sqlite3.connect(DB)
    con.execute(
        """CREATE TABLE IF NOT EXISTS signals(
             date TEXT PRIMARY KEY, created_utc TEXT, state TEXT,
             score REAL, btc_price REAL,
             ret_24h REAL, ret_48h REAL, ret_72h REAL)"""
    )
    con.execute(
        "INSERT OR REPLACE INTO signals(date, created_utc, state, score, btc_price) "
        "VALUES (?,?,?,?,?)",
        (str(date.date()), datetime.now(timezone.utc).isoformat(), state,
         float(score), float(price)),
    )
    con.commit()
    return con


def backfill_outcomes(con, close):
    cur = con.execute("SELECT date FROM signals WHERE ret_72h IS NULL")
    for (d,) in cur.fetchall():
        t = pd.Timestamp(d)
        if t not in close.index:
            continue
        vals = {}
        for h, col in [(1, "ret_24h"), (2, "ret_48h"), (3, "ret_72h")]:
            t2 = t + pd.Timedelta(days=h)
            if t2 in close.index:
                vals[col] = float(np.log(close.loc[t2] / close.loc[t]))
        if vals:
            sets = ",".join(f"{k}=?" for k in vals)
            con.execute(f"UPDATE signals SET {sets} WHERE date=?", (*vals.values(), d))
    con.commit()


def main():
    refresh_cm()
    refresh_price()
    df, f, feats, booster, comp_score, gbm_score = compute_scores()
    pos, score01 = current_state(comp_score, gbm_score)
    t = pos.index[-1]
    state = {1.0: "BUY", -1.0: "SELL", 0.0: "WAIT"}[float(pos.iloc[-1])]
    score = float(score01.iloc[-1]) * 100
    price = float(df["close"].iloc[-1])

    # staleness checks
    onchain_last = df["mvrv"].dropna().index.max()
    onchain_age = (t - onchain_last).days
    print("=" * 60)
    print("CURRENT BTC SIGNAL")
    print("=" * 60)
    print(f"\n{state}\n")
    print(f"Signal score: {int(round(score))}/100  (composite+GBM percentile; "
          f"NOT a calibrated probability)")
    print("Target horizon: 24h-72h (validated label: 48h)")
    print(f"As of (UTC daily close): {t.date()}   BTC price: ${price:,.0f}")
    if onchain_age > 3:
        print(f"WARNING: on-chain inputs are {onchain_age} days stale "
              f"(last {onchain_last.date()}); score relies on price features")
    print("\nMajor factors (GBM contribution on latest bar):")
    for line in top_factors(booster, feats, f.iloc[-1]):
        print(f"  * {line}")
    if state != "WAIT":
        print(f"\nHistorical comparable {state} setups (2016..present, gross):")
        for line in setup_stats(pos, df["close"], state):
            print(line)
    print("\nNOTE: research verdict = NO ROBUST EDGE FOUND YET (failed the "
          "2024-2026 out-of-sample test after costs). Paper-trading record "
          "only; not investment advice.")
    con = record(t, state, score, price)
    backfill_outcomes(con, df["close"])
    n = con.execute("SELECT COUNT(*) FROM signals").fetchone()[0]
    print(f"\nRecorded to signals.db ({n} rows).")


if __name__ == "__main__":
    main()
