import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { api } from '../lib/api.js';
import { toast } from '../lib/toast.js';

const formatRange = (start, end) => {
  if (!start) return '';
  const startFmt = new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(Number(start));
  const endFmt = end
    ? new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(Number(end))
    : '';
  return end ? `${startFmt} – ${endFmt}` : startFmt;
};

export default function SchedulePage() {
  const { user, logout } = useAuth();
  const { toggleTheme } = useTheme();
  const canCreate = user.role === 'teacher';
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState({
    group_name: '',
    title: '',
    starts_date: '',
    starts_time: '',
    ends_time: '',
    location: '',
    notes: '',
  });

  const loadEvents = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter.trim()) params.set('group', filter.trim());
    const data = await api(`/api/schedule?${params.toString()}`);
    setEvents(data.events);
  }, [filter]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await loadEvents();
      } catch (err) {
        toast(err.message || 'Не удалось загрузить расписание', 'error');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [loadEvents]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.starts_date) return;
    try {
      const starts_at = new Date(`${form.starts_date}T${form.starts_time || '00:00'}`).getTime();
      const ends_at = form.ends_time ? new Date(`${form.starts_date}T${form.ends_time}`).getTime() : starts_at;
      await api('/api/schedule', {
        method: 'POST',
        body: JSON.stringify({
          group_name: form.group_name.trim(),
          title: form.title.trim(),
          starts_at,
          ends_at,
          location: form.location.trim(),
          notes: form.notes.trim(),
        }),
      });
      toast('Событие добавлено');
      setForm({
        group_name: '',
        title: '',
        starts_date: '',
        starts_time: '',
        ends_time: '',
        location: '',
        notes: '',
      });
      await loadEvents();
    } catch (err) {
      toast(err.message || 'Не удалось добавить событие', 'error');
    }
  };

  const handleFilter = async (e) => {
    e.preventDefault();
    try {
      await loadEvents();
    } catch (err) {
      toast(err.message || 'Не удалось загрузить расписание', 'error');
    }
  };

  return (
    <div className="container" style={{ maxWidth: '1400px' }}>
      <div className="header">
        <div className="brand">МАДИ</div>
        <div className="nav" style={{ gap: 8 }}>
          <Link className="btn ghost" to="/chats">
            💬 Чаты
          </Link>
          <Link className="btn ghost" to="/schedule">
            📅 Расписание
          </Link>
          <span className="tag">{user.role}</span>
          <span className="tag">{user.name}</span>
          <button className="theme-toggle" onClick={toggleTheme}>
            Тема
          </button>
          <button className="btn ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </div>
      <div className="row" style={{ gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {canCreate && (
          <div className="card" style={{ flex: '1 1 420px' }}>
            <h3>Добавить событие</h3>
            <form onSubmit={handleSubmit}>
              <label>Группа</label>
              <input value={form.group_name} onChange={(e) => setForm((prev) => ({ ...prev, group_name: e.target.value }))} placeholder="ИВЧ-21" />
              <label>Название</label>
              <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Лекция" required />
              <div className="row" style={{ gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label>Дата</label>
                  <input type="date" value={form.starts_date} onChange={(e) => setForm((prev) => ({ ...prev, starts_date: e.target.value }))} required />
                </div>
                <div style={{ width: 140 }}>
                  <label>Начало</label>
                  <input type="time" value={form.starts_time} onChange={(e) => setForm((prev) => ({ ...prev, starts_time: e.target.value }))} />
                </div>
                <div style={{ width: 140 }}>
                  <label>Окончание</label>
                  <input type="time" value={form.ends_time} onChange={(e) => setForm((prev) => ({ ...prev, ends_time: e.target.value }))} />
                </div>
              </div>
              <label>Аудитория</label>
              <input value={form.location} onChange={(e) => setForm((prev) => ({ ...prev, location: e.target.value }))} placeholder="А-101" />
              <label>Заметки</label>
              <textarea value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} rows={3} />
              <button className="primary" style={{ marginTop: 8 }}>
                Сохранить
              </button>
            </form>
          </div>
        )}
        <div className="card" style={{ flex: '1 1 500px' }}>
          <h3>Расписание</h3>
          <form className="row" style={{ gap: 8 }} onSubmit={handleFilter}>
            <input placeholder="Фильтр по группе" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="btn">Загрузить</button>
          </form>
          {loading ? (
            <div className="muted" style={{ marginTop: 12 }}>
              Загрузка…
            </div>
          ) : (
            <ul className="list" style={{ marginTop: 12 }}>
              {events.map((event) => (
                <li key={event.id}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                    <div>
                      <b>{event.title}</b>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {event.group_name || ''} {event.location ? `• ${event.location}` : ''}
                      </div>
                      {event.notes && <div className="muted" style={{ fontSize: 12 }}>{event.notes}</div>}
                    </div>
                    <div className="muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatRange(event.starts_at, event.ends_at)}
                    </div>
                  </div>
                </li>
              ))}
              {!events.length && <li className="muted">Событий нет</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
