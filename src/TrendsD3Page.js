import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

import {
  Box,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  OutlinedInput,
  Stack,
  Paper,
} from "@mui/material";

/* =========================================================================
   CONFIG
   ========================================================================= */
const API_BASE =
  (process.env.REACT_APP_API?.replace(/\/$/, "") || "http://127.0.0.1:8000");

/* =========================================================================
   CONSTANTS
   ========================================================================= */
const YEAR_OPTIONS = [2025, 2024, 2023]; // includes 2025
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" },
  { value: 3, label: "March" },   { value: 4, label: "April" },
  { value: 5, label: "May" },     { value: 6, label: "June" },
  { value: 7, label: "July" },    { value: 8, label: "August" },
  { value: 9, label: "September" }, { value: 10, label: "October" },
  { value: 11, label: "November" },  { value: 12, label: "December" },
];

// Fallback crop list shown when /crops is not yet wired.
const CROPS_FALLBACK = [
  "Wheat",
  "Barley",
  "Canola",
  "Cotton",
  "Maize",
  "Rice",
  "Sorghum",
  "Soybean",
  "Sunflower",
  "Sugarcane",
  "Grapes",
];

/* =========================================================================
   HELPERS
   ========================================================================= */
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Remove “Average” and any year tokens but keep site + (STATE)
function stripYearTag(label) {
  if (!label) return label;
  return label
    .replace(/\bAverage\b/gi, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Insert a year before the final "(STATE)" group (or at the end if not found)
function addYearTag(baseLabel, year) {
  const m = baseLabel.match(/^(.*?)(\s*\([^)]+\))$/);
  if (m) return `${m[1]} ${year}${m[2]}`;
  return `${baseLabel} ${year}`;
}

/* =========================================================================
   COMPONENT
   ========================================================================= */
export default function TrendsD3Page() {
  // Controls (chart)
  const [selectedMonth, setSelectedMonth] = useState(1);
  const [selectedYear, setSelectedYear] = useState(2024);
  const [showActuals] = useState(true);

  // Crop selector + limits
  const [cropList, setCropList] = useState([]);
  const [selectedCrop, setSelectedCrop] = useState("");
  const [cropLimits, setCropLimits] = useState(null); // {min,max,best}

  // States list management
  const [allStates, setAllStates] = useState([]);            // full list from API
  const [selectedStates, setSelectedStates] = useState([]);  // user selection

  // Data
  const [forecastRows, setForecastRows] = useState([]);
  const [actualRows, setActualRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState("");

  // D3
  const svgRef = useRef(null);
  const wrapRef = useRef(null);
  const tooltipRef = useRef(null);
  const [size, setSize] = useState({ w: 960, h: 480 });

  // Responsive width
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(560, Math.floor(e.contentRect.width));
        setSize({ w, h: 480 });
      }
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  /* ------------------------ Load the states once ------------------------ */
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const states = await getJSON(`${API_BASE}/states`);
        if (ignore) return;
        const clean = (states || [])
          .filter((x) => typeof x === "string" && x && x.toLowerCase() !== "nan");
        setAllStates(clean);
        setSelectedStates([]); // start EMPTY on load
      } catch (e) {
        if (!ignore) setErrors(`Error loading states: ${e.message}`);
      }
    })();
    return () => { ignore = true; };
  }, []);

  /* -------------------------- Load crops list --------------------------- */
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const crops = await getJSON(`${API_BASE}/crops`);
        if (ignore) return;
        const names = (crops || [])
          .filter((c) => typeof c === "string" && c.trim().length > 0);
        setCropList(names.length ? names : CROPS_FALLBACK);
      } catch {
        if (!ignore) setCropList(CROPS_FALLBACK);
      }
    })();
    return () => { ignore = true; };
  }, []);

  // When crop changes, fetch min/max/best
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!selectedCrop) {
        setCropLimits(null);
        return;
      }
      try {
        const res = await getJSON(
          `${API_BASE}/crop/limits?` + new URLSearchParams({ crop: selectedCrop })
        );
        if (ignore) return;
        setCropLimits({ min: +res.min, max: +res.max, best: +res.best });
      } catch (e) {
        if (!ignore) {
          setCropLimits(null);
          setErrors(`Could not load crop limits: ${e.message}`);
        }
      }
    })();
    return () => { ignore = true; };
  }, [selectedCrop]);

  // Unique station names (no year) – used to synthesize 2025 labels and in the 2025 Predictions panel
  const baseStationNames = useMemo(() => {
    const uniq = new Set(allStates.map(stripYearTag));
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [allStates]);

  // If user picks 2025, we fabricate 2025 labels from base names.
  const synthetic2025 = useMemo(
    () => baseStationNames.map((n) => addYearTag(n, 2025)),
    [baseStationNames]
  );

  /* --------------- Filtered list that matches selectedYear -------------- */
  const yearFilteredStates = useMemo(() => {
    if (selectedYear === 2025) {
      return synthetic2025; // 2025 is forecast-only; we synthesize labels
    }
    return allStates.filter((s) => s.includes(String(selectedYear)));
  }, [allStates, selectedYear, synthetic2025]);

  // When the year changes, drop any previously selected stations that don't match it
  useEffect(() => {
    setSelectedStates((prev) => {
      const allowed = new Set(yearFilteredStates);
      return prev.filter((s) => allowed.has(s));
    });
  }, [selectedYear, yearFilteredStates]);

  /* ---------------------- Load forecast/actuals ------------------------- */
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!selectedStates.length) {
        setForecastRows([]);
        setActualRows([]);
        return;
      }
      setLoading(true);
      setErrors("");
      try {
        if (selectedYear === 2025) {
          // 2025: predictions ONLY
          const fParams = new URLSearchParams({
            year: String(selectedYear),
            month: String(selectedMonth),
            states: selectedStates.join(","),
          });
          const forecast = await getJSON(`${API_BASE}/model/forecast?${fParams.toString()}`);
          if (!ignore) {
            setForecastRows(forecast || []);
            setActualRows([]); // no actuals for 2025
          }
        } else {
          // 2023/2024: actuals ONLY
          if (!ignore) setForecastRows([]); // ensure no dashed lines
          if (showActuals) {
            const aParams = new URLSearchParams({
              month: String(selectedMonth),
              year: String(selectedYear),
              states: selectedStates.join(","),
            });
            const actual = await getJSON(`${API_BASE}/temps?${aParams.toString()}`);
            if (!ignore) {
              setActualRows(
                (actual || []).map((r) => ({ state: r.state, day: +r.day, temp: +r.temp }))
              );
            }
          } else if (!ignore) {
            setActualRows([]);
          }
        }
        if (!ignore) setLoading(false);
      } catch (e) {
        if (!ignore) {
          setLoading(false);
          setErrors(`API error: ${e.message}`);
          setForecastRows([]);
          setActualRows([]);
        }
      }
    })();
    return () => { ignore = true; };
  }, [selectedStates, selectedMonth, selectedYear, showActuals]);

  /* ------------------------- Build chart series ------------------------- */
  const forecastSeries = useMemo(() => {
    const byState = d3.group(forecastRows, (d) => d.state);
    return Array.from(byState, ([key, values]) => ({
      key,
      values: values
        .filter((v) => v.month === selectedMonth && v.year === selectedYear)
        .map((v) => ({ day: v.day, temp: +v.yhat }))
        .sort((a, b) => d3.ascending(a.day, b.day)),
    }));
  }, [forecastRows, selectedMonth, selectedYear]);

  const actualSeries = useMemo(() => {
    const byState = d3.group(actualRows, (d) => d.state);
    return Array.from(byState, ([key, values]) => ({
      key,
      values: values.sort((a, b) => d3.ascending(a.day, b.day)),
    }));
  }, [actualRows]);

  const color = useMemo(
    () => d3.scaleOrdinal(d3.schemeTableau10).domain([...allStates, ...synthetic2025]),
    [allStates, synthetic2025]
  );

  /* ------------------------------- D3 draw ------------------------------ */
  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { w, h } = size;
    const margin = { top: 8, right: 24, bottom: 40, left: 56 };
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;

    svg.attr("viewBox", `0 0 ${w} ${h}`);
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain([1, 31]).range([0, innerW]);
    const both = [...forecastSeries, ...actualSeries];
    const yMax = d3.max(both, (s) => d3.max(s.values, (d) => d.temp)) ?? 35;
    const yMin = d3.min(both, (s) => d3.min(s.values, (d) => d.temp)) ?? 0;

    // If a crop is selected, include the crop limits in the visible domain
    let domainMin = Math.min(0, yMin);
    let domainMax = yMax;
    if (cropLimits) {
      domainMin = Math.min(domainMin, cropLimits.min);
      domainMax = Math.max(domainMax, cropLimits.max);
    }

    const y = d3.scaleLinear().domain([domainMin, domainMax]).nice().range([innerH, 0]);

    // Grid
    const gridY = d3.axisLeft(y).ticks(6).tickSize(-innerW).tickFormat("");
    g.append("g").attr("class", "grid-y").call(gridY);
    g.select(".grid-y .domain").remove();
    g.selectAll(".grid-y line").attr("stroke", "#e5e7eb");

    const axX = d3.axisBottom(x).ticks(10).tickSizeOuter(0);
    const axY = d3.axisLeft(y).ticks(6).tickSizeOuter(0);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(axX)
      .call((gx) =>
        gx
          .append("text")
          .attr("x", innerW)
          .attr("y", 32)
          .attr("fill", "#334155")
          .attr("text-anchor", "end")
          .attr("font-size", 12)
          .text("Days")
      );

    g.append("g")
      .call(axY)
      .call((gy) =>
        gy
          .append("text")
          .attr("x", -6)
          .attr("y", -10)
          .attr("fill", "#334155")
          .attr("text-anchor", "start")
          .attr("font-size", 12)
          .text("Temperature (°C)")
      );

    const line = d3.line().x((d) => x(d.day)).y((d) => y(d.temp)).curve(d3.curveMonotoneX);

    // ======== Crop suitability overlay (behind series) ========
    if (cropLimits) {
      const yTop = y(cropLimits.max);
      const yBottom = y(cropLimits.min);
      const bandHeight = Math.max(1, yBottom - yTop);

      // Min–Max shaded band
      g.append("rect")
        .attr("x", 0)
        .attr("y", yTop)
        .attr("width", innerW)
        .attr("height", bandHeight)
        .attr("fill", "#22c55e")
        .attr("opacity", 0.12);

      // Subtle boundary lines so the band reads cleanly against series
      g.append("line")
        .attr("x1", 0).attr("x2", innerW)
        .attr("y1", yTop).attr("y2", yTop)
        .attr("stroke", "#16a34a").attr("stroke-opacity", 0.25);

      g.append("line")
        .attr("x1", 0).attr("x2", innerW)
        .attr("y1", yBottom).attr("y2", yBottom)
        .attr("stroke", "#16a34a").attr("stroke-opacity", 0.25);

      // Best guide line
      g.append("line")
        .attr("x1", 0)
        .attr("x2", innerW)
        .attr("y1", y(cropLimits.best))
        .attr("y2", y(cropLimits.best))
        .attr("stroke", "#16a34a")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4,3");

      // Label for best — haloed to avoid collisions with lines
      g.append("text")
        .attr("x", innerW)
        .attr("y", y(cropLimits.best) - 6)
        .attr("text-anchor", "end")
        .attr("fill", "#166534")
        .attr("font-size", 12)
        .attr("paint-order", "stroke")
        .attr("stroke", "white")
        .attr("stroke-width", 3)
        .text(
          `Best ${selectedCrop ? selectedCrop : "Crop"} Temperature: ${cropLimits.best.toFixed(
            1
          )}°C`
        );
    }

    // Forecast (dashed)
    g.append("g")
      .selectAll("path.forecast")
      .data(forecastSeries, (d) => d.key)
      .join((enter) =>
        enter
          .append("path")
          .attr("class", "forecast")
          .attr("fill", "none")
          .attr("stroke-width", 2.5)
          .attr("stroke-linecap", "round")
          .attr("stroke-linejoin", "round")
          .attr("stroke-dasharray", "6,4")
          .attr("stroke", (d) => color(d.key))
          .attr("d", (d) => line(d.values))
          .attr("opacity", 0)
          .transition()
          .duration(500)
          .attr("opacity", 1)
      );

    // Actuals (solid)
    g.append("g")
      .selectAll("path.actual")
      .data(actualSeries, (d) => d.key)
      .join((enter) =>
        enter
          .append("path")
          .attr("class", "actual")
          .attr("fill", "none")
          .attr("stroke-width", 1.5)
          .attr("stroke-linecap", "round")
          .attr("stroke-linejoin", "round")
          .attr("stroke", (d) => color(d.key))
          .attr("d", (d) => line(d.values))
          .attr("opacity", 0.9)
      );

    // Tooltip
    const tooltip = d3.select(tooltipRef.current);
    const bisect = d3.bisector((d) => d.day).center;
    const monthLabel = MONTHS.find((m) => m.value === selectedMonth)?.label ?? "";
    const mergedForHover = forecastSeries.length ? forecastSeries : actualSeries;

    g.append("rect")
      .attr("width", innerW)
      .attr("height", innerH)
      .attr("fill", "transparent")
      .on("mousemove", function (event) {
        const [mx] = d3.pointer(event, this);
        const day = x.invert(mx);

        const nearest = mergedForHover.map((s) => {
          const i = bisect(s.values, day);
          const idx = Math.max(0, Math.min(s.values.length - 1, i));
          const v = s.values[idx];
          return { ...v, state: s.key, color: color(s.key) };
        });

        const rows = nearest
          .sort((a, b) => d3.descending(a.temp, b.temp))
          .map(
            (n) =>
              `<div style="display:flex;gap:8px;align-items:center">
                 <span style="width:10px;height:10px;border-radius:50%;background:${n.color}"></span>
                 <span>${n.state}</span>
                 <span style="margin-left:auto;font-weight:600">${n.temp.toFixed(1)}°C</span>
               </div>`
          )
          .join("");

        tooltip
          .style("opacity", 1)
          .html(
            `<div style="font-weight:700;margin-bottom:6px">${monthLabel} ${selectedYear} — Day ${Math.round(
              day
            )}</div>${rows}`
          )
          .style("left", `${56 + x(day)}px`)
          .style("top", `16px`);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
      });
  // added selectedCrop so the label updates immediately when crop changes
  }, [forecastSeries, actualSeries, size, color, selectedMonth, selectedYear, cropLimits, selectedCrop]);

  const monthLabel = MONTHS.find((m) => m.value === selectedMonth)?.label ?? "";

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h3" fontWeight={800} sx={{ mb: 1 }}>
        Seasonal Temperature Trends in Australia (AI Forecast)
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Dashed lines = model forecast; thin solid lines = actuals (when available).
      </Typography>

      {/* Controls */}
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        alignItems="center"
        sx={{ mb: 2 }}
      >
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="month-label">Month</InputLabel>
          <Select
            labelId="month-label"
            label="Month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(Number(e.target.value))}
          >
            {MONTHS.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {m.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="year-label">Year</InputLabel>
          <Select
            labelId="year-label"
            label="Year"
            value={selectedYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
          >
            {YEAR_OPTIONS.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Crop selector */}
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="crop-label">Crop</InputLabel>
          <Select
            labelId="crop-label"
            label="Crop"
            value={selectedCrop}
            onChange={(e) => setSelectedCrop(e.target.value)}
          >
            <MenuItem value="">
              <em>None (no band)</em>
            </MenuItem>
            {cropList.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* States (filtered by year, includes synthetic 2025 names) */}
        <FormControl size="small" sx={{ minWidth: 300, flexGrow: 1 }}>
          <InputLabel id="states-label">States</InputLabel>
          <Select
            labelId="states-label"
            multiple
            value={selectedStates}
            onChange={(e) =>
              setSelectedStates(
                typeof e.target.value === "string" ? e.target.value.split(",") : e.target.value
              )
            }
            input={<OutlinedInput label="States" />}
            renderValue={(selected) =>
              selected.length ? (
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {selected.map((v) => (
                    <Chip key={v} label={v} size="small" />
                  ))}
                </Box>
              ) : (
                <Typography sx={{ pl: 1 }} color="text.secondary">
                  Select stations for {selectedYear}
                </Typography>
              )
            }
          >
            {yearFilteredStates.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {/* Errors / status */}
      {errors && (
        <Typography color="warning.main" sx={{ mb: 1 }}>
          {errors}
        </Typography>
      )}
      {loading && selectedStates.length > 0 && (
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          Loading…
        </Typography>
      )}

      {/* Chart */}
      <Paper variant="outlined" sx={{ p: { xs: 1, md: 2 } }}>
        <Box ref={wrapRef} sx={{ width: "100%", position: "relative" }}>
          <svg ref={svgRef} width="100%" height={size.h} />
          <div
            ref={tooltipRef}
            style={{
              position: "absolute",
              pointerEvents: "none",
              transform: "translate(-50%, 0)",
              background: "rgba(255,255,255,0.96)",
              border: "1px solid #e5e7eb",
              padding: "8px 10px",
              borderRadius: 6,
              boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
              fontSize: 12,
              opacity: 0,
              zIndex: 3,
            }}
          />
        </Box>

        {/* Color legend for selected series */}
        {selectedStates.length > 0 && (
          <Box
            sx={{
              mt: 1,
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              alignItems: "center",
            }}
          >
            {selectedStates.map((s) => (
              <Box key={s} sx={{ display: "inline-flex", alignItems: "center" }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    bgcolor: color(s),
                    mr: 1,
                  }}
                />
                <Typography variant="body2">{s}</Typography>
              </Box>
            ))}

            {cropLimits && (
              <Chip
                sx={{ ml: 1 }}
                color="success"
                label={`Crop: ${selectedCrop} • Min ${cropLimits.min.toFixed(
                  1
                )}°C • Best ${cropLimits.best.toFixed(1)}°C • Max ${cropLimits.max.toFixed(1)}°C`}
                size="small"
                variant="outlined"
              />
            )}
          </Box>
        )}

        <Typography color="text.secondary" variant="caption" sx={{ mt: 1, display: "inline-block" }}>
          {monthLabel} — {selectedYear} • Dashed = forecast • Solid = actuals
        </Typography>
      </Paper>
    </Box>
  );
}
