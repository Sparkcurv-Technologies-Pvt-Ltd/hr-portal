import { useState } from "react";

// Desktop sidebar collapsed state, persisted in localStorage (shared by both dashboards)
export function useSidebarCollapsed() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("sidebarCollapsed") === "true");
  const toggleSidebarCollapsed = () => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem("sidebarCollapsed", String(!prev));
      return !prev;
    });
  };
  return [sidebarCollapsed, toggleSidebarCollapsed];
}
