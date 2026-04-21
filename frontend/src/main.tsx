// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css'; // если есть
import { ChatSocketProvider } from './context/ChatSocketContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ChatSocketProvider token={localStorage.getItem('token')} currentUserId={null}>
        <App />
    </ChatSocketProvider>
  </React.StrictMode>
);