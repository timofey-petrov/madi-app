export const token = () => localStorage.getItem('token') || '';
export const setToken = (t) => localStorage.setItem('token', t);
export const clearToken = () => localStorage.removeItem('token');

export async function api(path, opts = {}){
  const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers || {});
  if (!headers['Content-Type'] && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token()) headers['Authorization'] = 'Bearer ' + token();
  const res = await fetch(path, { ...opts, headers });
  if (!res.ok){
    const text = await res.text().catch(()=> '');
    throw new Error(text || res.statusText);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export async function me(){
  try{ const { user } = await api('/api/me'); return user; }catch{ return null; }
}

export function toast(message, type = 'success'){
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : 'success');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 2500);
}

// Theme toggle
const THEME_KEY = 'theme'; // 'light' | 'dark'
export function applyTheme(theme){
  const root = document.documentElement;
  root.classList.remove('theme-light','theme-dark');
  root.classList.add(theme === 'light' ? 'theme-light' : 'theme-dark');
  localStorage.setItem(THEME_KEY, theme);
}
export function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return applyTheme(saved);
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(prefersLight ? 'light' : 'dark');
}
export function toggleTheme(){
  const curr = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(curr === 'dark' ? 'light' : 'dark');
}
