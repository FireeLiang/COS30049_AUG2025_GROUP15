
from __future__ import annotations



import re

import calendar

from typing import List, Dict, Iterable, Tuple, Optional



import pandas as pd

from fastapi import FastAPI, Query, HTTPException

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel



# =====================================================================

#                 NEW RAINFALL IMPORTS

# =====================================================================

from modelling import forecast_year_month

from rainfall_modelling import forecast_rainfall_stacked


# =====================================================================
#                 NEW: IMPORT MAP TEMPERATURE MODULE
# =====================================================================
from maptemp import map_router


# =====================================================================

#                 DATASET PATHS

# =====================================================================

# --- Temperature ---

CSV_PATH = "datasets/temperature_daily_clean.csv"

CROPS_CSV_PATH = "datasets/Australian_Crop_Suitability.csv"  # crops table used by /crops & /crop/limits



# --- Rainfall ---

RAINFALL_CSV_PATH = "datasets/monthly_rainfall_summary.csv"

RAINFALL_CROPS_CSV_PATH = "datasets/crop_rainfall_suitability.csv"





# =====================================================================

#                 DATA LOADING: TEMPERATURE

# =====================================================================

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



# =====================================================================

#                 DATA LOADING: RAINFALL (NEW)

# =====================================================================

#
# Update the load_rainfall_master function to stop coercing the station column to a number.

def load_rainfall_master() -> pd.DataFrame:
    """
    Loads historical rainfall data.
    Expected cols: Bureau of Meteorology station number,Year,Month,Total_Monthly_Rainfall_mm
    """
    try:
        df = pd.read_csv(RAINFALL_CSV_PATH)
    except Exception:
        print("--- WARNING: Could not load rainfall CSV ---")
        return pd.DataFrame(columns=["Bureau of Meteorology station number", "Year", "Month", "Total_Monthly_Rainfall_mm"])
   
    # Clean column names
    df.columns = df.columns.str.strip()
   
    # Ensure numeric types ONLY for data columns (removed Station Number from this list)
    for col in ["Year", "Month", "Total_Monthly_Rainfall_mm"]: 
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Explicitly force the Station identifier to be a clean String
    if "Bureau of Meteorology station number" in df.columns:
        df["Bureau of Meteorology station number"] = df["Bureau of Meteorology station number"].astype(str).str.strip()

    df = df.dropna()
    return df





def load_rainfall_crops() -> pd.DataFrame:

    """

    Loads crop rainfall suitability data.

    Expected cols: Crop,Rainfall_Min,Rainfall_Max

    """

    try:

        cdf = pd.read_csv(RAINFALL_CROPS_CSV_PATH)

    except Exception:

        print("--- WARNING: Could not load rainfall crop suitability CSV ---")

        return pd.DataFrame(columns=["Crop", "Rainfall_Min", "Rainfall_Max"])

   

    cdf.columns = cdf.columns.str.strip()



    for col in ["Rainfall_Min", "Rainfall_Max"]:

        if col in cdf.columns:

            cdf[col] = pd.to_numeric(cdf[col], errors="coerce")

   

    if "Crop" in cdf.columns:

        cdf["Crop"] = cdf["Crop"].astype(str).str.strip()



    cdf = cdf.dropna()

    return cdf





# =====================================================================

#                 LOAD ALL DATA ON STARTUP

# =====================================================================

MASTER = load_master()

CROPS = load_crops()



# --- New Rainfall DataFrames ---

RAINFALL_MASTER = load_rainfall_master()

RAINFALL_CROPS = load_rainfall_crops()





# ---------------------------------------------------------------------

# FastAPI app

# ---------------------------------------------------------------------

app = FastAPI(title="Seasonal Forecasting API", version="1.5")



app.add_middleware(

    CORSMiddleware,

    allow_origins=["*"],

    allow_methods=["*"],

    allow_headers=["*"],

)

# After creating the app:
app = FastAPI(title="Seasonal Forecasting API", version="1.5")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# =====================================================================
#                 INCLUDE MAP ROUTER
# =====================================================================
app.include_router(map_router)

# ---------------------------------------------------------------------

# Small, in-memory configuration (updated via PUT /config)

# ---------------------------------------------------------------------

ALLOWED_MODELS = {"polynomial", "decision_tree", "random_forest"}

CONFIG: Dict[str, str] = {

    "default_model": "random_forest",  # used when /model/forecast has no ?model=

}



class ConfigUpdate(BaseModel):

    default_model: Optional[str] = None





# =====================================================================

#                 HELPERS: TEMPERATURE

# =====================================================================

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

# ------------------------------------------------------------------
# Human-friendly state labels used by the front-end
# ------------------------------------------------------------------
STATE_DISPLAY_NAMES: List[str] = [
    "Tasmania (TAS)",
    "Northern Territory (NT)",
    "Queensland (QLD)",
    "New South Wales (NSW)",
    "South Australia (SA)",
    "Western Australia (WA)",
    "Victoria (VIC)",
]

