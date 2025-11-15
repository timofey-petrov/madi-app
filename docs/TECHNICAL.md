# Техническая документация MADI App

## 1. Обзор

MADI App — внутренний коммуникационный сервис для преподавателей и студентов МАДИ. Решение состоит из двух основных частей:

- **Backend** — `server/` на Node.js + Express, хранение данных в SQLite (через `better-sqlite3`). Отвечает за аутентификацию JWT, REST API, Socket.IO события и выгрузку вложений.
- **Frontend** — `web/` на React + Vite. Клиент реализует аутентификацию, ролевую навигацию, чаты, задания, расписание, тему интерфейса и базовые smoke-тесты на Vitest.

## 2. Архитектура

| Слой | Технологии | Назначение |
|------|------------|------------|
| Клиент | React 19, React Router, Context API (Auth/Theme), Socket.IO client, Vite | UI, авторизация, ролевые ограничители (Protected/PublicRoute), чаты, расписание, drawer заданий, загрузка файлов |
| Сервер | Express 4, Socket.IO 4, better-sqlite3, bcrypt, jsonwebtoken, multer, Nodemailer | REST API, выдача SPA/legacy HTML, upload файлов (100 МБ), WebSocket события typing/join, почтовые уведомления |
| Storage | SQLite (`server/data/madi.db`), `server/uploads` для вложений | Данные пользователей, чатов, сообщений, заданий, расписания, сбросы паролей |

### Потоки данных

1. Клиент авторизуется через `/api/auth/login` или `/api/auth/register`, получает JWT и сохраняет его через `AuthContext`.
2. Все запросы к API идут через `web/src/lib/api.js` с подстановкой Bearer токена. При 401 выполняется logout.
3. Socket.IO подключается с тем же токеном (см. `ChatsPage.jsx`) и подписывается на комнаты `chat_<ID>` для typing-событий.
4. Вложения передаются через `multipart/form-data` на `/api/chats/:chatId/messages` (multer пишет файлы в `server/uploads`).
5. При сборке фронтенда `npm run build --prefix web` файлы кладутся в `web/dist`, а Express обслуживает их вместо `server/public`.

## 3. Серверная часть

### Запуск

```bash
# подготовка env
cp server/.env.example server/.env

# локальный запуск
cd server
npm install
npm run dev      # nodemon

# сброс данных и демо-пользователей
npm run reset
```

Docker-режим: `docker compose up -d --build` — поднимает API (`server`) и фронтенд (Nginx + web). Порты: API `3000`, UI `8080`.

### Переменные окружения (`server/.env`)

| Переменная | Описание |
|------------|----------|
| `PORT` | Порт API (по умолчанию 3000) |
| `JWT_SECRET` | Секрет подписи токенов |
| `APP_BASE_URL` | URL фронтенда для ссылок в письмах |
| `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` | Настройки SMTP (fallback в `server/data/outbox/` при сбое) |

### REST API (основные эндпоинты)

| Метод и путь | Назначение | Ограничения |
|--------------|------------|-------------|
| `POST /api/auth/register` | Регистрация (student/teacher) | публично |
| `POST /api/auth/login` | Получение JWT | публично |
| `GET /api/me` | Профиль текущего пользователя | JWT |
| `POST /api/auth/change-password` | Смена пароля с проверкой старого | JWT |
| `GET /api/users` | Поиск пользователей по email/name | JWT |
| `POST /api/chats` | Создание группового/DM чата, создание Jitsi room | JWT |
| `GET /api/chats` | Список чатов пользователя | JWT |
| `GET /api/chats/:chatId` | Карточка чата | членство |
| `PUT /api/chats/:chatId` | Обновление метаданных (изображение, тема) | owner/moderator |
| `GET /api/chats/:chatId/members` | Состав участников | членство |
| `POST /api/chats/:chatId/members` | Добавление участника | owner/moderator |
| `DELETE /api/chats/:chatId/members/:userId` | Исключение участника | owner/moderator |
| `GET /api/chats/:chatId/messages` | История сообщений (пагинация оффсет/limit) | членство |
| `POST /api/chats/:chatId/messages` | Отправка сообщений/файлов | членство, upload `file` |
| `PUT /api/chats/:chatId/messages/:messageId` | Редактирование (2 минуты) | автор |
| `DELETE /api/chats/:chatId/messages/:messageId` | Удаление | автор/owner |
| `GET /api/chats/:chatId/jitsi` | Получение/создание ссылки на видеозвонок | членство |
| `POST /api/chats/:chatId/assignments` | Создать задание | teacher/owner/moderator |
| `GET /api/chats/:chatId/assignments` | Список заданий | членство |
| `POST /api/assignments/:id/close` | Закрыть задание | создатель/owner |
| `POST /api/assignments/:id/submissions` | Сдать работу (upload) | участник |
| `GET /api/assignments/:id/submissions` | Список сдач | преподаватель |
| `POST /api/schedule` | Добавление события расписания | преподаватель |
| `GET /api/schedule` | Фильтрация расписания по группе/курсу/дате | JWT |
| `DELETE /api/chats/:chatId` | Полное удаление чата (со всеми файлами) | owner |

