export function Drawer({ title, onClose, children }) {
  return (
    <div className="card drawer">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <b>{title}</b>
        <button className="btn ghost" onClick={onClose}>
          Закрыть
        </button>
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