# Keyword to locate the correct station_name(s) inside _HIST_NAMES
_STATE_KEYWORDS: Dict[str, str] = {
    "Tasmania (TAS)": "Brumbys Creek",
    "Northern Territory (NT)": "Darwin Airport",
    "Queensland (QLD)": "Goondiwindi",
    "New South Wales (NSW)": "Moree Aero",
    "South Australia (SA)": "Nuriootpa PIRSA",
    "Western Australia (WA)": "Perth Metro",
    "Victoria (VIC)": "Rutherglen Research",
}


def _build_station_to_display() -> Dict[str, str]:
    """
    Map each historical station_name (2023/2024) to one of the
    7 state display labels above.
    """
    mapping: Dict[str, str] = {}
    for display, keyword in _STATE_KEYWORDS.items():
        kw = keyword.lower()
        for hist_name in _HIST_NAMES:
            if kw in hist_name.lower():
                mapping[hist_name] = display
    return mapping


STATION_TO_DISPLAY: Dict[str, str] = _build_station_to_display()

# Reverse: display label -> list of station_name strings
DISPLAY_TO_STATIONS: Dict[str, List[str]] = {}
for hist_name, display in STATION_TO_DISPLAY.items():
    DISPLAY_TO_STATIONS.setdefault(display, []).append(hist_name)


