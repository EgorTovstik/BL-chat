import { apiClient } from "./client";
import type { Chat, Message, ChatCreatePayload } from "../types";

export const chatAPI = {
    // получить список чатов пользователя
    getChats: async (): Promise<Chat[]> => {
        const response = await apiClient.get<Chat[]>('/chat/');
        return response.data;
    },
    // получить информацию о текущем чате
    getChat: async (chat_id: number): Promise<Chat> => {
        const response = await apiClient.get<Chat>(`/chat/${chat_id}`);
        return response.data;
    },
    // получить сообщения чата
    getChatHistory: async (chat_id: number, limit: number = 50): Promise<Message[]> => {
        const response = await apiClient.get<Message[]>(`/chat/${chat_id}/messages`, {
            params: {limit}
        });
        return response.data;
    },
    // создать новый чат
    createChat: async (data: ChatCreatePayload): Promise<Chat> => {
        const response = await apiClient.post<Chat>('/chat/', data);
        return response.data;
    },
};