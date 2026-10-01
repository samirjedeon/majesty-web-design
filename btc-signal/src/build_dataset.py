"""
Phase 1 — Build a clean, timestamp-aligned historical dataset.

Sources (all documented in ../README.md):
  1. Bitstamp BTC/USD 1-minute OHLCV, 2012-01-01 .. present
     (github.com/ff137/bitstamp-btcusd-minute-data, mirror of Kaggle
      mczielinski/bitcoin-historical-data, CC BY-SA 4.0)
  2. Coin Metrics Community data, daily on-chain metrics for BTC/ETH/USDT/USDC
     (github.com/coinmetrics/data, CC BY-NC 4.0)
  3. Multi-exchange BTC perp funding rates 2020-2023
     (github.com/supervik/historical-funding-rates-fetcher)

Leakage controls
----------------
* The unit of observation is a UTC day D. All same-day price/volume features
  use ONLY minute bars with timestamp < midnight UTC ending day D
  ("decision time" = 00:00 UTC of D+1).
* Coin Metrics daily metrics for day D are published mid-day D+1 (metric
  completion ~12-20h after UTC midnight). They are therefore LAGGED BY ONE
  DAY: at decision time end-of-D, the latest usable on-chain row is D-1.
* Funding rates print in real time (every 1-8h); the day-D aggregate uses
  only fundings with timestamp <= end of day D.
* Forward returns are close(D) -> close(D+h), h in {1,2,3} days
  (24h / 48h / 72h target horizons).
"""
import gzip
import io
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "..", "data", "raw")
OUT = os.path.join(HERE, "..", "data", "processed")
BITSTAMP_DIR = os.environ.get(
    "BITSTAMP_DIR", "/home/user/ff137/bitstamp-btcusd-minute-data/data"
)
FUNDING_DIR = os.environ.get(
    "FUNDING_DIR",
    "/home/user/supervik/historical-funding-rates-fetcher/data/BTC-USDT",
)


def load_minute() -> pd.DataFrame:
    hist = os.path.join(BITSTAMP_DIR, "historical", "btcusd_bitstamp_1min_2012-2025.csv.gz")
    upd = os.path.join(BITSTAMP_DIR, "updates", "btcusd_bitstamp_1min_latest.csv")
    frames = [pd.read_csv(hist)]
    if os.path.exists(upd):
        frames.append(pd.read_csv(upd))
    df = pd.concat(frames, ignore_index=True)
    df.columns = [c.lower() for c in df.columns]
    df = df.drop_duplicates("timestamp").sort_values("timestamp")
    df["dt"] = pd.to_datetime(df["timestamp"], unit="s", utc=True)
    df = df.set_index("dt")
    return df


def daily_bars(minute: pd.DataFrame) -> pd.DataFrame:
    # label='left', so row "D" covers [D 00:00, D+1 00:00) UTC
    o = minute["open"].resample("1D").first()
    h = minute["high"].resample("1D").max()
    l = minute["low"].resample("1D").min()
    c = minute["close"].resample("1D").last()
    v_btc = minute["volume"].resample("1D").sum()
    v_usd = (minute["volume"] * minute["close"]).resample("1D").sum()
    # intraday realized volatility from 5-minute log returns
    c5 = minute["close"].resample("5min").last().ffill()
    r5 = np.log(c5).diff()
    rv = r5.groupby(r5.index.floor("D")).apply(lambda x: np.sqrt(np.nansum(x**2)))
    # Parkinson estimator from hourly bars
    h1 = minute["high"].resample("1h").max()
    l1 = minute["low"].resample("1h").min()
    pk = (np.log(h1 / l1) ** 2 / (4 * np.log(2)))
    pk_d = np.sqrt(pk.groupby(pk.index.floor("D")).sum())
    out = pd.DataFrame(
        {"open": o, "high": h, "low": l, "close": c,
         "vol_btc": v_btc, "vol_usd": v_usd, "rv_5m": rv, "rv_park": pk_d}
    )
    out.index = out.index.tz_localize(None)
    return out


def load_cm(asset: str) -> pd.DataFrame:
    df = pd.read_csv(os.path.join(RAW, f"cm_{asset}.csv"), parse_dates=["time"])
    df = df.set_index("time")
    return df


def load_funding() -> pd.Series:
    """Median daily funding across exchanges (sum of daily fundings per
    exchange, then cross-exchange median) — robust to venue quirks."""
    per_ex = {}
    for f in os.listdir(FUNDING_DIR):
        if not f.endswith(".csv"):
            continue
        ex = f.split("_")[1]
        d = pd.read_csv(os.path.join(FUNDING_DIR, f))
        d["Date"] = pd.to_datetime(d["Date"])
        daily = d.set_index("Date")["Funding Rate"].resample("1D").sum(min_count=1)
        per_ex[ex] = daily
    fx = pd.DataFrame(per_ex)
    return fx.median(axis=1, skipna=True).rename("funding_daily")


def build() -> pd.DataFrame:
    os.makedirs(OUT, exist_ok=True)
    minute = load_minute()
    px = daily_bars(minute)
    # drop the (possibly partial) last day: only completed UTC days
    last_min_ts = minute.index.max()
    last_complete = (last_min_ts.floor("D") - pd.Timedelta(days=1)).tz_localize(None)
    px = px.loc[:last_complete]
    px.to_csv(os.path.join(OUT, "btc_daily_ohlcv.csv"))

    btc = load_cm("btc")
    eth = load_cm("eth")
    usdt = load_cm("usdt")
    usdc = load_cm("usdc")

    cm_cols = {
        "AdrActCnt": "adr_act", "CapMVRVCur": "mvrv", "FeeTotNtv": "fee_ntv",
        "FlowInExNtv": "flow_in_ex", "FlowOutExNtv": "flow_out_ex",
        "HashRate": "hashrate", "SplyCur": "sply",
        "SplyExNtv": "sply_ex", "TxTfrCnt": "tx_tfr",
        "volume_reported_spot_usd_1d": "spot_vol_usd",
    }
    cm = btc[list(cm_cols)].rename(columns=cm_cols)
    cm["eth_price"] = eth["PriceUSD"]
    cm["stbl_sply"] = usdt["SplyCur"].fillna(0) + usdc["SplyCur"].fillna(0)
    # LAG 1 DAY: on-chain day D usable only at end of D+1
    cm = cm.shift(1)

    df = px.join(cm, how="left")

    fund = load_funding()
    df = df.join(fund, how="left")

    # forward returns (labels)
    for h in (1, 2, 3):
        df[f"fwd_ret_{h}d"] = np.log(df["close"].shift(-h) / df["close"])

    df.index.name = "date"
    df.to_csv(os.path.join(OUT, "btc_daily_merged.csv"))
    print(f"rows={len(df)}  span={df.index.min()}..{df.index.max()}")
    print("non-null:", {c: int(df[c].notna().sum()) for c in df.columns})
    return df


if __name__ == "__main__":
    build()
