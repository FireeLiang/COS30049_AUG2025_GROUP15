from __future__ import annotations

import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor, StackingRegressor
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
import xgboost as xgb
import warnings
from typing import List, Dict, Any

# Suppress warnings for a cleaner output
warnings.filterwarnings('ignore')

# --- 1. Feature Engineering Helper ---
def _feature_engineer_rainfall(df: pd.DataFrame) -> pd.DataFrame:
    """Applies feature engineering to the rainfall dataframe."""
    df_out = df.sort_values(by=['Bureau of Meteorology station number', 'Year', 'Month']).reset_index(drop=True)

    # Create lag and rolling features
    df_out['Rainfall_1_Month_Ago'] = df_out.groupby('Bureau of Meteorology station number')['Total_Monthly_Rainfall_mm'].shift(1)
    df_out['Rainfall_1_Year_Ago'] = df_out.groupby('Bureau of Meteorology station number')['Total_Monthly_Rainfall_mm'].shift(12)
    df_out['Rainfall_3_Month_Rolling_Avg'] = df_out.groupby('Bureau of Meteorology station number')['Total_Monthly_Rainfall_mm'].shift(1).rolling(3).mean()
    
    # Cyclical month features
    df_out['month_sin'] = np.sin(2 * np.pi * df_out['Month'] / 12)
    df_out['month_cos'] = np.cos(2 * np.pi * df_out['Month'] / 12)
    
    return df_out.dropna().copy()


# --- 2. Main Forecasting Function ---
def forecast_rainfall_stacked(
    historical_df: pd.DataFrame, 
    station_ids: List[int], 
    target_year: int = 2025
) -> List[Dict[str, Any]]:
    """
    Trains a stacked model on all historical data and forecasts
    the target year for the specified station IDs.
    """
    
    print("--- Preparing data and training the final Stacked Model ---")
    
    # --- 3. Prepare FULL Dataset for Final Training ---
    df_model = _feature_engineer_rainfall(historical_df)
    
    features = [
        'Bureau of Meteorology station number', 'Year', 'month_sin', 'month_cos',
        'Rainfall_1_Month_Ago', 'Rainfall_1_Year_Ago', 'Rainfall_3_Month_Rolling_Avg'
    ]
    target = 'Total_Monthly_Rainfall_mm'

    X = df_model[features]
    y = df_model[target]

    X_encoded = pd.get_dummies(X, columns=['Bureau of Meteorology station number'], drop_first=True)
    
    # Store column names for later prediction
    X_encoded_columns = X_encoded.columns

    # Scale the features
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X_encoded)

    # --- 4. Define and Train the Stacked Model on ALL Data ---
    # Based on notebook parameters
    best_rf_params = {'max_depth': 20, 'min_samples_leaf': 2, 'n_estimators': 100}
    best_gb_params = {'learning_rate': 0.05, 'max_depth': 3, 'n_estimators': 100}
    best_xgb_params = {'learning_rate': 0.05, 'max_depth': 3, 'n_estimators': 100}

    estimators = [
        ('rf', RandomForestRegressor(random_state=42, n_jobs=-1, **best_rf_params)),
        ('gb', GradientBoostingRegressor(random_state=42, **best_gb_params)),
        ('xgb', xgb.XGBRegressor(random_state=42, n_jobs=-1, **best_xgb_params))
    ]

    stacked_model = StackingRegressor(estimators=estimators, final_estimator=LinearRegression(), cv=5)

    # Train the final model on the entire dataset
    stacked_model.fit(X_scaled, y)
    print("Final Stacked Model trained on all available data.")

    # --- 5. Generate Forecast Iteratively ---
    print(f"--- Generating {target_year} Forecast for requested stations ---")
    
    all_forecasts = []
    
    # Keep a history of data that includes the new forecasts
    prediction_history = historical_df.copy()

    for station_id in station_ids:
        # Check if station has enough data
        station_history = prediction_history[prediction_history['Bureau of Meteorology station number'] == station_id]
        if len(station_history) < 12:
            print(f"Skipping station {station_id} due to insufficient historical data.")
            continue

        for month in range(1, 13):
            # Get the most recent data required to build features
            history_for_features = prediction_history[
                prediction_history['Bureau of Meteorology station number'] == station_id
            ].tail(24)

            # Create the feature set for the prediction
            last_month = history_for_features.iloc[-1]
            last_year = history_for_features[history_for_features['Month'] == month].iloc[-1]
            rolling_avg = history_for_features.iloc[-3:]['Total_Monthly_Rainfall_mm'].mean()

            new_data = pd.DataFrame({
                'Bureau of Meteorology station number': [station_id],
                'Year': [target_year],
                'month_sin': [np.sin(2 * np.pi * month / 12)],
                'month_cos': [np.cos(2 * np.pi * month / 12)],
                'Rainfall_1_Month_Ago': [last_month['Total_Monthly_Rainfall_mm']],
                'Rainfall_1_Year_Ago': [last_year['Total_Monthly_Rainfall_mm']],
                'Rainfall_3_Month_Rolling_Avg': [rolling_avg]
            })

            # Encode and scale the new data point
            new_data_encoded = pd.get_dummies(new_data, columns=['Bureau of Meteorology station number'])
            new_data_reindexed = new_data_encoded.reindex(columns=X_encoded_columns, fill_value=0)
            new_data_scaled = scaler.transform(new_data_reindexed)

            # Make the prediction
            forecast = stacked_model.predict(new_data_scaled)[0]
            forecast = max(0, forecast)  # Ensure forecast is not negative

            result_row = {
                'Bureau of Meteorology station number': station_id,
                'Year': target_year,
                'Month': month,
                'Forecasted_Rainfall_mm': forecast
            }
            all_forecasts.append(result_row)

            # Add the new forecast to our history for the next iteration
            new_history_row = pd.DataFrame([
                {
                    'Bureau of Meteorology station number': station_id,
                    'Year': target_year,
                    'Month': month,
                    'Total_Monthly_Rainfall_mm': forecast
                }
            ])
            prediction_history = pd.concat([prediction_history, new_history_row], ignore_index=True)

    print("--- Forecast generation complete ---")
    return all_forecasts