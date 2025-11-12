export function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'error' ? 'error' : 'success');
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
