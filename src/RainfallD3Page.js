import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

// Import Material-UI components
import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  Paper,
  ClickAwayListener, 
} from "@mui/material";

// Import CSS
import "./TrendsD3Page.css"; // Re-using the same CSS file for consistent styling

/* =========================================================================
   CONFIG
   ========================================================================= */
const API_BASE =
  process.env.REACT_APP_API?.replace(/\/$/, "") || "http://127.0.0.1:8000";

/* =========================================================================
   CONSTANTS
   ========================================================================= */
const YEAR_OPTIONS = [2025, 2024, 2023];
const MONTHS = [
  { value: 1, label: "Jan" }, { value: 2, label: "Feb" },
  { value: 3, label: "Mar" }, { value: 4, label: "Apr" },
  { value: 5, label: "May" }, { value: 6, label: "Jun" },
  { value: 7, label: "Jul" }, { value: 8, label: "Aug" },
  { value: 9, label: "Sep" }, { value: 10, label: "Oct" },
  { value: 11, label: "Nov" }, { value: 12, label: "Dec" },
];
const MONTH_MAP = new Map(MONTHS.map((m) => [m.value, m.label]));

/* =========================================================================
   API HELPER
   ========================================================================= */
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* =========================================================================
   D3 CHART COMPONENT
   ========================================================================= */
