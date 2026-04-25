import React, { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';

type AuthContextType = {
  token: string | null;
  currentUserId: number | null;
  login: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

// 🔥 Вспомогательная функция: декодируем userId из JWT
const parseUserIdFromToken = (token: string): number | null => {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(window.atob(base64));
    return payload.sub ? Number(payload.sub) : null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Инициализация: читаем токен из localStorage при старте
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      const userId = parseUserIdFromToken(storedToken);
      if (userId) {
        setToken(storedToken);
        setCurrentUserId(userId);
      } else {
        localStorage.removeItem('token'); // Невалидный токен
      }
    }
    setIsLoading(false);
  }, []);

  // 🔥 Слушаем изменения в localStorage (для синхронизации между вкладками)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'token') {
        const newToken = e.newValue;
        if (newToken) {
          const userId = parseUserIdFromToken(newToken);
          if (userId) {
            setToken(newToken);
            setCurrentUserId(userId);
          }
        } else {
          setToken(null);
          setCurrentUserId(null);
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const login = useCallback((newToken: string) => {
    const userId = parseUserIdFromToken(newToken);
    if (userId) {
      localStorage.setItem('token', newToken);
      setToken(newToken);
      setCurrentUserId(userId);
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    setToken(null);
    setCurrentUserId(null);
  }, []);

  const value = {
    token,
    currentUserId,
    login,
    logout,
    isLoading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};