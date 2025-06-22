import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import Create from './pages/Create';
import Trending from './pages/Trending';

export default function App() {
  return (
    <Router>
      <nav style={{ background: '#fff', borderBottom: '1px solid #eee', padding: '12px 24px', display: 'flex', gap: 24 }}>
        <Link to="/" style={{ fontWeight: 'bold', color: '#333', textDecoration: 'none', fontSize: 20 }}>PLEBS</Link>
        <Link to="/trending" style={{ color: '#333', textDecoration: 'none' }}>Trending</Link>
        <Link to="/create" style={{ color: '#333', textDecoration: 'none' }}>Create Token</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/create" element={<Create />} />
        <Route path="/trending" element={<Trending />} />
      </Routes>
    </Router>
  );
}