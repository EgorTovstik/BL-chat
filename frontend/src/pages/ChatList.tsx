// src/pages/ChatList.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatAPI } from '../api/chat';
import { authAPI } from '../api/auth';
import type { Chat } from '../types';
import styles from './ChatList.module.css';

export function ChatList() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const loadData = async () => {
      try {
        const [user, chatsData] = await Promise.all([
          authAPI.getCurrentUser(),
          chatAPI.getChats()
        ]);
        
        setCurrentUserId(user.id);
        setChats(chatsData);
      } catch (err: any) {
        console.error('Failed to load data:', err);
        const detail = err.response?.data?.detail || 'Ошибка загрузки';
        setError(Array.isArray(detail) ? detail[0] : detail);
        
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  const getChatTitle = (chat: Chat, myId: number | null): string => {
    if (chat.name) return chat.name;
    
    if (chat.type === 'personal' && chat.participants.length > 0 && myId !== null) {
      const interlocutor = chat.participants.find(p => p.id !== myId);
      if (interlocutor) {
        return interlocutor.full_name;
      }
    }
    return 'Без названия';
  };

  if (loading) return <div className={styles.center}>Загрузка...</div>;
  if (error) return (
    <div className={styles.center}>
      <p style={{ color: '#dc2626' }}>{error}</p>
    </div>
  );

  // 🔥 Теперь рендерим ТОЛЬКО список чатов (без заглушки и второй колонки)
  return (
    <div className={styles.container}>
      {/* Шапка с поиском */}
      <div className={styles.sidebarHeader}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Поиск"
            className={styles.searchInput}
          />
        </div>
      </div>

      {/* Список чатов */}
      <div className={styles.chatList}>
        {chats.length === 0 ? (
          <div className={styles.empty}>
            <p>Нет чатов</p>
          </div>
        ) : (
          chats.map(chat => {
            const interlocutor = chat.type === 'personal' 
              ? chat.participants.find(p => p.id !== currentUserId)
              : null;
            const displayName = chat.name || interlocutor?.full_name || 'Без названия';
            const lastMessage = "Нажмите, чтобы открыть чат";
            
            return (
              <div
                key={chat.id}
                // 🔥 Путь для вложенных роутов
                onClick={() => navigate(`/chats/chat/${chat.id}`)}
                className={styles.chatItem}
              >
                {/* Аватар */}
                <div className={styles.avatar}>
                  {displayName.charAt(0).toUpperCase()}
                </div>

                {/* Контент карточки */}
                <div className={styles.chatContent}>
                  <div className={styles.chatHeader}>
                    <span className={styles.chatTitle}>{displayName}</span>
                    <span className={styles.chatTime}>12:34</span>
                  </div>
                  <div className={styles.chatPreview}>
                    <span className={styles.lastMessage}>{lastMessage}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}