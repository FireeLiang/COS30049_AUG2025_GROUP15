import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import './App.css';

import {
  Box,
  Typography,
  Paper,
} from "@mui/material";
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import localGeoData from './map/states.geojson';

// --- CONSTANTS ---
const API_BASE_URL = 'http://127.0.0.1:8000';

// --- Human-friendly error mapping ---
const HUMAN_ERRORS = {
    400: "Invalid date. Please select another date.",
    404: "No data found for the chosen parameters.",
    500: "Server error. Please try again later.",
    503: "Forecast model not available for the selected state."
};

// Map GeoJSON state names to abbreviations
const STATE_ABBR_MAP = {
    'Western Australia': 'WA',
    'Northern Territory': 'NT',
    'South Australia': 'SA',
    'Queensland': 'QLD',
    'New South Wales': 'NSW',
    'Victoria': 'VIC',
    'Tasmania': 'TAS'
};

// Full state names for display
const STATE_FULL_NAMES = {
    'WA': 'Western Australia',
    'NT': 'Northern Territory',
    'SA': 'South Australia',
    'QLD': 'Queensland',
    'NSW': 'New South Wales',
    'VIC': 'Victoria',
    'TAS': 'Tasmania'
};

// Colors for each state (matching your prototype)
const STATE_COLORS = {
    'WA': '#4ade80',
    'NT': '#3b82f6',
    'SA': '#facc15',
    'QLD': '#f87171',
    'NSW': '#a78bfa',
    'VIC': '#22d3ee',
    'TAS': '#f472b6',
    'default': '#d1d5db'
};

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: new Date(0, i).toLocaleString('en-US', { month: 'long' })
}));
const YEARS = [2023, 2024, 2025];

// Helper to get days in month
const getDaysInMonth = (year, month) => {
    return new Date(year, month, 0).getDate();
};

// --- API Helper ---
async function fetchJson(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            const error = new Error(errorText || 'Unknown error');
            error.status = response.status;
            throw error;
        }
        return await response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
}

