// src/pages/Login.tsx
import { useState } from 'react';
import { authAPI } from '../api/auth';
import { useNavigate } from 'react-router-dom';

export function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await authAPI.login(username, password);
      localStorage.setItem('token', data.access_token); // 🔑 Сохраняем токен
      navigate('/chats'); // Переход к списку чатов
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка входа');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 300, margin: '50px auto' }}>
      <h2>Вход</h2>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <input
        placeholder="Username"
        value={username}
        onChange={e => setUsername(e.target.value)}
        required
        style={{ display: 'block', width: '100%', marginBottom: 10, padding: 8 }}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        style={{ display: 'block', width: '100%', marginBottom: 10, padding: 8 }}
      />
      <button type="submit" style={{ padding: '8px 16px' }}>Войти</button>
    </form>
  );
}