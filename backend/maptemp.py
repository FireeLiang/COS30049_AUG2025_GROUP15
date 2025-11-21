from typing import List, Dict, Optional, Any
from datetime import datetime, date
import os
import re

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sklearn.ensemble import RandomForestRegressor
from sklearn.tree import DecisionTreeRegressor
import numpy as np
import warnings

# Suppress warnings during startup/training for cleaner console output
warnings.filterwarnings('ignore')

# --- File Paths ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HISTORICAL_CSV_PATH = os.path.join(BASE_DIR, "datasets", "temperature_daily_clean.csv")
CROPS_CSV_PATH = os.path.join(BASE_DIR, "datasets", "Crop_suitability_temperature.csv")

# Global variables for data storage and trained models
TRAINED_MODELS: Dict[int, RandomForestRegressor] = {}
MASTER_DATA = pd.DataFrame()
CROPS_RULES = pd.DataFrame()

# --- State Mapping (Linking state abbreviation to its representative station_id) ---
STATE_STATION_MAP = {
    "TAS": 91375,  # Creesy (Brumbys Creek)
    "NT": 14015,   # Darwin Airport
    "QLD": 41560,  # Goondiwindi
    "NSW": 53115,  # Moree Aero
    "SA": 23373,   # Nuriootpa PIRSA
    "WA": 9225,    # Perth Metro
    "VIC": 82039   # Rutherglen Research 
}

# Reverse mapping for quick lookup
STATION_STATE_MAP = {v: k for k, v in STATE_STATION_MAP.items()}

# =====================================================================
#                 DATA LOADING & MODEL TRAINING
# =====================================================================

def load_and_train():
    """ Loads data and executes model training upon server startup. """
    global MASTER_DATA, CROPS_RULES
    
    print("="*60)
    print("INITIALIZING MAP TEMPERATURE MODULE")
    print("="*60)
    
    # 1. Load Historical Data (for training and 2023/2024 lookups)
    try:
        if not os.path.exists(HISTORICAL_CSV_PATH):
            raise FileNotFoundError(f"Temperature CSV not found at: {HISTORICAL_CSV_PATH}")
        
        # Load with necessary columns
        df = pd.read_csv(
            HISTORICAL_CSV_PATH, 
            usecols=['date', 'station_id', 'avg_temp', 'station_name']
        )
        
        # Robust date conversion and feature engineering (DOY)
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df['doy'] = df['date'].dt.dayofyear
        df['year'] = df['date'].dt.year
        df['month'] = df['date'].dt.month
        df['day'] = df['date'].dt.day
        df['date'] = df['date'].dt.date  # Convert back to date object for lookup
        df['station_id'] = pd.to_numeric(df['station_id'], errors='coerce')
        df['avg_temp'] = pd.to_numeric(df['avg_temp'], errors='coerce')
        
        # Only keep rows with valid data and from our mapped stations
        MASTER_DATA = df.dropna(subset=['date', 'station_id', 'avg_temp', 'station_name', 'doy'])
        MASTER_DATA = MASTER_DATA[MASTER_DATA['station_id'].isin(STATE_STATION_MAP.values())].copy()
        
        print(f"✓ Loaded {len(MASTER_DATA)} historical temperature records")
        print(f"✓ Date range: {MASTER_DATA['date'].min()} to {MASTER_DATA['date'].max()}")
        print(f"✓ Stations loaded: {sorted(MASTER_DATA['station_id'].unique().tolist())}")
        
    except Exception as e:
        print(f"✗ CRITICAL ERROR loading historical data: {e}")
        MASTER_DATA = pd.DataFrame()

    # 2. Load Crop Rules
    try:
        if not os.path.exists(CROPS_CSV_PATH):
            raise FileNotFoundError(f"Crop CSV not found at: {CROPS_CSV_PATH}")
        
        cdf = pd.read_csv(CROPS_CSV_PATH)
        cdf.columns = cdf.columns.str.strip()
        
        # Ensure required columns exist
        required_cols = ['Crop', 'Temp_Min', 'Temp_Max']
        missing = [c for c in required_cols if c not in cdf.columns]
        if missing:
            raise ValueError(f"Missing required columns: {missing}")
        
        # Convert to numeric
        cdf['Temp_Min'] = pd.to_numeric(cdf['Temp_Min'], errors='coerce')
        cdf['Temp_Max'] = pd.to_numeric(cdf['Temp_Max'], errors='coerce')
        
        CROPS_RULES = cdf.dropna(subset=['Crop', 'Temp_Min', 'Temp_Max']).copy()
        print(f"✓ Loaded {len(CROPS_RULES)} crop suitability rules")
        print(f"✓ Crops: {', '.join(CROPS_RULES['Crop'].tolist())}")
        
    except Exception as e:
        print(f"CRITICAL ERROR loading crop rules: {e}")
        CROPS_RULES = pd.DataFrame()

    # 3. Train Random Forest Models for 2025 Prediction
    if not MASTER_DATA.empty:
        print("\n" + "-"*60)
        print("TRAINING RANDOM FOREST MODELS FOR 2025 PREDICTIONS")
        print("-"*60)
        
        for state_abbr, station_id in STATE_STATION_MAP.items():
            group_df = MASTER_DATA[MASTER_DATA['station_id'] == station_id].copy()
            
            if len(group_df) < 50:
                print(f"Skipping {state_abbr} (Station {station_id}): Insufficient data ({len(group_df)} rows)")
                continue

            # Prepare features and target
            X_train = group_df[['doy', 'month']]  # Using day of year and month
            y_train = group_df['avg_temp']
            
            # Use Random Forest Regressor 
            model = RandomForestRegressor(
                n_estimators=100,
                max_depth=15,
                min_samples_split=5,
                random_state=42,
                n_jobs=-1
            )
            
            model.fit(X_train, y_train)
            TRAINED_MODELS[station_id] = model
            
            print(f"✓ {state_abbr} (Station {station_id}): Trained on {len(group_df)} samples")
        
        print(f"\n✓ Successfully trained {len(TRAINED_MODELS)}/{len(STATE_STATION_MAP)} station models")
    else:
        print("\n✗ Cannot train models: No historical data loaded")

    print("="*60)
    print("SYSTEM READY - Temperature predictions available!")
    print("="*60 + "\n")