// --- MAIN COMPONENT ---
function MapsD3Page() {
    const svgRef = useRef(null);
    const containerRef = useRef(null);
    
    // State management
    const [geoData, setGeoData] = useState(null);
    const [selectedDate, setSelectedDate] = useState({
        year: YEARS[0],
        month: MONTHS[0].value,
        day: 1
    });
    const [selectedState, setSelectedState] = useState(null); //Store selected state abbreviation
    const [avgTemperature, setAvgTemperature] = useState(null);
    const [stationInfo, setStationInfo] = useState({ id: null, name: null });
    const [suitableCrops, setSuitableCrops] = useState([]);
    const [loading, setLoading] = useState(false);
    const [apiError, setApiError] = useState(null);

    // Calculate max days for current month/year
    const maxDaysInMonth = useMemo(() => {
        return getDaysInMonth(selectedDate.year, selectedDate.month);
    }, [selectedDate.year, selectedDate.month]);

    // Adjust day if it exceeds max days in new month
    useEffect(() => {
        if (selectedDate.day > maxDaysInMonth) {
            setSelectedDate(prev => ({ ...prev, day: maxDaysInMonth }));
        }
    }, [maxDaysInMonth, selectedDate.day]);

// --- 1. Load Local GeoJSON Data ---
    useEffect(() => {
        const loadData = async () => {
            try {
                // 1. Resolve the import
                // Check if the import is a Module (has .default) or direct
                let rawData = (localGeoData && localGeoData.default) ? localGeoData.default : localGeoData;

                if (!rawData) {
                    throw new Error("Sorry, the map data could not be loaded. Please check the file path or format.");
                }

                let finalData = rawData;

                // 2. Handle "File Path" vs "JSON Object"
                // If rawData is a string, it means the bundler returned the file path (URL).
                // We need to fetch it.
                if (typeof rawData === 'string') {
                    const response = await fetch(rawData);
                    if (!response.ok) throw new Error(`Failed to fetch local file: ${response.statusText}`);
                    finalData = await response.json();
                }

                // 3. Verify Structure matches your file
                if (!finalData.features || !Array.isArray(finalData.features)) {
                    console.error("Structure mismatch. Data:", finalData);
                    throw new Error("GeoJSON is missing the 'features' array.");
                }

                // 4. Process Data (Deep Copy & Filter)
                const data = JSON.parse(JSON.stringify(finalData));
                
                const allowedStates = [
                    'Western Australia',
                    'Northern Territory', 
                    'South Australia',
                    'Queensland',
                    'New South Wales',
                    'Victoria',
                    'Tasmania'
                ];
                
                data.features = data.features
                    .filter(feature => {
                        const stateName = feature.properties?.STATE_NAME;
                        return allowedStates.includes(stateName);
                    })
                    .map(feature => ({
                        ...feature,
                        properties: {
                            ...feature.properties,
                            abbr: STATE_ABBR_MAP[feature.properties.STATE_NAME] || feature.properties.STATE_NAME
                        }
                    }));
                
                setGeoData(data);
            } catch (err) {
                console.error("Map Load Error:", err);
                setApiError(`Map Error: ${err.message}`);
            }
        };

        loadData();
    }, []);

    // --- 2. D3 Map Drawing Effect (Now shows temperature ON the map) ---
    useEffect(() => {
        if (!geoData || !containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth || 600;
        const height = 600;

        const svg = d3.select(svgRef.current)
            .attr("width", width)
            .attr("height", height)
            .attr("viewBox", `0 0 ${width} ${height}`)
            .style("overflow", "visible");

        svg.selectAll('*').remove();

        const g = svg.append("g");

        // Create projection for Australia
        const projection = d3.geoMercator()
            .center([133, -28])
            .scale(width * 1.37)
            .translate([width / 2, height / 2]);

        const path = d3.geoPath().projection(projection);

        // Draw States
        g.selectAll("path")
            .data(geoData.features)
            .enter().append("path")
            .attr("d", path)
            .attr("class", "state-path")
            .attr("stroke", "#374151")
            .attr("stroke-width", 1.5)
            .attr("fill", d => {
                const abbr = d.properties.abbr;
                // Highlight selected state
                if (selectedState === abbr) {
                    return STATE_COLORS[abbr] || STATE_COLORS.default;
                }
                return STATE_COLORS.default;
            })
            .on("click", (event, d) => {
                const abbr = d.properties.abbr;
                const validStates = ['WA', 'NT', 'SA', 'QLD', 'NSW', 'VIC', 'TAS'];
                if (validStates.includes(abbr)) {
                    setSelectedState(abbr);
                    setApiError(null);
                }
            })
            .append("title")
            .text(d => `${d.properties.STATE_NAME || d.properties.abbr} - Click to select`);

        // Add State Labels (abbreviations only)
        g.selectAll(".state-label")
            .data(geoData.features)
            .enter().append("text")
            .attr("class", "state-label")
            .attr("transform", d => `translate(${path.centroid(d)})`)
            .attr("text-anchor", "middle")
            .attr("fill", d => {
                const abbr = d.properties.abbr;
                return selectedState === abbr ? '#000' : '#1f2937';
            })
            .attr("font-size", "15px")
            .attr("font-weight", "750")
            .attr("pointer-events", "none")
            .text(d => d.properties.abbr);

        // --- NEW: Display Temperature ON Map for Selected State ---
        if (selectedState && avgTemperature !== null) {
            const selectedFeature = geoData.features.find(
                f => f.properties.abbr === selectedState
            );
            
            if (selectedFeature) {
                const centroid = path.centroid(selectedFeature);
                
                // Add temperature text below state label
                g.append("text")
                    .attr("class", "temp-on-map")
                    .attr("transform", `translate(${centroid[0]}, ${centroid[1] + 20})`)
                    .attr("text-anchor", "middle")
                    .attr("font-size", "16px")
                    .attr("font-weight", "700")
                    .attr("fill", "#1f2937")
                    .attr("pointer-events", "none")
                    .text(`${avgTemperature.toFixed(1)}°C`);
            }
        }

    }, [geoData, selectedState, avgTemperature]);

    // --- 3. Data Fetching Effect ---
    useEffect(() => {
        if (!selectedState) {
            setAvgTemperature(null);
            setSuitableCrops([]);
            setStationInfo({ id: null, name: null });
            return;
        }

        const { year, month, day } = selectedDate;
        setLoading(true);
        setApiError(null);

        const requestBody = {
            year,
            month,
            day,
            state: selectedState
        };

        fetchJson(`${API_BASE_URL}/model/suitability`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        })
        .then(results => {
            if (!results || results.length === 0) {
                throw new Error("Data for the chosen date and state is not available at the moment. Please try a different selection.");
            }
            
            const temp = results[0].avg_temp;
            const station = {
                id: results[0].station_id,
                name: results[0].station_name || 'Unknown Station'
            };
            
            const suitable = results
                .filter(r => r.is_suitable)
                .map(r => ({
                    crop: r.crop,
                    temp_min: r.temp_min,
                    temp_max: r.temp_max,
                    best_temp: r.best_temp
                }));

            setAvgTemperature(temp);
            setSuitableCrops(suitable);
            setStationInfo(station);
        })
        .catch(error => {
            console.error('API Error:', error);
            const friendlyMessage = error.status && HUMAN_ERRORS[error.status]
            ? HUMAN_ERRORS[error.status]
            : "Sorry, we couldn't load the data. Please try again.";

            setApiError(friendlyMessage);
            setAvgTemperature(null);
            setSuitableCrops([]);
            setStationInfo({ id: null, name: null });
        })
        .finally(() => {
            setLoading(false);
        });

    }, [selectedState, selectedDate]);

    // --- Handlers ---
    const handleDateChange = (type, value) => {
        setSelectedDate(prev => ({
            ...prev,
            [type]: parseInt(value, 10)
        }));
    };

    const handleDaySliderChange = (e) => {
        setSelectedDate(prev => ({
            ...prev,
            day: parseInt(e.target.value, 10)
        }));
    };

    // Format date string for display
    const dateString = useMemo(() => {
        const { year, month, day } = selectedDate;
        const monthName = MONTHS.find(m => m.value === month)?.label || '';
        return `${monthName} ${day}, ${year}`;
    }, [selectedDate]);

    const suitableCount = suitableCrops.length;

    // --- RENDER ---
    return (
        <div className="maps-page-container">
            {/* Header */}
            <div className="maps-header">
                <h1>Planting Suitability Across Australian States ({selectedDate.year})</h1>
                <p>Select a date and click on a state to view temperature and suitable crops plantation.</p>
            </div>

            {/* ========================================================================= */}
            {/* 2. NEW GUIDANCE / INSTRUCTION BOX (ADDED)                                 */}
            {/* ========================================================================= */}
            <Paper 
                elevation={0} 
                variant="outlined" 
                sx={{ 
                p: 2, 
                mt: 2, 
                mb: 4, // Added margin bottom for spacing before the grid
                borderRadius: "14px", 
                width: "100%", 
                boxSizing: "border-box",
                backgroundColor: "#f8f9fa", 
                borderLeft: "6px solid #1976d2"
                }}
            >
                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
                <InfoOutlinedIcon color="primary" sx={{ mt: 0.5 }} />
                
                <Box sx={{ width: "100%" }}>
                    <Typography variant="h6" component="div" sx={{ fontSize: "1rem", fontWeight: 600, mb: 1 }}>
                    How to interpret this chart
                    </Typography>
                    
                    <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 4 }}>
                    {/* Left Column: Context */}
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="body2" color="text.secondary" paragraph sx={{ mb: 0.5 }}>
                        This interactive map visualizes <strong>Regional Planting Suitability</strong> based on historical and forecasted temperatures (2023-2025).
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                        Click on a <strong>State</strong> to reveal the local average temperature. The system then generates a list of <strong>Suitable Crops</strong> whose optimal growing conditions match that specific location and date.
                        </Typography>
                    </Box>

                    {/* Right Column: Interaction */}
                    <Box sx={{ flex: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontSize: "0.85rem", fontWeight: "bold", color: "#444" }}>
                        Interactive Controls:
                        </Typography>
                        <Box component="ul" sx={{ m: 0, pl: 2, fontSize: "0.85rem", color: "text.secondary" }}>
                        <li><strong>Map Selection:</strong> Click any state on the map to filter data for that region.</li>
                        <li><strong>Time Slider:</strong> Drag the "Day" slider or change Month/Year to simulate different planting windows.</li>
                        <li><strong>Recommendations:</strong> Review the cards below the map to see specific temperature ranges for viable crops.</li>
                        </Box>
                    </Box>
                    </Box>
                </Box>
                </Box>
            </Paper>

            {/* Main Grid */}
            <div className="maps-grid">
                {/* Map Section */}
                <div className="map-section">
                    <h2>Australian States</h2>
                    <div className="map-container" ref={containerRef}>
                        <svg ref={svgRef}></svg>
                    </div>
                </div>

                {/* Controls Section */}
                <div className="controls-section">
                    {/* Year and Month - Side by Side */}
                    <div className="date-selector-row">
                        <div className="date-selector-col">
                            <label>Year</label>
                            <select
                                value={selectedDate.year}
                                onChange={(e) => handleDateChange('year', e.target.value)}
                            >
                                {YEARS.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                        <div className="date-selector-col">
                            <label>Month</label>
                            <select
                                value={selectedDate.month}
                                onChange={(e) => handleDateChange('month', e.target.value)}
                            >
                                {MONTHS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Day Slider */}
                    <div className="control-group">
                        <label>
                            Day: <strong>{selectedDate.day}</strong>
                        </label>
                        <input
                            type="range"
                            min="1"
                            max={maxDaysInMonth}
                            value={selectedDate.day}
                            onChange={handleDaySliderChange}
                            className="day-slider"
                        />
                        <div className="slider-labels">
                            <span>1</span>
                            <span>{maxDaysInMonth}</span>
                        </div>
                    </div>

                    {/* Selected Date Display - Smaller */}
                    <div className="control-group">
                        <label>Selected Date</label>
                        <div className="date-display-small">
                            {dateString}
                        </div>
                    </div>

                    {/* Selected State Info - Show Full Name */}
                    <div className="control-group">
                        <label>Selected State</label>
                        {selectedState ? (
                            <div className="temp-display">
                                <div className="value" style={{ fontSize: '1.25rem' }}>
                                    {STATE_FULL_NAMES[selectedState]} ({selectedState})
                                </div>
                            </div>
                        ) : (
                            <div className="no-selection">Click on a state to begin</div>
                        )}
                    </div>

                    {/* Temperature Display */}
                    {loading ? (
                        <div className="loading-state">Loading temperature data...</div>
                    ) : apiError ? (
                        <div className="error-state">{apiError}</div>
                    ) : avgTemperature !== null ? (
                        <div className="control-group">
                            <label>Average Temperature</label>
                            <div className="temp-display">
                                <div className="label">Temperature</div>
                                <div className="value">{avgTemperature.toFixed(1)}°C</div>
                                {stationInfo.name && (
                                    <div className="station">
                                        Station: {stationInfo.name}
                                        {stationInfo.id && ` (ID: ${stationInfo.id})`}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}
                </div>
            </div>

            {/* AI Recommendations Section */}
            {selectedState && (
                <div className="recommendations-section">
                    <div className="recommendations-header">
                        <h2>Crops Recommendation</h2>
                        <span className="crop-count">
                            {suitableCount} Suitable Crop{suitableCount !== 1 ? 's' : ''}
                        </span>
                    </div>

                    {loading ? (
                        <div className="loading-state">Loading crop recommendations...</div>
                    ) : suitableCount > 0 ? (
                        <div className="crops-grid">
                            {suitableCrops.map((crop, idx) => (
                                <div key={idx} className="crop-card">
                                    <h3>{crop.crop}</h3>
                                    <div className="crop-temp-info">
                                        <div><strong>Range:</strong> {crop.temp_min}°C - {crop.temp_max}°C</div>
                                        {crop.best_temp && (
                                            <div><strong>Optimal:</strong> {crop.best_temp}°C</div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="no-crops">
                            No suitable crops found for the current temperature. Try selecting a different date or state.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default MapsD3Page;