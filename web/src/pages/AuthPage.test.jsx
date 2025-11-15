import { fireEvent, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import AuthPage from './AuthPage.jsx';

const mockLogin = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'u1' }));
const mockRegister = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'u2' }));
const mockToggleTheme = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({
    login: mockLogin,
    register: mockRegister,
  }),
}));

vi.mock('../contexts/ThemeContext.jsx', () => ({
  useTheme: () => ({
    toggleTheme: mockToggleTheme,
  }),
}));

vi.mock('../lib/toast.js', () => ({
  toast: mockToast,
}));

describe('AuthPage', () => {
  beforeEach(() => {
    mockLogin.mockClear();
    mockRegister.mockClear();
    mockToggleTheme.mockClear();
    mockToast.mockClear();
  });

  it('submits login form with entered credentials', async () => {
    const user = userEvent.setup();
    render(<AuthPage />);

    const [loginForm] = document.querySelectorAll('form');
    const loginEmail = within(loginForm).getByPlaceholderText('you@madi.ru');
    const loginPassword = loginForm.querySelector('input[name="password"]');

    await user.type(loginEmail, 'demo@madi.ru');
    await user.type(loginPassword, 'hunter2');
    fireEvent.submit(loginForm);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('demo@madi.ru', 'hunter2');
    });
  });

  it('registers a user and allows switching the theme', async () => {
    const user = userEvent.setup();
    render(<AuthPage />);

    const forms = document.querySelectorAll('form');
    const registerForm = forms[1];
    const nameInput = registerForm.querySelector('input[name="name"]');
    const emailInput = within(registerForm).getByPlaceholderText('you@madi.ru');
    const passwordInput = registerForm.querySelector('input[name="password"]');
    const roleSelect = registerForm.querySelector('select[name="role"]');

    await user.type(nameInput, 'QA Engineer');
    await user.type(emailInput, 'qa@madi.ru');
    await user.type(passwordInput, 'secretpass');
    await user.selectOptions(roleSelect, 'teacher');
    fireEvent.submit(registerForm);

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        name: 'QA Engineer',
        email: 'qa@madi.ru',
        password: 'secretpass',
        role: 'teacher',
      });
    });

    const themeButton = document.querySelector('.theme-toggle');
    await user.click(themeButton);

    expect(mockToggleTheme).toHaveBeenCalled();
  });
});
