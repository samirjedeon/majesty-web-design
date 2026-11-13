"""
Phase 1b — Candidate features across multiple lookback windows.

All rolling statistics are PAST-ONLY (pandas rolling windows end at the
current row, which contains only information available at decision time —
on-chain columns were already lagged one day in build_dataset.py).
Normalisation uses a rolling 2-year percentile-rank transform computed from
past values only; no full-sample statistics are ever used.
"""
import os
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")

RANK_WIN = 730  # 2y rolling percentile window


def past_rank(s: pd.Series, win: int = RANK_WIN, min_periods: int = 180) -> pd.Series:
    """Percentile rank of the current value within the trailing window."""
    return s.rolling(win, min_periods=min_periods).rank(pct=True)


def zlog(s: pd.Series) -> pd.Series:
    return np.log(s.replace(0, np.nan))


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    f = pd.DataFrame(index=df.index)
    c = df["close"]
    lr = np.log(c).diff()

    # --- momentum / mean reversion over multiple lookbacks
    for w in (1, 3, 7, 14, 30, 90):
        f[f"ret_{w}d"] = np.log(c / c.shift(w))
    for w in (30, 90, 200):
        ma = c.rolling(w).mean()
        sd = c.rolling(w).std()
        f[f"ma_z_{w}"] = (c - ma) / sd
    hi90 = c.rolling(90).max()
    lo90 = c.rolling(90).min()
    f["dd_90"] = c / hi90 - 1.0
    f["ru_90"] = c / lo90 - 1.0
    rng7 = (df["high"].rolling(7).max() - df["low"].rolling(7).min())
    f["rangepos_7"] = (c - df["low"].rolling(7).min()) / rng7

    # --- volatility
    f["rv"] = df["rv_5m"]
    f["rv_ratio_3_30"] = df["rv_5m"].rolling(3).mean() / df["rv_5m"].rolling(30).mean()
    f["rv_rank"] = past_rank(df["rv_5m"])
    f["park_ratio"] = df["rv_park"].rolling(3).mean() / df["rv_park"].rolling(30).mean()

    # --- volume / liquidity
    f["volu_z_7_90"] = (
        zlog(df["vol_usd"]).rolling(7).mean() - zlog(df["vol_usd"]).rolling(90).mean()
    ) / zlog(df["vol_usd"]).rolling(90).std()
    f["spotvol_z"] = (
        zlog(df["spot_vol_usd"]).rolling(7).mean()
        - zlog(df["spot_vol_usd"]).rolling(90).mean()
    ) / zlog(df["spot_vol_usd"]).rolling(90).std()
    # volume on down days vs up days (absorption proxy)
    up = (lr > 0).astype(float)
    f["upvol_share_7"] = (
        (df["vol_usd"] * up).rolling(7).sum() / df["vol_usd"].rolling(7).sum()
    )

    # --- on-chain (already lagged 1d)
    f["mvrv"] = df["mvrv"]
    f["mvrv_rank"] = past_rank(df["mvrv"])
    f["mvrv_ch_30"] = df["mvrv"] / df["mvrv"].shift(30) - 1
    netflow = (df["flow_in_ex"] - df["flow_out_ex"])
    f["netflow_7"] = netflow.rolling(7).mean() / df["sply_ex"]
    f["netflow_30"] = netflow.rolling(30).mean() / df["sply_ex"]
    f["netflow_rank"] = past_rank(netflow.rolling(7).mean() / df["sply_ex"])
    f["splyex_ch_7"] = df["sply_ex"] / df["sply_ex"].shift(7) - 1
    f["splyex_ch_30"] = df["sply_ex"] / df["sply_ex"].shift(30) - 1
    f["flowin_z"] = (
        zlog(df["flow_in_ex"]).rolling(7).mean()
        - zlog(df["flow_in_ex"]).rolling(90).mean()
    ) / zlog(df["flow_in_ex"]).rolling(90).std()
    f["adr_mom_30"] = zlog(df["adr_act"].rolling(7).mean()) - zlog(
        df["adr_act"].rolling(7).mean()
    ).shift(30)
    f["adr_px_div"] = f["adr_mom_30"] - f["ret_30d"]  # activity vs price divergence
    f["hash_mom_30"] = zlog(df["hashrate"].rolling(7).mean()) - zlog(
        df["hashrate"].rolling(7).mean()
    ).shift(30)
    f["fee_z"] = (
        zlog(df["fee_ntv"]).rolling(7).mean() - zlog(df["fee_ntv"]).rolling(90).mean()
    ) / zlog(df["fee_ntv"]).rolling(90).std()
    f["txtfr_mom_30"] = zlog(df["tx_tfr"].rolling(7).mean()) - zlog(
        df["tx_tfr"].rolling(7).mean()
    ).shift(30)

    # --- cross-asset & stablecoin liquidity (lagged 1d in build)
    ethbtc = df["eth_price"] / c
    f["ethbtc_ch_7"] = ethbtc / ethbtc.shift(7) - 1
    f["ethbtc_ch_30"] = ethbtc / ethbtc.shift(30) - 1
    f["stbl_gr_7"] = df["stbl_sply"] / df["stbl_sply"].shift(7) - 1
    f["stbl_gr_30"] = df["stbl_sply"] / df["stbl_sply"].shift(30) - 1

    # --- funding (real-time; available only 2020-2023)
    f["funding"] = df["funding_daily"]
    f["funding_3d"] = df["funding_daily"].rolling(3).mean()
    f["funding_z_30"] = (
        df["funding_daily"] - df["funding_daily"].rolling(30).mean()
    ) / df["funding_daily"].rolling(30).std()

    return f


def main():
    df = pd.read_csv(
        os.path.join(PROC, "btc_daily_merged.csv"), parse_dates=["date"]
    ).set_index("date")
    f = build_features(df)
    labels = df[["fwd_ret_1d", "fwd_ret_2d", "fwd_ret_3d", "close"]]
    out = f.join(labels)
    out.to_csv(os.path.join(PROC, "features.csv"))
    print(f"features={f.shape[1]}  rows={len(out)}")


if __name__ == "__main__":
    main()
