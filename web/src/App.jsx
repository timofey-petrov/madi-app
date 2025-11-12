import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext.jsx';
import AuthPage from './pages/AuthPage.jsx';
import ChatsPage from './pages/ChatsPage.jsx';
import SchedulePage from './pages/SchedulePage.jsx';

const ScreenMessage = ({ text }) => (
  <div className="container" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <div className="card" style={{ maxWidth: 320, width: '100%', textAlign: 'center' }}>{text}</div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <ScreenMessage text="Загрузка…" />;
  if (!user) return <Navigate to="/" replace />;
  return children;
};

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <ScreenMessage text="Загрузка…" />;
  if (user) return <Navigate to="/chats" replace />;
  return children;
};

export default function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <PublicRoute>
            <AuthPage />
          </PublicRoute>
        }
      />
      <Route
        path="/chats"
        element={
          <ProtectedRoute>
            <ChatsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/schedule"
        element={
          <ProtectedRoute>
            <SchedulePage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
