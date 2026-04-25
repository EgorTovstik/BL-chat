import React, { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback } from 'react';

type MessageData = {
  id: number;
  chat_id: number;
  sender_id: number;
  text: string;
  timestamp: string;
  read: boolean;
  client_msg_id?: string;
  [key: string]: any;
};

type ChatListUpdate = {
  type: 'chat_list_update';
  chat_id: number;
  last_message_text: string;
  last_message_at: string;
  sender_id: number;
  unread_increment?: number;
};

type UserStatusUpdate = {
  type: 'user_status_update';
  user_id: number;
  status: 'online' | 'offline';
};

type TypingUpdate = {
  type: 'typing_update';
  chat_id: number;
  user_id: number;
  is_typing: boolean;
};

type InitialOnlineList = {
  type: 'initial_online_list';
  user_ids: number[];
};

type MessagesReadUpdate = {
  type: 'messages_read';
  chat_id: number;
  reader_id: number;
  count: number;
  last_read_at: string;
};

type ChatSocketContextType = {
  subscribeToChat: (chatId: number, onMessage: (msg: MessageData) => void) => () => void;
  subscribeToChatList: (onUpdate: (update: ChatListUpdate) => void) => () => void;
  sendMessage: (chatId: number, text: string, client_msg_id?: string) => boolean;
  // 🔥 НОВОЕ: отправка статуса "печатает"
  sendTypingStatus: (chatId: number, isTyping: boolean) => boolean;
  connectionStatus: 'connecting' | 'open' | 'closed' | 'error';
  reconnect: () => void;
  // 🔥 Онлайн-статусы
  isUserOnline: (userId: number) => boolean;
  subscribeToUserStatus: (userId: number, onChange: (online: boolean) => void) => () => void;
  // 🔥 Статус "печатает"
  subscribeToTyping: (chatId: number, onChange: (userIds: Set<number>) => void) => () => void;
  subscribeToMessagesRead: (
    chatId: number, 
    onRead: (data: { reader_id: number; last_read_at: string }) => void
  ) => () => void;
  
  markMessagesRead: (chatId: number, upToMessageId?: number) => boolean;
};

const ChatSocketContext = createContext<ChatSocketContextType | null>(null);

