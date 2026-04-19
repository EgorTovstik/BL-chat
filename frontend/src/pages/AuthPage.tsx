// src/pages/Login.tsx
import { useState } from 'react';
import { authAPI } from '../api/auth';
import { useNavigate } from 'react-router-dom';
import type { UserCreate } from '../types';

export function AuthPage() {
  const [isRegister, setIsRegister] = useState(false);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    try {
      if (isRegister) {
        // Регистрация
        const payload: UserCreate = {
          full_name: fullName,
          email,
          password
        };
        await authAPI.register(payload);

        // Успех → показываем сообщение и переключаем на вход
        const loginHint = email.split('@')[0];
        setSuccess(`✅ Готово! Логин для входа: ${loginHint}`);
        setIsRegister(false);
        setPassword('');
        setFullName('');
        setEmail('');
      } else {
        // Вход
        const data = await authAPI.login(username, password);
        localStorage.setItem('token', data.access_token); // 🔑 Сохраняем токен
        navigate('/chats'); // Переход к списку чатов
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка входа');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 320, margin: '50px auto' }}>
      <h2 style={{ textAlign: 'center' }}>{isRegister ? 'Регистрация' : 'Вход'}</h2>
      
      {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}
      {success && <p style={{ color: 'green', textAlign: 'center' }}>{success}</p>}

      {/* Поля только для регистрации */}
      {isRegister && (
        <>
          <input
            placeholder="Ваше имя"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            style={{ display: 'block', width: '100%', marginBottom: 10, padding: 8, boxSizing: 'border-box' }}
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{ display: 'block', width: '100%', marginBottom: 10, padding: 8, boxSizing: 'border-box' }}
          />
        </>
      )}

      {/* Общие поля */}
      <input
        placeholder={isRegister ? "Email (логин будет создан автоматически)" : "Логин"}
        value={isRegister ? email : username}
        onChange={e => isRegister ? setEmail(e.target.value) : setUsername(e.target.value)}
        required
        style={{ display: 'block', width: '100%', marginBottom: 10, padding: 8, boxSizing: 'border-box' }}
      />
      
      <input
        type="password"
        placeholder="Пароль"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        style={{ display: 'block', width: '100%', marginBottom: 10, padding: 8, boxSizing: 'border-box' }}
      />

      <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
        <button 
          type="button" 
          onClick={() => {
            setIsRegister(!isRegister);
            setError('');
            setSuccess('');
            setPassword('');
          }}
          style={{ flex: 1, padding: '8px 16px', cursor: 'pointer' }}
        >
          {isRegister ? 'Уже есть аккаунт? Войти' : 'Регистрация'}
        </button>
        <button 
          type="submit" 
          style={{ flex: 1, padding: '8px 16px', cursor: 'pointer' }}
        >
          {isRegister ? 'Создать' : 'Войти'}
        </button>
      </div>
    </form>
  );
}