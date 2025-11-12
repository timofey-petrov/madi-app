import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { toast } from '../lib/toast.js';

export default function AuthPage() {
  const { login, register } = useAuth();
  const { toggleTheme } = useTheme();
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '', role: 'student' });
  const [loginPending, setLoginPending] = useState(false);
  const [registerPending, setRegisterPending] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginPending(true);
    try {
      await login(loginForm.email.trim(), loginForm.password);
    } catch (err) {
      toast(err.message || 'Ошибка входа', 'error');
    } finally {
      setLoginPending(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setRegisterPending(true);
    try {
      await register({
        name: registerForm.name.trim(),
        email: registerForm.email.trim(),
        password: registerForm.password,
        role: registerForm.role,
      });
    } catch (err) {
      toast(err.message || 'Ошибка регистрации', 'error');
    } finally {
      setRegisterPending(false);
    }
  };

  return (
    <div className="container auth-screen">
      <div className="header">
        <div className="brand">МАДИ</div>
        <div className="nav">
          <button className="theme-toggle" onClick={toggleTheme}>
            Тема
          </button>
        </div>
      </div>
      <div className="grid grid-2">
        <form className="card" onSubmit={handleLogin}>
          <h3>Вход</h3>
          <label>Email</label>
          <input
            name="email"
            value={loginForm.email}
            onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="you@madi.ru"
            autoComplete="off"
            required
          />
          <label>Пароль</label>
          <input
            type="password"
            name="password"
            value={loginForm.password}
            onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="••••••••"
            autoComplete="off"
            required
          />
          <button className="primary" style={{ marginTop: 8 }} disabled={loginPending}>
            {loginPending ? 'Входим…' : 'Войти'}
          </button>
        </form>
        <form className="card" onSubmit={handleRegister}>
          <h3>Регистрация</h3>
          <label>Имя</label>
          <input
            name="name"
            value={registerForm.name}
            onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Имя"
            autoComplete="off"
            required
          />
          <label>Роль</label>
          <select value={registerForm.role} onChange={(e) => setRegisterForm((prev) => ({ ...prev, role: e.target.value }))} name="role">
            <option value="student">Студент</option>
            <option value="teacher">Преподаватель</option>
          </select>
          <label>Email</label>
          <input
            name="email"
            value={registerForm.email}
            onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="you@madi.ru"
            autoComplete="off"
            required
          />
          <label>Пароль</label>
          <input
            type="password"
            name="password"
            value={registerForm.password}
            onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
            placeholder="Минимум 6 символов"
            autoComplete="off"
            required
          />
          <button className="primary" style={{ marginTop: 8 }} disabled={registerPending}>
            {registerPending ? 'Создаём…' : 'Создать аккаунт'}
          </button>
        </form>
      </div>
    </div>
  );
}
