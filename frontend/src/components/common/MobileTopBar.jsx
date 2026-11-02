import { List } from "@phosphor-icons/react";

// Fixed top bar shown below the lg breakpoint (logo + hamburger) and the backdrop behind the open mobile sidebar
export function MobileTopBar({ mobileSidebarOpen, setMobileSidebarOpen }) {
  return (
    <>
      {/* Mobile Top Bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 z-30 flex items-center justify-between px-4 transition-colors duration-200" style={{ background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--sidebar-border)' }}>
        {/* White tile keeps the grey wordmark crisp on the bar */}
        <span className="inline-flex items-center rounded-lg px-2 py-1" style={{ background: '#FFFFFF' }}>
          <img src="/sparkcurv-logo-full.png" alt="Sparkcurv — Tech, simplified" style={{ height: 28, width: 'auto' }} />
        </span>
        <button
          data-testid="mobile-sidebar-toggle"
          onClick={() => setMobileSidebarOpen(true)}
          aria-label="Open menu"
          className="flex items-center justify-center w-9 h-9 rounded-lg"
          style={{ color: 'var(--nav-text)', border: '1px solid var(--border-color)' }}
        >
          <List style={{ width: 20, height: 20 }} />
        </button>
      </div>

      {/* Mobile overlay backdrop */}
      {mobileSidebarOpen && (
        <div
          data-testid="mobile-sidebar-overlay"
          className="fixed inset-0 bg-slate-950/50 backdrop-blur-[2px] z-40 lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
    </>
  );
}
