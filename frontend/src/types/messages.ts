import type { UserRead } from './index'

// То, что приходит от сервера (WebSocket + REST)
export interface Message {
  id: number;
  chat_id: number;
  sender_id: number;
  text: string;
  timestamp: string;
  read: boolean;
  client_msg_id?: string; // 🔥 Добавили для идемпотентности
  sender?: UserRead;
}

// 🔥 То, что мы отправляем через WebSocket (на бэк)
export interface MessageCreatePayload {
  type: 'message';
  chat_id: number; // 🔥 Бэк ожидает chat_id!
  text: string;
  client_msg_id?: string;
}

// 🔥 Внутренний тип для локального стейта (объединяет оптимистичные + реальные)
export type MessageState = Message & {
  isOptimistic?: boolean; // 🔥 Флаг для визуализации "отправки"
};