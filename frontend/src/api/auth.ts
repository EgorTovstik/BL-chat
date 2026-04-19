import { apiClient } from './client'
import { UserCreate, TokenResponse, UserRead } from '../types'

export const authAPI = {
    //Регистрация
    register: async (data: UserCreate): Promise<UserRead> => {
        const response = await apiClient.post<UserRead>('/user/', data);
        return response.data;
    },

    //Вход
    login: async (username: string, password: string): Promise<TokenResponse> => {
        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);

        const response = await apiClient.post<TokenResponse>('/auth/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        return response.data;
    },

    // Получить текущего пользователя
    getCurrentUser: async (): Promise<UserRead> => {
        const response = await apiClient.get<UserRead>('/user/me');
        return response.data;
    },
}

