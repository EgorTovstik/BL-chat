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
  
  // 🔥 Используем MessageState для стейта (с флагом isOptimistic)
  const [messages, setMessages] = useState<MessageState[]>([]);
  const [chatInfo, setChatInfo] = useState<Chat | null>(null);
  const [inputText, setInputText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  
  const { subscribeToChat, sendMessage, connectionStatus } = useChatSocket();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const chatIdRef = useRef<number | null>(null);

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
        // 🔥 Конвертируем историю в MessageState (все сообщения из истории — не оптимистичные)
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

  // Подписка на сообщения чата через контекст
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
        // 🔥 1. Сначала пробуем найти по client_msg_id (правильный способ)
        const optimisticByIdx = prev.findIndex(m => 
          m.isOptimistic && 
          m.client_msg_id && 
          serverMessage.client_msg_id &&
          m.client_msg_id === serverMessage.client_msg_id
        );

        if (optimisticByIdx !== -1) {
          log('info', `Replacing by client_msg_id at index ${optimisticByIdx}`);
          const newMessages = [...prev];
          newMessages[optimisticByIdx] = { ...serverMessage, isOptimistic: false };
          return newMessages;
        }

        // 🔥 2. Резервный поиск: по тексту + отправителю + времени (в пределах 5 секунд)
        // Срабатывает, если бэк не возвращает client_msg_id
        const serverTime = new Date(serverMessage.timestamp).getTime();
        const optimisticByContent = prev.findIndex(m => 
          m.isOptimistic &&
          m.sender_id === serverMessage.sender_id &&
          m.text === serverMessage.text &&
          Math.abs(new Date(m.timestamp).getTime() - serverTime) < 5000 // 5 секунд окно
        );

        if (optimisticByContent !== -1) {
          log('info', `Replacing by content match at index ${optimisticByContent}`);
          const newMessages = [...prev];
          newMessages[optimisticByContent] = { ...serverMessage, isOptimistic: false };
          return newMessages;
        }

        // 🔥 3. Если дубль по id — игнорируем (защита от повторной рассылки)
        if (prev.some(m => m.id === serverMessage.id)) {
          log('warn', `Duplicate message id=${serverMessage.id}, ignoring`);
          return prev;
        }

        // 🔥 4. Новое сообщение от другого пользователя — добавляем
        log('info', `Adding new message id=${serverMessage.id}`);
        return [...prev, { ...serverMessage, isOptimistic: false }];
      });
    });

    return () => unsubscribe();
  }, [chatId, currentUserId, subscribeToChat]);

  // Авто-скролл вниз при новых сообщениях
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Отправка сообщения (оптимистичное обновление)
  const handleSend = useCallback(() => {
    if (!inputText.trim() || !chatIdRef.current || !currentUserId) return;

    const numericChatId = chatIdRef.current;
    const client_msg_id = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    // 🔥 Оптимистичное сообщение (для мгновенного отображения)
    const optimisticMessage: MessageState = {
      id: -Date.now(), // Временный отрицательный ID
      chat_id: numericChatId,
      sender_id: currentUserId,
      text: inputText,
      timestamp: new Date().toISOString(),
      read: true, // Свои сообщения сразу "прочитаны"
      client_msg_id, // 🔥 Для сопоставления с ответом сервера
      isOptimistic: true, // 🔥 Флаг для визуализации
    };

    // 🔥 Мгновенно добавляем в стейт
    setMessages(prev => [...prev, optimisticMessage]);
    setInputText('');

    // 🔥 Формируем payload для отправки на бэк
    const payload: MessageCreatePayload = {
      type: 'message',
      chat_id: numericChatId, // 🔥 Обязательно! Бэк ожидает chat_id
      text: inputText,
      client_msg_id,
    };

    // Отправляем через сокет
    const sent = sendMessage(numericChatId, inputText, client_msg_id);
    
    if (!sent) {
      log('error', 'Failed to send message via WebSocket');
      // 🔥 Если отправка не удалась — убираем оптимистичное сообщение
      setMessages(prev => prev.filter(m => m.client_msg_id !== client_msg_id));
    }
  }, [inputText, currentUserId, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Очистка при размонтировании
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Заглушка, пока не загрузился user_id
  if (currentUserId === null) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Загрузка чата...</div>
      </div>
    );
  }

  // Вычисляем заголовок
  const chatTitle = chatInfo
    ? getChatTitle(chatInfo, currentUserId)
    : `Загрузка...`;

  // Маппинг статусов для индикатора
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
        {/* 🔥 Аватар чата */}
        <div className={styles.headerAvatar}>
          {chatInfo?.type === 'personal' 
            ? chatInfo.participants.find(p => p.id !== currentUserId)?.full_name?.charAt(0).toUpperCase() || '?'
            : chatInfo?.name?.charAt(0).toUpperCase() || 'G'
          }
        </div>

        <span className={styles.chatTitle}>{chatTitle}</span>

        {/* Индикатор статуса */}
        <span
          className={`${styles.statusDot} ${styles[connectionStatus]}`}
          style={{ backgroundColor: currentStatus.color }}
          title={currentStatus.label}
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
                // 🔥 Уникальный ключ: client_msg_id для оптимистичных, id для реальных
                key={msg.isOptimistic && msg.client_msg_id ? msg.client_msg_id : msg.id}
                // 🔥 Используем CSS-классы вместо инлайн flex-direction
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

                {/* 🔥 Используем CSS-классы вместо инлайн стилей */}
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