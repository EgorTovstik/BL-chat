// src/context/ChatSocketContext.tsx
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';

type ChatSocketContextType = {
  subscribeToChat: (chatId: number, callback: (msg: any) => void) => () => void;
};

const ChatSocketContext = createContext<ChatSocketContextType | null>(null);

export function ChatSocketProvider({ children, token, currentUserId }: { 
  children: ReactNode;
  token: string | null;
  currentUserId: number | null;
}) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const subscribers = new Map<number, Set<(msg: any) => void>>();

  // Подключение к сокету (ленивое, по требованию)
  const connect = (chatId: number) => {
    if (ws?.readyState === WebSocket.OPEN) return ws;
    
    const newWs = new WebSocket(`ws://localhost:8000/api/v1/ws/${chatId}?token=${token}`);
    
    newWs.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'message') {
          // Уведомляем всех подписчиков этого чата
          subscribers.get(data.chat_id)?.forEach(cb => cb(data));
          // И глобально для списка чатов
          window.dispatchEvent(new CustomEvent('chat-message-received', {
            detail: { chatId: data.chat_id, lastMessage: data }
          }));
        }
      } catch (e) { console.error('WS parse error', e); }
    };
    
    setWs(newWs);
    return newWs;
  };

  // Подписка на сообщения чата
  const subscribeToChat = (chatId: number, callback: (msg: any) => void) => {
    if (!subscribers.has(chatId)) subscribers.set(chatId, new Set());
    subscribers.get(chatId)!.add(callback);
    
    // Авто-подключение при первой подписке
    if (token && currentUserId) connect(chatId);
    
    // Функция отписки
    return () => {
      subscribers.get(chatId)?.delete(callback);
      if (subscribers.get(chatId)?.size === 0) {
        subscribers.delete(chatId);
        // Опционально: закрыть сокет, если больше нет подписчиков
      }
    };
  };

  return (
    <ChatSocketContext.Provider value={{ subscribeToChat }}>
      {children}
    </ChatSocketContext.Provider>
  );
}

export const useChatSocket = () => {
  const ctx = useContext(ChatSocketContext);
  if (!ctx) throw new Error('useChatSocket must be used within ChatSocketProvider');
  return ctx;
};