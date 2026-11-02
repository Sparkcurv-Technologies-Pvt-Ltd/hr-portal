// Sidebar header logo: the full Sparkcurv logo on a white tile (it's designed for white backgrounds),
// or just the emblem when the sidebar is collapsed. `label` is the panel name under the logo.
export function SidebarBrand({ collapsed, label }) {
  if (collapsed) {
    return (
      <div className="flex items-center justify-center w-11 h-11 rounded-xl shadow-md flex-shrink-0" style={{ background: '#FFFFFF' }} title="Sparkcurv">
        <img src="/sparkcurv-logo.png" alt="Sparkcurv" style={{ width: 30, height: 30, objectFit: 'contain' }} />
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div className="inline-flex items-center rounded-xl px-3 py-2 shadow-md" style={{ background: '#FFFFFF' }}>
        <img src="/sparkcurv-logo-full.png" alt="Sparkcurv — Tech, simplified" style={{ height: 34, width: 'auto', maxWidth: '100%' }} />
      </div>
      {label && (
        <span className="block mt-2 pl-0.5 text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: '#7DD3FC' }}>{label}</span>
      )}
    </div>
  );
}
