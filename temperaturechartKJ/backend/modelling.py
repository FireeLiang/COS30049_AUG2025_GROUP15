from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple
import calendar
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import PolynomialFeatures
from sklearn.tree import DecisionTreeRegressor

# ----------------------------- Utilities ---------------------------------- #
def _ensure_datetime(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out = out.dropna(subset=["date"]).sort_values("date").set_index("date")
    return out

def _feature_engineer(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["day_of_year"] = out.index.dayofyear
    out["year"] = out.index.year
    out["month"] = out.index.month
    out["avg_temp"] = pd.to_numeric(out["avg_temp"], errors="coerce")
    return out

def _split_xy(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame, pd.Series, pd.Series]:
    X = df[["day_of_year", "year", "month"]]
    y = df["avg_temp"]
    data = pd.concat([X, y], axis=1).dropna(subset=["avg_temp"])
    if data.empty:
        return None, None, None, None
    X = data[["day_of_year", "year", "month"]]
    y = data["avg_temp"].astype(float)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, shuffle=False)
    return X_train, X_test, y_train, y_test

# ------------------------------ Models ------------------------------------ #
def model_poly():
    return make_pipeline(PolynomialFeatures(4), LinearRegression())

def model_tree():
    return DecisionTreeRegressor(random_state=42, max_depth=10)

def model_rf():
    return RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1)

def get_available_models() -> Dict[str, str]:
    return {
        "polynomial": "Polynomial Regression (degree=4)",
        "decision_tree": "Decision Tree (max_depth=10)",
        "random_forest": "Random Forest (n_estimators=200)",
    }

def _rmse(y_true, y_pred) -> float:
    return float(np.sqrt(mean_squared_error(y_true, y_pred)))

def evaluate(y_true, y_pred) -> Dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "mse": float(mean_squared_error(y_true, y_pred)),
        "rmse": _rmse(y_true, y_pred),
        "r2": float(r2_score(y_true, y_pred)),
    }

@dataclass
class CompareResult:
    station_id: int
    station_name: str
    metrics: Dict[str, Dict[str, float]]
    y_test: List[Dict[str, float]]
    predictions: Dict[str, List[Dict[str, float]]]
    best_model: str

# -------------------------- Core Workflows -------------------------------- #
def forecast_year_month(
    full_df: pd.DataFrame,
    station_name: str,
    target_year: int,
    target_month: int,
    model_key: str = "random_forest",
) -> List[Dict[str, float]]:
    """
    Train on ALL rows for `station_name` with year < target_year, then
    predict the requested (target_year, target_month) by day (1..n_days).
    Works for target_year 2023/2024/2025 (2025 uses 2023/2024 as training).
    """
    if "station_name" not in full_df.columns:
        raise ValueError("full_df must contain 'station_name'.")

    d = full_df[full_df["station_name"] == station_name].copy()
    if d.empty:
        return []

    d = _ensure_datetime(d)
    d = _feature_engineer(d)
    d = d.dropna(subset=["avg_temp"])

    train = d[d["year"] < target_year]
    if train.empty:
        train = d.copy()

    X_all = train[["day_of_year", "year", "month"]]
    y_all = train["avg_temp"].astype(float)

    model_map = {
        "polynomial": model_poly(),
        "decision_tree": model_tree(),
        "random_forest": model_rf(),
    }
    m = model_map.get(model_key, model_rf())
    m.fit(X_all, y_all)

    n_days = calendar.monthrange(target_year, target_month)[1]
    idx = pd.date_range(f"{target_year}-{target_month:02d}-01", periods=n_days, freq="D")
    fut = pd.DataFrame(index=idx)
    fut["day_of_year"] = fut.index.dayofyear
    fut["year"] = fut.index.year
    fut["month"] = fut.index.month

    yhat = m.predict(fut[["day_of_year", "year", "month"]])
    return [{"day": int(d), "yhat": float(v)} for d, v in zip(range(1, n_days + 1), yhat)]
