import React, { useEffect, useState } from 'react';

function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  if (num >= 1e6) return (num / 1e6).toFixed(2) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(2) + 'K';
  return num.toLocaleString();
}

function formatPercent(pct) {
  if (pct === null || pct === undefined) return '-';
  const val = Number(pct);
  return (val > 0 ? '+' : '') + val.toFixed(2) + '%';
}

const TrendingLeaderboard = () => {
  const [tokens, setTokens] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/trending')
      .then(res => res.json())
      .then(data => {
        setTokens(data);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to load trending tokens');
        setLoading(false);
      });
  }, []);

  if (loading) return <div>Loading trending tokens...</div>;
  if (error) return <div style={{color:'red'}}>{error}</div>;

  return (
    <div className="trending-leaderboard">
      <h2>🔥 Trending Tokens</h2>
      <table style={{width:'100%', borderCollapse:'collapse', marginTop:16}}>
        <thead>
          <tr>
            <th>#</th>
            <th>Token</th>
            <th>Ticker</th>
            <th>24h Volume</th>
            <th>24h Change</th>
            <th>Liquidity</th>
            <th>Chat Members</th>
            <th>Messages</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t, i) => (
            <tr key={t.contract_address || t.id} style={{background:i%2?'#fafbfc':'#fff'}}>
              <td>{i+1}</td>
              <td>
                {t.image_url && <img src={t.image_url} alt={t.name} style={{width:28, height:28, borderRadius:6, marginRight:8, verticalAlign:'middle'}} />}
                {t.name}
              </td>
              <td>{t.ticker || t.symbol}</td>
              <td>{formatNumber(t.volume24h)}</td>
              <td style={{color: t.priceChange24h > 0 ? 'green' : t.priceChange24h < 0 ? 'red' : undefined}}>{formatPercent(t.priceChange24h)}</td>
              <td>{formatNumber(t.liquidity)}</td>
              <td>{t.chat_members}</td>
              <td>{t.message_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default TrendingLeaderboard;
