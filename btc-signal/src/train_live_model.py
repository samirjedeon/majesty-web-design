"""
Train the production GBM on all available history and save it, so the live
monitor does not need to retrain. Re-run monthly (or each Jan 1, matching
the walk-forward retrain cadence used in research).
"""
import os
import pandas as pd
import lightgbm as lgb

from research_models import GBM_FEATS_EXCLUDE

HERE = os.path.dirname(os.path.abspath(__file__))
PROC = os.path.join(HERE, "..", "data", "processed")
MODELS = os.path.join(HERE, "..", "models")


def main():
    os.makedirs(MODELS, exist_ok=True)
    df = pd.read_csv(os.path.join(PROC, "features.csv"), parse_dates=["date"]).set_index("date")
    feats = [c for c in df.columns
             if not c.startswith("fwd_ret") and c != "close" and c not in GBM_FEATS_EXCLUDE]
    tr = df.dropna(subset=["fwd_ret_2d"])
    m = lgb.LGBMRegressor(
        n_estimators=300, learning_rate=0.03, num_leaves=15,
        min_child_samples=100, subsample=0.8, subsample_freq=1,
        colsample_bytree=0.7, reg_lambda=5.0, random_state=7, verbose=-1,
    )
    m.fit(tr[feats], tr["fwd_ret_2d"])
    m.booster_.save_model(os.path.join(MODELS, "gbm_live.txt"))
    with open(os.path.join(MODELS, "gbm_features.txt"), "w") as f:
        f.write("\n".join(feats))
    print(f"saved model on {len(tr)} rows, {len(feats)} features, "
          f"trained through {tr.index.max().date()}")


if __name__ == "__main__":
    main()
