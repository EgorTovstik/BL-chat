import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import type { Message, MessageCreatePayload, MessageState } from '../types/messages';
import type { Chat } from '../types';
import { chatAPI } from '../api/chat';
import { getChatTitle } from '../utils/chat';
import { useChatSocket } from '../context/ChatSocketContext';
import styles from './ChatRoom.module.css';

export function ChatRoom() {
  const { id: chatId } = useParams<{ id: string }>();
  
  const [messages, setMessages] = useState<MessageState[]>([]);
  const [chatInfo, setChatInfo] = useState<Chat | null>(null);
  const [inputText, setInputText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  
  // Статус собеседника онлайн/оффлайн
  const [isInterlocutorOnline, setIsInterlocutorOnline] = useState(false);
  
  // 🔥 НОВОЕ: Список пользователей, которые печатают в этом чате
  const [typingUsers, setTypingUsers] = useState<Set<number>>(new Set());
  
  // 🔥 Добавили sendTypingStatus в деструктуризацию
  const { 
    subscribeToChat, 
    sendMessage, 
    sendTypingStatus, // 🔥 НОВОЕ
    connectionStatus, 
    isUserOnline, 
    subscribeToUserStatus, 
    subscribeToTyping 
  } = useChatSocket();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const chatIdRef = useRef<number | null>(null);
  
  // 🔥 Рефы для debounce-логики отправки статуса "печатает"
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentlyTypingRef = useRef(false);

  const log = (type: 'info' | 'warn' | 'error', message: string, data?: any) => {
    if (process.env.NODE_ENV !== 'development') return;
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    const prefix = `[${timestamp}] [WS]`;
    const logFn = console[type] || console.log;
    logFn(`${prefix} ${message}`, data || '');
  };

  // Загрузка данных чата и истории
  useEffect(() => {
    isMountedRef.current = true;

    const token = localStorage.getItem('token');
    if (!token) {
      log('warn', 'No token found');
      window.location.href = '/login';
      return;
    }

    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(window.atob(base64));
      const userId = Number(payload.sub);
      setCurrentUserId(userId);
      log('info', `Parsed token: user_id=${userId}`);
    } catch (e) {
      log('error', 'Failed to parse token', e);
      window.location.href = '/login';
      return;
    }

    const fetchChatInfo = async () => {
      if (!chatId) return;
      try {
        const chat = await chatAPI.getChat(Number(chatId));
        setChatInfo(chat);
        log('info', `Loaded chat info: ${chat.name || 'personal'}`);
      } catch (err) {
        log('error', 'Failed to load chat info', err);
      }
    };

    const fetchMessageHistory = async () => {
      if (!chatId) return;
      try {
        const history = await chatAPI.getChatHistory(Number(chatId), 50);
        const messagesWithState: MessageState[] = history.map(m => ({ ...m, isOptimistic: false }));
        setMessages(messagesWithState);
        log('info', `Loaded ${history.length} messages`);
      } catch (err: any) {
        log('warn', 'Failed to load message history', err);
      }
    };

    fetchChatInfo();
    fetchMessageHistory();
  }, [chatId]);

  // Подписка на статус собеседника (онлайн/оффлайн)
  useEffect(() => {
    if (!chatInfo || !currentUserId) return;

    const interlocutor = chatInfo.type === 'personal'
      ? chatInfo.participants.find(p => p.id !== currentUserId)
      : null;

    if (interlocutor) {
      setIsInterlocutorOnline(isUserOnline(interlocutor.id));
      const unsubscribe = subscribeToUserStatus(interlocutor.id, (online) => {
        setIsInterlocutorOnline(online);
      });
      return () => unsubscribe();
    } else {
      setIsInterlocutorOnline(false);
    }
  }, [chatInfo, currentUserId, isUserOnline, subscribeToUserStatus]);

  // 🔥 НОВОЕ: Подписка на события "печатает" для текущего чата
  useEffect(() => {
    if (!chatId) return;
    
    const numericChatId = Number(chatId);
    
    const unsubscribe = subscribeToTyping(numericChatId, (typingUserIds) => {
      // Обновляем список печатающих (исключаем себя)
      setTypingUsers(new Set(
        Array.from(typingUserIds).filter(id => id !== currentUserId)
      ));
    });
    
    return () => unsubscribe();
  }, [chatId, currentUserId, subscribeToTyping]);

  // Подписка на сообщения чата
  useEffect(() => {
    if (!chatId || currentUserId === null) return;
    
    const numericChatId = Number(chatId);
    chatIdRef.current = numericChatId;

    const unsubscribe = subscribeToChat(numericChatId, (serverMessage) => {
      if (!isMountedRef.current) return;
      
      log('info', '📩 Received new_message', { 
        id: serverMessage.id, 
        client_msg_id: serverMessage.client_msg_id 
      });
      
      setMessages((prev) => {
        const optimisticByIdx = prev.findIndex(m => 
          m.isOptimistic && 
          m.client_msg_id && 
          serverMessage.client_msg_id &&
          m.client_msg_id === serverMessage.client_msg_id
        );

        if (optimisticByIdx !== -1) {
          const newMessages = [...prev];
          newMessages[optimisticByIdx] = { ...serverMessage, isOptimistic: false };
          return newMessages;
        }

        const serverTime = new Date(serverMessage.timestamp).getTime();
        const optimisticByContent = prev.findIndex(m => 
          m.isOptimistic &&
          m.sender_id === serverMessage.sender_id &&
          m.text === serverMessage.text &&
          Math.abs(new Date(m.timestamp).getTime() - serverTime) < 5000
        );

        if (optimisticByContent !== -1) {
          const newMessages = [...prev];
          newMessages[optimisticByContent] = { ...serverMessage, isOptimistic: false };
          return newMessages;
        }

        if (prev.some(m => m.id === serverMessage.id)) {
          return prev;
        }

        return [...prev, { ...serverMessage, isOptimistic: false }];
      });
    });

    return () => unsubscribe();
  }, [chatId, currentUserId, subscribeToChat]);

  // 🔥 НОВОЕ: Логика отправки статуса "печатает" с дебаунсом
  // 🔥 Добавили sendTypingStatus в зависимости
  const handleTyping = useCallback(() => {
    if (!chatIdRef.current || !currentUserId) return;
    
    const numericChatId = chatIdRef.current;
    
    // Если поле пустое — сразу сообщаем, что перестали печатать
    if (!inputText.trim()) {
      if (isCurrentlyTypingRef.current) {
        // 🔥 ИСПРАВЛЕНО: используем sendTypingStatus вместо хака с sendMessage
        sendTypingStatus(numericChatId, false);
        isCurrentlyTypingRef.current = false;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      return;
    }
    
    // Если ещё не отправили сигнал "печатает" — отправляем
    if (!isCurrentlyTypingRef.current) {
      // 🔥 ИСПРАВЛЕНО: используем sendTypingStatus
      sendTypingStatus(numericChatId, true);
      isCurrentlyTypingRef.current = true;
    }
    
    // Сбрасываем предыдущий таймер
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Устанавливаем новый таймер: если пауза > 2 сек — считаем, что перестал печатать
    typingTimeoutRef.current = setTimeout(() => {
      if (isCurrentlyTypingRef.current) {
        // 🔥 ИСПРАВЛЕНО: используем sendTypingStatus
        sendTypingStatus(numericChatId, false);
        isCurrentlyTypingRef.current = false;
      }
      typingTimeoutRef.current = null;
    }, 2000);
    
  }, [inputText, currentUserId, sendTypingStatus]); // 🔥 Добавили sendTypingStatus

  // Вызываем handleTyping при каждом изменении inputText
  useEffect(() => {
    handleTyping();
  }, [inputText, handleTyping]);

  // Авто-скролл
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Очистка таймеров при размонтировании
  // 🔥 Добавили sendTypingStatus в зависимости
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        // Опционально: сообщить бэку, что юзер ушёл
        if (chatIdRef.current && isCurrentlyTypingRef.current) {
          // 🔥 ИСПРАВЛЕНО: используем sendTypingStatus
          sendTypingStatus(chatIdRef.current, false);
        }
      }
    };
  }, [sendTypingStatus]); // 🔥 Добавили sendTypingStatus
  
  // Отправка сообщения
  // 🔥 Добавили sendTypingStatus в зависимости
  const handleSend = useCallback(() => {
    if (!inputText.trim() || !chatIdRef.current || !currentUserId) return;

    const numericChatId = chatIdRef.current;
    const client_msg_id = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    const optimisticMessage: MessageState = {
      id: -Date.now(),
      chat_id: numericChatId,
      sender_id: currentUserId,
      text: inputText,
      timestamp: new Date().toISOString(),
      read: true,
      client_msg_id,
      isOptimistic: true,
    };

    setMessages(prev => [...prev, optimisticMessage]);
    setInputText('');
    
    // 🔥 Сразу сообщаем, что перестали печатать (после отправки)
    if (isCurrentlyTypingRef.current) {
      // 🔥 ИСПРАВЛЕНО: используем sendTypingStatus
      sendTypingStatus(numericChatId, false);
      isCurrentlyTypingRef.current = false;
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    const payload: MessageCreatePayload = {
      type: 'message',
      chat_id: numericChatId,
      text: inputText,
      client_msg_id,
    };

    const sent = sendMessage(numericChatId, inputText, client_msg_id);
    
    if (!sent) {
      log('error', 'Failed to send message via WebSocket');
      setMessages(prev => prev.filter(m => m.client_msg_id !== client_msg_id));
    }
  }, [inputText, currentUserId, sendMessage, sendTypingStatus]); // 🔥 Добавили sendTypingStatus

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 🔥 useMemo ДО раннего возврата
  const typingText = React.useMemo(() => {
    if (typingUsers.size === 0) return '';
    if (!chatInfo) return '';
    
    if (chatInfo.type === 'personal') {
      return 'Печатает...';
    } else {
      const names = Array.from(typingUsers)
        .map(uid => chatInfo.participants.find(p => p.id === uid)?.full_name || 'Участник')
        .slice(0, 2);
      
      if (names.length === 1) {
        return `${names[0]} печатает...`;
      } else {
        return `${names.join(', ')} печатают...`;
      }
    }
  }, [typingUsers, chatInfo]);

  // 🔥 Ранний возврат — ПОСЛЕ всех хуков
  if (currentUserId === null) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Загрузка чата...</div>
      </div>
    );
  }

  const chatTitle = chatInfo
    ? getChatTitle(chatInfo, currentUserId)
    : `Загрузка...`;

  const statusMap: Record<typeof connectionStatus, { color: string; label: string }> = {
    connecting: { color: '#fbbf24', label: 'Подключение...' },
    open: { color: '#4ade80', label: 'Онлайн' },
    closed: { color: '#94a3b8', label: 'Нет связи' },
    error: { color: '#ef4444', label: 'Ошибка' },
  };
  const currentStatus = statusMap[connectionStatus];

  return (
    <div className={styles.container}>
      {/* Шапка чата */}
      <div className={styles.header}>
        <div className={styles.headerAvatar}>
          {chatInfo?.type === 'personal' 
            ? chatInfo.participants.find(p => p.id !== currentUserId)?.full_name?.charAt(0).toUpperCase() || '?'
            : chatInfo?.name?.charAt(0).toUpperCase() || 'G'
          }
        </div>

        <div className={styles.userInfo}>
          <span className={styles.chatTitle}>{chatTitle}</span>
          
          {chatInfo?.type === 'personal' && (
            <span className={`${styles.userStatus} ${isInterlocutorOnline ? styles.statusOnline : styles.statusOffline}`}>
              {isInterlocutorOnline ? 'В сети' : 'Не в сети'}
            </span>
          )}
        </div>

        <span
          className={styles.connectionStatusDot}
          style={{ backgroundColor: currentStatus.color }}
          title={`Соединение: ${currentStatus.label}`}
        />
      </div>

      {/* Область сообщений */}
      <div className={styles.messagesArea}>
        {messages.length === 0 ? (
          <div className={styles.emptyChat}>
            <p>Нет сообщений. Напишите первым!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMyMessage = msg.sender_id === currentUserId;
            const time = new Date(msg.timestamp).toLocaleTimeString('ru-RU', {
              hour: '2-digit',
              minute: '2-digit'
            });
            const senderName = isMyMessage ? 'Вы' : (msg.sender?.full_name || 'Собеседник');

            return (
              <div
                key={msg.isOptimistic && msg.client_msg_id ? msg.client_msg_id : msg.id}
                className={`${styles.messageWrapper} ${isMyMessage ? styles['messageWrapper--sent'] : ''}`}
                style={{
                  opacity: msg.isOptimistic ? 0.7 : 1,
                  transition: 'opacity 0.2s ease',
                }}
              >
                {!isMyMessage && (
                  <div className={styles.msgAvatar}>
                    {msg.sender?.full_name?.charAt(0).toUpperCase() || '?'}
                  </div>
                )}

                <div className={`${styles.messageBubble} ${isMyMessage ? styles['messageBubble--sent'] : ''}`}>
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 2 }}>
                    {senderName}
                  </div>
                  {msg.text}
                  <div className={styles.messageMeta}>
                    {time}
                    {isMyMessage && !msg.isOptimistic && (
                      <span style={{ color: msg.read ? '#4ade80' : 'inherit' }}>
                        {msg.read ? '✓✓' : '✓'}
                      </span>
                    )}
                    {msg.isOptimistic && <span title="Отправка...">⏳</span>}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 🔥 Индикатор "Печатает..." с анимацией */}
      {typingText && (
        <div className={styles.typingIndicator}>
          <span className={styles.typingText}>{typingText}</span>
          <span className={styles.typingDots}>
            <span className={styles.dot}></span>
            <span className={styles.dot}></span>
            <span className={styles.dot}></span>
          </span>
        </div>
      )}

      {/* Поле ввода */}
      <div className={styles.inputArea}>
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Написать сообщение..."
          disabled={connectionStatus !== 'open'}
          className={styles.input}
          style={{
            opacity: connectionStatus === 'open' ? 1 : 0.6,
          }}
        />
        <button 
          onClick={handleSend} 
          disabled={connectionStatus !== 'open' || !inputText.trim()}
          className={styles.sendBtn}
          style={{
            opacity: (connectionStatus === 'open' && inputText.trim()) ? 1 : 0.5,
            cursor: (connectionStatus === 'open' && inputText.trim()) ? 'pointer' : 'not-allowed',
          }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}