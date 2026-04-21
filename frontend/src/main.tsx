import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, useLocation } from 'react-router-dom'; // ✅ Запятая!
import App from './App';
import './index.css';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ChatSocketProvider } from './context/ChatSocketContext';

// 🔥 SocketWrapper: всегда возвращаем один и тот же тип элемента
function SocketWrapper({ children }: { children: React.ReactNode }) {
  const { token, currentUserId } = useAuth();
  const location = useLocation();
  
  const isAuthPage = location.pathname === '/login';
  const shouldConnect = !!token && !!currentUserId && !isAuthPage;

  // 🔥 Всегда рендерим ChatSocketProvider, но передаём null-пропсы если не нужно подключаться
  // Это сохраняет порядок хуков и совместимо с HMR
  return (
    <ChatSocketProvider 
      token={shouldConnect ? token : null} 
      currentUserId={shouldConnect ? currentUserId : null}
    >
      {children}
    </ChatSocketProvider>
  );
}

function RootWithProviders() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <SocketWrapper>
          <App />
        </SocketWrapper>
      </BrowserRouter>
    </AuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootWithProviders />
  </React.StrictMode>
);