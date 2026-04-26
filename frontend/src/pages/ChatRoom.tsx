import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import type { Message, MessageCreatePayload, MessageState } from '../types/messages';
import type { Chat, Attachment } from '../types';
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
  
  // 🔥 НОВОЕ: Список пользователей, которые печатают в этом чате
  const [typingUsers, setTypingUsers] = useState<Set<number>>(new Set());

  // Отправка сообщений и файлов
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false); // 🔥 Для drag-and-drop

  // Черновик для файлов
  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
  const [pendingClientMsgId, setPendingClientMsgId] = useState<string | null>(null);
  
  const { 
    subscribeToChat, 
    sendMessage, 
    sendTypingStatus,
    markMessagesRead,           
    subscribeToMessagesRead,    
    connectionStatus, 
    isUserOnline, 
    subscribeToUserStatus, 
    subscribeToTyping,
    uploadFile,
    sendAttachmentMessage,
  } = useChatSocket();
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMountedRef = useRef(true);
  const chatIdRef = useRef<number | null>(null);
  const currentUserIdRef = useRef<number | null>(null);
  
  // 🔥 Рефы для debounce-логики отправки статуса "печатает"
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentlyTypingRef = useRef(false);
  
  // 🔥 Реф для отслеживания, отправляли ли уже markMessagesRead для текущей сессии чата
  const hasMarkedReadRef = useRef(false);

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
      currentUserIdRef.current = userId;
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

  // Сброс флага hasMarkedRead при смене чата
  useEffect(() => {
    hasMarkedReadRef.current = false;
  }, [chatId]);

  const interlocutor = chatInfo?.type === 'personal'
    ? chatInfo.participants.find(p => p.id !== currentUserId)
    : null;

  const isInterlocutorOnline = interlocutor 
    ? isUserOnline(interlocutor.id)  // 🔥 Прямой вызов — всегда актуально!
    : false;

  // 🔥 НОВОЕ: Подписка на события "печатает" для текущего чата
  useEffect(() => {
    if (!chatId) return;
    
    const numericChatId = Number(chatId);
    
    const unsubscribe = subscribeToTyping(numericChatId, (typingUserIds) => {
      setTypingUsers(new Set(
        Array.from(typingUserIds).filter(id => id !== currentUserId)
      ));
    });
    
    return () => unsubscribe();
  }, [chatId, currentUserId, subscribeToTyping]);

  // 🔥 НОВОЕ: Подписка на события "прочитано" — обновляем галочки у своих сообщений
  useEffect(() => {
    if (!chatId || !currentUserId) return;
    
    const numericChatId = Number(chatId);
    
    const unsubscribe = subscribeToMessagesRead(numericChatId, ({ reader_id, last_read_at }) => {
      // Если прочитал НЕ я → обновляем статус read у моих сообщений
      if (reader_id !== currentUserId) {
        setMessages(prev => prev.map(msg => {
          // Обновляем только мои непрочитанные сообщения, отправленные до момента прочтения
          if (msg.sender_id === currentUserId && !msg.read && msg.timestamp <= last_read_at) {
            return { ...msg, read: true };
          }
          return msg;
        }));
      }
    });
    
    return () => unsubscribe();
  }, [chatId, currentUserId, subscribeToMessagesRead]);

  // Подписка на сообщения чата
  useEffect(() => {
    if (!chatId || currentUserId === null) return;
    
    const numericChatId = Number(chatId);
    chatIdRef.current = numericChatId;

    const unsubscribe = subscribeToChat(numericChatId, (serverMessage) => {
      if (!isMountedRef.current) return;
      
      log('info', '📩 Received new_message', { 
        id: serverMessage.id, 
        client_msg_id: serverMessage.client_msg_id,
        hasAttachments: !!serverMessage.attachments,
        attachmentsCount: serverMessage.attachments?.length
      });
      
      setMessages((prev) => {
        // 1. Заменяем оптимистичное сообщение на реальное (по client_msg_id)
        const optimisticByIdx = prev.findIndex(m => 
          m.isOptimistic && 
          m.client_msg_id && 
          serverMessage.client_msg_id &&
          m.client_msg_id === serverMessage.client_msg_id
        );

        if (optimisticByIdx !== -1) {
          const newMessages = [...prev];
          // 🔥 FIX: сохраняем attachments из оптимистичного, если сервер не прислал
          newMessages[optimisticByIdx] = { 
            ...serverMessage, 
            isOptimistic: false,
            attachments: serverMessage.attachments?.length > 0 
              ? serverMessage.attachments 
              : prev[optimisticByIdx].attachments
          };
          return newMessages;
        }

        // 🔥 1.5. Фолбэк: поиск по вложениям (для файлов, если client_msg_id не совпал)
        if (serverMessage.attachments?.length > 0) {
          const optimisticByAttachment = prev.findIndex(m => 
            m.isOptimistic &&
            m.sender_id === serverMessage.sender_id &&
            m.attachments?.[0]?.file_key === serverMessage.attachments[0]?.file_key &&
            Math.abs(new Date(m.timestamp).getTime() - new Date(serverMessage.timestamp).getTime()) < 5000
          );
          
          if (optimisticByAttachment !== -1) {
            const newMessages = [...prev];
            // 🔥 FIX: сохраняем attachments из оптимистичного
            newMessages[optimisticByAttachment] = { 
              ...serverMessage, 
              isOptimistic: false,
              attachments: serverMessage.attachments?.length > 0 
                ? serverMessage.attachments 
                : prev[optimisticByAttachment].attachments
            };
            return newMessages;
          }
        }

        // 2. Фолбэк: поиск по контенту + времени (для текстовых сообщений)
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

        // 3. Защита от дублей по ID
        if (prev.some(m => m.id === serverMessage.id)) {
          return prev;
        }

        // 4. 🔥 НОВОЕ: Если пришло сообщение ОТ ДРУГОГО пользователя и чат открыт — сразу маркируем как прочитанное
        if (serverMessage.sender_id !== currentUserId && document.visibilityState === 'visible') {
          // Откладываем на 100мс, чтобы не спамить при пакетной отправке
          setTimeout(() => {
            if (chatIdRef.current && connectionStatus === 'open') {
              markMessagesRead(chatIdRef.current);
            }
          }, 100);
        }

        return [...prev, { ...serverMessage, isOptimistic: false }];
      });
    });

    return () => unsubscribe();
  }, [chatId, currentUserId, subscribeToChat, markMessagesRead, connectionStatus]);

  // 🔥 НОВОЕ: Отправляем markMessagesRead при первом рендере чата (если он видим)
  useEffect(() => {
    if (!chatId || !currentUserId || !chatInfo || hasMarkedReadRef.current) return;
    if (document.visibilityState !== 'visible') return;
    
    // Небольшая задержка, чтобы сокет точно успел подключиться
    const timer = setTimeout(() => {
      if (isMountedRef.current && connectionStatus === 'open') {
        markMessagesRead(Number(chatId));
        hasMarkedReadRef.current = true;
        log('info', `📖 Marked messages as read for chat ${chatId}`);
      }
    }, 200);
    
    return () => clearTimeout(timer);
  }, [chatId, currentUserId, chatInfo, markMessagesRead, connectionStatus]);

  // 🔥 НОВОЕ: Отправляем markMessagesRead при возврате вкладки в фокус
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && chatId && connectionStatus === 'open') {
        markMessagesRead(Number(chatId));
        hasMarkedReadRef.current = true;
        log('info', `📖 Marked read on visibility change for chat ${chatId}`);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [chatId, markMessagesRead, connectionStatus]);

  // 🔥 НОВОЕ: Логика отправки статуса "печатает" с дебаунсом
  const handleTyping = useCallback(() => {
    if (!chatIdRef.current || !currentUserId) return;
    
    const numericChatId = chatIdRef.current;
    
    if (!inputText.trim()) {
      if (isCurrentlyTypingRef.current) {
        sendTypingStatus(numericChatId, false);
        isCurrentlyTypingRef.current = false;
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      return;
    }
    
    if (!isCurrentlyTypingRef.current) {
      sendTypingStatus(numericChatId, true);
      isCurrentlyTypingRef.current = true;
    }
    
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      if (isCurrentlyTypingRef.current) {
        sendTypingStatus(numericChatId, false);
        isCurrentlyTypingRef.current = false;
      }
      typingTimeoutRef.current = null;
    }, 2000);
    
  }, [inputText, currentUserId, sendTypingStatus]);

  // 🔥 Обработка выбора файла через скрепку
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !chatId) return;

    setUploadingFile(file);
    const attachment = await uploadFile(Number(chatId), file);
    
    if (!attachment) {
      setUploadingFile(null);
      alert('Не удалось загрузить файл');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    // 🔥 FIX: НЕ отправляем сразу, а сохраняем в черновик
    setPendingAttachment(attachment);
    setPendingClientMsgId(`client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
    
    setUploadingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    
    // 🔥 Фокус на поле ввода, чтобы пользователь сразу мог добавить текст
    const input = document.querySelector(`.${styles.input}`) as HTMLInputElement;
    input?.focus();
  };

  // 🔥 Обработчики Drag & Drop (как в Телеграме) — 🔥 ИСПРАВЛЕНО
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  }, [isDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Проверяем, что курсор ушёл за пределы контейнера
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setIsDragging(false);
    }
  }, []);

  // 🔥 FIX: handleDrop теперь использует pendingAttachment, как handleFileSelect
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (!file || !chatId) return;
    
    setUploadingFile(file);
    const attachment = await uploadFile(Number(chatId), file);
    
    if (!attachment) {
      setUploadingFile(null);
      alert('Не удалось загрузить файл');
      return;
    }

    // 🔥 FIX: Сохраняем в черновик, НЕ отправляем сразу
    setPendingAttachment(attachment);
    setPendingClientMsgId(`client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
    
    setUploadingFile(null);
    
    // 🔥 Фокус на поле ввода
    const input = document.querySelector(`.${styles.input}`) as HTMLInputElement;
    input?.focus();
  }, [chatId, uploadFile]);

  useEffect(() => {
    handleTyping();
  }, [inputText, handleTyping]);

  // Авто-скролл
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  // Очистка таймеров при размонтировании
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        if (chatIdRef.current && isCurrentlyTypingRef.current) {
          sendTypingStatus(chatIdRef.current, false);
        }
      }
    };
  }, [sendTypingStatus]);
  
  // 🔥 FIX: Отправка сообщения — теперь можно отправить файл без текста
  const handleSend = useCallback(() => {
    if (!chatIdRef.current || !currentUserId) return;
    
    const numericChatId = chatIdRef.current;
    const client_msg_id = pendingClientMsgId || `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    
    // 🔥 Если есть черновик с вложением — отправляем его + текст (текст может быть пустым)
    if (pendingAttachment) {
      const optimisticMsg: MessageState = {
        id: -Date.now(),
        chat_id: numericChatId,
        sender_id: currentUserId,
        text: inputText,  // Может быть пустым
        timestamp: new Date().toISOString(),
        read: true,
        client_msg_id,
        isOptimistic: true,
        attachments: [{ ...pendingAttachment, id: -1, message_id: -1 }]
      };
      setMessages(prev => [...prev, optimisticMsg]);
      
      // Отправка через сокет
      const sent = sendAttachmentMessage(numericChatId, inputText, pendingAttachment, client_msg_id);
      if (!sent) {
        setMessages(prev => prev.filter(m => m.client_msg_id !== client_msg_id));
        alert('Отправка не удалась');
      }
      
      // 🔥 Сброс черновика
      setPendingAttachment(null);
      setPendingClientMsgId(null);
      setInputText('');
      return;
    }
    
    // 🔥 Обычная отправка текста (если нет вложения)
    if (!inputText.trim()) return;
    
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
    
    const sent = sendMessage(numericChatId, inputText, client_msg_id);
    if (!sent) {
      log('error', 'Failed to send message via WebSocket');
      setMessages(prev => prev.filter(m => m.client_msg_id !== client_msg_id));
    }
    
    setInputText('');
  }, [inputText, currentUserId, sendMessage, sendAttachmentMessage, pendingAttachment, pendingClientMsgId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 🔥 useMemo для текста "печатает"
  const typingText = React.useMemo(() => {
    if (typingUsers.size === 0 || !chatInfo) return '';
    
    if (chatInfo.type === 'personal') {
      return 'Печатает';
    } else {
      const names = Array.from(typingUsers)
        .map(uid => chatInfo.participants.find(p => p.id === uid)?.full_name || 'Участник')
        .slice(0, 2);
      
      if (names.length === 1) {
        return `${names[0]} печатает`;
      } else {
        return `${names.join(', ')} печатают`;
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
    <div 
      className={styles.container}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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
                  
                  {/* 🔥 Отображение вложений */}
                  {msg.attachments?.map(att => {
                    const getFileUrl = (key: string) => `http://localhost:8000/api/v1/files/${key}`;
                    const formatSize = (b: number) => 
                      b < 1024 ? `${b} B` : b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;
                    
                    if (att.file_type === 'image') {
                      return (
                        <div key={att.id} className={styles.imageAttachment}>
                          <img 
                            src={getFileUrl(att.thumbnail_key || att.file_key)} 
                            alt={att.filename}
                            className={styles.previewImg}
                            onClick={() => window.open(getFileUrl(att.file_key), '_blank')}
                          />
                          <span className={styles.fileName}>{att.filename}</span>
                        </div>
                      );
                    }
                    
                    return (
                      <a 
                        key={att.id}
                        href={getFileUrl(att.file_key)} 
                        target="_blank" 
                        rel="noopener" 
                        className={styles.fileAttachment}
                      >
                        <span className={styles.fileIcon}>
                          {att.file_type === 'document' ? '📄' : att.file_type === 'audio' ? '🎵' : '📎'}
                        </span>
                        <div className={styles.fileMeta}>
                          <span className={styles.fileName}>{att.filename}</span>
                          <span className={styles.fileSize}>{formatSize(att.file_size)}</span>
                        </div>
                      </a>
                    );
                  })}
                  
                  <div className={styles.messageMeta}>
                    {time}
                    {isMyMessage && !msg.isOptimistic && (
                      <span 
                        className={styles.readStatus}
                        style={{ color: msg.read ? '#4ade80' : 'inherit' }}
                        title={msg.read ? 'Прочитано' : 'Доставлено'}
                      >
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

      {/* 🔥 Оверлей при перетаскивании файла (как в ТГ) */}
      {isDragging && (
        <div className={styles.dragOverlay}>
          <div className={styles.dragOverlayContent}>
            <span className={styles.dragIcon}>📎</span>
            <span className={styles.dragText}>Отпустите файл для отправки</span>
          </div>
        </div>
      )}

      {/* 🔥 Индикатор прикреплённого файла (перед полем ввода) */}
      {pendingAttachment && (
        <div className={styles.pendingAttachment}>
          <div className={styles.pendingAttachmentPreview}>
            {pendingAttachment.file_type === 'image' ? (
              <img 
                src={`http://localhost:8000/api/v1/files/${pendingAttachment.thumbnail_key || pendingAttachment.file_key}`} 
                alt={pendingAttachment.filename}
                className={styles.pendingImg}
              />
            ) : (
              <span className={styles.pendingFileIcon}>📎</span>
            )}
            <span className={styles.pendingFileName}>
              {pendingAttachment.filename}
            </span>
            <button 
              onClick={() => {
                setPendingAttachment(null);
                setPendingClientMsgId(null);
              }}
              className={styles.pendingRemoveBtn}
              title="Удалить вложение"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Поле ввода — новая структура со скрепкой внутри */}
      <div className={styles.inputArea}>
        {/* 🔥 Скрепка ВНУТРИ, слева от поля */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingFile !== null || connectionStatus !== 'open'}
          className={styles.attachBtn}
          title="Прикрепить файл"
        >
          {uploadingFile ? '⏳' : '📎'}
        </button>
        
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Написать сообщение..."
          disabled={connectionStatus !== 'open' || uploadingFile !== null}
          className={styles.input}
          style={{
            opacity: connectionStatus === 'open' && !uploadingFile ? 1 : 0.6,
          }}
        />
        
        {/* 🔥 FIX: Кнопка активна, если есть текст ИЛИ прикреплён файл */}
        <button 
          onClick={handleSend} 
          disabled={
            connectionStatus !== 'open' || 
            uploadingFile !== null || 
            (!inputText.trim() && !pendingAttachment)  // 🔥 Разрешаем отправку файла без текста
          }
          className={styles.sendBtn}
          style={{
            opacity: (connectionStatus === 'open' && !uploadingFile && (inputText.trim() || pendingAttachment)) ? 1 : 0.5,
            cursor: (connectionStatus === 'open' && !uploadingFile && (inputText.trim() || pendingAttachment)) ? 'pointer' : 'not-allowed',
          }}
        >
          ➤
        </button>
      </div>

      {/* Скрытый input для файла */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        className={styles.hiddenFileInput}
        accept="image/*,application/pdf,.doc,.docx,.txt,.mp3,.mp4,.webm"
      />
    </div>
  );
}