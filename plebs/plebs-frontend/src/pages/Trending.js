import React from 'react';
import TrendingLeaderboard from '../components/TrendingLeaderboard';

export default function TrendingPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f8fafc 0%, #e0e7ff 100%)', padding: '40px 0' }}>
      <div style={{ maxWidth: 900, margin: '0 auto', background: 'white', borderRadius: 16, boxShadow: '0 4px 24px rgba(0,0,0,0.07)', padding: 32 }}>
        <TrendingLeaderboard />
      </div>
    </div>
  );
}