def _resolve_to_historical(display_or_name: str) -> str:
    """
    Map a display label such as 'Perth Metro 2025 (WA)' or
    'Queensland (QLD)' to the most likely historical station_name
    in MASTER.
    """
    # 1) Already a historical station_name
    if display_or_name in _HIST_NAMES:
        return display_or_name

    # 2) New friendly state labels, e.g. "Queensland (QLD)"
    if display_or_name in STATE_DISPLAY_NAMES:
        stations = DISPLAY_TO_STATIONS.get(display_or_name, [])
        if stations:
            # Use the first mapped station as the canonical one
            return stations[0]

    # 3) Fallback: old fuzzy matching logic for labels like
    #    "Perth Metro 2025 (WA)" etc.
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

        "states_count": len(STATE_DISPLAY_NAMES),

        "crops_count": 0 if CROPS is None or CROPS.empty else int(CROPS.shape[0]),

        # New rainfall counts

        "rainfall_stations_count": 0 if RAINFALL_MASTER.empty else RAINFALL_MASTER["Bureau of Meteorology station number"].nunique(),

        "rainfall_crops_count": 0 if RAINFALL_CROPS.empty else RAINFALL_CROPS.shape[0],

        "endpoints": [

            "/status",

            "/config (PUT)",

            # Temperature

            "/states",

            "/states_2025",
            "/years",

            "/months",

            "/crops",

            "/crop/limits",

            "/temps",

            "/model/forecast",

            # Rainfall

            "/rainfall/stations",

            "/rainfall/crops",

            "/crop/rainfall-limits",

            "/rainfall/actuals",

            "/model/rainfall-forecast",

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



# =====================================================================

#                 REFERENCE ENDPOINTS: TEMPERATURE

# =====================================================================

@app.get("/states", response_model=List[str])
def get_states() -> List[str]:
    """
    Returns the 7 Australian state/territory labels used by the UI,
    e.g. 'Queensland (QLD)'.
    """
    return STATE_DISPLAY_NAMES





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



# =====================================================================

#                 REFERENCE ENDPOINTS: RAINFALL (NEW)

# =====================================================================

@app.get("/rainfall/stations", response_model=List[str])

def list_rainfall_stations() -> List[str]:

    if RAINFALL_MASTER.empty:

        return []

    stations = (

        RAINFALL_MASTER["Bureau of Meteorology station number"]

        .dropna()

        .astype(str)

        .drop_duplicates()

        .sort_values()

        .tolist()

    )

    return stations



@app.get("/rainfall/crops", response_model=List[str])

def list_rainfall_crops() -> List[str]:

    if RAINFALL_CROPS.empty:

        return []

    names = (

        RAINFALL_CROPS["Crop"]

        .dropna()

        .astype(str)

        .str.strip()

        .drop_duplicates()

        .sort_values()

        .tolist()

    )

    return names





@app.get("/crop/rainfall-limits")

def crop_rainfall_limits(crop: str):

    """

    Return min/max rainfall thresholds for a crop.

    """

    if RAINFALL_CROPS.empty:

        raise HTTPException(status_code=404, detail="Rainfall crop table empty/unavailable")



    row = RAINFALL_CROPS[RAINFALL_CROPS["Crop"].str.casefold() == crop.strip().casefold()]

    if row.empty:

        raise HTTPException(status_code=404, detail=f"Crop not found: {crop}")



    r = row.iloc[0]

    return {

        "crop": r["Crop"],

        "min": float(r["Rainfall_Min"]),

        "max": float(r["Rainfall_Max"]),

    }





# =====================================================================

#                 ACTUAL DATA API: TEMPERATURE

# =====================================================================

class TempRow(BaseModel):

    state: str

    day: int

    temp: float





@app.get("/temps", response_model=List[TempRow])
def get_monthly_temps(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(..., ge=2023, le=2024),
    states: str = Query(
        ...,
        description="Comma-separated friendly labels, e.g. 'Queensland (QLD)'",
    ),
):
    # 1) Parse user-facing state labels
    chosen_display = [s.strip() for s in states.split(",") if s.strip()]
    if not chosen_display:
        return []

    # 2) Map them to the underlying historical station_name values
    hist_names: List[str] = []
    for disp in chosen_display:
        hist_names.extend(DISPLAY_TO_STATIONS.get(disp, []))

    if not hist_names:
        return []

    # 3) Filter the master table
    df = MASTER[
        (MASTER["date"].dt.month == month)
        & (MASTER["date"].dt.year == year)
        & (MASTER["station_name"].isin(hist_names))
    ].copy()

    if df.empty:
        return []

    # 4) Convert station_name -> friendly display label
    df["day"] = df["date"].dt.day
    df["state_display"] = df["station_name"].map(STATION_TO_DISPLAY).fillna(
        df["station_name"]
    )

    out = (
        df[["state_display", "day", "avg_temp"]]
        .dropna(subset=["avg_temp"])
        .rename(columns={"state_display": "state", "avg_temp": "temp"})
        .sort_values(["state", "day"])
    )

    return [
        TempRow(state=r.state, day=int(r.day), temp=float(r.temp))
        for r in out.itertuples(index=False)
    ]




# =====================================================================

#                 ACTUAL DATA API: RAINFALL (NEW)

# =====================================================================

class RainfallActualRow(BaseModel):

    station: str

    year: int

    month: int

    rainfall: float



@app.get("/rainfall/actuals", response_model=List[RainfallActualRow])

def get_monthly_rainfall(

    year: int = Query(..., ge=2023, le=2024),

    stations: str = Query(..., description="Comma-separated station IDs"),

):

    try:

        chosen_stations = [s.strip() for s in stations.split(",") if s.strip()]

    except ValueError:

        raise HTTPException(status_code=400, detail="Invalid station ID. Must be integer.")

       

    if not chosen_stations:

        return []



    df = RAINFALL_MASTER[

        (RAINFALL_MASTER["Year"] == year)

        & (RAINFALL_MASTER["Bureau of Meteorology station number"].isin(chosen_stations))

    ].copy()



    if df.empty:

        return []



    out = (

        df[["Bureau of Meteorology station number", "Year", "Month", "Total_Monthly_Rainfall_mm"]]

        .dropna()

        .rename(columns={

            "Bureau of Meteorology station number": "station",

            "Year": "year",

            "Month": "month",

            "Total_Monthly_Rainfall_mm": "rainfall"

        })

        .sort_values(["station", "year", "month"])

    )

    return [

        RainfallActualRow(

            station=str(r.station),

            year=int(r.year),

            month=int(r.month),

            rainfall=float(r.rainfall)

        )

        for r in out.itertuples(index=False)

    ]





# =====================================================================

#                 FORECAST API: TEMPERATURE

# =====================================================================

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

        return [] # Changed from {"Invalid Station"} to be a valid empty list



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



# =====================================================================

#                 FORECAST API: RAINFALL (NEW)

# =====================================================================

class RainfallForecastRow(BaseModel):

    station: str

    year: int

    month: int

    yhat: float



@app.get("/model/rainfall-forecast", response_model=List[RainfallForecastRow])

def forecast_rainfall(

    year: int = Query(..., ge=2025, le=2025, description="Only 2025 forecast is supported"),

    stations: str = Query(..., description="Comma-separated station IDs"),

):

    """

    Trains on all historical data and forecasts the 12 months of 2025

    for the selected station(s).

    """

    try:

        chosen_stations = [s.strip() for s in stations.split(",") if s.strip()]

    except ValueError:

        raise HTTPException(status_code=400, detail="Invalid station ID. Must be integer.")

       

    if not chosen_stations:

        return []

   

    if RAINFALL_MASTER.empty:

        raise HTTPException(status_code=500, detail="Rainfall model not loaded. Check data file.")

   

    # Run the stacked model forecast

    # This function is imported from rainfall_modelling.py

    forecasts = forecast_rainfall_stacked(

        historical_df=RAINFALL_MASTER,

        station_ids=chosen_stations,

        target_year=year

    )

   

    # Format for Pydantic response model

    results = [

        RainfallForecastRow(

            station=str(f["Bureau of Meteorology station number"]),

            year=int(f["Year"]),

            month=int(f["Month"]),

            yhat=float(f["Forecasted_Rainfall_mm"])

        ) for f in forecasts

    ]

   

    return results



# ---------------------------------------------------------------------

# Tiny helper for UI

# ---------------------------------------------------------------------

@app.get("/month_name")

def month_name(month: int):

    if 1 <= month <= 12:

        return {"name": calendar.month_name[month]}

    return {"name": ""}