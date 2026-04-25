import { useEffect, useState, useMemo, useCallback } from 'react';
import { apiClient } from '../api/client';
import { chatAPI } from '../api/chat';
import type { UserRead, ChatCreatePayload, Chat } from '../types';
import styles from '../pages/ChatList.module.css'; // 🔥 Переиспользуем стили

type CreateChatModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (newChat: Chat) => void;
  currentUserId: number | null;
  initialMode?: 'personal' | 'group';
};

export function CreateChatModal({ 
  isOpen, 
  onClose, 
  onCreate, 
  currentUserId,
  initialMode = 'personal'
}: CreateChatModalProps) {
  // 🔥 Внутренний стейт модалки
  const [modalMode, setModalMode] = useState<'personal' | 'group' | null>(initialMode);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserRead[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserRead[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [createError, setCreateError] = useState('');

  // 🔥 Сброс состояния при закрытии/открытии
  useEffect(() => {
    if (!isOpen) {
      setModalMode(initialMode);
      setSearchQuery('');
      setSearchResults([]);
      setSelectedUsers([]);
      setGroupName('');
      setCreateError('');
    }
  }, [isOpen, initialMode]);

  // 🔥 Поиск пользователей с дебаунсом
  useEffect(() => {
    if (!isOpen || modalMode === null) return;
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await apiClient.get<UserRead[]>('/user/search', {
          params: { user_name: searchQuery }
        });
        const filtered = response.data.filter(
          u => u.id !== currentUserId && !selectedUsers.some(s => s.id === u.id)
        );
        setSearchResults(filtered);
      } catch (err) {
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, isOpen, modalMode, currentUserId, selectedUsers]);

  // 🔥 Хендлеры
  const toggleUser = useCallback((user: UserRead) => {
    setSelectedUsers(prev => 
      prev.some(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
  }, []);

  const validateCreatePayload = useCallback((): string | null => {
    if (modalMode === 'personal' && selectedUsers.length !== 1) {
      return 'Выберите ровно одного собеседника';
    }
    if (modalMode === 'group') {
      if (selectedUsers.length < 2) {
        return 'В группе должно быть минимум 2 участника (кроме вас)';
      }
      if (!groupName.trim()) {
        return 'Введите название группы';
      }
    }
    return null;
  }, [modalMode, selectedUsers, groupName]);

  const handleCreateChat = useCallback(async () => {
    const error = validateCreatePayload();
    if (error) {
      setCreateError(error);
      return;
    }
    setCreateError('');

    try {
      const payload: ChatCreatePayload = {
        type: modalMode!,
        name: modalMode === 'group' ? groupName.trim() : undefined,
        participant_ids: selectedUsers.map(u => u.id),
      };

      const newChat = await chatAPI.createChat(payload);
      onCreate(newChat); // 🔥 Сообщаем родителю об успехе
      onClose(); // 🔥 Закрываем модалку
    } catch (err: any) {
      console.error('Create chat failed:', err);
      setCreateError(err.response?.data?.detail || 'Не удалось создать чат');
    }
  }, [modalMode, selectedUsers, groupName, validateCreatePayload, onCreate, onClose]);

  // 🔥 Фильтрация результатов поиска
  const availableUsers = useMemo(() => 
    searchResults.filter(u => !selectedUsers.some(s => s.id === u.id)),
    [searchResults, selectedUsers]
  );

  // 🔥 Если модалка закрыта — не рендерим ничего (экономия ресурсов)
  if (!isOpen) return null;

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
        {/* Шапка */}
        <div className={styles.modalHeader}>
          <h3>{modalMode === 'personal' ? 'Новый чат' : 'Новая группа'}</h3>
          <button className={styles.modalClose} onClick={onClose}>×</button>
        </div>

        {/* Переключатель режима */}
        <div className={styles.modeToggle}>
          <button
            className={`${styles.toggleBtn} ${modalMode === 'personal' ? styles.toggleBtnActive : ''}`}
            onClick={() => { setModalMode('personal'); setSelectedUsers([]); setGroupName(''); }}
          >
            💬 Личный
          </button>
          <button
            className={`${styles.toggleBtn} ${modalMode === 'group' ? styles.toggleBtnActive : ''}`}
            onClick={() => { setModalMode('group'); setSelectedUsers([]); setGroupName(''); }}
          >
            👥 Группа
          </button>
        </div>

        {/* Название группы */}
        {modalMode === 'group' && (
          <input
            type="text"
            placeholder="Название группы"
            value={groupName}
            onChange={e => setGroupName(e.target.value)}
            className={styles.groupNameInput}
          />
        )}

        {/* Поиск */}
        <div className={styles.modalSearch}>
          <input
            type="text"
            placeholder={modalMode === 'personal' ? 'Поиск собеседника...' : 'Поиск участников...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className={styles.modalSearchInput}
            autoFocus
          />
          {isSearching && <span className={styles.searching}>🔍</span>}
        </div>

        {/* Результаты */}
        <div className={styles.searchResults}>
          {availableUsers.map(user => (
            <div 
              key={user.id} 
              className={styles.searchResultItem}
              onClick={() => toggleUser(user)}
            >
              <span className={styles.userAvatar}>
                {user.full_name.charAt(0).toUpperCase()}
              </span>
              <span>{user.full_name}</span>
            </div>
          ))}
          {searchQuery.length >= 2 && availableUsers.length === 0 && !isSearching && (
            <div className={styles.noResults}>Ничего не найдено</div>
          )}
          {searchQuery.length < 2 && (
            <div className={styles.noResults}>Введите минимум 2 символа для поиска</div>
          )}
        </div>

        {/* Выбранные */}
        {selectedUsers.length > 0 && (
          <div className={styles.selectedUsers}>
            <strong>Выбрано:</strong>
            {selectedUsers.map(user => (
              <span key={user.id} className={styles.selectedChip}>
                {user.full_name}
                <button onClick={(e) => { e.stopPropagation(); toggleUser(user); }}>×</button>
              </span>
            ))}
          </div>
        )}

        {/* Ошибка */}
        {createError && <p className={styles.modalError}>{createError}</p>}

        {/* Кнопки */}
        <div className={styles.modalActions}>
          <button onClick={onClose} className={styles.btnSecondary}>Отмена</button>
          <button 
            onClick={handleCreateChat} 
            className={styles.btnPrimary}
            disabled={
              selectedUsers.length === 0 || 
              (modalMode === 'group' && !groupName.trim()) ||
              (modalMode === 'personal' && selectedUsers.length !== 1)
            }
          >
            Создать
          </button>
        </div>
      </div>
    </div>
  );
}