### WebSocket события (Socket.IO)

- Клиент подключается с query `token`. Сервер в `io.use` (см. `index.js`) валидирует JWT и прикрепляет `socket.user`.
- `join { chatId }` — добавляет соединение в комнату `chat_<id>`.
- `typing { chatId }` — рассылает событие всем участникам комнаты.

### База данных

Схема описана в `server/db.js`. Ключевые таблицы:

| Таблица | Поля |
|---------|------|
| `users` | `id`, `email`, `password_hash`, `name`, `role (student/teacher)`, `created_at` |
| `chats` | `id`, `title`, `is_group`, `owner_id`, `jitsi_room`, `created_at` |
| `chat_members` | `chat_id`, `user_id`, `role (owner/moderator/member)`, `created_at` |
| `messages` | `id`, `chat_id`, `user_id`, `content`, `type (text/file/video)`, `attachment_path`, `created_at` |
| `assignments` | `id`, `chat_id`, `title`, `description`, `due_at`, `creator_id`, `status` |
| `submissions` | `assignment_id`, `user_id`, `file_path`, `created_at` |
| `schedule_events` | `group_name`, `course`, `title`, `starts_at`, `ends_at`, `location`, `notes` |
| `password_resets` | `token`, `user_id`, `expires_at`, `used_at` |

## 4. Клиентская часть

- Точка входа — `web/src/main.jsx`. Приложение оборачивается в `ThemeProvider`, `AuthProvider`, `BrowserRouter`.
- Роуты:
  - `/` — `AuthPage` (форма входа/регистрации, переключение темы).
  - `/chats` — `ChatsPage` (список чатов, сообщения, drawer заданий, загрузки, управляющие действия по ролям).
  - `/schedule` — `SchedulePage` (просмотр расписания).
  - `*` — редирект на `/`.
- Компоненты:
  - `contexts/AuthContext.jsx` — хранение токена, user, `login/register/logout/refreshUser`.
  - `contexts/ThemeContext.jsx` — переключение темы и запись в `localStorage`.
  - `components/Drawer.jsx` — выдвижная панель (используется для заданий и расписания).
  - `lib/api.js` — обёртка над `fetch` с автоматическим проставлением `Authorization` и сохранением токена.
  - `lib/toast.js` — простые уведомления.

### Сборка и тесты фронтенда

```bash
cd web
npm install
npm run dev      # Vite dev server
npm run build    # сборка в web/dist
npm run preview  # предпросмотр
npm run test     # Vitest smoke suite
```

Smoke-тесты (`web/src/App.test.jsx`, `web/src/pages/AuthPage.test.jsx`) накрывают маршрутизацию и базовые сценарии аутентификации.

## 5. Руководство по деплою

1. **Локальная проверка** — прогнать `npm run test --prefix web`, `npm run build --prefix web` и `npm run dev` в `server/`.
2. **Продакшн** — задать `APP_BASE_URL`, SMTP, `JWT_SECRET`. Собрать фронт (`npm run build --prefix web`) и перезапустить сервер, чтобы он обслуживал `web/dist`.
3. **Docker** — пересобрать образ `server` (Node 18) и фронт (Nginx). Убедиться, что `docker-compose.yml` прокидывает `.env`.
4. **Резервные копии** — `server/data/madi.db` и `server/uploads`. Настроить volume в Compose.
5. **Мониторинг** — следить за размером uploads и SQLite WAL, ротация логов (stdout приложения).

## 6. Тестовые данные

`npm run reset` (в `server/`) создаёт:

- `teacher@madi.ru / password` (роль teacher, владелец демо-чата).
- `student@madi.ru / password`.
- Один групповой чат с заданием, сообщениями и событием расписания.

Используйте их для быстрой проверки UI и API.
