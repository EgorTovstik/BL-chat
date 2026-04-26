// src/api/chat.ts
import { apiClient } from "./client";
import type { Chat, Message, ChatCreatePayload } from "../types";

export const chatAPI = {
    // Получить список чатов пользователя
    getChats: async (): Promise<Chat[]> => {
        const response = await apiClient.get<Chat[]>('/chat/');
        return response.data;
    },

    // Поиск чатов пользователя
    searchChats: async (query: string, limit: number = 20): Promise<Chat[]> => {
        if (query.length < 2) {
            return [];
        }
        
        console.log('🔍 [API] Поиск запрос:', { query, limit });
        
        try {
            const response = await apiClient.get<Chat[]>('/chat/search', {
                params: {
                    chat_name: query.trim(),
                    limit: Math.min(Math.max(limit, 1), 50)
                }
            });
            
            console.log('✅ [API] Поиск ответ:', {
                status: response.status,
                count: response.data?.length,
                firstItem: response.data?.[0]  // Покажем первый элемент для проверки структуры
            });
            
            return response.data;
        } catch (err) {
            console.error('❌ [API] Поиск ошибка:', err);
            throw err;
        }
    },

    // Получить информацию о текущем чате
    getChat: async (chat_id: number): Promise<Chat> => {
        const response = await apiClient.get<Chat>(`/chat/${chat_id}`);
        return response.data;
    },

    // Получить сообщения чата
    getChatHistory: async (chat_id: number, limit: number = 50): Promise<Message[]> => {
        const response = await apiClient.get<Message[]>(`/chat/${chat_id}/messages`, {
            params: { limit }
        });
        return response.data;
    },

    // Создать новый чат
    createChat: async (data: ChatCreatePayload): Promise<Chat> => {
        const response = await apiClient.post<Chat>('/chat/', data);
        return response.data;
    },
};