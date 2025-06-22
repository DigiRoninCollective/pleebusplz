// src/components/ChatRoom.jsx - Main Chat Room Interface
import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const BACKEND_URL = 'http://localhost:5000'; // Update with your deployed URL

function ChatRoom() {
  const [socket, setSocket] = useState(null);
  const [chatRooms, setChatRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [username, setUsername] = useState('');
  const [tokens, setTokens] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  const [tokenPrice, setTokenPrice] = useState(null);
  const messagesEndRef = useRef(null);

  // Initialize socket connection
  useEffect(() => {
    const newSocket = io(BACKEND_URL);
    setSocket(newSocket);

    newSocket.on('new-message', (message) => {
      setMessages(prev => [...prev, message]);
    });

    return () => newSocket.close();
  }, []);

  // Load initial data
  useEffect(() => {
    fetchChatRooms();
    fetchTokens();
  }, []);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Fetch token price when selected
  useEffect(() => {
    if (selectedToken) {
      fetchTokenPrice(selectedToken.ticker.toLowerCase());
    }
  }, [selectedToken]);

  const fetchChatRooms = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/chat-rooms`);
      const rooms = await response.json();
      setChatRooms(rooms);
    } catch (error) {
      console.error('Error fetching chat rooms:', error);
    }
  };

  const fetchTokens = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/tokens`);
      const tokenData = await response.json();
      setTokens(tokenData);
    } catch (error) {
      console.error('Error fetching tokens:', error);
    }
  };

  const fetchTokenPrice = async (tokenId) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/solana-price/${tokenId}`);
      const priceData = await response.json();
      setTokenPrice(priceData);
    } catch (error) {
      console.error('Error fetching price:', error);
    }
  };

  const joinRoom = (room) => {
    if (socket && room) {
      setActiveRoom(room);
      socket.emit('join-room', room.id);
      setMessages([]); // Clear messages when switching rooms
    }
  };

  const sendMessage = () => {
    if (socket && newMessage.trim() && activeRoom && username.trim()) {
      const messageData = {
        roomId: activeRoom.id,
        username: username,
        message: newMessage,
        source: 'web',
        timestamp: new Date().toISOString()
      };
      
      socket.emit('chat-message', messageData);
      setNewMessage('');
    }
  };

  const createNewRoom = async () => {
    const roomName = prompt('Enter room name:');
    if (roomName) {
      try {
        const response = await fetch(`${BACKEND_URL}/api/chat-rooms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: roomName })
        });
        const newRoom = await response.json();
        setChatRooms(prev => [newRoom, ...prev]);
      } catch (error) {
        console.error('Error creating room:', error);
      }
    }
  };

  if (!username) {
    return (
      <div className="login-screen">
        <h2>Enter Your Username</h2>
        <input
          type="text"
          placeholder="Username"
          onKeyPress={(e) => {
            if (e.key === 'Enter' && e.target.value.trim()) {
              setUsername(e.target.value.trim());
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="sidebar">
        <div className="user-info">
          <h3>Welcome, {username}!</h3>
          <button onClick={() => setUsername('')}>Change Username</button>
        </div>

        <div className="chat-rooms">
          <div className="section-header">
            <h3>Chat Rooms</h3>
            <button onClick={createNewRoom}>+ New Room</button>
          </div>
          {chatRooms.map(room => (
            <div
              key={room.id}
              className={`room-item ${activeRoom?.id === room.id ? 'active' : ''}`}
              onClick={() => joinRoom(room)}
            >
              {room.name}
            </div>
          ))}
        </div>

        <div className="tokens-section">
          <h3>Tokens</h3>
          {tokens.slice(0, 5).map(token => (
            <div
              key={token.id}
              className={`token-item ${selectedToken?.id === token.id ? 'active' : ''}`}
              onClick={() => setSelectedToken(token)}
            >
              <strong>{token.ticker}</strong> - {token.name}
            </div>
          ))}
        </div>
      </div>

      <div className="main-content">
        {activeRoom ? (
          <div className="chat-container">
            <div className="chat-header">
              <h2>{activeRoom.name}</h2>
              <div className="connection-status">
                {socket?.connected ? '🟢 Connected' : '🔴 Disconnected'}
              </div>
            </div>

            <div className="messages-container">
              {messages.map((msg, index) => (
                <div key={index} className={`message ${msg.source}`}>
                  <span className="username">{msg.username}:</span>
                  <span className="message-text">{msg.message}</span>
                  <span className="timestamp">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <div className="message-input">
              <input
                type="text"
                placeholder="Type a message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              />
              <button onClick={sendMessage}>Send</button>
            </div>
          </div>
        ) : (
          <div className="no-room-selected">
            <h2>Select a chat room to start messaging</h2>
          </div>
        )}
      </div>

      {selectedToken && (
        <div className="token-panel">
          <div className="token-info">
            <h3>{selectedToken.name} ({selectedToken.ticker})</h3>
            <p>{selectedToken.description}</p>
            {selectedToken.image_url && (
              <img src={selectedToken.image_url} alt={selectedToken.name} className="token-image" />
            )}
            
            {tokenPrice && (
              <div className="price-info">
                <h4>Price Data:</h4>
                <pre>{JSON.stringify(tokenPrice, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default ChatRoom;