export function ChatSocketProvider({ 
  children, 
  token, 
  currentUserId 
}: { 
  children: ReactNode;
  token: string | null;
  currentUserId: number | null;
}) {
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'open' | 'closed' | 'error'>('closed');
  
  // === Рефы ===
  const wsRef = useRef<WebSocket | null>(null);
  const tokenRef = useRef<string | null>(token);
  const userIdRef = useRef<number | null>(currentUserId);
  const isMountedRef = useRef(true);
  const isConnectingRef = useRef(false);
  
  // Хранилища колбэков
  const chatSubscribersRef = useRef<Map<number, Set<(msg: MessageData) => void>>>(new Map());
  const listSubscribersRef = useRef<Set<(update: ChatListUpdate) => void>>(new Set());
  const subscribedChatsRef = useRef<Set<number>>(new Set());
  
  // 🔥 Онлайн-статусы
  const onlineUsersRef = useRef<Set<number>>(new Set());
  const [onlineUsersVersion, setOnlineUsersVersion] = useState(0);

  // Статус "Печатает..."
  const typingUsersRef = useRef<Map<number, Set<number>>>(new Map());
  const [typingVersion, setTypingVersion] = useState(0);

  // 🔥 Хранилище подписчиков на события прочтения (по chat_id)
  const readSubscribersRef = useRef<Map<number, Set<(data: { reader_id: number; last_read_at: string }) => void>>>(new Map());

  // Синхронизация пропсов с рефами
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { userIdRef.current = currentUserId; }, [currentUserId]);

  // Cleanup при размонтировании
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      isConnectingRef.current = false;
      wsRef.current?.close(1000, 'Component unmounted');
    };
  }, []);

  // Логика подключения
  const connect = useCallback(() => {
    const currentToken = tokenRef.current;
    const currentUserId = userIdRef.current;
    
    if (!currentToken || !currentUserId || !isMountedRef.current) {
      setConnectionStatus('closed');
      return;
    }
    
    if (isConnectingRef.current) return;
    
    if (wsRef.current) {
      const rs = wsRef.current.readyState;
      if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'Reconnect');
      }
    }

    isConnectingRef.current = true;
    setConnectionStatus('connecting');
    
    const nonce = Date.now();
    const ws = new WebSocket(`ws://localhost:8000/api/v1/ws/?token=${currentToken}&_n=${nonce}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      isConnectingRef.current = false;
      setConnectionStatus('open');
      
      subscribedChatsRef.current.forEach(chatId => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'subscribe_chat', chat_id: chatId }));
        }
      });
    };

    ws.onmessage = (event) => {
      if (!isMountedRef.current) return;
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'new_message') {
          chatSubscribersRef.current.get(data.chat_id)?.forEach(cb => cb(data as MessageData));
        } 
        else if (data.type === 'chat_list_update') {
          listSubscribersRef.current.forEach(cb => cb(data as ChatListUpdate));
        }
        // 🔥 === НОВОЕ: Обработка начального списка онлайн ===
        else if (data.type === 'initial_online_list') {
          // Очищаем и заполняем заново, чтобы избежать рассинхрона
          onlineUsersRef.current = new Set<number>(data.user_ids);
          setOnlineUsersVersion(v => v + 1); // Триггерим ре-рендер подписчиков
        }
        // 🔥 === Существующая логика обновлений статуса ===
        else if (data.type === 'user_status_update') {
          const { user_id, status } = data as UserStatusUpdate;
          
          if (status === 'online') {
            onlineUsersRef.current.add(user_id);
          } else {
            onlineUsersRef.current.delete(user_id);
          }
          setOnlineUsersVersion(v => v + 1);
        }
        else if (data.type === 'messages_read') {
          const { chat_id, reader_id, last_read_at } = data as MessagesReadUpdate;
          
          // 🔥 Уведомляем ТОЛЬКО подписчиков на read-события для этого чата
          readSubscribersRef.current.get(chat_id)?.forEach(cb => {
            cb({ reader_id, last_read_at });
          });
        }
        else if (data.type === 'typing_update') {
          const { chat_id, user_id, is_typing } = data as TypingUpdate;
          
          const chatSet = typingUsersRef.current.get(chat_id) || new Set<number>();
          if (is_typing) {
            chatSet.add(user_id);
          } else {
            chatSet.delete(user_id);
          }
          
          if (chatSet.size > 0) {
            typingUsersRef.current.set(chat_id, chatSet);
          } else {
            typingUsersRef.current.delete(chat_id);
          }
          setTypingVersion(v => v + 1);
        }  
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    ws.onclose = (event) => {
      if (!isMountedRef.current) return;
      isConnectingRef.current = false;
      
      if (event.code === 1000) {
        setConnectionStatus('closed');
        return;
      }
      
      if (tokenRef.current && isMountedRef.current) {
        setTimeout(() => {
          if (isMountedRef.current && tokenRef.current && !isConnectingRef.current) {
            connect();
          }
        }, 3000);
      } else {
        setConnectionStatus('closed');
      }
    };

    ws.onerror = (error) => {
      if (!isMountedRef.current) return;
      console.error('WS error', error);
    };
  }, []);

  useEffect(() => {
    if (!token || !currentUserId) {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Auth changed');
      }
      setConnectionStatus('closed');
      return;
    }
    connect();
    return () => {
      if (!token || !currentUserId) {
        wsRef.current?.close(1000, 'Cleanup');
      }
    };
  }, [token, currentUserId]);

  // === Публичные методы ===
  
  const subscribeToChat = useCallback((chatId: number, onMessage: (msg: MessageData) => void) => {
    if (!chatSubscribersRef.current.has(chatId)) {
      chatSubscribersRef.current.set(chatId, new Set());
    }
    chatSubscribersRef.current.get(chatId)!.add(onMessage);

    if (!subscribedChatsRef.current.has(chatId) && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe_chat', chat_id: chatId }));
      subscribedChatsRef.current.add(chatId);
    }

    return () => {
      chatSubscribersRef.current.get(chatId)?.delete(onMessage);
      if (chatSubscribersRef.current.get(chatId)?.size === 0) {
        chatSubscribersRef.current.delete(chatId);
      }
    };
  }, []);

  const subscribeToChatList = useCallback((onUpdate: (update: ChatListUpdate) => void) => {
    listSubscribersRef.current.add(onUpdate);
    return () => {
      listSubscribersRef.current.delete(onUpdate);
    };
  }, []);

  const reconnect = useCallback(() => {
    wsRef.current?.close(1000, 'Manual reconnect');
    isConnectingRef.current = false;
    setTimeout(() => {
      if (isMountedRef.current) connect();
    }, 100);
  }, [connect]);

  // Отправка обычного сообщения
  const sendMessage = useCallback((chatId: number, text: string, client_msg_id?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send: WebSocket not open');
      return false;
    }
    
    const payload = {
      type: 'message',
      chat_id: chatId,
      text,
      client_msg_id: client_msg_id || `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    };
    
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('Failed to send message', e);
      return false;
    }
  }, []);

  // 🔥 НОВОЕ: Отправка статуса "печатает"
  const sendTypingStatus = useCallback((chatId: number, isTyping: boolean): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot send typing: WebSocket not open');
      return false;
    }
    
    const payload = {
      type: 'typing',  // 🔥 Правильный тип события!
      chat_id: chatId,
      is_typing: isTyping
    };
    
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('Failed to send typing status', e);
      return false;
    }
  }, []);

  // Онлайн-статусы
  const isUserOnline = useCallback((userId: number): boolean => {
    return onlineUsersRef.current.has(userId);
  }, []);

  const subscribeToUserStatus = useCallback((userId: number, onChange: (online: boolean) => void) => {
    // Мгновенный вызов с текущим статусом
    onChange(onlineUsersRef.current.has(userId));
    
    // Подписка на изменения версии (альтернатива поллингу)
    const checkStatus = () => onChange(onlineUsersRef.current.has(userId));
    
    // Можно использовать ref для хранения колбэка, если нужна точная подписка,
    // но для простоты достаточно полагаться на то, что компоненты сами 
    // переподпишутся при ре-рендере.
    return () => {}; 
  }, []);

  // Подписка на статус "печатает"
  const subscribeToTyping = useCallback((chatId: number, onChange: (userIds: Set<number>) => void) => {
    onChange(typingUsersRef.current.get(chatId) || new Set());
    const interval = setInterval(() => {
      onChange(typingUsersRef.current.get(chatId) || new Set());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const subscribeToMessagesRead = useCallback((
    chatId: number, 
    onRead: (data: { reader_id: number; last_read_at: string }) => void
  ) => {
    if (!readSubscribersRef.current.has(chatId)) {
      readSubscribersRef.current.set(chatId, new Set());
    }
    readSubscribersRef.current.get(chatId)!.add(onRead);

    return () => {
      readSubscribersRef.current.get(chatId)?.delete(onRead);
      if (readSubscribersRef.current.get(chatId)?.size === 0) {
        readSubscribersRef.current.delete(chatId);
      }
    };
  }, []);

  const markMessagesRead = useCallback((chatId: number, upToMessageId?: number): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('Cannot mark read: WebSocket not open');
      return false;
    }
    
    const payload: any = { type: 'read', chat_id: chatId };
    if (upToMessageId !== undefined) {
      payload.up_to_message_id = upToMessageId;
    }
    
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch (e) {
      console.error('Failed to send read status', e);
      return false;
    }
  }, []);

  const value = {
    subscribeToChat,
    subscribeToChatList,
    sendMessage,
    sendTypingStatus,
    connectionStatus,
    reconnect,
    isUserOnline,
    subscribeToUserStatus,
    subscribeToTyping,
    subscribeToMessagesRead, // 🔥 Добавьте эту строку
    markMessagesRead,
  };

  return (
    <ChatSocketContext.Provider value={value}>
      {children}
    </ChatSocketContext.Provider>
  );
}

export const useChatSocket = () => {
  const ctx = useContext(ChatSocketContext);
  if (!ctx) throw new Error('useChatSocket must be used within ChatSocketProvider');
  return ctx;
};