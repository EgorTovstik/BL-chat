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

export function getChatPreviewText(
  chat: Chat,
  currentUserId: number | null,
): string {
  let previewText = "Нажмите, чтобы открыть чат";
  const lastMsg = chat.last_message;
  if (lastMsg) {
    if (chat.type === 'group' && lastMsg.sender_id !== currentUserId) {
      const senderName = lastMsg.sender?.full_name || 'Участник';
      previewText = `${senderName}: ${lastMsg.text}`;
    } else {
      previewText = (lastMsg.sender_id === currentUserId ? 'Вы: ' : '') + lastMsg.text;
    }
  }

  return previewText;
}