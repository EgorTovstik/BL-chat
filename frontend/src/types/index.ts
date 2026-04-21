
// Базовые поля пользователя
export interface UserBase {
    full_name: string;
    email: string;
}

// Для регистрации (создания)
export interface UserCreate extends UserBase {
    password: string;
}

// Для входа (login)
export interface TokenResponse {
    access_token: string;
    token_type: string;
}

// То, что возвращает API при чтении пользователя
export interface UserRead {
    id: number;
    full_name: string;
}

// Для обновления профиля (опциональные поля)
export interface UserUpdate {
  full_name?: string;
  email?: string;
  password?: string;
}