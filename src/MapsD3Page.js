import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import './App.css';

// --- CONSTANTS ---
const API_BASE_URL = 'http://127.0.0.1:8000';
const GEOJSON_URL = 'https://raw.githubusercontent.com/rowanhogan/australian-states/master/states.geojson';

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
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const YEARS = [2023, 2024, 2025];

// --- API Helper ---
async function fetchJson(url, options = {}) {
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error (${response.status}): ${errorText}`);
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
        day: DAYS[0]
    });
    const [selectedState, setSelectedState] = useState(null);
    const [avgTemperature, setAvgTemperature] = useState(null);
    const [stationInfo, setStationInfo] = useState({ id: null, name: null });
    const [suitableCrops, setSuitableCrops] = useState([]);
    const [loading, setLoading] = useState(false);
    const [apiError, setApiError] = useState(null);

    // --- 1. Fetch GeoJSON Data ---
    useEffect(() => {
        fetch(GEOJSON_URL)
            .then(res => {
                if (!res.ok) throw new Error('Failed to load GeoJSON');
                return res.json();
            })
            .then(data => {
                // Add abbreviations to features
                data.features = data.features.map(feature => ({
                    ...feature,
                    properties: {
                        ...feature.properties,
                        abbr: STATE_ABBR_MAP[feature.properties.STATE_NAME] || feature.properties.STATE_NAME
                    }
                }));
                setGeoData(data);
            })
            .catch(err => {
                console.error("Failed to load GeoJSON:", err);
                setApiError("Failed to load map data. Please refresh the page.");
            });
    }, []);

    // --- 2. D3 Map Drawing Effect ---
    useEffect(() => {
        if (!geoData || !containerRef.current) return;

        const container = containerRef.current;
        const width = container.clientWidth || 600;
        const height = 400;

        const svg = d3.select(svgRef.current)
            .attr("width", width)
            .attr("height", height)
            .attr("viewBox", `0 0 ${width} ${height}`)
            .style("overflow", "visible");

        svg.selectAll('*').remove();

        const g = svg.append("g");

        // Create projection for Australia
        const projection = d3.geoMercator()
            .center([133, -28]) // Center of Australia
            .scale(width * 0.8)
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
                // Only allow clicks on the 7 states (excluding ACT if present)
                const validStates = ['WA', 'NT', 'SA', 'QLD', 'NSW', 'VIC', 'TAS'];
                if (validStates.includes(abbr)) {
                    setSelectedState(abbr);
                    setApiError(null);
                }
            })
            .append("title")
            .text(d => `${d.properties.STATE_NAME || d.properties.abbr} - Click to select`);

        // Add State Labels
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
            .attr("font-size", "12px")
            .attr("font-weight", "600")
            .attr("pointer-events", "none")
            .text(d => d.properties.abbr);

    }, [geoData, selectedState]);

    // --- 3. Data Fetching Effect (Temperature & Crop Suitability) ---
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
                throw new Error("No data returned for selected parameters.");
            }
            
            // Extract temperature and station info from first result
            const temp = results[0].avg_temp;
            const station = {
                id: results[0].station_id,
                name: results[0].station_name || 'Unknown Station'
            };
            
            // Filter suitable crops
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
            setApiError(error.message || 'Failed to fetch data');
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
                <p>Select a date and click on a state to view temperature and suitable crops</p>
            </div>

            {/* Main Grid */}
            <div className="maps-grid">
                {/* Map Section */}
                <div className="map-section">
                    <h2>Australian States Map</h2>
                    <div className="map-container" ref={containerRef}>
                        <svg ref={svgRef}></svg>
                    </div>
                </div>

                {/* Controls Section */}
                <div className="controls-section">
                    <div className="control-group">
                        <label>Select Date</label>
                        <div className="control-row">
                            <select
                                value={selectedDate.year}
                                onChange={(e) => handleDateChange('year', e.target.value)}
                            >
                                {YEARS.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                            <select
                                value={selectedDate.month}
                                onChange={(e) => handleDateChange('month', e.target.value)}
                            >
                                {MONTHS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                            <select
                                value={selectedDate.day}
                                onChange={(e) => handleDateChange('day', e.target.value)}
                            >
                                {DAYS.map(d => (
                                    <option key={d} value={d}>{d}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Selected State Info */}
                    <div className="control-group">
                        <label>Selected State</label>
                        {selectedState ? (
                            <div className="temp-display">
                                <div className="label">State</div>
                                <div className="value">{selectedState}</div>
                                <div className="label" style={{ marginTop: '1rem' }}>Date</div>
                                <div style={{ fontSize: '1rem' }}>{dateString}</div>
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
                        <h2>AI Recommendation</h2>
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