# Execute loading and training immediately when this module is imported
load_and_train()


# =====================================================================
#                 PYDANTIC MODELS (Input/Output Schemas)
# =====================================================================

class SuitabilityQuery(BaseModel):
    """The data model for the request body sent from React."""
    year: int = Field(..., description="Year (2023, 2024=Actuals; 2025=Forecast)")
    month: int = Field(..., ge=1, le=12, description="Selected month")
    day: int = Field(..., ge=1, le=31, description="Selected day")
    state: str = Field(..., description="State abbreviation (e.g., NSW, WA, NT, etc.)")

class CropSuitabilityResult(BaseModel):
    """The data model for the response sent back to React."""
    crop: str
    is_suitable: bool
    temp_min: float
    temp_max: float
    avg_temp: float
    station_id: int
    station_name: str
    best_temp: Optional[float] = None 


# =====================================================================
#                 CORE LOGIC AND UTILITIES
# =====================================================================

def _fetch_live_or_actual_temp(query: SuitabilityQuery) -> Optional[Dict[str, Any]]:
    """ Fetches actual temperature or predicts 2025 temperature live. """
    
    # Validate state
    if query.state not in STATE_STATION_MAP:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid state '{query.state}'. Valid states: {', '.join(STATE_STATION_MAP.keys())}"
        )

    target_id = STATE_STATION_MAP[query.state]
    
    # Validate date
    try:
        target_date = date(query.year, query.month, query.day)
        doy = target_date.timetuple().tm_yday
    except ValueError:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid date: {query.day}/{query.month}/{query.year}"
        )

    # Get station name (cleaned)
    station_record = MASTER_DATA[MASTER_DATA['station_id'] == target_id]
    station_name = f"Station {target_id}"
    
    if not station_record.empty:
        name_raw = station_record.iloc[0]['station_name']
        # Clean the name (removes 'Average 2023 (WA)', leaving just the core site name)
        station_name = re.split(r'\s+Average|\s+\(', str(name_raw))[0].strip()
    
    if query.year in [2023, 2024]:
        # --- ACTUALS Lookup ---
        temp_row = MASTER_DATA[
            (MASTER_DATA['date'] == target_date) & 
            (MASTER_DATA['station_id'] == target_id)
        ]
        
        if temp_row.empty:
            raise HTTPException(
                status_code=404,
                detail=f"No actual temperature data found for {query.state} on {query.day}/{query.month}/{query.year}"
            )
        
        avg_temp = float(temp_row.iloc[0]['avg_temp'])
    
    elif query.year == 2025:
        # --- LIVE PREDICTION (Random Forest Model) ---
        model = TRAINED_MODELS.get(target_id)
        if not model:
            raise HTTPException(
                status_code=503, 
                detail=f"Prediction model not available for {query.state}. Cannot predict 2025."
            )

        # Perform prediction using Day of Year and Month
        input_features = pd.DataFrame({
            'doy': [doy],
            'month': [query.month]
        })
        
        yhat = model.predict(input_features)[0]
        avg_temp = float(yhat)

    else:
        raise HTTPException(
            status_code=400,
            detail=f"Year {query.year} not supported. Use 2023, 2024 (actuals) or 2025 (forecast)."
        )

    return {
        'avg_temp': round(avg_temp, 1),
        'station_id': target_id,
        'station_name': station_name,
    }


