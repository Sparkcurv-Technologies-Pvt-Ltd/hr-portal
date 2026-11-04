import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { canDo, hasAnyModuleAccess } from "@/lib/permissions";
import {
  SignOut, Clock, House, CalendarCheck, ChartBar, Receipt, CalendarStar, Scroll, Laptop, CurrencyDollar,
  GitPullRequest, TreeStructure, UsersThree, ShieldCheck, ArrowRight, LockKey, Kanban, Handshake, X as XIcon
} from "@phosphor-icons/react";
import { Avatar } from "@/components/common/Avatar";
import { MobileTopBar } from "@/components/common/MobileTopBar";
import { SidebarBrand } from "@/components/common/SidebarBrand";
import { SidebarCollapseToggle } from "@/components/common/SidebarCollapseToggle";

// Nav items grouped into sidebar sections. `userFlag` = user field that must be true (e.g. vault_access), `module` = permission-matrix module the user needs View on, `testId` keeps the existing data-testid attributes.
export const EMPLOYEE_NAV_SECTIONS = [
  {
    label: "Workspace",
    items: [
      { id: "dashboard", label: "Dashboard", icon: House },
      { id: "projects", label: "Projects & Tasks", icon: Kanban, module: "projects", testId: "projects-tab" },
      { id: "client-mgmt", label: "Client Management", icon: Handshake, access: u => !!u?.client_mgmt?.access, testId: "client-mgmt-tab-nav" },
      { id: "summary", label: "Work Summary", icon: ChartBar },
      { id: "wfh", label: "Work From Home", icon: Laptop, testId: "wfh-tab" },
      { id: "change-requests", label: "Change Requests", icon: GitPullRequest, testId: "cr-tab" },
      { id: "vault", label: "Vault", icon: LockKey, userFlag: "vault_access", testId: "vault-tab" },
    ],
  },
  {
    label: "Pay",
    items: [
      { id: "payslips", label: "Payslips", icon: Receipt },
      { id: "salary", label: "My Salary", icon: CurrencyDollar, testId: "salary-tab" },
    ],
  },
  {
    label: "Company",
    items: [
      { id: "holidays", label: "Holidays", icon: CalendarStar, testId: "holidays-tab" },
      { id: "policy", label: "Company Policy", icon: Scroll, testId: "policy-tab" },
      { id: "org-tree", label: "Worker Tree", icon: TreeStructure, testId: "org-tree-tab" },
    ],
  },
  {
    label: "Manager Tools",
    managerOnly: true,
    items: [
      { id: "team", label: "My Team", icon: UsersThree, testId: "team-tab" },
      { id: "team-requests", label: "Team Requests", icon: GitPullRequest, testId: "team-requests-tab" },
      { id: "team-attendance", label: "Team Attendance", icon: Clock, testId: "team-attendance-tab" },
      { id: "team-leave-wfh", label: "Team Leave & WFH", icon: CalendarCheck, testId: "team-leave-wfh-tab" },
    ],
  },
];

export const EMPLOYEE_NAV_LABELS = Object.fromEntries(
  EMPLOYEE_NAV_SECTIONS.flatMap(section => section.items.map(item => [item.id, item.label]))
);

// Employee sidebar: logo, permission-filtered nav (+ manager tools), collapse-toggle button, user info
export function EmployeeSidebar({
  user, logout, isManagerRole,
  activeTab, setActiveTab, sidebarCollapsed, toggleSidebarCollapsed, mobileSidebarOpen, setMobileSidebarOpen
}) {
  const navigate = useNavigate();
  // Only for people explicitly granted module access (employees: only by the superadmin);
  // admins use the Admin Panel directly
  const showManagementLink = user?.role !== "admin" && hasAnyModuleAccess(user);

  const sections = EMPLOYEE_NAV_SECTIONS
    .filter(section => !section.managerOnly || isManagerRole)
    .map(section => ({ ...section, items: section.items.filter(item => (!item.userFlag || user?.[item.userFlag]) && (!item.module || canDo(user, item.module, "view")) && (!item.access || item.access(user))) }))
    .filter(section => section.items.length > 0);

  return (
    <>
      <MobileTopBar mobileSidebarOpen={mobileSidebarOpen} setMobileSidebarOpen={setMobileSidebarOpen} />

      {/* Sidebar */}
      <aside
        className={`app-sidebar fixed left-0 top-0 h-screen flex flex-col z-50 transition-all duration-300 ${sidebarCollapsed ? "w-20" : "w-64"} ${mobileSidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        {/* Logo */}
        <div className="sidebar-brand">
          <SidebarBrand collapsed={sidebarCollapsed} label="Employee Portal" />
          <button
            data-testid="mobile-sidebar-close"
            onClick={() => setMobileSidebarOpen(false)}
            aria-label="Close menu"
            className="lg:hidden flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 flex-shrink-0"
          >
            <XIcon style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Navigation */}
        <nav
          className={`flex-1 px-4 py-4 space-y-0.5 overflow-y-auto ${sidebarCollapsed ? "sidebar-collapsed-nav" : ""}`}
          onClick={() => setMobileSidebarOpen(false)}
        >
          {sections.map(section => (
            <div key={section.label} className="space-y-0.5">
              <p className="nav-section-label">{section.label}</p>
              {section.items.map(item => (
                <button
                  key={item.id}
                  data-testid={item.testId}
                  onClick={() => setActiveTab(item.id)}
                  className={activeTab === item.id ? "nav-item-active w-full" : "nav-item w-full"}
                  title={sidebarCollapsed ? item.label : undefined}
                >
                  <item.icon style={{ width: 18, height: 18, flexShrink: 0 }} weight={activeTab === item.id ? "fill" : "duotone"} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}

          {/* Management panel (modules granted by an admin in Employees → Access) */}
          {showManagementLink && (
            <div className="space-y-0.5">
              <p className="nav-section-label">Management</p>
              <button
                data-testid="management-panel-link"
                onClick={() => navigate("/admin")}
                className="nav-item w-full"
                title={sidebarCollapsed ? "Management Panel" : undefined}
              >
                <ShieldCheck style={{ width: 18, height: 18, flexShrink: 0 }} weight="duotone" />
                <span>Management Panel</span>
                {!sidebarCollapsed && <ArrowRight className="ml-auto" style={{ width: 14, height: 14 }} />}
              </button>
            </div>
          )}
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
                <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }}>
                  {user?.department}
                  {user?.employee_code && <span className="font-mono font-bold text-[#0020F8] tracking-wide">{user?.department ? " · " : ""}{user.employee_code}</span>}
                </p>
              </div>
            )}
          </div>
          <Button
            data-testid="logout-btn"
            onClick={logout}
            variant="outline"
            className={`w-full text-slate-500 hover:text-red-600 hover:border-red-200 border-slate-200 rounded-xl text-sm font-medium h-9 ${sidebarCollapsed ? "justify-center px-0" : "justify-start gap-2"}`}
          >
            <SignOut className="h-4 w-4" />
            {!sidebarCollapsed && "Sign Out"}
          </Button>
        </div>
      </aside>
    </>
  );
}
