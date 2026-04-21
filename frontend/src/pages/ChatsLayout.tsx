import {Outlet} from 'react-router-dom';
import {ChatList} from './ChatList'

export function ChatsLayout() {
    return (
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {/* Левая панель — список чатов (всегда виден) */}
        <div style={{ width: '420px', borderRight: '1px solid #dfe1e5', flexShrink: 0 }}>
            <ChatList />
        </div>

        {/* Правая панель — меняется через Outlet */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
            <Outlet />
        </div>
        </div>
    );
}