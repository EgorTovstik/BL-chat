// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { ChatsLayout } from './pages/ChatsLayout';  // 🔥 Новый импорт
import { ChatRoom } from './pages/ChatRoom';        // 🔥 ChatRoom теперь вложен

// Компонент-заглушка для пустого состояния
const EmptyChat = () => (
  <div style={{
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#87aadd',
    color: '#fff',
    fontSize: '16px'
  }}>
    Выберите чат, чтобы начать общение
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Авторизация */}
        <Route path="/login" element={<AuthPage />} />

        {/* 🔥 Вложенные роуты для чатов */}
        <Route path="/chats" element={<ChatsLayout />}>
          {/* По умолчанию — заглушка */}
          <Route index element={<EmptyChat />} />
          {/* При выборе чата — показываем ChatRoom */}
          <Route path="chat/:id" element={<ChatRoom />} />
        </Route>

        {/* Редиректы */}
        <Route path="/" element={<Navigate to="/chats" replace />} />
        <Route path="*" element={<Navigate to="/chats" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;