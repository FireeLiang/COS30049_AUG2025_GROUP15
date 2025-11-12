from __future__ import annotations

import re
import calendar
from typing import List, Dict, Iterable, Tuple, Optional

import pandas as pd
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------
# Load & CLEAN master data once (CSV contains 2023/2024/2025 labels,
# but we only *train* on 2023 & 2024 rows)
# ---------------------------------------------------------------------
CSV_PATH = "datasets/temperature_daily_clean.csv"
CROPS_CSV_PATH = "datasets/Australian_Crop_Suitability.csv"  # crops table used by /crops & /crop/limits


def load_master() -> pd.DataFrame:
    df = pd.read_csv(CSV_PATH)

    # robust datetime
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"])

    # keep ONLY 2023 & 2024 for training/actuals
    df = df[df["date"].dt.year.isin([2023, 2024])].copy()

    # tidy columns
    if "avg_temp" in df.columns:
        df["avg_temp"] = pd.to_numeric(df["avg_temp"], errors="coerce")

    if "station_name" in df.columns:
        df["station_name"] = df["station_name"].astype(str).str.strip()

    return df


def load_crops() -> pd.DataFrame:
    """
    Expected columns in Australian_Crop_Suitability.csv:
      Crop, Temp_Min, Temp_Max, Best
    """
    try:
        cdf = pd.read_csv(CROPS_CSV_PATH)
    except Exception:
        # If file not present we still want the API to boot.
        return pd.DataFrame(columns=["Crop", "Temp_Min", "Temp_Max", "Best"])

    # Normalize/clean
    for col in ["Temp_Min", "Temp_Max", "Best"]:
        if col in cdf.columns:
            cdf[col] = pd.to_numeric(cdf[col], errors="coerce")

    if "Crop" in cdf.columns:
        cdf["Crop"] = cdf["Crop"].astype(str).str.strip()

    # Drop invalid rows
    keep = (
        cdf["Crop"].notna()
        & cdf["Temp_Min"].notna()
        & cdf["Temp_Max"].notna()
        & cdf["Best"].notna()
    )
    cdf = cdf[keep].copy()

    # Enforce ordering where min <= best <= max (swap if users mixed them)
    def _fix_row(row):
        vals = sorted([row["Temp_Min"], row["Best"], row["Temp_Max"]])
        row["Temp_Min"], row["Best"], row["Temp_Max"] = vals[0], vals[1], vals[2]
        return row

    if not cdf.empty:
        cdf = cdf.apply(_fix_row, axis=1)

    return cdf


MASTER = load_master()
CROPS = load_crops()

# ---------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------
app = FastAPI(title="Seasonal Temperature API", version="1.4")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------
# Small, in-memory configuration (updated via PUT /config)
# ---------------------------------------------------------------------
ALLOWED_MODELS = {"polynomial", "decision_tree", "random_forest"}
CONFIG: Dict[str, str] = {
    "default_model": "random_forest",  # used when /model/forecast has no ?model=
}

class ConfigUpdate(BaseModel):
    default_model: Optional[str] = None


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
YEAR_CHOICES = [2023, 2024, 2025]  # 2025 = forecast-only


def _historical_states() -> List[str]:
    """Exact station_name strings that exist in 2023/2024 rows."""
    states = (
        MASTER[["station_name"]]
        .dropna()
        .drop_duplicates()
        .sort_values(by="station_name")["station_name"]
        .tolist()
    )
    # defensively hide accidental '2025' strings if present
    return [s for s in states if "2025" not in s]


# ---------- fuzzy name resolution for 2025 labels ----------
_WORD_CLEAN_RE = re.compile(r"[^\w\s]")          # drop punctuation
YEAR_RE = re.compile(r"\b20\d{2}\b")


