"""
Shared backtest utilities — execution realism and metrics.

Execution model
---------------
Signal is computed from data through close of day D (00:00 UTC).
Fills happen at the OPEN of day D+1 (the first trade after decision time),
i.e. a true no-lookahead fill with ~minutes of execution delay.
Daily strategy return: pos(D) * log(open(D+2)/open(D+1)) - cost * |Δpos|.

`cost_bps` is the one-way cost (fee + half-spread + slippage) in basis
points, charged on every unit of position change.
"""
import numpy as np
import pandas as pd


def run_strategy(open_px: pd.Series, pos: pd.Series, cost_bps: float) -> pd.DataFrame:
    o = open_px.reindex(pos.index)
    fwd = np.log(o.shift(-2) / o.shift(-1))  # open(D+1) -> open(D+2)
    turn = pos.diff().abs().fillna(pos.abs())
    ret = pos * fwd - turn * cost_bps / 1e4
    return pd.DataFrame({"pos": pos, "gross": pos * fwd, "net": ret, "turnover": turn})


def ann_metrics(r: pd.Series, name: str = "") -> dict:
    r = r.dropna()
    if len(r) == 0:
        return {}
    mu, sd = r.mean(), r.std()
    downside = r[r < 0].std()
    eq = r.cumsum()
    dd = (eq - eq.cummax()).min()
    return dict(
        name=name, n_days=len(r), total_logret=r.sum(),
        ann_ret=mu * 365, ann_vol=sd * np.sqrt(365),
        sharpe=(mu / sd * np.sqrt(365)) if sd > 0 else np.nan,
        sortino=(mu / downside * np.sqrt(365)) if downside and downside > 0 else np.nan,
        max_dd_log=dd, hit_rate=(r[r != 0] > 0).mean() if (r != 0).any() else np.nan,
    )


def trade_stats(res: pd.DataFrame) -> dict:
    """Group consecutive same-position days into trades."""
    pos = res["pos"].fillna(0)
    grp = (pos != pos.shift()).cumsum()
    trades = []
    for _, g in res.groupby(grp):
        p = g["pos"].iloc[0]
        if p == 0:
            continue
        trades.append(g["net"].sum())
    tr = pd.Series(trades)
    if len(tr) == 0:
        return dict(n_trades=0)
    wins, losses = tr[tr > 0], tr[tr <= 0]
    pf = wins.sum() / abs(losses.sum()) if len(losses) and losses.sum() != 0 else np.inf
    return dict(
        n_trades=len(tr), win_rate=(tr > 0).mean(),
        avg_win=wins.mean() if len(wins) else np.nan,
        avg_loss=losses.mean() if len(losses) else np.nan,
        expectancy=tr.mean(), profit_factor=pf,
        best=tr.max(), worst=tr.min(),
    )
