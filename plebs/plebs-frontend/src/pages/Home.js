// Homepage// src/pages/Home.js - Updated Homepage with Chat Integration
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ChatRoom from '../components/ChatRoom';

export default function Home() {
  const [tokens, setTokens] = useState([]);
  const [showChat, setShowChat] = useState(false);
  const [loading, setLoading] = useState(true);

  const BACKEND_URL = 'http://localhost:5000'; // Update with your deployed URL

  useEffect(() => {
    fetchTokens();
  }, []);

  const fetchTokens = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/tokens`);
      const data = await response.json();
      setTokens(data);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching tokens:', error);
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
      {/* Header */}
      <header style={{ 
        padding: '20px', 
        background: 'rgba(0,0,0,0.1)', 
        color: 'white',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h1 style={{ margin: 0, fontSize: '2.5rem', fontWeight: 'bold' }}>
          🔥 PLEBS 🔥
        </h1>
        <nav style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
          <Link 
            to="/create" 
            style={{ 
              color: 'white', 
              textDecoration: 'none', 
              padding: '10px 20px',
              background: 'rgba(255,255,255,0.2)',
              borderRadius: '25px',
              transition: 'all 0.3s'
            }}
          >
            Create Token
          </Link>
          <button
            onClick={() => setShowChat(!showChat)}
            style={{
              background: showChat ? '#e74c3c' : '#27ae60',
              color: 'white',
              border: 'none',
              padding: '10px 20px',
              borderRadius: '25px',
              cursor: 'pointer',
              fontSize: '16px',
              transition: 'all 0.3s'
            }}
          >
            {showChat ? 'Hide Chat' : 'Open Chat Room'}
          </button>
        </nav>
      </header>

      {/* Chat Room Overlay */}
      {showChat && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 1000,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center'
        }}>
          <div style={{
            width: '90%',
            height: '90%',
            background: 'white',
            borderRadius: '10px',
            position: 'relative'
          }}>
            <button
              onClick={() => setShowChat(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '15px',
                background: '#e74c3c',
                color: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '30px',
                height: '30px',
                cursor: 'pointer',
                zIndex: 1001,
                fontSize: '18px'
              }}
            >
              ×
            </button>
            <ChatRoom />
          </div>
        </div>
      )}

      {/* Main Content */}
      <main style={{ padding: '40px 20px' }}>
        <div style={{ 
          textAlign: 'center', 
          color: 'white', 
          marginBottom: '40px' 
        }}>
          <h2 style={{ fontSize: '2rem', marginBottom: '20px' }}>
            Welcome to PLEBS - The People's Token Launchpad
          </h2>
          <p style={{ fontSize: '1.2rem', opacity: 0.9, maxWidth: '600px', margin: '0 auto' }}>
            Create, trade, and chat about the hottest tokens. Join our community chat rooms 
            with integrated Telegram bots and live Solana charts!
          </p>
        </div>

        {/* Featured Tokens */}
        <div style={{ 
          background: 'rgba(255,255,255,0.1)', 
          borderRadius: '15px', 
          padding: '30px',
          marginBottom: '40px'
        }}>
          <h3 style={{ color: 'white', marginBottom: '20px', fontSize: '1.5rem' }}>
            Featured Tokens 🚀
          </h3>
          
          {loading ? (
            <div style={{ color: 'white', textAlign: 'center', padding: '40px' }}>
              Loading tokens...
            </div>
          ) : tokens.length === 0 ? (
            <div style={{ 
              color: 'white', 
              textAlign: 'center', 
              padding: '40px',
              opacity: 0.8
            }}>
              No tokens created yet. Be the first!
              <br />
              <Link 
                to="/create" 
                style={{ 
                  color: '#3498db', 
                  textDecoration: 'underline',
                  marginTop: '10px',
                  display: 'inline-block'
                }}
              >
                Create the first token →
              </Link>
            </div>
          ) : (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
              gap: '20px' 
            }}>
              {tokens.slice(0, 6).map(token => (
                <div 
                  key={token.id}
                  style={{
                    background: 'rgba(255,255,255,0.9)',
                    padding: '20px',
                    borderRadius: '10px',
                    color: '#2c3e50',
                    transition: 'transform 0.3s',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => e.target.style.transform = 'translateY(-5px)'}
                  onMouseLeave={(e) => e.target.style.transform = 'translateY(0)'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '15px' }}>
                    {token.image_url && (
                      <img 
                        src={token.image_url} 
                        alt={token.name}
                        style={{ 
                          width: '40px', 
                          height: '40px', 
                          borderRadius: '50%', 
                          marginRight: '15px',
                          objectFit: 'cover'
                        }}
                      />
                    )}
                    <div>
                      <h4 style={{ margin: 0, fontSize: '1.2rem' }}>{token.name}</h4>
                      <p style={{ margin: 0, color: '#7f8c8d', fontWeight: 'bold' }}>
                        ${token.ticker}
                      </p>
                    </div>
                  </div>
                  <p style={{ 
                    margin: 0, 
                    color: '#34495e', 
                    lineHeight: 1.4,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden'
                  }}>
                    {token.description}
                  </p>
                  <div style={{ 
                    marginTop: '15px', 
                    padding: '10px', 
                    background: '#f8f9fa', 
                    borderRadius: '5px',
                    fontSize: '12px',
                    color: '#7f8c8d'
                  }}>
                    Created: {new Date(token.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Features Section */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
          gap: '30px',
          marginTop: '60px'
        }}>
          <div style={{ 
            background: 'rgba(255,255,255,0.1)', 
            padding: '30px', 
            borderRadius: '15px', 
            textAlign: 'center',
            color: 'white'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '15px' }}>💬</div>
            <h3>Chat Rooms</h3>
            <p>Real-time chat with Telegram bot integration</p>
          </div>
          
          <div style={{ 
            background: 'rgba(255,255,255,0.1)', 
            padding: '30px', 
            borderRadius: '15px', 
            textAlign: 'center',
            color: 'white'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '15px' }}>📊</div>
            <h3>Live Charts</h3>
            <p>Real-time Solana token prices and charts</p>
          </div>
          
          <div style={{ 
            background: 'rgba(255,255,255,0.1)', 
            padding: '30px', 
            borderRadius: '15px', 
            textAlign: 'center',
            color: 'white'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '15px' }}>🚀</div>
            <h3>Launch Tokens</h3>
            <p>Easy token creation and community building</p>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer style={{ 
        padding: '40px 20px', 
        textAlign: 'center', 
        color: 'rgba(255,255,255,0.8)',
        borderTop: '1px solid rgba(255,255,255,0.1)'
      }}>
        <p>🔥 PLEBS - By the people, for the people 🔥</p>
        <p style={{ fontSize: '14px', opacity: 0.7 }}>
          Built with React, Node.js, PostgreSQL, and Solana
        </p>
      </footer>
    </div>
  );
}