import type { Chat, Attachment } from '../types';

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
};

/**
 * Форматирует превью для вложений (без иконок, только текст)
 */
function formatAttachmentsPreview(attachments: Attachment[]): string {
  if (attachments.length === 0) return '';
  
  const first = attachments[0];
  const count = attachments.length;
  
  // Текстовые лейблы по типу файла (без иконок)
  const labels: Record<string, string> = {
    image: count === 1 ? 'Фото' : `Фото (${count})`,
    document: count === 1 ? 'Документ' : `Документы (${count})`,
    audio: count === 1 ? 'Аудио' : `Аудио (${count})`,
    video: count === 1 ? 'Видео' : `Видео (${count})`,
    other: count === 1 ? 'Файл' : `Файлы (${count})`,
  };
  
  // Если все вложения одного типа — показываем общий лейбл
  const allSameType = attachments.every(att => att.file_type === first.file_type);
  if (allSameType) {
    return labels[first.file_type] || 'Файл';
  }
  
  // Если разные типы — показываем общее количество
  return `${count} вложений`;
}

/**
 * Возвращает текст превью последнего сообщения в чате
 * - Учитывает вложения (если нет текста)
 * - Добавляет "Вы:" для своих сообщений
 * - Добавляет имя отправителя в групповых чатах
 */
export function getChatPreviewText(
  chat: Chat,
  currentUserId: number | null,
): string {
  const lastMsg = chat.last_message;
  
  // Если нет последнего сообщения — дефолтный текст
  if (!lastMsg) {
    return 'Нажмите, чтобы открыть чат';
  }

  // 🔥 Определяем базовый текст сообщения
  let messageText = '';
  
  // Если есть текст — используем его
  if (lastMsg.text && lastMsg.text.trim()) {
    messageText = lastMsg.text;
  } 
  // Если только вложения — форматируем их
  else if (lastMsg.attachments?.length) {
    messageText = formatAttachmentsPreview(lastMsg.attachments);
  } 
  // Пустое сообщение без контента
  else {
    messageText = '…';
  }

  // 🔥 Добавляем префикс отправителя
  const isMyMessage = lastMsg.sender_id === currentUserId;
  
  // В групповых чатах: показываем имя отправителя (если не я)
  if (chat.type === 'group' && !isMyMessage) {
    const senderName = lastMsg.sender?.full_name || 'Участник';
    return `${senderName}: ${messageText}`;
  }
  
  // Для всех: добавляем "Вы:" если это моё сообщение
  if (isMyMessage) {
    return `Вы: ${messageText}`;
  }
  
  // Обычное сообщение от другого в личном чате
  return messageText;
}

// 🔥 Экспорт для удобства (если нужно использовать отдельно)
export { formatAttachmentsPreview };