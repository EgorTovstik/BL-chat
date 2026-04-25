import { useState } from 'react';
import { authAPI } from '../api/auth';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext'; // 🔥 Новый импорт
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
  const { login } = useAuth(); // 🔥 Берём login из контекста

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
        // 🔥 Вход: используем login() из контекста вместо прямого localStorage
        const data = await authAPI.login(username, password);
        
        // 🔥 Это ключевое: login() сохраняет токен, декодирует userId 
        // и триггерит переподключение сокета
        login(data.access_token);
        
        navigate('/chats', { replace: true });
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Ошибка входа');
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 320, margin: '50px auto' }}>
      <h2 style={{ textAlign: 'center' }}>{isRegister ? 'Регистрация' : 'Вход'}</h2>
      
      {error && <p style={{ color: '#dc2626', textAlign: 'center', fontSize: 14 }}>{error}</p>}
      {success && <p style={{ color: '#16a34a', textAlign: 'center', fontSize: 14 }}>{success}</p>}

      {/* Поля только для регистрации */}
      {isRegister && (
        <>
          <input
            placeholder="Ваше имя"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            required
            style={{ 
              display: 'block', 
              width: '100%', 
              marginBottom: 10, 
              padding: '10px 12px', 
              boxSizing: 'border-box',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 14
            }}
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{ 
              display: 'block', 
              width: '100%', 
              marginBottom: 10, 
              padding: '10px 12px', 
              boxSizing: 'border-box',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              fontSize: 14
            }}
          />
        </>
      )}

      {/* Общие поля */}
      <input
        placeholder={isRegister ? "Email (логин будет создан автоматически)" : "Логин"}
        value={isRegister ? email : username}
        onChange={e => isRegister ? setEmail(e.target.value) : setUsername(e.target.value)}
        required
        style={{ 
          display: 'block', 
          width: '100%', 
          marginBottom: 10, 
          padding: '10px 12px', 
          boxSizing: 'border-box',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          fontSize: 14
        }}
      />
      
      <input
        type="password"
        placeholder="Пароль"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        style={{ 
          display: 'block', 
          width: '100%', 
          marginBottom: 10, 
          padding: '10px 12px', 
          boxSizing: 'border-box',
          border: '1px solid #cbd5e1',
          borderRadius: 6,
          fontSize: 14
        }}
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
          style={{ 
            flex: 1, 
            padding: '10px 16px', 
            cursor: 'pointer',
            background: '#f1f5f9',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            fontSize: 14,
            transition: 'background 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#e2e8f0'}
          onMouseOut={(e) => e.currentTarget.style.background = '#f1f5f9'}
        >
          {isRegister ? 'Уже есть аккаунт? Войти' : 'Регистрация'}
        </button>
        <button 
          type="submit" 
          style={{ 
            flex: 1, 
            padding: '10px 16px', 
            cursor: 'pointer',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            transition: 'background 0.2s'
          }}
          onMouseOver={(e) => e.currentTarget.style.background = '#2563eb'}
          onMouseOut={(e) => e.currentTarget.style.background = '#3b82f6'}
        >
          {isRegister ? 'Создать' : 'Войти'}
        </button>
      </div>
    </form>
  );
}