def _canon(s: str) -> str:
    """Light canonicalization for consistent tokenization."""
    s = s.lower().strip()
    s = s.replace("creesy", "cressy")            # common variant
    s = YEAR_RE.sub(" ", s)                      # remove years
    s = s.replace("average", " ")                # ignore 'Average'
    s = _WORD_CLEAN_RE.sub(" ", s)               # remove punctuation
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _tokens(s: str) -> List[str]:
    """Tokenize and keep informative words only."""
    stop = {"", "nsw", "vic", "sa", "wa", "nt", "tas", "qld"}  # state tags are redundant
    toks = [t for t in _canon(s).split(" ") if t not in stop]
    return toks


def _jaccard(a: Iterable[str], b: Iterable[str]) -> float:
    A, B = set(a), set(b)
    if not A and not B:
        return 0.0
    return len(A & B) / float(len(A | B))


_HIST_NAMES = _historical_states()
_HIST_TOKENS: List[Tuple[str, List[str]]] = [(name, _tokens(name)) for name in _HIST_NAMES]


def _resolve_to_historical(display_or_name: str) -> str:
    """
    Map a display label such as 'Perth Metro 2025 (WA)' to the most
    likely historical station_name in MASTER.
    """
    if display_or_name in _HIST_NAMES:
        return display_or_name

    tgt = _tokens(display_or_name)
    best_name, best_score = None, -1.0
    for hist_name, hist_tok in _HIST_TOKENS:
        score = _jaccard(tgt, hist_tok)
        if score > best_score:
            best_name, best_score = hist_name, score

    return best_name if best_name is not None else _HIST_NAMES[0]


def _states_2025_labels() -> List[str]:
    """Build display names for 2025 from the historical names."""
    labels: List[str] = []
    for s in _HIST_NAMES:
        if re.search(r"20\d{2}", s):
            lbl = re.sub(r"20\d{2}", "2025", s)
        else:
            m = re.search(r"\s(\([A-Za-z]{2,3}\))$", s)
            if m:
                lbl = s[: m.start()] + " 2025 " + m.group(1)
            else:
                lbl = s + " 2025"
        labels.append(lbl)
    return sorted(labels)

# ---------------------------------------------------------------------
# Meta / admin endpoints (satisfy multi-method requirement)
# ---------------------------------------------------------------------
@app.get("/status")
def status():
    """Lightweight health + metadata endpoint (GET)."""
    return {
        "ok": True,
        "version": app.version,
        "default_model": CONFIG["default_model"],
        "years": YEAR_CHOICES,
        "states_count": len(_HIST_NAMES),
        "crops_count": 0 if CROPS is None or CROPS.empty else int(CROPS.shape[0]),
        "endpoints": [
            "/status",
            "/config (PUT)",
            "/states",
            "/states_2025",
            "/years",
            "/months",
            "/crops",
            "/crop/limits",
            "/temps",
            "/model/forecast",
            "/month_name",
        ],
    }


@app.put("/config")
def update_config(patch: ConfigUpdate):
    """
    Update in-memory config (PUT).
    - default_model: one of {'polynomial','decision_tree','random_forest'}
    """
    if patch.default_model is not None:
        m = patch.default_model.strip().lower()
        if m not in ALLOWED_MODELS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid model '{patch.default_model}'. Allowed: {sorted(ALLOWED_MODELS)}",
            )
        CONFIG["default_model"] = m
    return {"ok": True, **CONFIG}

# ---------------------------------------------------------------------
# Reference endpoints used by the UI
# ---------------------------------------------------------------------
@app.get("/states", response_model=List[str])
def get_states() -> List[str]:
    return _HIST_NAMES


@app.get("/states_2025", response_model=List[str])
def get_states_2025() -> List[str]:
    return _states_2025_labels()


@app.get("/years", response_model=List[int])
def get_years() -> List[int]:
    return YEAR_CHOICES


@app.get("/months", response_model=List[int])
def get_months() -> List[int]:
    return list(range(1, 12 + 1))

# ----------------------- Crops reference -------------------------
@app.get("/crops", response_model=List[str])
def list_crops() -> List[str]:
    if CROPS.empty:
        return []
    names = (
        CROPS["Crop"].dropna().astype(str).str.strip().drop_duplicates().sort_values().tolist()
    )
    return names


