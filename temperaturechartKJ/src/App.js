// src/App.js
import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';

// Import your page components
import TrendsD3Page from './TrendsD3Page';
import SamplePage from './SamplePage';

// A simple component for the "Home" page (/)
function HomePage() {
  return (
    <div style={{ padding: '20px' }}>
      <h1>Home Page</h1>
      <p>Welcome! This is the main landing page.</p>
      <p>Please use the links in the navigation to go to other pages.</p>
    </div>
  );
}

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
              <Link to="/TrendsD3Page" style={{ color: 'white', textDecoration: 'none' }}>Trends (Page 1)</Link>
            </li>
            <li>
              <Link to="/SamplePage" style={{ color: 'white', textDecoration: 'none' }}>Sample (Page 2)</Link>
            </li>
          </ul>
        </nav>

        {/* --- ROUTE DEFINITIONS --- */}
        {/* This <Routes> block swaps components based on the URL */}
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/TrendsD3Page" element={<TrendsD3Page />} />
          <Route path="/SamplePage" element={<SamplePage />} />
        </Routes>
        
      </div>
    </BrowserRouter>
  );
}

export default App;