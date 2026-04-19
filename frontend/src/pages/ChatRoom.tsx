// src/pages/ChatRoom.tsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom'; // 🔥 useNavigate больше не нужен для кнопки "Назад"
import type { Message, MessageCreatePayload } from '../types/messages';
import styles from './ChatRoom.module.css';

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function ChatRoom() {
  const { id: chatId } = useParams<{ id: string }>();
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);

  const log = (type: 'info' | 'warn' | 'error', message: string, data?: any) => {
    const timestamp = new Date().toISOString().split('T')[1].slice(0, 8);
    const prefix = `[${timestamp}] [WS]`;
    const logFn = console[type] || console.log;
    logFn(`${prefix} ${message}`, data || '');
  };

  useEffect(() => {
    isMountedRef.current = true;

    const token = localStorage.getItem('token');
    if (!token) {
      log('warn', 'No token found');
      // 🔥 В новой структуре редирект делаем через window.location, чтобы перезагрузить всё приложение
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

    const connect = () => {
      if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
        log('info', 'WebSocket already active, skipping connect');
        return;
      }
        
      if (!isMountedRef.current) return;
      
      setConnectionStatus('connecting');
      const wsUrl = `ws://localhost:8000/api/v1/ws/${chatId}?token=${token}`;
      
      log('info', `Connecting to ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) return;
        log('info', '✅ WebSocket connected', {
          readyState: ws.readyState,
          protocol: ws.protocol,
          url: ws.url
        });
        setConnectionStatus('connected');
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        
        try {
          const data = JSON.parse(event.data);
          log('info', '📩 Received message', { type: data.type, id: data.id });
          
          if (data.type === 'message') {
            const { type, ...msg } = data as Message & { type: string };
            
            setMessages((prev) => {
              if (prev.some(m => m.id === msg.id)) {
                log('warn', `Duplicate message ignored: id=${msg.id}`);
                return prev;
              }
              log('info', `Added new message: id=${msg.id}, text="${msg.text.slice(0, 30)}..."`);
              return [...prev, msg];
            });
          } else if (data.type === 'pong') {
            // Игнорируем ответ на пинг
          } else {
            log('warn', `Unknown message type: ${data.type}`, data);
          }
        } catch (e) {
          log('error', 'Failed to parse incoming message', { error: e, raw: event.data });
        }
      };

      ws.onclose = (event) => {
        if (!isMountedRef.current) return;
        
        log('info', '🔌 WebSocket closed', {
          code: event.code,
          reason: event.reason || '(no reason)',
          wasClean: event.wasClean,
          timestamp: new Date().toISOString()
        });
        
        setConnectionStatus('disconnected');
        
        if (event.code !== 1000 && isMountedRef.current) {
          log('info', 'Attempting reconnect in 2s...');
          reconnectTimeoutRef.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = (error: Event) => {
        if (!isMountedRef.current) return;
        
        log('error', '❌ WebSocket error event', {
          error: error.toString(),
          readyState: ws.readyState,
          timestamp: new Date().toISOString()
        });
        setConnectionStatus('error');
      };
    };

    connect();

    return () => {
      isMountedRef.current = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        log('info', 'Closing WebSocket on unmount');
        wsRef.current.close(1000, 'Component unmounted');
      }
    };
  }, [chatId]); // 🔥 Только chatId! navigate убрали

  // Авто-скролл вниз
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Отправка сообщения
  const handleSend = () => {
    if (!inputText.trim()) return;
    
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log('warn', 'Cannot send: WebSocket not open', { readyState: ws?.readyState });
      return;
    }

    const payload: MessageCreatePayload = {
      type: 'message',
      text: inputText,
      client_msg_id: `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    };

    try {
      ws.send(JSON.stringify(payload));
      log('info', '📤 Sent message', { text: inputText.slice(0, 30), client_msg_id: payload.client_msg_id });
      setInputText('');
    } catch (e) {
      log('error', 'Failed to send message', e);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 🔥 Определяем заголовок чата (имя собеседника или название группы)
  const chatTitle = React.useMemo(() => {
    if (messages.length === 0) return `Чат #${chatId}`;
    
    const firstMsg = messages[0];
    if (firstMsg.sender) {
      // Если чат личный — показываем имя собеседника
      if (firstMsg.sender_id !== currentUserId) {
        return firstMsg.sender.full_name;
      }
      // Если первое сообщение от нас — попробуем найти другое
      const other = messages.find(m => m.sender_id !== currentUserId)?.sender;
      if (other) return other.full_name;
    }
    return `Чат #${chatId}`;
  }, [messages, chatId, currentUserId]);

  // 🔥 Заглушка, пока не загрузился user_id
  if (currentUserId === null) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Загрузка чата...</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      {/* Шапка чата — без кнопки "Назад" */}
      <div className={styles.header}>
        <span className={styles.chatTitle}>{chatTitle}</span>
        
        {/* Индикатор статуса */}
        <span 
          className={`${styles.statusDot} ${styles[connectionStatus]}`}
          style={{
            backgroundColor: 
              connectionStatus === 'connected' ? '#4ade80' :
              connectionStatus === 'connecting' ? '#fbbf24' :
              connectionStatus === 'error' ? '#ef4444' : '#94a3b8'
          }}
          title={`Статус: ${connectionStatus}`}
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
            const senderName = isMyMessage ? 'Вы' : msg.sender?.full_name || 'Собеседник';

            return (
              <div 
                key={msg.id} 
                className={styles.messageWrapper}
                style={{
                  flexDirection: isMyMessage ? 'row-reverse' : 'row',
                }}
              >
                {/* Аватар только для чужих сообщений */}
                {!isMyMessage && (
                  <div className={styles.msgAvatar}>
                    {msg.sender?.full_name?.charAt(0).toUpperCase() || '?'}
                  </div>
                )}

                <div 
                  className={styles.messageBubble}
                  style={{
                    backgroundColor: isMyMessage ? '#3390ec' : '#fff',
                    color: isMyMessage ? '#fff' : '#000',
                    borderBottomRightRadius: isMyMessage ? 0 : 16,
                    borderBottomLeftRadius: isMyMessage ? 16 : 0,
                  }}
                >
                  {/* Имя отправителя (в групповых чатах можно всегда показывать) */}
                  <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 2 }}>
                    {senderName}
                  </div>
                  {msg.text}
                  <div className={styles.messageMeta}>
                    {time}
                    {isMyMessage && (
                      <span style={{ color: msg.read ? '#4ade80' : 'inherit' }}>
                        {msg.read ? '✓✓' : '✓'}
                      </span>
                    )}
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
          disabled={connectionStatus !== 'connected'}
          className={styles.input}
          style={{
            opacity: connectionStatus === 'connected' ? 1 : 0.6,
          }}
        />
        <button 
          onClick={handleSend} 
          disabled={connectionStatus !== 'connected' || !inputText.trim()}
          className={styles.sendBtn}
          style={{
            opacity: (connectionStatus === 'connected' && inputText.trim()) ? 1 : 0.5,
            cursor: (connectionStatus === 'connected' && inputText.trim()) ? 'pointer' : 'not-allowed',
          }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}