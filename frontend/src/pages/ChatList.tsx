// src/pages/ChatList.tsx
import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { chatAPI } from '../api/chat';
import { authAPI } from '../api/auth';
import { apiClient } from '../api/client'; // 🔥 Для поиска пользователей
import { getChatTitle } from "../utils/chat";
import type { Chat, UserRead, ChatCreatePayload } from '../types';
import styles from './ChatList.module.css';

export function ChatList() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { id: activeChatId } = useParams<{ id: string }>();

  // 🔥 Состояния для модального окна создания чата
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'personal' | 'group' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserRead[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<UserRead[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [user, chatsData] = await Promise.all([
          authAPI.getCurrentUser(),
          chatAPI.getChats()
        ]);
        
        setCurrentUserId(user.id);
        setChats(chatsData);
      } catch (err: any) {
        console.error('Failed to load data:', err);
        const detail = err.response?.data?.detail || 'Ошибка загрузки';
        setError(Array.isArray(detail) ? detail[0] : detail);
        
        if (err.response?.status === 401) {
          localStorage.removeItem('token');
          navigate('/login');
        }
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [navigate]);

  // 🔥 Поиск пользователей с дебаунсом (300мс)
  useEffect(() => {
    if (!isModalOpen || modalMode === null) return;
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        // 🔥 Запрос к эндпоинту /user/search
        const response = await apiClient.get<UserRead[]>('/user/search', {
          params: { user_name: searchQuery }
        });
        // Исключаем себя и уже выбранных пользователей
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
  }, [searchQuery, isModalOpen, modalMode, currentUserId, selectedUsers]);

  // 🔥 Хендлеры модального окна
  const openCreateModal = (mode: 'personal' | 'group') => {
    setModalMode(mode);
    setIsModalOpen(true);
    setSearchQuery('');
    setSearchResults([]);
    setSelectedUsers([]);
    setGroupName('');
    setCreateError('');
  };

  const closeCreateModal = () => {
    setIsModalOpen(false);
    setModalMode(null);
  };

  const toggleUser = (user: UserRead) => {
    setSelectedUsers(prev => 
      prev.some(u => u.id === user.id)
        ? prev.filter(u => u.id !== user.id)
        : [...prev, user]
    );
  };

  // 🔥 Валидация перед созданием
  const validateCreatePayload = (): string | null => {
    if (modalMode === 'personal') {
      if (selectedUsers.length !== 1) {
        return 'Выберите ровно одного собеседника';
      }
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
  };

  // 🔥 Создание чата/группы
  const handleCreateChat = async () => {
    const error = validateCreatePayload();
    if (error) {
      setCreateError(error);
      return;
    }
    setCreateError('');

    try {
      // 🔥 ВАЖНО: передаём ТОЛЬКО других пользователей!
      // Бэк сам добавит currentUserId
      const payload: ChatCreatePayload = {
        type: modalMode!,
        name: modalMode === 'group' ? groupName.trim() : undefined,
        participant_ids: selectedUsers.map(u => u.id),
      };

      const newChat = await chatAPI.createChat(payload);
      
      closeCreateModal();
      // Обновляем список и переходим в новый чат
      setChats(prev => [newChat, ...prev]);
      navigate(`/chats/chat/${newChat.id}`);
      
    } catch (err: any) {
      console.error('Create chat failed:', err);
      setCreateError(err.response?.data?.detail || 'Не удалось создать чат');
    }
  };

  // 🔥 Фильтрация: скрываем уже выбранных из результатов поиска
  const availableUsers = useMemo(() => 
    searchResults.filter(u => !selectedUsers.some(s => s.id === u.id)),
    [searchResults, selectedUsers]
  );

  if (loading) return <div className={styles.center}>Загрузка...</div>;
  if (error) return (
    <div className={styles.center}>
      <p style={{ color: '#dc2626' }}>{error}</p>
    </div>
  );

  return (
    <div className={styles.container}>
      {/* Шапка с поиском и кнопкой создания */}
      <div className={styles.sidebarHeader}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            placeholder="Поиск"
            className={styles.searchInput}
          />
        </div>
      </div>

      {/* Список чатов */}
      <div className={styles.chatList}>
        {chats.length === 0 ? (
          <div className={styles.empty}>
            <p>Нет чатов</p>
          </div>
        ) : (
          chats.map(chat => {
            const interlocutor = chat.type === 'personal' 
              ? chat.participants.find(p => p.id !== currentUserId)
              : null;
            const displayName = getChatTitle(chat, currentUserId);
            
            // 🔥 Получаем последнее сообщение (если есть)
            const lastMsg = chat.last_message;
            
            // Формируем текст превью
            const lastMessageText = lastMsg 
              ? (lastMsg.sender_id === currentUserId ? 'Вы: ' : '') + lastMsg.text
              : "Нажмите, чтобы открыть чат";
            
            // Форматируем время (если есть сообщение)
            const lastMessageTime = lastMsg?.timestamp
              ? new Date(lastMsg.timestamp).toLocaleTimeString('ru-RU', { 
                  hour: '2-digit', 
                  minute: '2-digit' 
                })
              : '';
            
            return (
              <div
                key={chat.id}
                onClick={() => navigate(`/chats/chat/${chat.id}`)}
                // 🔥 Добавляем класс 'active', если ID совпадает
                className={`${styles.chatItem} ${chat.id == activeChatId ? styles.active : ''}`}
              >
                {/* Аватар */}
                <div className={styles.avatar}>
                  {displayName.charAt(0).toUpperCase()}
                </div>

                {/* Контент карточки */}
                <div className={styles.chatContent}>
                  <div className={styles.chatHeader}>
                    <span className={styles.chatTitle}>{displayName}</span>
                    {/* 🔥 Показываем время только если есть сообщение */}
                    {lastMessageTime && (
                      <span className={styles.chatTime}>{lastMessageTime}</span>
                    )}
                  </div>
                  <div className={styles.chatPreview}>
                    {/* 🔥 Текст последнего сообщения с обрезкой */}
                    <span className={styles.lastMessage} title={lastMessageText}>
                      {lastMessageText.length > 40 
                        ? lastMessageText.slice(0, 40) + '...' 
                        : lastMessageText}
                    </span>
                    {/* Здесь можно добавить бейдж непрочитанных, если бэк будет возвращать unread_count */}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 🔥 Кнопка создания чата (как в ТГ) */}
      <button 
        className={styles.createBtn}
        onClick={() => openCreateModal('personal')}
        title="Новый чат"
      >
        ✎
      </button>

            {/* 🔥 Модальное окно создания чата */}
      {isModalOpen && (
        <div className={styles.modalOverlay} onClick={closeCreateModal}>
          <div className={styles.modalContent} onClick={e => e.stopPropagation()}>
            {/* Шапка модалки */}
            <div className={styles.modalHeader}>
              <h3>{modalMode === 'personal' ? 'Новый чат' : 'Новая группа'}</h3>
              <button className={styles.modalClose} onClick={closeCreateModal}>×</button>
            </div>

            {/* 🔥 Переключатель режима: Личный / Группа */}
            <div className={styles.modeToggle}>
              <button
                className={`${styles.toggleBtn} ${modalMode === 'personal' ? styles.toggleBtnActive : ''}`}
                onClick={() => {
                  setModalMode('personal');
                  setSelectedUsers([]); // Очищаем выбор при смене режима
                  setGroupName('');
                }}
              >
                💬 Личный
              </button>
              <button
                className={`${styles.toggleBtn} ${modalMode === 'group' ? styles.toggleBtnActive : ''}`}
                onClick={() => {
                  setModalMode('group');
                  setSelectedUsers([]); // Очищаем выбор при смене режима
                  setGroupName('');
                }}
              >
                👥 Группа
              </button>
            </div>

            {/* Поле названия для группы */}
            {modalMode === 'group' && (
              <input
                type="text"
                placeholder="Название группы"
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                className={styles.groupNameInput}
              />
            )}

            {/* Поиск пользователей */}
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

            {/* Результаты поиска */}
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

            {/* Выбранные пользователи */}
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

            {/* Кнопки действий */}
            <div className={styles.modalActions}>
              <button onClick={closeCreateModal} className={styles.btnSecondary}>
                Отмена
              </button>
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
      )}
    </div>
  );
}