function RainfallD3Page() {
  // --- Refs ---
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);

  // --- State for Dropdowns ---
  const [allStations, setAllStations] = useState([]);
  const [allCrops, setAllCrops] = useState([]);

  // --- State for User Selections ---
  const [selectedYears, setSelectedYears] = useState([2025, 2024, 2023]);
  const [selectedStations, setSelectedStations] = useState([]);
  const [selectedCrop, setSelectedCrop] = useState("");

  // --- State for Data ---
  const [chartData, setChartData] = useState([]); // Processed data for D3
  const [cropLimits, setCropLimits] = useState(null); // { min, max }
  const [error, setError] = useState(null);
  const [barDomain, setBarDomain] = useState([]); // Domain for the bars

  // ======================================================================
  // --- COLOR SCALE ---
  // ======================================================================
  const color = useMemo(() => 
    d3.scaleOrdinal()
      .domain(YEAR_OPTIONS.sort())
      .range(["#1b9e77", "#d95f02", "#7570b3"]), // Colors for 2025, 2024, 2023
    []
  );

  // --- 1. Effect to Load Dropdown Data (on mount) ---
  useEffect(() => {
    getJSON(`${API_BASE}/rainfall/stations`)
      .then(setAllStations)
      .catch((err) => {
        console.error("Failed to fetch stations:", err);
        setError("Could not load stations. API down?");
      });

    getJSON(`${API_BASE}/rainfall/crops`)
      .then(setAllCrops)
      .catch((err) => {
        console.error("Failed to fetch rainfall crops:", err);
      });
  }, []);

  // --- 2. Effect to Load Chart Data ---
  useEffect(() => {
    if (!selectedStations.length || !selectedYears.length) {
      setChartData([]);
      setBarDomain([]);
      return;
    }

    const stationString = selectedStations.join(",");
    const promises = [];

    // --- Build fetch promises for selected years ---
    
    if (selectedYears.includes(2025)) {
      promises.push(
        getJSON(`${API_BASE}/model/rainfall-forecast?year=2025&stations=${stationString}`)
          .then(data => data.map(d => ({ 
            ...d, 
            rainfall: d.yhat, 
            type: 'forecast',
            key: `2025-forecast`
          })))
      );
    }
    
    if (selectedYears.includes(2024)) {
      promises.push(
        getJSON(`${API_BASE}/rainfall/actuals?year=2024&stations=${stationString}`)
          .then(data => data.map(d => ({ 
            ...d, 
            type: 'actual',
            key: `2024-actual`
          })))
      );
    }

    if (selectedYears.includes(2023)) {
      promises.push(
        getJSON(`${API_BASE}/rainfall/actuals?year=2023&stations=${stationString}`)
          .then(data => data.map(d => ({ 
            ...d, 
            type: 'actual',
            key: `2023-actual`
          })))
      );
    }

    // --- Fetch all, process, and set state ---
    Promise.all(promises)
      .then((results) => {
        const flatData = results.flat();
        setChartData(flatData);

        // Build the domain for the inner-most bars (year-type)
        const newDomain = new Set(flatData.map(d => d.key));
        setBarDomain(Array.from(newDomain).sort()); // 2023 -> 2024 -> 2025
        
        setError(null);
      })
      .catch((err) => {
        console.error("Failed to fetch chart data:", err);
        setError("Could not load chart data.");
        setChartData([]);
        setBarDomain([]);
      });

  }, [selectedStations, selectedYears]);

  // --- 3. Effect to Load Crop Limits ---
  useEffect(() => {
    if (!selectedCrop) {
      setCropLimits(null);
      return;
    }
    getJSON(`${API_BASE}/crop/rainfall-limits?crop=${selectedCrop}`)
      .then(setCropLimits)
      .catch((err) => {
        console.error("Failed to fetch crop limits:", err);
        setCropLimits(null);
      });
  }, [selectedCrop]);


  // --- 4. Effect to Render D3 Chart ---
  useEffect(() => {
    if (!chartData.length || !barDomain.length || !selectedStations.length || !svgRef.current) {
      d3.select(svgRef.current).selectAll("*").remove(); // Clear chart
      return;
    }

    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);
    svg.selectAll("*").remove();

    // --- Chart Dimensions ---
    const margin = { top: 20, right: 20, bottom: 50, left: 60 };
    const width = svg.node().clientWidth - margin.left - margin.right;
    const height = svg.node().clientHeight - margin.top - margin.bottom;

    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // --- Determine Y-axis max ---
    const dataMax = d3.max(chartData, (d) => d.rainfall) || 100;
    const cropMax = cropLimits ? cropLimits.max : 0;
    const yMax = Math.max(dataMax, cropMax) * 1.1;

    // --- D3 Scales ---
    
    // X0 - Groups (Months)
    const x0 = d3
      .scaleBand()
      .domain(MONTHS.map(m => m.label))
      .range([0, width])
      .padding(0.2);

    // X1 - Sub-groups (Stations)
    const x1 = d3
      .scaleBand()
      .domain(selectedStations.sort((a,b) => a - b)) // Sort station IDs
      .range([0, x0.bandwidth()])
      .padding(0.1); // Padding between station groups

    // X2 - Bars within sub-groups (Year-Type)
    const x2 = d3
      .scaleBand()
      .domain(barDomain) // Use state: ["2023-actual", "2024-actual", "2025-forecast"]
      .range([0, x1.bandwidth()])
      .padding(0.05); // Padding between individual bars

    // Y - Rainfall
    const y = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([height, 0]);

    // --- Draw Axes ---
    g.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x0))
      .call(g => g.selectAll(".domain").remove())
      .call(g => g.selectAll("text").style("font-size", "13px"));
      
    g.append("g")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d} mm`))
      .call(g => g.selectAll(".domain").remove())
      .call(g => g.selectAll("line").attr("stroke", "#e0e0e0").attr("stroke-dasharray", "2,2"))
      .call(g => g.selectAll("text").style("font-size", "13px"));
      
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left + 15)
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("fill", "#555")
      .style("font-weight", "500")
      .text("Monthly Rainfall (mm)");

    // --- Draw Crop Suitability Area ---
    if (cropLimits) {
      const yMin = y(cropLimits.min);
      const yMax = y(cropLimits.max);

      g.append("rect")
        .attr("x", 0).attr("y", yMax)
        .attr("width", width).attr("height", yMin - yMax)
        .attr("fill", "green").attr("opacity", 0.1);

      g.append("line")
        .attr("x1", 0).attr("y1", yMax)
        .attr("x2", width).attr("y2", yMax)
        .attr("stroke", "green").attr("stroke-width", 1).attr("stroke-dasharray", "4,4");
        
      g.append("line")
        .attr("x1", 0).attr("y1", yMin)
        .attr("x2", width).attr("y2", yMin)
        .attr("stroke", "green").attr("stroke-width", 1).attr("stroke-dasharray", "4,4");
    }

    // --- Draw Bars ---
    
    // Group data by month
    const dataByMonth = d3.group(chartData, d => d.month);

    g.append("g")
      .selectAll("g")
      .data(dataByMonth)
      .join("g")
        // Position the group at the correct month
        .attr("transform", d => `translate(${x0(MONTH_MAP.get(d[0]))}, 0)`)
      
      // Now, create sub-groups for STATIONS
      .selectAll("g")
      .data(d => d3.group(d[1], d => d.station)) // d[1] is data for month
      .join("g")
        // Position the station group within the month
        .attr("transform", d => `translate(${x1(d[0])}, 0)`) // d[0] is station ID
      
      // Finally, draw the rects for each YEAR-TYPE
      .selectAll("rect")
      .data(d => d[1]) // d[1] is data for that station (in that month)
      .join("rect")
        .attr("x", d => x2(d.key)) // d.key is "2023-actual"
        
        // --- MODIFICATION FOR 0-VALUE ---
        .attr("y", d => (d.rainfall === 0 ? y(0) - 1 : y(d.rainfall))) // 1px *above* the base
        .attr("height", d => (d.rainfall === 0 ? 1 : height - y(d.rainfall))) // 1px tall
        .attr("opacity", d => (d.rainfall === 0) ? 0.4 : (d.type === 'forecast' ? 0.7 : 1.0))
        // --- END MODIFICATION ---

        .attr("width", x2.bandwidth())
        .attr("fill", d => color(d.year)) // Color by year
        
        // --- Tooltip Events ---
        .on("mouseover", (event, d) => {
          tooltip.style("opacity", 1);
          tooltip.html(`
            <strong>${d.year} - ${MONTH_MAP.get(d.month)}</strong><br/>
            <strong>Station: ${d.station}</strong><br/>
            <span style="text-transform: capitalize;">${d.type}</span>: ${d.rainfall.toFixed(1)} mm
          `);
        })
        .on("mousemove", (event) => {
          tooltip
            .style("left", (event.pageX + 15) + "px")
            .style("top", (event.pageY - 28) + "px");
        })
        .on("mouseout", () => {
          tooltip.style("opacity", 0);
        });

  }, [chartData, cropLimits, barDomain, color, selectedStations]);

  // --- Handlers for MUI Selects ---
  const handleYearChange = (event) => {
    const {
      target: { value },
    } = event;
    setSelectedYears(
      typeof value === "string" ? value.split(",") : value
    );
  };

  const handleStationChange = (event) => {
    const {
      target: { value },
    } = event;
    setSelectedStations(
      typeof value === "string" ? value.split(",") : value
    );
  };

  const handleCropChange = (event) => {
    setSelectedCrop(event.target.value);
  };

  // --- Render Component ---
  return (
    <Box className="trends-wrap">
      {/* Header */}
      <Box className="trends-header">
        <Typography variant="h3" component="h1" className="trends-title">
          Rainfall Suitability
        </Typography>
        <Typography className="trends-subtitle">
          Historical vs. Forecasted Monthly Rainfall
        </Typography>
      </Box>

      {/* Controls */}
      <Paper elevation={0} variant="outlined" sx={{ p: 2, mt: 2, borderRadius: "14px" }}>
        <Box className="controls">
          <FormControl sx={{ m: 1, minWidth: 160 }} size="small">
            <InputLabel id="year-multi-label">Years</InputLabel>
            <Select
              labelId="year-multi-label"
              id="year-multi-select"
              multiple
              value={selectedYears}
              onChange={handleYearChange}
              input={<OutlinedInput id="select-multi-chip" label="Years" />}
              renderValue={(selected) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.sort().map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                </Box>
              )}
            >
              {YEAR_OPTIONS.map((year) => (
                <MenuItem key={year} value={year}>
                  {year}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ m: 1, minWidth: 240, maxWidth: 400 }} size="small">
            <InputLabel id="station-multi-label">Stations</InputLabel>
            <Select
              labelId="station-multi-label"
              id="station-multi-select"
              multiple
              value={selectedStations}
              onChange={handleStationChange}
              input={<OutlinedInput id="select-station-chip" label="Stations" />}
              renderValue={(selected) => (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.slice(0, 3).map((value) => (
                    <Chip key={value} label={value} size="small" />
                  ))}
                  {selected.length > 3 && <Chip label={`+${selected.length - 3} more`} size="small" />}
                </Box>
              )}
            >
              {allStations.map((stationId) => (
                <MenuItem key={stationId} value={stationId}>
                  {stationId}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl sx={{ m: 1, minWidth: 180 }} size="small">
            <InputLabel id="crop-select-label">Crop</InputLabel>
            <Select
              labelId="crop-select-label"
              id="crop-select"
              value={selectedCrop}
              label="Crop"
              onChange={handleCropChange}
            >
              <MenuItem value="">
                <em>None</em>
              </MenuItem>
              {allCrops.map((cropName) => (
                <MenuItem key={cropName} value={cropName}>
                  {cropName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Paper>

      {/* Legend */}
      <Box sx={{ mt: 2, display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
        {/* Year Colors */}
        {selectedYears.sort().map((year) => (
          <Box key={year} sx={{ display: "inline-flex", alignItems: "center" }}>
            <Box
              sx={{
                width: 12,
                height: 12,
                borderRadius: "2px",
                bgcolor: color(year),
                mr: 1,
              }}
            />
            <Typography variant="body2">{year}</Typography>
          </Box>
        ))}
        {/* Bar Type Legend */}
        <Box sx={{ display: "inline-flex", alignItems: "center", ml: 2 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: "2px", bgcolor: "grey.500", mr: 1, opacity: 1.0 }} />
            <Typography variant="body2">Actual</Typography>
        </Box>
        <Box sx={{ display: "inline-flex", alignItems: "center" }}>
            <Box sx={{ width: 12, height: 12, borderRadius: "2px", bgcolor: "grey.500", mr: 1, opacity: 0.7 }} />
            <Typography variant="body2">Forecast</Typography>
        </Box>

        {cropLimits && (
          <Chip
            sx={{ ml: 1 }}
            color="success"
            label={`Crop: ${selectedCrop} • Min ${cropLimits.min.toFixed(0)}mm • Max ${cropLimits.max.toFixed(0)}mm`}
            size="small"
            variant="outlined"
          />
        )}
      </Box>
      
      {/* Error Message */}
      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          <strong>Error:</strong> {error}
        </Typography>
      )}

      {/* D3 Chart Area */}
      <Box className="chart-card" sx={{ mt: 2, height: "500px", width: "100%" }}>
        <svg ref={svgRef} style={{ width: "100%", height: "100%" }}></svg>
      </Box>

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="d3-tooltip"
        style={{
          opacity: 0,
          position: "absolute",
          pointerEvents: "none",
          background: "rgba(0,0,0,0.8)",
          color: "white",
          padding: "8px 12px",
          borderRadius: "6px",
          fontSize: "13px",
          lineHeight: 1.5,
        }}
      ></div>
    </Box>
  );
}

export default RainfallD3Page;