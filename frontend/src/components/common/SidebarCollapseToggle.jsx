import { CaretLeft, CaretRight } from "@phosphor-icons/react";

// Desktop-only button that collapses the sidebar to icon width
export function SidebarCollapseToggle({ sidebarCollapsed, onToggle }) {
  return (
    <button
      data-testid="sidebar-collapse-toggle"
      onClick={onToggle}
      className="hidden lg:flex items-center justify-center gap-2 mx-4 mb-2 py-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors text-xs font-semibold"
      style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '4px', paddingTop: '10px' }}
    >
      {sidebarCollapsed ? <CaretRight style={{ width: 16, height: 16 }} /> : <CaretLeft style={{ width: 16, height: 16 }} />}
      {!sidebarCollapsed && <span>Collapse</span>}
    </button>
  );
}
