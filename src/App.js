// src/App.js
import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';

// Import pages
import TrendsD3Page from './TrendsD3Page';
import MapsD3Page from './MapsD3Page';
import RainfallD3Page from './RainfallD3Page';

// Import hero image
import farmerImage from './image/not_baymax.png';

/* ============================================================
   Responsive Breakpoint Hook
   ============================================================ */
function useBreakpoint() {
  const getWidth = () =>
    typeof window !== 'undefined' ? window.innerWidth : 1024;
  const [width, setWidth] = useState(getWidth);

  useEffect(() => {
    const handleResize = () => setWidth(getWidth());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return {
    width,
    isMobile: width < 640,
    isTablet: width >= 640 && width < 1024,
    isDesktop: width >= 1024,
  };
}

/* ============================================================
   Bottom Navigation Component
   ============================================================ */
function BottomNav() {
  const location = useLocation();
  const { isMobile } = useBreakpoint();

  // Mapping of page transitions
  const routes = [
    { path: "/", prev: null, next: "/MapsD3Page" },
    { path: "/MapsD3Page", prev: "/", next: "/TrendsD3Page" },
    { path: "/TrendsD3Page", prev: "/MapsD3Page", next: "/RainfallD3Page" },
    { path: "/RainfallD3Page", prev: "/TrendsD3Page", next: null },
  ];

  const current = routes.find((r) => r.path === location.pathname);
  if (!current) return null;

  const buttonStyle = {
    padding: isMobile ? "8px 14px" : "10px 18px",
    fontSize: isMobile ? 14 : 16,
    background: "#333",
    color: "white",
    textDecoration: "none",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    gap: 8,
  };

  const barStyle = {
    position: "fixed",
    bottom: 12,
    left: 0,
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    padding: "0 20px",
    pointerEvents: "none", // Allows clicks only on children
  };

  return (
    <div style={barStyle}>
      {/* Previous Button */}
      <div style={{ pointerEvents: "auto" }}>
        {current.prev && (
          <Link to={current.prev} style={buttonStyle}>
            ← Prev
          </Link>
        )}
      </div>

      {/* Next Button */}
      <div style={{ pointerEvents: "auto" }}>
        {current.next && (
          <Link to={current.next} style={buttonStyle}>
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   Home Page (Responsive Hero)
   ============================================================ */
function HomePage({ isMobile, isTablet }) {
  const wrapStyle = {
    ...styles.wrap,
    padding: isMobile ? "20px 12px" : "32px 20px",
  };

  const heroStyle = {
    ...styles.hero,
    flexDirection: isMobile ? "column-reverse" : "row",
    textAlign: isMobile ? "center" : "left",
    alignItems: "center",
  };

  const copyStyle = {
    ...styles.copy,
    alignItems: isMobile ? "center" : "flex-start",
  };

  return (
    <div style={wrapStyle}>
      <div style={heroStyle}>
        {/* Left Copy */}
        <div style={copyStyle}>
          <h1 style={styles.h1}>
            <span style={{ ...styles.h1Line1, fontSize: isMobile ? 52 : isTablet ? 72 : 88 }}>
              AI
            </span>
            <span style={{ ...styles.h1Line2, fontSize: isMobile ? 52 : isTablet ? 72 : 88 }}>
              FARMER
            </span>
          </h1>

          <p style={styles.lead}>
            Today’s weather, informed by history — helping you decide if it’s the right day to plant.
          </p>

          <h2 style={styles.subhead}>How is Today’s Weather and Forecast Calculated?</h2>
          <p style={styles.body}>
            Our weather forecasts are powered by machine learning, analyzing historical weather
            data from the past few years. While not based on real-time data, this approach helps
            provide accurate planting recommendations and forecasts.
          </p>

          <p style={styles.credit}>Presented by 1Bit.</p>
        </div>

        {/* Right Image */}
        <div style={styles.illustrationWrap}>
          <img src={farmerImage} alt="Farm" style={styles.illustration} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Shared Styles
   ============================================================ */
const styles = {
  wrap: { padding: "32px 20px" },
  hero: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "flex",
    gap: 32,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  copy: { flex: "1 1 440px", minWidth: 260, display: "flex", flexDirection: "column" },
  h1: { margin: 0, lineHeight: 1.02, letterSpacing: "-0.02em" },
  h1Line1: { display: "block", fontWeight: 900 },
  h1Line2: { display: "block", fontWeight: 900 },
  lead: { marginTop: 16, fontSize: 20, color: "#334155" },
  subhead: { marginTop: 28, fontSize: 22, fontWeight: 700 },
  body: { marginTop: 8, fontSize: 18, color: "#334155" },
  credit: { marginTop: 24, fontWeight: 600 },
  illustrationWrap: { flex: "0 1 480px", minWidth: 260, display: "grid", placeItems: "center" },
  illustration: { width: "100%", borderRadius: "50%", objectFit: "cover" },
};

/* ============================================================
   App Router & Layout
   ============================================================ */
function App() {
  const { isMobile, isTablet } = useBreakpoint();

  // Nav Bar Styles
  const navStyle = {
    padding: isMobile ? "8px 10px" : "10px 20px",
    background: "#333",
    color: "white",
    borderRadius: 8,
    margin: isMobile ? "8px" : "10px",
  };

  const navListStyle = {
    listStyle: "none",
    display: "flex",
    flexDirection: isMobile ? "column" : "row",
    gap: isMobile ? "8px" : "20px",
    margin: 0,
    padding: 0,
    alignItems: "center",
  };

  const navLinkStyle = { color: "white", textDecoration: "none", fontSize: isMobile ? 14 : 16 };

  return (
    <BrowserRouter>
      <div className="App">
        {/* Top Navigation */}
        <nav style={navStyle}>
          <ul style={navListStyle}>
            <li><Link to="/" style={navLinkStyle}>Home</Link></li>
            <li><Link to="/MapsD3Page" style={navLinkStyle}>MapsD3Page</Link></li>
            <li><Link to="/TrendsD3Page" style={navLinkStyle}>TrendsD3Page</Link></li>
            <li><Link to="/RainfallD3Page" style={navLinkStyle}>RainfallD3Page</Link></li>
          </ul>
        </nav>

        {/* Page Routes */}
        <Routes>
          <Route path="/" element={<HomePage isMobile={isMobile} isTablet={isTablet} />} />
          <Route path="/TrendsD3Page" element={<TrendsD3Page />} />
          <Route path="/MapsD3Page" element={<MapsD3Page />} />
          <Route path="/RainfallD3Page" element={<RainfallD3Page />} />
        </Routes>

        {/* Bottom Navigation */}
        <BottomNav />
      </div>
    </BrowserRouter>
  );
}

export default App;
