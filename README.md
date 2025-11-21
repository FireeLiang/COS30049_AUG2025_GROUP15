# Seasonal Forecasting (COS30049_AUG2025_GROUP15)

Lightweight React + FastAPI project for visualising historical temperatures, AI temperature forecasts and rainfall forecasts for Australian weather stations. Front-end uses React/D3/MUI; back-end uses FastAPI with ML code in Python.

## Quick links
- Backend entry: `backend/main.py`
- Temperature modelling: `backend/modelling.py` -> `forecast_year_month`
- Rainfall modelling: `backend/rainfall_modelling.py` -> `forecast_rainfall_stacked`
- Map / suitability: `backend/maptemp.py` -> `map_router`, `get_suitability_prediction`
- Frontend: `src/App.js`, `src/MapsD3Page.js`, `src/TrendsD3Page.js`, `src/RainfallD3Page.js`
- Frontend API helper: `src/api.js`
- Datasets: `backend/datasets/`

## Prerequisites
- Node.js >=16 and npm (frontend)
- Python 3.9+ and pip (backend)
- Recommended: virtualenv for backend work

## Backend — install & run (Windows)
1. Create & activate virtualenv:
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1   # PowerShell
# or
.\.venv\Scripts\activate.bat    # CMD
```

2. Install Python dependencies:
```powershell
pip install fastapi uvicorn pandas numpy scikit-learn xgboost pydantic
```

3. Run FastAPI server:
```powershell
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```
Notes:
- `backend/maptemp.py` trains models on import — check console logs.

## Frontend — install & run
1. Install dependencies:
```powershell
npm install
```
2. Start dev server:
```powershell
npm start
```
- Frontend expects backend at `http://127.0.0.1:8000` by default. Override:
```powershell
$env:REACT_APP_API="http://127.0.0.1:8000"; npm start
```

## Key data loaders & files
- Temperature loader: `load_master()` in `backend/main.py` — uses `datasets/temperature_daily_clean.csv`
- Crop temperature suitability: `load_crops()` -> `datasets/Australian_Crop_Suitability.csv`
- Rainfall loader: `load_rainfall_master()` -> `datasets/monthly_rainfall_summary.csv`
- Rainfall crop limits: `load_rainfall_crops()` -> `datasets/crop_rainfall_suitability.csv`

## API endpoints (selected)
- GET /status
- GET /states, /states_2025, /years, /months
- GET /crops, /crop/limits?crop=...
- GET /temps?month=&year=&states=
- GET /model/forecast?year=&month=&states=&model=
- GET /rainfall/stations, /rainfall/crops
- GET /rainfall/actuals?year=&stations=
- GET /model/rainfall-forecast?year=2025&stations=
- POST /model/suitability (map suitability via `maptemp.py`)

Example:
```powershell
# Status
curl http://127.0.0.1:8000/status

# Temp forecast Jan 2025 for Queensland
curl "http://127.0.0.1:8000/model/forecast?year=2025&month=1&states=Queensland%20(QLD)&model=random_forest"
```

## AI model integration & configuration
- Map suitability: `backend/maptemp.py` trains RandomForest models at module import (`load_and_train()`), serves predictions via POST `/model/suitability`.
- Temperature forecasts: `forecast_year_month` in `backend/modelling.py`. Default model controlled by in-memory `CONFIG["default_model"]` (allowed: `polynomial`, `decision_tree`, `random_forest`). Change via:
```powershell
curl -X PUT "http://127.0.0.1:8000/config" -H "Content-Type: application/json" -d '{"default_model":"decision_tree"}'
```
- Rainfall forecasts: `forecast_rainfall_stacked` in `backend/rainfall_modelling.py` — endpoint `/model/rainfall-forecast`.

## Datasets (backend/datasets/)
- `temperature_daily_clean.csv` — daily temperature source.
- `Australian_Crop_Suitability.csv` — crop temperature suitability.
- `monthly_rainfall_summary.csv` — monthly rainfall history.
- `crop_rainfall_suitability.csv` — rainfall crop limits.
- Missing CSVs: server tolerates some missing files, but modelling endpoints need corresponding CSVs.

## Troubleshooting
- Map training fails: check backend console logs — `maptemp.py` prints progress.
- Forecasts empty: verify CSVs and expected column names.
- xgboost install issues: use wheels or conda on Windows.

## Developer notes
- Modelling helpers and factories: `backend/modelling.py`
- Rainfall feature engineering: `backend/rainfall_modelling.py`
- UI consumes endpoints via `src/api.js`
- Consider adding `requirements.txt` and a combined start script for convenience.

If you want I can generate a requirements.txt or add a simple start script to run both back-end and front-end concurrently.