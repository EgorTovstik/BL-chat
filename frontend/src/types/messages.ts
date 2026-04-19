import type { UserRead } from './index'

// То, что приходит от сервера (WebSocket + REST)
export interface Message {
    id: number;
    chat_id: number;
    sender_id: number;
    text: string;
    timestamp: string; // datetime → ISO-строка в JSON
    read: boolean;
    sender: UserRead;
}

// То, что мы отправляем через WebSocket
export interface MessageCreatePayload {
    type: 'message',
    text: string,
    client_msg_id?: string;
}