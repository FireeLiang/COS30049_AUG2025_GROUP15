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
  Button,
} from "@mui/material";

// Import CSS
import "./TrendsD3Page.css"; 

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
  const zoomBehaviorRef = useRef(null);

  // --- State for Dropdowns ---
  const [allStations, setAllStations] = useState([]);
  const [allCrops, setAllCrops] = useState([]);

  // --- State for User Selections ---
  const [selectedYears, setSelectedYears] = useState([2025, 2024, 2023]);
  const [selectedStations, setSelectedStations] = useState([]);
  const [selectedCrop, setSelectedCrop] = useState("");

  // --- State for Data ---
  const [chartData, setChartData] = useState([]); 
  const [cropLimits, setCropLimits] = useState(null); 
  const [error, setError] = useState(null);
  const [barDomain, setBarDomain] = useState([]); 

  // ======================================================================
  // --- COLOR SCALE ---
  // ======================================================================
  const color = useMemo(() => 
    d3.scaleOrdinal()
      .domain(YEAR_OPTIONS.sort())
      .range(["#1b9e77", "#d95f02", "#7570b3"]), 
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

    Promise.all(promises)
      .then((results) => {
        const flatData = results.flat();
        setChartData(flatData);
        const newDomain = new Set(flatData.map(d => d.key));
        setBarDomain(Array.from(newDomain).sort()); 
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


  // --- 4. Effect to Render D3 Chart (With ZOOM & TOOLTIP & EXTERNAL LABELS) ---
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const tooltip = d3.select(tooltipRef.current);
    svg.selectAll("*").remove(); // Clear chart for every redraw

    // --- Chart Dimensions ---
    // INCREASE BOTTOM MARGIN TO 80 to fit the labels below the axis
    const margin = { top: 20, right: 20, bottom: 80, left: 110 }; 
    const width = svg.node().clientWidth - margin.left - margin.right;
    const height = svg.node().clientHeight - margin.top - margin.bottom;

    // --- Define Clip Path ---
    svg.append("defs")
      .append("clipPath")
      .attr("id", "chart-clip")
      .append("rect")
      .attr("width", width)
      .attr("height", height)
      .attr("x", 0)
      .attr("y", 0);

    // --- Create Main Group ---
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // --- Scales & Axes Init ---
    const dataMax = d3.max(chartData, (d) => d.rainfall) || 100; 
    const cropMax = cropLimits ? cropLimits.max : 0;
    const yMax = Math.max(dataMax, cropMax) * 1.1;

    // X0 - Groups (Months)
    const x0 = d3.scaleBand()
      .domain(MONTHS.map(m => m.label))
      .range([0, width])
      .padding(0.2);

    // Y - Rainfall
    const y = d3.scaleLinear()
      .domain([0, yMax])
      .range([height, 0]);

    // --- Draw Axes ---
    const xAxisGroup = g.append("g")
      .attr("class", "x-axis")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x0));
      
    const yAxisGroup = g.append("g")
      .attr("class", "y-axis")
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d} mm`));

    // Style Axes
    // Push month labels down (dy) so they don't overlap with our new station labels
    xAxisGroup.selectAll("text")
      .style("font-size", "13px")
      .attr("dy", "4em"); 

    yAxisGroup.selectAll("text").style("font-size", "13px");
    
    // Gridlines (Initial)
    const gridGroup = g.append("g").attr("class", "grid-lines");
    gridGroup
      .call(d3.axisLeft(y).ticks(5).tickSize(-width).tickFormat(""))
      .call(g => g.selectAll(".domain").remove())
      .call(g => g.selectAll("line").attr("stroke", "#e0e0e0").attr("stroke-dasharray", "2,2"));

    // Y-Axis Label
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("y", 0 - margin.left)
      .attr("x", 0 - (height / 2))
      .attr("dy", "1em")
      .style("text-anchor", "middle")
      .style("font-size", "14px")
      .style("fill", "#555")
      .style("font-weight", "500")
      .text("Monthly Rainfall (mm)");

    // --- Content Group (Clipped) ---
    // Bars go here so they don't spill out of chart area
    const contentG = g.append("g").attr("clip-path", "url(#chart-clip)");

    // --- Labels Group (Not Clipped) ---
    // Station labels go here so they can be drawn BELOW the x-axis
    const labelsG = g.append("g").attr("class", "labels-container");

    // --- Crop Suitability Area Elements ---
    let cropRect, cropLineMax, cropLineMin;
    if (cropLimits) {
      const yMin = y(cropLimits.min);
      const yMax = y(cropLimits.max);

      cropRect = contentG.append("rect")
        .attr("class", "crop-rect")
        .attr("x", 0).attr("y", yMax)
        .attr("width", width).attr("height", yMin - yMax)
        .attr("fill", "green").attr("opacity", 0.1);

      cropLineMax = contentG.append("line")
        .attr("class", "crop-line-max")
        .attr("x1", 0).attr("y1", yMax)
        .attr("x2", width).attr("y2", yMax)
        .attr("stroke", "green").attr("stroke-width", 1).attr("stroke-dasharray", "4,4");
        
      cropLineMin = contentG.append("line")
        .attr("class", "crop-line-min")
        .attr("x1", 0).attr("y1", yMin)
        .attr("x2", width).attr("y2", yMin)
        .attr("stroke", "green").attr("stroke-width", 1).attr("stroke-dasharray", "4,4");
    }

    // --- Bar Logic Variables ---
    let x1, x2, monthGroups;

    // --- Draw Bars (Initial) ---
    if (chartData.length && barDomain.length && selectedStations.length) {
      // X1 - Sub-groups (Stations)
      x1 = d3.scaleBand()
        .domain(selectedStations.sort((a,b) => a - b)) 
        .range([0, x0.bandwidth()])
        .padding(0.1);

      // X2 - Bars within sub-groups (Year-Type)
      x2 = d3.scaleBand()
        .domain(barDomain) 
        .range([0, x1.bandwidth()])
        .padding(0.05);

      // Group data by month
      const dataByMonth = d3.group(chartData, d => d.month);

      // Create Month Groups (For Bars)
      monthGroups = contentG.append("g")
        .attr("class", "bars-container")
        .selectAll("g.month-group")
        .data(dataByMonth)
        .join("g")
          .attr("class", "month-group")
          .attr("transform", d => `translate(${x0(MONTH_MAP.get(d[0]))}, 0)`);
      
      // Create Station Groups (For Bars)
      const stationGroups = monthGroups
        .selectAll("g.station-group")
        .data(d => d3.group(d[1], d => d.station))
        .join("g")
          .attr("class", "station-group")
          .attr("transform", d => `translate(${x1(d[0])}, 0)`);

      // Draw Rects
      stationGroups.selectAll("rect")
        .data(d => d[1])
        .join("rect")
          .attr("class", "bar-rect")
          .attr("x", d => x2(d.key)) 
          .attr("y", d => (d.rainfall === 0 ? y(0) - 1 : y(d.rainfall))) 
          .attr("height", d => (d.rainfall === 0 ? 1 : height - y(d.rainfall))) 
          .attr("opacity", d => (d.rainfall === 0) ? 0.4 : (d.type === 'forecast' ? 0.7 : 1.0))
          .attr("width", x2.bandwidth())
          .attr("fill", d => color(d.year))
          .on("mouseover", (event, d) => {
            tooltip.style("opacity", 1);
            tooltip.html(`
              <strong>${d.year} - ${MONTH_MAP.get(d.month)}</strong><br/>
              Station ID: ${d.station}<br/>
              Rainfall: ${d.rainfall.toFixed(1)} mm
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

      // ★★★ DRAW STATION LABELS (Separate Group, Unclipped, Below Axis) ★★★
      if (selectedStations.length > 1) {
         // We mirror the structure (Month -> Station) in the labelsG
         const labelMonths = labelsG.selectAll(".l-month-group")
            .data(dataByMonth)
            .join("g")
            .attr("class", "l-month-group")
            .attr("transform", d => `translate(${x0(MONTH_MAP.get(d[0]))}, 0)`);

         const labelStations = labelMonths.selectAll(".l-station-group")
            .data(d => d3.group(d[1], d => d.station))
            .join("g")
            .attr("class", "l-station-group")
            .attr("transform", d => `translate(${x1(d[0])}, 0)`);
         
         labelStations.append("text")
            .attr("class", "station-label")
            .text(d => d[0]) // Station ID
            .attr("x", x1.bandwidth() / 2)
            .attr("y", height + 10) // Start slightly below the axis line
            .attr("text-anchor", "end") // Anchor end so rotation makes it read bottom-to-top ending at axis
            .attr("font-size", "10px")
            .attr("fill", "#333")
            .style("pointer-events", "none")
            .attr("transform", d => `rotate(-90, ${x1.bandwidth() / 2}, ${height + 10})`);
      }
    }

    // ======================================================================
    // --- ZOOM HANDLER ---
    // ======================================================================
    const zoom = d3.zoom()
      .scaleExtent([1, 5])
      .extent([[0, 0], [width, height]])
      .translateExtent([[0, 0], [width, height]])
      .on("zoom", (event) => {
        const t = event.transform;

        // 1. Rescale Y-Axis (Linear)
        const newY = t.rescaleY(y);
        yAxisGroup.call(d3.axisLeft(newY).ticks(5).tickFormat(d => `${d} mm`));
        yAxisGroup.selectAll("text").style("font-size", "13px");

        gridGroup.call(d3.axisLeft(newY).ticks(5).tickSize(-width).tickFormat(""));
        gridGroup.selectAll("line").attr("stroke", "#e0e0e0").attr("stroke-dasharray", "2,2");
        gridGroup.selectAll(".domain").remove();

        // 2. Rescale X-Axis (Band) - Manual Range Adjustment
        x0.range([0, width].map(d => t.applyX(d)));
        xAxisGroup.call(d3.axisBottom(x0));
        // Keep month labels pushed down
        xAxisGroup.selectAll("text").attr("dy", "4em"); 

        // 3. Update Crop Lines/Rects
        if (cropLimits) {
          const newYMin = newY(cropLimits.min);
          const newYMax = newY(cropLimits.max);
          
          cropRect.attr("y", newYMax).attr("height", Math.max(0, newYMin - newYMax));
          cropLineMax.attr("y1", newYMax).attr("y2", newYMax);
          cropLineMin.attr("y1", newYMin).attr("y2", newYMin);
        }

        // 4. Update Bars & Labels
        if (chartData.length && barDomain.length && selectedStations.length) {
            // Update scales
            x1.range([0, x0.bandwidth()]);
            x2.range([0, x1.bandwidth()]);

            // Move Bar Groups (Clipped)
            contentG.selectAll(".month-group")
                .attr("transform", d => `translate(${x0(MONTH_MAP.get(d[0]))}, 0)`);
            contentG.selectAll(".station-group")
                .attr("transform", d => `translate(${x1(d[0])}, 0)`);

            // Move Label Groups (Unclipped)
            labelsG.selectAll(".l-month-group")
                .attr("transform", d => `translate(${x0(MONTH_MAP.get(d[0]))}, 0)`);
            labelsG.selectAll(".l-station-group")
                .attr("transform", d => `translate(${x1(d[0])}, 0)`);

            // Resize Bars
            contentG.selectAll(".bar-rect")
                .attr("x", d => x2(d.key))
                .attr("width", x2.bandwidth())
                .attr("y", d => (d.rainfall === 0 ? newY(0) - 1 : newY(d.rainfall)))
                .attr("height", d => {
                    const val = d.rainfall === 0 ? 1 : height - newY(d.rainfall);
                    return Math.max(0, val);
                });
            
            // Update Station Labels Position
             if (selectedStations.length > 1) {
               labelsG.selectAll(".station-label")
                 .attr("x", x1.bandwidth() / 2)
                 .attr("transform", `rotate(-90, ${x1.bandwidth() / 2}, ${height + 10})`);
             }
        }
      });

    zoomBehaviorRef.current = zoom;

    // --- ZOOM OVERLAY ---
    const zoomRect = g.append("rect")
        .attr("width", width)
        .attr("height", height)
        .style("fill", "none")
        .style("pointer-events", "all")
        .call(zoom);

    // Send zoom overlay to back
    zoomRect.lower();

    svg.call(zoom);
    svg.on("dblclick.zoom", null);

  }, [chartData, cropLimits, barDomain, color, selectedStations]); 

  // --- Handlers ---
  const handleYearChange = (event) => {
    const { target: { value } } = event;
    setSelectedYears(typeof value === "string" ? value.split(",") : value);
  };

  const handleStationChange = (event) => {
    const { target: { value } } = event;
    setSelectedStations(typeof value === "string" ? value.split(",") : value);
  };

  const handleCropChange = (event) => {
    setSelectedCrop(event.target.value);
  };

  const handleResetZoom = () => {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    d3.select(svgRef.current)
      .transition()
      .duration(750)
      .call(zoomBehaviorRef.current.transform, d3.zoomIdentity);
  };

  // --- Render ---
  return (
    <Box 
      className="trends-wrap" 
      sx={{ maxWidth: '1800px', margin: '0 auto' }}
    >
      <Box className="trends-header">
        <Typography variant="h3" component="h1" className="trends-title">
          Rainfall Suitability
        </Typography>
        <Typography className="trends-subtitle">
          Historical vs. Forecasted Monthly Rainfall
        </Typography>
      </Box>

      <Paper 
        elevation={0} 
        variant="outlined" 
        sx={{ 
          p: 2, mt: 2, borderRadius: "14px", width: "100%", boxSizing: "border-box"
        }}
      >
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
                <MenuItem key={year} value={year}>{year}</MenuItem>
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
                <MenuItem key={stationId} value={stationId}>{stationId}</MenuItem>
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
              <MenuItem value=""><em>None</em></MenuItem>
              {allCrops.map((cropName) => (
                <MenuItem key={cropName} value={cropName}>{cropName}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Paper>

      <Box sx={{ mt: 2, display: "flex", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
        {selectedYears.sort().map((year) => (
          <Box key={year} sx={{ display: "inline-flex", alignItems: "center" }}>
            <Box sx={{ width: 12, height: 12, borderRadius: "2px", bgcolor: color(year), mr: 1 }}/>
            <Typography variant="body2">{year}</Typography>
          </Box>
        ))}
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
      
      {error && (
        <Typography color="error" sx={{ mt: 2 }}>
          <strong>Error:</strong> {error}
        </Typography>
      )}

      <Box className="chart-card" sx={{ mt: 2, height: "500px", position: "relative" }}>
        
        <Button
          variant="outlined"
          size="small"
          onClick={handleResetZoom}
          sx={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 10,
            backgroundColor: "rgba(255,255,255,0.8)",
            "&:hover": {
              backgroundColor: "rgba(255,255,255,1)",
            }
          }}
        >
          Reset Zoom
        </Button>

        <svg ref={svgRef} style={{ width: "100%", height: "100%", overflow: 'hidden' }}></svg>
      </Box>

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
          zIndex: 10, 
          textAlign: "left",
        }}
      ></div>
    </Box>
  );
}

export default RainfallD3Page;