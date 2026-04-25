import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { chatAPI } from '../api/chat';
import { authAPI } from '../api/auth';
import { getChatTitle, getChatPreviewText } from "../utils/chat";
import { useChatSocket } from '../context/ChatSocketContext'; 
import { CreateChatModal } from '../components/CreateChatModal';
import type { Chat, MessageRead } from '../types';
import styles from './ChatList.module.css';

export function ChatList() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const navigate = useNavigate();
  const { id: activeChatId } = useParams<{ id: string }>();
  
  const { 
    subscribeToChatList, 
    subscribeToMessagesRead, // 🔥 Новая подписка
    isUserOnline,
    markMessagesRead,
    connectionStatus 
  } = useChatSocket();

  // === Загрузка начальных данных ===
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

  // === Подписка на новые сообщения (обновление превью) ===
  useEffect(() => {
    const unsubscribe = subscribeToChatList((update) => {
      setChats(prev => {
        const idx = prev.findIndex(c => c.id === update.chat_id);
        if (idx === -1) return prev;
        
        const chatToUpdate = prev[idx];
        const isFromOtherUser = update.sender_id !== currentUserId;
        
        const updatedChat: Chat = {
          ...chatToUpdate,
          last_message: {
            id: 0,
            chat_id: update.chat_id,
            sender_id: update.sender_id,
            text: update.last_message_text,
            timestamp: update.last_message_at,
            read: !isFromOtherUser
          } as MessageRead,
          // 🔥 Обновляем unread_count ТОЛЬКО для сообщений от других
          unread_count: isFromOtherUser 
            ? (chatToUpdate.unread_count || 0) + 1 
            : (chatToUpdate.unread_count || 0)
        };
        
        // Перемещаем наверх и сортируем
        const filtered = prev.filter((_, i) => i !== idx);
        return [updatedChat, ...filtered].sort((a, b) => {
          const timeA = a.last_message?.timestamp ? new Date(a.last_message.timestamp).getTime() : 0;
          const timeB = b.last_message?.timestamp ? new Date(b.last_message.timestamp).getTime() : 0;
          return timeB - timeA;
        });
      });
    });
    
    return () => unsubscribe();
  }, [subscribeToChatList, currentUserId]);

  // === 🔥 Подписка на события прочтения (обновление только unread_count) ===
  useEffect(() => {
    // Подписываемся на все чаты — при получении события обновляем нужный
    const unsubscribe = subscribeToMessagesRead('*', (data) => {
      setChats(prev => prev.map(chat => {
        // Обновляем только если событие для этого чата И прочитал НЕ я
        if (data.reader_id !== currentUserId) {
          return { ...chat, unread_count: 0 };
        }
        return chat;
      }));
    });
    
    return () => unsubscribe();
  }, [subscribeToMessagesRead, currentUserId]);

  // === Обработчик выбора чата ===
  const handleChatSelect = useCallback((chatId: number, unreadCount?: number) => {
    // Локально сбрасываем счётчик для мгновенного отклика
    if (unreadCount && unreadCount > 0) {
      setChats(prev => prev.map(c => 
        c.id === chatId ? { ...c, unread_count: 0 } : c
      ));
    }
    
    navigate(`/chats/chat/${chatId}`);
    
    // Уведомляем бэкенд о прочтении
    setTimeout(() => {
      if (connectionStatus === 'open') {
        markMessagesRead(chatId);
      }
    }, 100);
  }, [navigate, markMessagesRead, connectionStatus]);

  // === Хендлеры модалки ===
  const handleOpenModal = (mode: 'personal' | 'group') => {
    setIsModalOpen(true);
  };

  const handleChatCreated = (newChat: Chat) => {
    setChats(prev => [newChat, ...prev]);
    navigate(`/chats/chat/${newChat.id}`);
  };

  // === Рендер ===
  if (loading) return <div className={styles.center}>Загрузка...</div>;
  if (error) return (
    <div className={styles.center}>
      <p style={{ color: '#dc2626' }}>{error}</p>
    </div>
  );

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
            const displayName = getChatTitle(chat, currentUserId);
            const lastMsg = chat.last_message;
            const lastMessageText = getChatPreviewText(chat, currentUserId);

            const interlocutor = chat.type === 'personal'
              ? chat.participants.find(p => p.id !== currentUserId)
              : null;

            const isInterlocutorOnline = interlocutor 
              ? isUserOnline(interlocutor.id) 
              : false;
            
            const lastMessageTime = lastMsg?.timestamp
              ? new Date(lastMsg.timestamp).toLocaleTimeString('ru-RU', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })
              : '';
              
              const hasUnread = (chat.unread_count || 0) > 0;
            
            return (
              <div
                key={chat.id}
                onClick={() => handleChatSelect(chat.id, chat.unread_count)}
                className={`${styles.chatItem} ${chat.id == activeChatId ? styles.active : ''}`}
              >
                <div className={styles.avatar}>
                  {displayName.charAt(0).toUpperCase()}
                </div>

                <div className={styles.chatContent}>
                  <div className={styles.chatHeader}>
                    <span className={styles.chatTitle}>{displayName}</span>
                    
                    <div className={styles.headerRight}>
                      {chat.type === 'personal' && (
                        <span 
                          className={`${styles.statusDot} ${isInterlocutorOnline ? styles.online : styles.offline}`}
                          title={isInterlocutorOnline ? 'В сети' : 'Не в сети'}
                        />
                      )}
                      
                      {lastMessageTime && (
                        <span className={styles.chatTime}>{lastMessageTime}</span>
                      )}
                    </div>
                  </div>
                  <div className={styles.chatPreview}>
                    <span className={styles.lastMessage} title={lastMessageText}>
                      {lastMessageText.length > 40 
                        ? lastMessageText.slice(0, 40) + '...' 
                        : lastMessageText}
                    </span>

                    {hasUnread && (
                      <span className={styles.unreadBadge}>
                        {(chat.unread_count || 0) > 99 ? '99+' : chat.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Кнопка создания чата */}
      <button 
        className={styles.createBtn}
        onClick={() => handleOpenModal('personal')}
        title="Новый чат"
      >
        ✎
      </button>

      <CreateChatModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreate={handleChatCreated}
        currentUserId={currentUserId}
        initialMode="personal"
      />
    </div>
  );
}