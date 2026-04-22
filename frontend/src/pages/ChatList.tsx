import { useEffect, useState } from 'react'; // 🔥 useMemo больше не нужен здесь
import { useNavigate, useParams } from 'react-router-dom';
import { chatAPI } from '../api/chat';
import { authAPI } from '../api/auth';
import { getChatTitle, getChatPreviewText } from "../utils/chat";
import { useChatSocket } from '../context/ChatSocketContext'; 
import { CreateChatModal } from '../components/CreateChatModal';
import type { Chat, MessageRead } from '../types'; // 🔥 UserRead, ChatCreatePayload больше не нужны здесь
import styles from './ChatList.module.css';

export function ChatList() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // 🔥 СОХРАНЯЕМ: состояние видимости модалки управляется родителем
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  const navigate = useNavigate();
  const { id: activeChatId } = useParams<{ id: string }>();
  
  const { subscribeToChatList, isUserOnline } = useChatSocket();

  // Загрузка начальных данных
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

  // Подписка на WebSocket-апдейты списка чатов
  useEffect(() => {
    const unsubscribe = subscribeToChatList((update) => {
      setChats(prev => {
        const idx = prev.findIndex(c => c.id === update.chat_id);
        if (idx === -1) return prev;
        
        const chatToUpdate = prev[idx];
        const updatedChat: Chat = {
          ...chatToUpdate,
          last_message: {
            id: 0,
            chat_id: update.chat_id,
            sender_id: update.sender_id,
            text: update.last_message_text,
            timestamp: update.last_message_at,
            read: false
          } as MessageRead
        };
        
        if (update.sender_id !== currentUserId) {
          updatedChat.unread_count = (updatedChat.unread_count || 0) + (update.unread_increment || 1);
        }
        
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

  // 🔥 Хендлер открытия модалки — теперь он реально открывает
  const handleOpenModal = (mode: 'personal' | 'group') => {
    setIsModalOpen(true);
    // 🔥 Опционально: можно передать mode в модалку через проп, если нужно
  };

  // 🔥 Колбэк: модалка сообщает, что чат создан
  const handleChatCreated = (newChat: Chat) => {
    setChats(prev => [newChat, ...prev]);
    navigate(`/chats/chat/${newChat.id}`);
  };

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
            
            return (
              <div
                key={chat.id}
                onClick={() => {
                  if (chat.unread_count && chat.unread_count > 0) {
                    setChats(prev => prev.map(c => 
                      c.id === chat.id ? { ...c, unread_count: 0 } : c
                    ));
                  }
                  navigate(`/chats/chat/${chat.id}`);
                }}
                className={`${styles.chatItem} ${chat.id == activeChatId ? styles.active : ''}`}
              >
                <div className={styles.avatar}>
                  {displayName.charAt(0).toUpperCase()}
                </div>

                <div className={styles.chatContent}>
                  <div className={styles.chatHeader}>
                    <span className={styles.chatTitle}>{displayName}</span>
                    
                    <div className={styles.headerRight}>
                      {/* 🔥 Индикатор онлайн-статуса (только для личных чатов) */}
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
                    {chat.unread_count && chat.unread_count > 0 && (
                      <span className={styles.unreadBadge}>
                        {chat.unread_count > 99 ? '99+' : chat.unread_count}
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

      {/* 🔥 Модалка: isOpen контролируется родителем */}
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