@app.get("/crop/limits")
def crop_limits(crop: str):
    """
    Return min/max/best temperature thresholds for a crop.
    """
    if CROPS.empty:
        raise HTTPException(status_code=404, detail="Crop table empty/unavailable")

    row = CROPS[CROPS["Crop"].str.casefold() == crop.strip().casefold()]
    if row.empty:
        raise HTTPException(status_code=404, detail=f"Crop not found: {crop}")

    r = row.iloc[0]
    return {
        "crop": r["Crop"],
        "min": float(r["Temp_Min"]),
        "max": float(r["Temp_Max"]),
        "best": float(r["Best"]),
    }

# ---------------------------------------------------------------------
# Raw actual temps (only 2023/2024)
# ---------------------------------------------------------------------
class TempRow(BaseModel):
    state: str
    day: int
    temp: float


@app.get("/temps", response_model=List[TempRow])
def get_monthly_temps(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2023, le=2024),
    states: str = Query(..., description="Comma-separated station_name (historical)"),
):
    chosen = [s.strip() for s in states.split(",") if s.strip()]
    if not chosen:
        return []

    df = MASTER[
        (MASTER["date"].dt.month == month)
        & (MASTER["date"].dt.year == year)
        & (MASTER["station_name"].isin(chosen))
    ].copy()

    if df.empty:
        return []

    df["day"] = df["date"].dt.day
    out = (
        df[["station_name", "day", "avg_temp"]]
        .dropna(subset=["avg_temp"])
        .rename(columns={"station_name": "state", "avg_temp": "temp"})
        .sort_values(["state", "day"])
    )
    return [
        TempRow(state=r.state, day=int(r.day), temp=float(r.temp))
        for r in out.itertuples(index=False)
    ]

# ---------------------------------------------------------------------
# Forecast endpoints (2023/2024 *or* 2025)
# ---------------------------------------------------------------------
from modelling import forecast_year_month  # noqa: E402


class ForecastRow(BaseModel):
    state: str
    year: int
    month: int
    day: int
    yhat: float


@app.get("/model/forecast", response_model=List[ForecastRow])
def forecast_month(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2023, le=2025),
    states: str = Query(..., description="Comma-separated display labels"),
    model: Optional[str] = Query(None, description="polynomial | decision_tree | random_forest"),
):
    """
    If year is 2023/2024:
      - 'states' must be the exact historical station_name strings.

    If year is 2025:
      - 'states' can be the display labels ending with '2025 ...';
        we resolve them back to the best matching historical name(s),
        train on 2023/2024, and predict for 2025.

    If 'model' is omitted, the app's CONFIG['default_model'] is used.
    """
    chosen_raw = [s.strip() for s in states.split(",") if s.strip()]
    if not chosen_raw:
        return {"Invalid Station"}

    # pick model (query param overrides server default)
    model_key = (model or CONFIG["default_model"]).lower()
    if model_key not in ALLOWED_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid model '{model}'. Allowed: {sorted(ALLOWED_MODELS)}",
        )

    chosen_resolved = [
        _resolve_to_historical(s) if year == 2025 else s for s in chosen_raw
    ]

    results: List[ForecastRow] = []
    for sname_display, sname_hist in zip(chosen_raw, chosen_resolved):
        preds = forecast_year_month(MASTER, sname_hist, year, month, model_key=model_key)
        for p in preds:
            results.append(
                ForecastRow(
                    state=sname_display,  # keep the display label in the response
                    year=year,
                    month=month,
                    day=int(p["day"]),
                    yhat=float(p["yhat"]),
                )
            )
    return results

# ---------------------------------------------------------------------
# Tiny helper for UI
# ---------------------------------------------------------------------
@app.get("/month_name")
def month_name(month: int):
    if 1 <= month <= 12:
        return {"name": calendar.month_name[month]}
    return {"name": ""}
