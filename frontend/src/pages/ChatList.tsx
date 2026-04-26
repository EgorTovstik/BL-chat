import { useEffect, useState, useCallback, useRef } from 'react';
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

  // 🔥 Состояние поиска
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Chat[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  
  const navigate = useNavigate();
  const { id: activeChatId } = useParams<{ id: string }>();
  
  const { 
    subscribeToChatList, 
    subscribeToMessagesRead,
    isUserOnline,
    markMessagesRead,
    connectionStatus,
    subscribeToNewChat 
  } = useChatSocket();

  // Реф для отслеживания, был ли уже синк после подключения сокета
  const hasSyncedAfterConnectRef = useRef(false);

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

  // === 🔥 Синхронизация чатов после подключения WebSocket ===
  useEffect(() => {
    if (connectionStatus === 'open' && !hasSyncedAfterConnectRef.current) {
      hasSyncedAfterConnectRef.current = true;
      
      const timer = setTimeout(async () => {
        try {
          const freshChats = await chatAPI.getChats();
          
          setChats(prev => {
            const prevMap = new Map(prev.map(c => [c.id, c]));
            
            freshChats.forEach(newChat => {
              const existing = prevMap.get(newChat.id);
              const prevTime = existing?.last_message?.timestamp;
              const newTime = newChat.last_message?.timestamp;
              
              if (!existing || newTime !== prevTime) {
                prevMap.set(newChat.id, newChat);
              }
            });
            
            return Array.from(prevMap.values()).sort((a, b) => {
              const timeA = a.last_message?.timestamp ? new Date(a.last_message.timestamp).getTime() : 0;
              const timeB = b.last_message?.timestamp ? new Date(b.last_message.timestamp).getTime() : 0;
              return timeB - timeA;
            });
          });
        } catch (err) {
          console.error('Failed to sync chats after WS connect:', err);
        }
      }, 500);
      
      return () => clearTimeout(timer);
    }
  }, [connectionStatus]);

  // === Подписка на новые сообщения (обновление превью) ===
  // 🔥 Обновляем и обычный список, и результаты поиска
  useEffect(() => {
    const unsubscribe = subscribeToChatList((update) => {
      // Функция для обновления конкретного массива чатов
      const updateChatList = (prevChats: Chat[]) => {
        const idx = prevChats.findIndex(c => c.id === update.chat_id);
        if (idx === -1) return prevChats;
        
        const chatToUpdate = prevChats[idx];
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
          unread_count: isFromOtherUser 
            ? (chatToUpdate.unread_count || 0) + 1 
            : (chatToUpdate.unread_count || 0)
        };
        
        const filtered = prevChats.filter((_, i) => i !== idx);
        return [updatedChat, ...filtered].sort((a, b) => {
          const timeA = a.last_message?.timestamp ? new Date(a.last_message.timestamp).getTime() : 0;
          const timeB = b.last_message?.timestamp ? new Date(b.last_message.timestamp).getTime() : 0;
          return timeB - timeA;
        });
      };

      // Обновляем основной список
      setChats(prev => updateChatList(prev));
      
      // 🔥 Если есть активный поиск — обновляем и результаты
      if (searchResults !== null) {
        setSearchResults(prev => prev ? updateChatList(prev) : null);
      }
    });
    
    return () => unsubscribe();
  }, [subscribeToChatList, currentUserId, searchResults]);

  // === 🔥 Подписка на события прочтения ===
  useEffect(() => {
    const unsubscribe = subscribeToMessagesRead('*', (data) => {
      const updateUnread = (prevChats: Chat[]) => prevChats.map(chat => {
        if (data.reader_id !== currentUserId) {
          return { ...chat, unread_count: 0 };
        }
        return chat;
      });

      setChats(prev => updateUnread(prev));
      
      if (searchResults !== null) {
        setSearchResults(prev => prev ? updateUnread(prev) : null);
      }
    });
    
    return () => unsubscribe();
  }, [subscribeToMessagesRead, currentUserId, searchResults]);

  useEffect(() => {
    const unsubscribe = subscribeToNewChat((newChat) => {
      setChats(prev => {
        // 🔥 Защита от дублей (если создатель тоже получит событие)
        if (prev.some(c => c.id === newChat.id)) return prev;
        return [newChat, ...prev];
      });
    });
    
    return () => unsubscribe();
  }, [subscribeToNewChat]);

  // === 🔥 Дебаунс поиска (300мс после последнего ввода) ===
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        console.log('⏳ [ChatList] Запуск поиска:', searchQuery);
        const results = await chatAPI.searchChats(searchQuery, 20);
        
        console.log('📦 [ChatList] Получено результатов:', results?.length);
        console.log('🔍 [ChatList] Первый результат:', results?.[0]);
        
        setSearchResults(results);
        
        // 🔥 Проверка: действительно ли стейт обновился?
        setTimeout(() => {
          console.log('🔄 [ChatList] searchResults после setState:', results?.length);
        }, 0);
        
      } catch (err) {
        console.error('❌ [ChatList] Ошибка поиска:', err);
        setSearchResults(null);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // === Обработчик выбора чата ===
  // 🔥 Работает и для обычного списка, и для результатов поиска
  const handleChatSelect = useCallback((chatId: number, unreadCount?: number) => {
    if (unreadCount && unreadCount > 0) {
      setChats(prev => prev.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c));
      if (searchResults !== null) {
        setSearchResults(prev => prev?.map(c => c.id === chatId ? { ...c, unread_count: 0 } : c));
      }
    }
    
    // 🔥 Сбрасываем поиск при переходе в чат
    setSearchQuery('');
    setSearchResults(null);
    
    navigate(`/chats/chat/${chatId}`);
    
    setTimeout(() => {
      if (connectionStatus === 'open') {
        markMessagesRead(chatId);
      }
    }, 100);
  }, [navigate, markMessagesRead, connectionStatus, searchResults]);

  // === Хендлеры модалки ===
  const handleOpenModal = (mode: 'personal' | 'group') => {
    setIsModalOpen(true);
  };

  const handleChatCreated = (newChat: Chat) => {
    setChats(prev => [newChat, ...prev]);
    // 🔥 Если активен поиск — добавляем новый чат и в результаты
    if (searchResults !== null) {
      setSearchResults(prev => prev ? [newChat, ...prev] : null);
    }
    navigate(`/chats/chat/${newChat.id}`);
  };

  // === Рендер ===
  if (loading) return <div className={styles.center}>Загрузка...</div>;
  if (error) return (
    <div className={styles.center}>
      <p style={{ color: '#dc2626' }}>{error}</p>
    </div>
  );

  // 🔥 Определяем, какие чаты показывать: результаты поиска или обычный список
  const displayedChats = searchResults !== null ? searchResults : chats;
  const isSearchActive = searchQuery.length >= 2;

  return (
    <div className={styles.container}>
      {/* Шапка с поиском */}
      <div className={styles.sidebarHeader}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Поиск чатов..."
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {/* 🔥 Кнопка очистки поиска */}
          {searchQuery && (
            <button 
              onClick={() => { setSearchQuery(''); setSearchResults(null); }}
              className={styles.clearSearchBtn}
              title="Очистить поиск"
              type="button"
            >
              ✕
            </button>
          )}
        </div>
        
        {/* 🔥 Индикатор поиска */}
        {isSearching && (
          <div className={styles.searchingIndicator}>Поиск...</div>
        )}
      </div>

      {/* Список чатов */}
      <div className={styles.chatList}>
        {displayedChats.length === 0 ? (
          <div className={styles.empty}>
            <p>{isSearchActive ? 'Ничего не найдено' : 'Нет чатов'}</p>
            {/* {isSearchActive && (
              <button 
                onClick={() => { setSearchQuery(''); setSearchResults(null); }}
                className={styles.clearSearchBtn}
              >
                Очистить поиск
              </button>
            )} */}
          </div>
        ) : (
          displayedChats.map(chat => {
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
        type="button"
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