import { apiClient } from "./client";
import type { Chat } from "../types";

export const chatAPI = {
    // получить список чатов пользователя
    getChats: async (): Promise<Chat[]> => {
        const response = await apiClient.get<Chat[]>('/chat/');
        return response.data;
    },
};