# =====================================================================
#                 API ROUTER DEFINITION
# =====================================================================

map_router = APIRouter(
    prefix="/model",
    tags=["Maps - Planting Suitability"],
)

# --- API ENDPOINT (ML Integration) ---
@map_router.post("/suitability", response_model=List[CropSuitabilityResult])
def get_suitability_prediction(query: SuitabilityQuery):
    """
    AI Model Endpoint: Fetches temperature (Actual or Live Forecast) and applies 
    the ML suitability rule (Random Forest Classifier logic).
    
    Returns a list of all crops with their suitability status based on temperature.
    """
    
    # 1. Fetch Temperature Data (Live Prediction or Lookup)
    try:
        temp_data = _fetch_live_or_actual_temp(query)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching temperature: {str(e)}")

    if temp_data is None:
        raise HTTPException(
            status_code=404, 
            detail=f"Temperature data not available for {query.state} on {query.day}/{query.month}/{query.year}."
        )

    avg_temp = temp_data['avg_temp']

    # 2. Check if crop rules are loaded
    if CROPS_RULES.empty:
        raise HTTPException(status_code=500, detail="Server Error: Crop suitability rules missing.")

    # 3. Apply ML/Suitability rule (T_min <= T_avg <= T_max)
    results = []
    
    for r in CROPS_RULES.itertuples(index=False):
        # The core "Random Forest Classifier" suitability rule
        is_suitable = (avg_temp >= r.Temp_Min) and (avg_temp <= r.Temp_Max)
        
        # Calculate best temperature (midpoint if not specified)
        best_temp = None
        if hasattr(r, 'Best') and pd.notna(r.Best):
            best_temp = float(r.Best)
        else:
            best_temp = (r.Temp_Min + r.Temp_Max) / 2.0
        
        results.append(
            CropSuitabilityResult(
                crop=r.Crop,
                is_suitable=is_suitable,
                temp_min=float(r.Temp_Min),
                temp_max=float(r.Temp_Max),
                avg_temp=avg_temp,
                station_id=temp_data['station_id'],
                station_name=temp_data['station_name'],
                best_temp=best_temp
            )
        )
        
    return results

# ---------------------------------------------------------------------
# Status Endpoint
# ---------------------------------------------------------------------

@map_router.get("/map-status")
def map_status():
    """Status check for the maps module."""
    return {
        "status": "operational",
        "models_trained": len(TRAINED_MODELS),
        "stations": list(STATE_STATION_MAP.keys()),
        "data_loaded": not MASTER_DATA.empty,
        "crops_loaded": not CROPS_RULES.empty,
        "total_records": len(MASTER_DATA),
    }