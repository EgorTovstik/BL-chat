import type { UserRead, Message } from './index'

// Базовые поля чата
export interface Chat {
    id: number;
    name: string | null;
    type: 'personal' | 'group';
    participants: UserRead[];
    last_message?: Message | null;
    unread_count?: number;
}

export interface ChatCreatePayload {
    name?: string | null;
    type: 'personal' | 'group';
    participant_ids: number[];
}