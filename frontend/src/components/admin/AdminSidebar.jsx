import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { canDo, PERMISSION_MODULES } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  SignOut, Users, CalendarCheck, Clock, House, Timer, CurrencyDollar, ClockClockwise, CalendarStar, Scroll, Laptop,
  GitPullRequest, Bell, TreeStructure, ShieldCheck, Wallet, ArrowLeft, LockKey, X as XIcon
} from "@phosphor-icons/react";
import { ResetPortalButton } from "@/components/admin/ResetPortalButton";
import { Avatar } from "@/components/common/Avatar";
import { MobileTopBar } from "@/components/common/MobileTopBar";
import { SidebarBrand } from "@/components/common/SidebarBrand";
import { SidebarCollapseToggle } from "@/components/common/SidebarCollapseToggle";

const allNavItems = [
  { id: "overview", label: "Overview", icon: House, section: "Workspace" },
  { id: "my-attendance", label: "My Attendance", icon: ClockClockwise, managerOnly: true, section: "Workspace" },
  { id: "employees", label: "Employees", icon: Users, adminOnly: true, section: "People & Pay" },
  { id: "payroll", label: "Payroll", icon: CurrencyDollar, adminOnly: true, section: "People & Pay" },
  { id: "finance", label: "Income & Expense", icon: Wallet, adminOnly: true, section: "People & Pay" },
  { id: "change-requests", label: "Change Requests", icon: GitPullRequest, section: "Requests & Time" },
  { id: "leaves", label: "Leave Requests", icon: CalendarCheck, section: "Requests & Time" },
  { id: "wfh", label: "WFH Requests", icon: Laptop, section: "Requests & Time" },
  { id: "permissions", label: "Permissions", icon: Timer, section: "Requests & Time" },
  { id: "attendance", label: "Attendance", icon: Clock, section: "Requests & Time" },
  { id: "org-chart", label: "Worker Tree", icon: TreeStructure, adminOnly: true, section: "Company" },
  { id: "holidays", label: "Holidays", icon: CalendarStar, section: "Company" },
  { id: "policy", label: "Company Policy", icon: Scroll, section: "Company" },
  { id: "role-access", label: "Role Access", icon: ShieldCheck, adminOnly: true, section: "Company" },
  { id: "vault", label: "Vault", icon: LockKey, adminOnly: true, section: "Company" },
];

export const ADMIN_NAV_LABELS = Object.fromEntries(allNavItems.map(item => [item.id, item.label]));

