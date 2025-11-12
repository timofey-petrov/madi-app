import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { api, getStoredToken } from '../lib/api.js';
import { toast } from '../lib/toast.js';
import { Drawer } from '../components/Drawer.jsx';

const formatDateTime = (ts) => {
  if (!ts) return '';
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(Number(ts));
  } catch {
    return '';
  }
};

const AssignmentsContent = ({ assignments, canManage, onCreate }) => {
  const [form, setForm] = useState({ title: '', description: '', due_date: '', due_time: '' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const due_at = form.due_date ? new Date(`${form.due_date}T${form.due_time || '00:00'}`).getTime() : null;
    try {
      await onCreate({
        title: form.title.trim(),
        description: form.description.trim(),
        due_at,
      });
      setForm({ title: '', description: '', due_date: '', due_time: '' });
    } catch (err) {
      toast(err.message || 'Не удалось создать задание', 'error');
    }
  };

  return (
    <>
      <ul className="list">
        {assignments.length === 0 && <li className="muted">Заданий нет</li>}
        {assignments.map((a) => (
          <li key={a.id}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <b>{a.title}</b>
                {a.description && <div className="muted">{a.description}</div>}
              </div>
              <div className="muted" style={{ whiteSpace: 'nowrap' }}>
                {a.due_at ? formatDateTime(a.due_at) : '—'}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {canManage && (
        <form onSubmit={handleSubmit} style={{ marginTop: 12 }}>
          <h4>Новое задание</h4>
          <label>Заголовок</label>
          <input value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} required />
          <label>Описание</label>
          <textarea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} rows={2} />
          <div className="row" style={{ gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Дата</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))} />
            </div>
            <div style={{ width: 140 }}>
              <label>Время</label>
              <input type="time" value={form.due_time} onChange={(e) => setForm((prev) => ({ ...prev, due_time: e.target.value }))} />
            </div>
          </div>
          <button className="primary" style={{ marginTop: 8 }}>
            Добавить
          </button>
        </form>
      )}
    </>
  );
};

const MembersContent = ({ members, canManage, onKick, onChangeRole, onInvite }) => {
  const [email, setEmail] = useState('');
  return (
    <>
      {canManage && (
        <form
          className="row"
          style={{ alignItems: 'stretch', gap: 8, marginBottom: 12 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!email.trim()) return;
            try {
              await onInvite(email.trim());
              setEmail('');
            } catch (err) {
              toast(err.message || 'Не удалось пригласить', 'error');
            }
          }}
        >
          <input placeholder="Email участника" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          <button className="primary">Пригласить</button>
        </form>
      )}
      <ul className="list">
        {members.map((m) => (
          <li key={m.id}>
            <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <div>
                {m.name} <span className="tag">{m.role}</span>
                <div className="muted" style={{ fontSize: 12 }}>
                  {m.email}
                </div>
              </div>
              {canManage && m.role !== 'owner' && (
                <div className="row" style={{ gap: 6 }}>
                  <select
                    value={m.role}
                    onChange={(e) =>
                      onChangeRole(m.id, e.target.value).catch((err) => toast(err.message || 'Не удалось обновить роль', 'error'))
                    }
                  >
                    <option value="member">member</option>
                    <option value="moderator">moderator</option>
                  </select>
                  <button
                    className="btn"
                    onClick={() =>
                      onKick(m.id).catch((err) => toast(err.message || 'Не удалось удалить участника', 'error'))
                    }
                  >
                    Исключить
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
};

export default function ChatsPage() {
  const { user, logout } = useAuth();
  const { toggleTheme } = useTheme();
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatMeta, setChatMeta] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [role, setRole] = useState('member');
  const [typingUsers, setTypingUsers] = useState([]);
  const [drawer, setDrawer] = useState(null);
  const [groupTitle, setGroupTitle] = useState('');
  const [dmEmail, setDmEmail] = useState('');
  const [messageInput, setMessageInput] = useState('');
  const [sending, setSending] = useState(false);
  const [file, setFile] = useState(null);
  const [chatsLoading, setChatsLoading] = useState(true);

  const socketRef = useRef(null);
  const activeChatRef = useRef(null);
  const typingMap = useRef(new Map());
  const typingTimers = useRef(new Map());
  const messagesBoxRef = useRef(null);
  const lastTypingEmitted = useRef(0);

  const canManage = role === 'owner' || role === 'moderator';

  const reloadChats = useCallback(async ({ selectFirst = false } = {}) => {
    const data = await api('/api/chats');
    setChats(data.chats);
    if (!data.chats.length) {
      setActiveChatId(null);
      return;
    }
    setActiveChatId((prev) => {
      if (selectFirst && prev == null) return data.chats[0].id;
      if (prev && data.chats.some((c) => c.id === prev)) return prev;
      return data.chats[0].id;
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        await reloadChats({ selectFirst: true });
      } catch (err) {
        toast(err.message || 'Не удалось загрузить чаты', 'error');
      } finally {
        if (mounted) setChatsLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [reloadChats]);

  useEffect(() => {
    activeChatRef.current = activeChatId;
    if (socketRef.current && activeChatId) {
      socketRef.current.emit('join', { chatId: activeChatId });
    }
  }, [activeChatId]);

  useEffect(() => {
    if (!user) return;
    const socket = io('/', { auth: { token: getStoredToken() } });
    socketRef.current = socket;

    const handleMessage = (msg) => {
      if (msg.chat_id !== activeChatRef.current) return;
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === msg.id);
        if (exists) {
          return prev.map((m) => (m.id === msg.id ? msg : m));
        }
        return [...prev, msg];
      });
    };
    const handleDeleted = ({ id }) => {
      setMessages((prev) => prev.filter((m) => m.id !== id));
    };
    const handleUpdated = (msg) => {
      if (msg.chat_id !== activeChatRef.current) return;
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? msg : m)));
    };
    const handleTyping = ({ chatId, user_id, user_name }) => {
      if (chatId !== activeChatRef.current || user_id === user.id) return;
      const timers = typingTimers.current;
      const map = typingMap.current;
      map.set(user_id, user_name);
      setTypingUsers(Array.from(map.values()));
      if (timers.get(user_id)) clearTimeout(timers.get(user_id));
      timers.set(
        user_id,
        setTimeout(() => {
          map.delete(user_id);
          timers.delete(user_id);
          setTypingUsers(Array.from(map.values()));
        }, 1800)
      );
    };

    socket.on('message', handleMessage);
    socket.on('message_deleted', handleDeleted);
    socket.on('message_updated', handleUpdated);
    socket.on('typing', handleTyping);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user]);

  useEffect(() => {
    if (!activeChatId) {
      setChatMeta(null);
      setMembers([]);
      setMessages([]);
      setRole('member');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [meta, membersData, messagesData] = await Promise.all([
          api(`/api/chats/${activeChatId}`),
          api(`/api/chats/${activeChatId}/members`),
          api(`/api/chats/${activeChatId}/messages`),
        ]);
        if (!cancelled) {
          setChatMeta(meta);
          setMembers(membersData.members);
          const me = membersData.members.find((m) => m.id === user.id);
          setRole(me?.role || 'member');
          setMessages(messagesData.messages);
        }
      } catch (err) {
        toast(err.message || 'Не удалось открыть чат', 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChatId, user?.id]);

  useEffect(() => {
    if (!messagesBoxRef.current) return;
    messagesBoxRef.current.scrollTop = messagesBoxRef.current.scrollHeight;
  }, [messages]);

  const loadMembers = useCallback(async () => {
    if (!activeChatId) return;
    const data = await api(`/api/chats/${activeChatId}/members`);
    setMembers(data.members);
    const me = data.members.find((m) => m.id === user.id);
    setRole(me?.role || 'member');
  }, [activeChatId, user?.id]);

  const showAssignments = useCallback(async () => {
    if (!activeChatId) return;
    try {
      const data = await api(`/api/chats/${activeChatId}/assignments`);
      setDrawer({ type: 'assignments', assignments: data.assignments });
    } catch (err) {
      toast(err.message || 'Не удалось загрузить задания', 'error');
    }
  }, [activeChatId]);

  const showMembersDrawer = async () => {
    await loadMembers();
    setDrawer({ type: 'members' });
  };

  const createAssignment = useCallback(async ({ title, description, due_at }) => {
    if (!activeChatId) return;
    await api(`/api/chats/${activeChatId}/assignments`, {
      method: 'POST',
      body: JSON.stringify({ title, description, due_at }),
    });
    toast('Задание добавлено');
    await showAssignments();
  }, [activeChatId, showAssignments]);

  const inviteMember = useCallback(async (email) => {
    const search = await api(`/api/users?q=${encodeURIComponent(email)}`);
    if (!search.users.length) throw new Error('Пользователь не найден');
    await api(`/api/chats/${activeChatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId: search.users[0].id }),
    });
    toast('Пользователь приглашён');
    await loadMembers();
  }, [activeChatId, loadMembers]);

  const changeMemberRole = useCallback(async (userId, newRole) => {
    await api(`/api/chats/${activeChatId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, role: newRole }),
    });
    toast('Роль обновлена');
    await loadMembers();
  }, [activeChatId, loadMembers]);

  const kickMember = useCallback(async (userId) => {
    await api(`/api/chats/${activeChatId}/members/${userId}`, { method: 'DELETE' });
    toast('Участник удалён');
    await loadMembers();
  }, [activeChatId, loadMembers]);

  const notifyTyping = () => {
    if (!socketRef.current || !activeChatId) return;
    const now = Date.now();
    if (now - lastTypingEmitted.current < 1000) return;
    lastTypingEmitted.current = now;
    socketRef.current.emit('typing', { chatId: activeChatId });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!activeChatId || (!messageInput.trim() && !file)) return;
    const body = new FormData();
    if (messageInput.trim()) body.append('content', messageInput.trim());
    if (file) body.append('file', file);
    setSending(true);
    try {
      await api(`/api/chats/${activeChatId}/messages`, {
        method: 'POST',
        body,
      });
      setMessageInput('');
      setFile(null);
    } catch (err) {
      toast(err.message || 'Не удалось отправить сообщение', 'error');
    } finally {
      setSending(false);
    }
  };

  const deleteChat = async () => {
    if (!activeChatId) return;
    if (!window.confirm('Удалить группу безвозвратно?')) return;
    try {
      await api(`/api/chats/${activeChatId}`, { method: 'DELETE' });
      toast('Группа удалена');
      setActiveChatId(null);
      await reloadChats({ selectFirst: true });
    } catch (err) {
      toast(err.message || 'Не удалось удалить', 'error');
    }
  };

  const handleEditMessage = async (message) => {
    const text = window.prompt('Изменить сообщение', message.content || '');
    if (text === null) return;
    await api(`/api/chats/${activeChatId}/messages/${message.id}`, {
      method: 'PUT',
      body: JSON.stringify({ content: text }),
    });
  };

  const handleDeleteMessage = async (message) => {
    if (!window.confirm('Удалить сообщение?')) return;
    await api(`/api/chats/${activeChatId}/messages/${message.id}`, {
      method: 'DELETE',
    });
  };

  const createGroup = async (e) => {
    e.preventDefault();
    if (!groupTitle.trim()) return;
    try {
      const resp = await api('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ title: groupTitle.trim(), is_group: 1, memberIds: [] }),
      });
      toast('Группа создана');
      setGroupTitle('');
      setActiveChatId(resp.id);
      await reloadChats();
    } catch (err) {
      toast(err.message || 'Не удалось создать', 'error');
    }
  };

  const createDirect = async (e) => {
    e.preventDefault();
    if (!dmEmail.trim()) return;
    try {
      const search = await api(`/api/users?q=${encodeURIComponent(dmEmail.trim())}`);
      if (!search.users.length) return toast('Пользователь не найден', 'error');
      const other = search.users[0];
      const resp = await api('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ title: other.name || other.email, is_group: 0, memberIds: [other.id] }),
      });
      // Опускаем права до member как и раньше
      await api(`/api/chats/${resp.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, role: 'member' }),
      });
      toast('Чат создан');
      setDmEmail('');
      setActiveChatId(resp.id);
      await reloadChats();
    } catch (err) {
      toast(err.message || 'Не удалось создать чат', 'error');
    }
  };

  const openJitsi = async () => {
    if (!activeChatId) return;
    try {
      const data = await api(`/api/chats/${activeChatId}/jitsi`);
      window.open(data.url, '_blank', 'noopener');
    } catch (err) {
      toast(err.message || 'Не удалось открыть конференцию', 'error');
    }
  };

  const canEditMessage = useCallback(
    (message) => message.user_id === user.id || canManage,
    [user?.id, canManage]
  );

  const drawerContent = useMemo(() => {
    if (!drawer) return null;
    if (drawer.type === 'assignments') {
      return <AssignmentsContent assignments={drawer.assignments || []} canManage={canManage} onCreate={createAssignment} />;
    }
    if (drawer.type === 'members') {
      return <MembersContent members={members} canManage={canManage} onInvite={inviteMember} onKick={kickMember} onChangeRole={changeMemberRole} />;
    }
    return null;
  }, [drawer, canManage, members, createAssignment, inviteMember, kickMember, changeMemberRole]);

  return (
    <div className="container" style={{ maxWidth: '1600px' }}>
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
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: '0 0 320px', maxWidth: '100%' }}>
          <h3>Чаты</h3>
          {chatsLoading && <div className="muted">Загрузка…</div>}
          <ul className="list" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {chats.map((chat) => (
              <li key={chat.id} className={chat.id === activeChatId ? 'active' : ''}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <div>
                    <b>{chat.title}</b>
                    <div className="muted" style={{ fontSize: 12, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {chat.last_message || 'Без сообщений'}
                    </div>
                  </div>
                  <button className="btn" onClick={() => setActiveChatId(chat.id)}>
                    Открыть
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <hr />
          <form onSubmit={createGroup}>
            <h4>Новая группа</h4>
            <input placeholder="Название" value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} required />
            <button className="primary" style={{ marginTop: 6 }}>
              Создать
            </button>
          </form>
          <form onSubmit={createDirect} style={{ marginTop: 12 }}>
            <h4>Личный чат</h4>
            <input placeholder="Email участника" value={dmEmail} onChange={(e) => setDmEmail(e.target.value)} required />
            <button className="btn" style={{ marginTop: 6 }}>
              Найти и создать
            </button>
          </form>
        </div>
        <div className="card" style={{ flex: '1 1 640px', minHeight: '70vh' }}>
          {activeChatId ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <h3 style={{ margin: 0 }}>{chatMeta?.title || 'Чат'}</h3>
                  <div className="muted">Ваша роль: <span className="tag">{role}</span></div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn ghost" onClick={showMembersDrawer}>
                    Участники
                  </button>
                  <button className="btn ghost" onClick={showAssignments}>
                    Задания
                  </button>
                  <button className="btn ghost" onClick={openJitsi}>
                    Конференция
                  </button>
                  {role === 'owner' && (
                    <button className="btn danger" onClick={deleteChat}>
                      Удалить
                    </button>
                  )}
                </div>
              </div>
              <div className="messages" ref={messagesBoxRef}>
                {messages.map((m) => (
                  <div key={m.id} className="message">
                    <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
                      <b>{m.user_name}</b>
                      <span className="muted">{formatDateTime(m.created_at)}</span>
                    </div>
                    {m.content && <p>{m.content}</p>}
                    {m.attachment_path && (
                      <div style={{ marginTop: 6 }}>
                        {m.type === 'video' ? (
                          <video controls style={{ maxWidth: '100%' }} src={m.attachment_path} />
                        ) : (
                          <a href={m.attachment_path} target="_blank" rel="noreferrer" className="link">
                            📎 {m.attachment_name || 'Файл'}
                          </a>
                        )}
                      </div>
                    )}
                    {canEditMessage(m) && (
                      <div className="row" style={{ gap: 8, marginTop: 6 }}>
                        <button className="btn ghost" onClick={() => handleEditMessage(m)}>
                          Изменить
                        </button>
                        <button className="btn ghost" onClick={() => handleDeleteMessage(m)}>
                          Удалить
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {typingUsers.length > 0 && <div className="muted" style={{ marginTop: 4 }}>{typingUsers.join(', ')} печатает…</div>}
              <form onSubmit={sendMessage} className="composer">
                <textarea
                  value={messageInput}
                  onChange={(e) => {
                    setMessageInput(e.target.value);
                    notifyTyping();
                  }}
                  placeholder="Сообщение"
                  rows={3}
                />
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <input
                    type="file"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    style={{ flex: 1 }}
                  />
                  <button className="primary" disabled={sending}>
                    {sending ? 'Отправляем…' : 'Отправить'}
                  </button>
                </div>
                {file && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Файл: {file.name}
                  </div>
                )}
              </form>
            </>
          ) : (
            <div className="muted">Выберите чат</div>
          )}
        </div>
      </div>
      {drawer && (
        <Drawer title={drawer.type === 'assignments' ? 'Задания' : 'Участники'} onClose={() => setDrawer(null)}>
          {drawerContent}
        </Drawer>
      )}
    </div>
  );
}
