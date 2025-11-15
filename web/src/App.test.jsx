import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import App from './App.jsx';

const authState = vi.hoisted(() => ({ current: { user: null, loading: false } }));

vi.mock('./contexts/AuthContext.jsx', () => ({
  useAuth: () => authState.current,
}));

vi.mock('./pages/AuthPage.jsx', () => ({
  default: () => <div data-testid="auth-page">Auth</div>,
}));

vi.mock('./pages/ChatsPage.jsx', () => ({
  default: () => <div data-testid="chats-page">Chats</div>,
}));

vi.mock('./pages/SchedulePage.jsx', () => ({
  default: () => <div data-testid="schedule-page">Schedule</div>,
}));

describe('App routing smoke tests', () => {
  beforeEach(() => {
    authState.current = { user: null, loading: false };
  });

  it('redirects guests hitting a protected route back to auth', () => {
    authState.current = { user: null, loading: false };
    render(
      <MemoryRouter initialEntries={['/chats']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
  });

  it('lets authenticated users see protected areas', () => {
    authState.current = { user: { id: '1' }, loading: false };
    render(
      <MemoryRouter initialEntries={['/chats']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId('chats-page')).toBeInTheDocument();
  });

  it('redirects authenticated users away from the public route', () => {
    authState.current = { user: { id: '17' }, loading: false };
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByTestId('chats-page')).toBeInTheDocument();
  });
});
