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

type ChatSocketContextType = {
  subscribeToChat: (chatId: number, onMessage: (msg: MessageData) => void) => () => void;
  subscribeToChatList: (onUpdate: (update: ChatListUpdate) => void) => () => void;
  sendMessage: (chatId: number, text: string, client_msg_id?: string) => boolean;
  connectionStatus: 'connecting' | 'open' | 'closed' | 'error';
  reconnect: () => void;
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
  const isConnectingRef = useRef(false); // 🔥 Защита от параллельных подключений
  
  // Хранилища колбэков
  const chatSubscribersRef = useRef<Map<number, Set<(msg: MessageData) => void>>>(new Map());
  const listSubscribersRef = useRef<Set<(update: ChatListUpdate) => void>>(new Set());
  const subscribedChatsRef = useRef<Set<number>>(new Set());

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

  // === Логика подключения (СТАБИЛЬНАЯ) ===
  const connect = useCallback(() => {
    const currentToken = tokenRef.current;
    const currentUserId = userIdRef.current;
    
    // 🔥 Если токена нет — НЕ подключаемся вообще
    if (!currentToken || !currentUserId || !isMountedRef.current) {
      setConnectionStatus('closed');
      return;
    }
    
    if (isConnectingRef.current) return;
    
    // Закрываем старое соединение
    if (wsRef.current) {
      const rs = wsRef.current.readyState;
      if (rs === WebSocket.OPEN || rs === WebSocket.CONNECTING) {
        wsRef.current.close(1000, 'Reconnect');
      }
    }

    isConnectingRef.current = true;
    setConnectionStatus('connecting');
    
    // 🔥 Добавляем _nonce для обхода кэша браузера (опционально)
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
        } else if (data.type === 'chat_list_update') {
          listSubscribersRef.current.forEach(cb => cb(data as ChatListUpdate));
        }
      } catch (e) {
        console.error('WS parse error', e);
      }
    };

    ws.onclose = (event) => {
      if (!isMountedRef.current) return;
      isConnectingRef.current = false;
      
      // 🔥 Не ставим 'closed', если планируем реконнект (чтобы не моргал интерфейс)
      if (event.code === 1000) {
        setConnectionStatus('closed');
        return;
      }
      
      // 🔥 Реконнект только если токен всё ещё валиден
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
      // Не ставим 'error' навсегда — onclose обработает статус
    };
  }, []);

  // === Эффект подключения ===
  // 🔥 Зависимости ТОЛЬКО от token/currentUserId, НЕ от connect
  useEffect(() => {
    // Если токена нет — закрываем сокет и выходим
    if (!token || !currentUserId) {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Auth changed');
      }
      setConnectionStatus('closed');
      return;
    }
    
    // Если токен есть — подключаемся
    connect();
    
    // Cleanup при размонтировании ИЛИ при изменении token/currentUserId
    return () => {
      // Закрываем только если пропсы стали невалидными (чтобы не рвать соединение при обычных ререндерах)
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

  // 🔥 reconnect не зависит от connect
  const reconnect = useCallback(() => {
    wsRef.current?.close(1000, 'Manual reconnect');
    isConnectingRef.current = false;
    // Небольшая задержка, чтобы onclose успел отработать
    setTimeout(() => {
      if (isMountedRef.current) connect();
    }, 100);
  }, [connect]);

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

  const value = {
    subscribeToChat,
    subscribeToChatList,
    sendMessage,
    connectionStatus,
    reconnect,
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