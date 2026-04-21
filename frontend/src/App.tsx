import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { ChatsLayout } from './pages/ChatsLayout';
import { ChatRoom } from './pages/ChatRoom';
import { useAuth } from './context/AuthContext'; // 🔥 Новый импорт

// 🔥 Компонент для защищённых роутов
function ProtectedRoute() {
  const { token, isLoading } = useAuth();
  
  if (isLoading) {
    return (
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '16px',
        color: '#64748b'
      }}>
        Загрузка...
      </div>
    );
  }
  
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  
  return <Outlet />;
}

// Компонент-заглушка для пустого состояния
const EmptyChat = () => (
  <div style={{
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    color: '#64748b',
    fontSize: '16px'
  }}>
    Выберите чат, чтобы начать общение 💬
  </div>
);

function App() {
  return (
      <Routes>
        {/* Публичные роуты */}
        <Route path="/login" element={<AuthPage />} />

        {/* 🔥 Защищённые роуты */}
        <Route element={<ProtectedRoute />}>
          <Route path="/chats" element={<ChatsLayout />}>
            <Route index element={<EmptyChat />} />
            <Route path="chat/:id" element={<ChatRoom />} />
          </Route>
          
          {/* Редирект с корня */}
          <Route path="/" element={<Navigate to="/chats" replace />} />
        </Route>

        {/* Catch-all: неавторизованных кидаем на логин, авторизованных — в чаты */}
        <Route path="*" element={<Navigate to="/chats" replace />} />
      </Routes>
  );
}

export default App;