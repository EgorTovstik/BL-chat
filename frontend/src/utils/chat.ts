import type {Chat} from '../types';

/**
 * Возвращает человеко-читаемое название чата:
 * - Для групп: имя чата или "Группа (N)"
 * - Для личных: имя собеседника
 */
export const getChatTitle = (chat: Chat, myId: number | null): string => {
    if (chat.name) return chat.name;

  if (chat.type === 'personal' && chat.participants.length > 0 && myId !== null) {
    const interlocutor = chat.participants.find(p => p.id !== myId);
    if (interlocutor) {
      return interlocutor.full_name;
    }
  }
  return 'Без названия';
}