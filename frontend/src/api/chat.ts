import { apiClient } from "./client";
import type { Chat } from "../types";

export const chatAPI = {
    // получить список чатов пользователя
    getChats: async (): Promise<Chat[]> => {
        const response = await apiClient.get<Chat[]>('/chat/');
        return response.data;
    },

    getChat: async (chat_id: number): Promise<Chat> => {
        const response = await apiClient.get<Chat>(`/chat/${chat_id}`)
        return response.data;
    },
};