// Admin / manager sidebar: logo, notification bell, role-filtered nav, collapse-toggle button, user info
export function AdminSidebar({
  user, logout, api, isAdmin, isManager, rolePerms, notifications, fetchData,
  activeTab, setActiveTab, sidebarCollapsed, toggleSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen
}) {
  const [notifDropdownOpen, setNotifDropdownOpen] = useState(false);

  const navigate = useNavigate();
  const moduleKeys = new Set(PERMISSION_MODULES.map(m => m.key));

  // Admins see everything; others see Overview, Holidays and the modules they were granted View on
  const navItems = allNavItems.filter(item => {
    if (item.managerOnly) return isManager;
    if (isAdmin) return true;
    if (item.id === "holidays") return true; // viewing holidays is open to everyone
    if (moduleKeys.has(item.id)) return canDo(user, item.id, "view");
    return !item.adminOnly;
  });

  // Group the visible items by section, keeping their order
  const navSections = navItems.reduce((groups, item) => {
    const last = groups[groups.length - 1];
    if (last && last.label === item.section) last.items.push(item);
    else groups.push({ label: item.section, items: [item] });
    return groups;
  }, []);

  return (
    <>
      <MobileTopBar mobileSidebarOpen={mobileSidebarOpen} setMobileSidebarOpen={setMobileSidebarOpen} />

      {/* Sidebar */}
      <aside
        className={`app-sidebar fixed left-0 top-0 h-screen flex flex-col z-50 transition-all duration-300 ${sidebarCollapsed ? "w-20" : "w-64"} ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="sidebar-brand">
          <SidebarBrand collapsed={sidebarCollapsed} label={isAdmin ? "Admin Panel" : "Management"} />
          <button
            data-testid="mobile-sidebar-close"
            aria-label="Close menu"
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 flex-shrink-0"
          >
            <XIcon style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Notification Bell */}
        <div className={`px-4 pt-3 pb-1 ${sidebarCollapsed ? "flex justify-center" : ""}`}>
          <button
            data-testid="notification-bell"
            onClick={() => setNotifDropdownOpen(!notifDropdownOpen)}
            className={`relative flex items-center gap-2 text-sm rounded-xl transition-colors ${sidebarCollapsed ? "justify-center w-10 h-10 px-0" : "w-full px-3 py-2"}`}
            style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-subtle)' }}
          >
            <Bell className="h-5 w-5 text-slate-500" weight={notifications.total > 0 ? "fill" : "duotone"} />
            {!sidebarCollapsed && <span className="font-semibold text-[13px]" style={{ color: 'var(--text-secondary)' }}>Notifications</span>}
            {notifications.total > 0 && (
              <span className={`flex items-center justify-center h-5 min-w-[20px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full animate-pulse ${sidebarCollapsed ? "absolute -top-1 -right-1" : "ml-auto"}`}>
                {notifications.total}
              </span>
            )}
          </button>
          {notifDropdownOpen && notifications.items.length > 0 && (
            <div className="mx-2 mt-1 mb-2 rounded-xl shadow-lg overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border-color)' }}>
              {notifications.items.map((item, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setNotifDropdownOpen(false);
                    if (item.type === "leave") setActiveTab("leaves");
                    else if (item.type === "wfh") setActiveTab("wfh");
                    else if (item.type === "cr") setActiveTab("change-requests");
                    else if (item.type === "permission") setActiveTab("permissions");
                  }}
                  className="w-full text-left px-3 py-2.5 text-xs hover:bg-blue-50 border-b last:border-b-0 border-slate-100 flex items-center gap-2"
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    item.type === "leave" ? "bg-amber-400" :
                    item.type === "cr" ? "bg-[#0020F8]" :
                    item.type === "wfh" ? "bg-purple-500" :
                    "bg-orange-500"
                  }`} />
                  <span className="text-slate-700 font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav
          className={`flex-1 px-4 py-3 space-y-0.5 overflow-y-auto ${sidebarCollapsed ? "sidebar-collapsed-nav" : ""}`}
          onClick={() => setMobileSidebarOpen(false)}
        >
          {navSections.map(section => (
            <div key={section.label} className="space-y-0.5">
              <p className="nav-section-label">{section.label}</p>
              {section.items.map((item) => (
                <button
                  key={item.id}
                  data-testid={`nav-${item.id}`}
                  onClick={() => setActiveTab(item.id)}
                  className={activeTab === item.id ? "nav-item-active w-full" : "nav-item w-full"}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon className="flex-shrink-0" weight={activeTab === item.id ? "fill" : "duotone"} style={{ width: 18, height: 18 }} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Collapse Toggle (desktop only) */}
        <SidebarCollapseToggle sidebarCollapsed={sidebarCollapsed} onToggle={toggleSidebarCollapsed} />

        {/* User Info */}
        <div className="sidebar-footer">
          <div className={`sidebar-user ${sidebarCollapsed ? "justify-center" : ""}`}>
            <Avatar url={user?.avatar_url} name={user?.name} size="h-9 w-9" textSize="text-xs" />
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user?.name}</p>
                <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>{isAdmin ? "Administrator" : "Management access"}</p>
              </div>
            )}
          </div>
          <Button
            data-testid="admin-logout-btn"
            onClick={logout}
            variant="outline"
            className={`w-full text-slate-500 hover:text-red-600 hover:border-red-200 border-slate-200 rounded-xl text-sm font-medium h-9 ${sidebarCollapsed ? "justify-center px-0" : "justify-start gap-2"}`}
          >
            <SignOut className="h-4 w-4" />
            {!sidebarCollapsed && "Sign Out"}
          </Button>
          {!isAdmin && (
            <Button
              data-testid="back-to-dashboard-btn"
              onClick={() => navigate("/dashboard")}
              variant="outline"
              className={`w-full mt-2 text-slate-500 border-slate-200 rounded-xl text-sm font-medium h-9 ${sidebarCollapsed ? "justify-center px-0" : "justify-start gap-2"}`}
            >
              <ArrowLeft className="h-4 w-4" />
              {!sidebarCollapsed && "My Dashboard"}
            </Button>
          )}
          {user?.role === "admin" && !sidebarCollapsed && (
            <ResetPortalButton api={api} onDone={() => { fetchData(); }} />
          )}
        </div>
      </aside>
    </>
  );
}
