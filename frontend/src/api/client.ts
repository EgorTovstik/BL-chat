import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

// 1️⃣ Базовый URL берём из .env (с фоллбэком на localhost)
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// 2️⃣ Создаём настроенный экземпляр axios
export const apiClient: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  // Таймаут запроса (опционально, но полезно)
  timeout: 10000, // 10 секунд
});

// 3️⃣ Интерцептор ЗАПРОСОВ — выполняется перед каждым запросом
apiClient.interceptors.request.use(
  (config: AxiosRequestConfig) => {
    // Достаём токен из localStorage
    const token = localStorage.getItem('token');
    
    // Если токен есть — добавляем в заголовок Authorization
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    // Если ошибка при настройке запроса
    return Promise.reject(error);
  }
);

// 4️⃣ Интерцептор ОТВЕТОВ — выполняется после каждого ответа сервера
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    // Если всё хорошо — просто возвращаем ответ
    return response;
  },
  (error) => {
    // Обрабатываем ошибки централизованно
    
    // 401 — неавторизован (токен протух или неверный)
    if (error.response?.status === 401) {
      console.warn('⚠️ 401 Unauthorized — удаляем токен и редиректим на логин');
      localStorage.removeItem('token');
      // Не делаем редирект сразу, чтобы не зациклить — пусть компонент сам обработает
      // window.location.href = '/login'; 
    }
    
    // 403 — нет прав доступа
    if (error.response?.status === 403) {
      console.warn('⚠️ 403 Forbidden — нет прав');
    }
    
    // 404 — не найдено
    if (error.response?.status === 404) {
      console.warn('⚠️ 404 Not Found');
    }
    
    // 500 — ошибка сервера
    if (error.response?.status >= 500) {
      console.error('💥 Server error:', error.response?.data);
    }
    
    // Пробрасываем ошибку дальше, чтобы компонент мог её обработать
    return Promise.reject(error);
  }
);