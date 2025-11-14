// src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';

// Import your page components
import TrendsD3Page from './TrendsD3Page';
import MapsD3Page from './MapsD3Page';
import RainfallD3Page from './RainfallD3Page';

// Hero-style Home page matching the prototype
function HomePage() {
  return (
    <div style={styles.wrap}>
      <div style={styles.hero}>
        {/* Left: copy */}
        <div style={styles.copy}>
          <h1 style={styles.h1}>
            <span style={styles.h1Line1}>AI</span>
            <span style={styles.h1Line2}>FARMER</span>
          </h1>

          <p style={styles.lead}>
            Today’s weather, informed by history — helping you decide if it’s the right day to
            plant.
          </p>

          <h2 style={styles.subhead}>How is Today’s Weather and Forecast Calculated?</h2>
          <p style={styles.body}>
            Our weather forecasts are powered by machine learning, analyzing historical weather
            data from the past few years. While not based on real-time data, this approach helps
            provide accurate planting recommendations and forecasts.
          </p>

          <p style={styles.credit}>Presented by 1Bit.</p>

          <Link to="/TrendsD3Page" style={styles.cta}>
            View Temperature
          </Link>
        </div>

        {/* Right: illustration */}
        <div style={styles.illustrationWrap}>
          {/* Replace the src with your asset path if you have a file in /public */}
          <img
            src="https://images.unsplash.com/photo-1604328698692-f76ea9498e76?q=80&w=1200&auto=format&fit=crop"
            alt="Farm illustration"
            style={styles.illustration}
          />
          {/* If you have your own SVG/PNG (e.g., /hero-farmer.svg), use: src='/hero-farmer.svg' */}
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    padding: "32px 20px",
  },
  hero: {
    maxWidth: 1200,
    margin: "0 auto",
    display: "flex",
    gap: 32,
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
  },
  copy: {
    flex: "1 1 440px",
    minWidth: 320,
  },
  h1: {
    margin: 0,
    lineHeight: 1.02,
    letterSpacing: "-0.02em",
  },
  h1Line1: {
    display: "block",
    fontSize: 88,
    fontWeight: 900,
  },
  h1Line2: {
    display: "block",
    fontSize: 88,
    fontWeight: 900,
  },
  lead: {
    marginTop: 16,
    fontSize: 20,
    color: "#334155",
    maxWidth: 560,
  },
  subhead: {
    marginTop: 28,
    fontSize: 22,
    fontWeight: 700,
  },
  body: {
    marginTop: 8,
    fontSize: 18,
    color: "#334155",
    maxWidth: 560,
  },
  credit: {
    marginTop: 24,
    fontWeight: 600,
  },
  cta: {
    display: "inline-block",
    marginTop: 12,
    padding: "12px 18px",
    borderRadius: 8,
    background: "#2f6e41",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 700,
    transition: "transform .08s ease, box-shadow .08s ease, opacity .2s",
    boxShadow: "0 6px 18px rgba(0,0,0,.12)",
  },
  illustrationWrap: {
    flex: "0 1 480px",
    minWidth: 320,
    display: "grid",
    placeItems: "center",
  },
  illustration: {
    width: "100%",
    height: "auto",
    borderRadius: "50%",
    objectFit: "cover",
    aspectRatio: "1 / 1",
  },
};

function App() {
  return (
    <BrowserRouter>
      <div className="App">
        {/* --- NAVIGATION --- */}
        {/* I've added this simple navigation bar so you can click between pages */}
        <nav style={{ 
          padding: '10px 20px', 
          backgroundColor: '#333', 
          color: 'white',
          borderRadius: '8px',
          margin: '10px'
        }}>
          <ul style={{ listStyle: 'none', display: 'flex', gap: '20px', margin: 0, padding: 0 }}>
            <li>
              {/* Link component prevents a full page reload */}
              <Link to="/" style={{ color: 'white', textDecoration: 'none' }}>Home</Link>
            </li>
            <li>
              <Link to="/TrendsD3Page" style={{ color: 'white', textDecoration: 'none' }}>TrendsD3Page</Link>
            </li>
            <li>
              <Link to="/MapsD3Page" style={{ color: 'white', textDecoration: 'none' }}>MapsD3Page</Link>
            </li>
            <li>
              <Link to="/RainfallD3Page" style={{ color: 'white', textDecoration: 'none' }}>RainfallD3Page</Link>
            </li>
          </ul>
        </nav>

        {/* --- ROUTE DEFINITIONS --- */}
        {/* This <Routes> block swaps components based on the URL */}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/TrendsD3Page" element={<TrendsD3Page />} />
          <Route path="/MapsD3Page" element={<MapsD3Page />} />
          <Route path="/RainfallD3Page" element={<RainfallD3Page />} />
        </Routes>
        
      </div>
    </BrowserRouter>
  );
}

export default App;