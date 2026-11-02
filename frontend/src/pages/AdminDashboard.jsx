import { useState } from "react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminDashboardData } from "@/hooks/useAdminDashboardData";
import { useNotifications } from "@/hooks/useNotifications";
import { useAttendanceHeatmap } from "@/hooks/useAttendanceHeatmap";
import { useLeaveBalanceEditor } from "@/hooks/useLeaveBalanceEditor";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { AdminSidebar, ADMIN_NAV_LABELS } from "@/components/admin/AdminSidebar";
import { PageHeader } from "@/components/common/PageHeader";
import { MyAttendanceTab } from "@/components/admin/MyAttendanceTab";
import { IncomeExpenseTab } from "@/components/admin/IncomeExpenseTab";
import { OverviewTab } from "@/components/admin/OverviewTab";
import { EmployeesTab } from "@/components/admin/EmployeesTab";
import { PayrollTab } from "@/components/admin/PayrollTab";
import { ChangeRequestsTab } from "@/components/admin/ChangeRequestsTab";
import { LeaveRequestsTab } from "@/components/admin/LeaveRequestsTab";
import { WfhRequestsTab } from "@/components/admin/WfhRequestsTab";
import { AttendanceTab } from "@/components/admin/AttendanceTab";
import { PermissionRequestsTab } from "@/components/admin/PermissionRequestsTab";
import { HolidaysTab } from "@/components/admin/HolidaysTab";
import { PolicyTab } from "@/components/admin/PolicyTab";
import { OrgChartTab } from "@/components/admin/OrgChartTab";
import { RoleAccessTab } from "@/components/admin/RoleAccessTab";
import { LeaveBalanceDialog } from "@/components/admin/LeaveBalanceDialog";
import { AccessDialog } from "@/components/admin/AccessDialog";
import { VaultTab } from "@/components/common/VaultTab";
import { usePermissions } from "@/hooks/usePermissions";

export default function AdminDashboard() {
  const { user, logout, api } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");
  const [sidebarCollapsed, toggleSidebarCollapsed] = useSidebarCollapsed();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { can } = usePermissions();
  // Employee whose module access is being edited (Employees → shield button)
  const [accessEmp, setAccessEmp] = useState(null);

  // Date shown on the attendance location map (also used by the 60s refresh)
  const [locationDate, setLocationDate] = useState(new Date().toISOString().split("T")[0]);

  // Server data (polled every 60s) + notifications (polled every 30s) + heatmap
  const {
    analytics, employees, setEmployees, managers, leaveRequests, permissionRequests, attendance,
    payslips, holidays, policies, wfhRequests, payrollSummary, changeRequests,
    locationData, setLocationData, officeSettings, setOfficeSettings, officeForm, setOfficeForm,
    orgNodes, setOrgNodes, orgLevels, setOrgLevels, rolePerms, setRolePerms,
    salaryComponents, setSalaryComponents, componentsForm, setComponentsForm,
    fetchData,
  } = useAdminDashboardData(api, user, locationDate);
  const notifications = useNotifications(api);
  const heatmapData = useAttendanceHeatmap(api);

  // Shared "request in flight" flag used by most admin forms
  const [loading, setLoading] = useState(false);

  // Tab UI state kept here so it survives switching between tabs
  const [payrollSubTab, setPayrollSubTab] = useState("dashboard");
  const [deductionForm, setDeductionForm] = useState({ deduction_name: "", amount: 0, is_percentage: false, percentage: 0 });
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [bulkMonth, setBulkMonth] = useState(new Date().getMonth() + 1);
  const [bulkYear, setBulkYear] = useState(new Date().getFullYear());
  const [payslipForm, setPayslipForm] = useState({
    employee_id: "",
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear()
  });
  const [editingComponents, setEditingComponents] = useState(false);
  const [payslipFilterEmp, setPayslipFilterEmp] = useState("");
  const [payslipFilterMonth, setPayslipFilterMonth] = useState(0);
  const [payslipFilterYear, setPayslipFilterYear] = useState(0);
  const [exportForm, setExportForm] = useState({
    start_date: format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), "yyyy-MM-dd"),
    end_date: format(new Date(), "yyyy-MM-dd"),
    employee_id: ""
  });
  const [attendanceView, setAttendanceView] = useState("table");
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [rolePermsLoading, setRolePermsLoading] = useState(false);

  // Leave balance dialog (opened from the Employees table, rendered at page level)
  const {
    leaveBalanceOpen, setLeaveBalanceOpen, leaveBalanceForm, setLeaveBalanceForm, leaveBalanceEmp,
    openLeaveBalanceModal, handleSaveLeaveBalance,
  } = useLeaveBalanceEditor(api, fetchData, setLoading);

  const isAdmin = user?.role === "admin";
  const isManager = ["manager"].includes(user?.role);

  return (
    <div className="min-h-screen transition-colors duration-200" style={{ background: 'var(--bg-page)' }}>
      <AdminSidebar
        user={user}
        logout={logout}
        api={api}
        isAdmin={isAdmin}
        isManager={isManager}
        rolePerms={rolePerms}
        notifications={notifications}
        fetchData={fetchData}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sidebarCollapsed={sidebarCollapsed}
        toggleSidebarCollapsed={toggleSidebarCollapsed}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
      />

      {/* Main Content */}
      <main className={`app-main pt-14 lg:pt-0 ${sidebarCollapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <PageHeader area={isAdmin ? "Admin Panel" : "Management"} page={ADMIN_NAV_LABELS[activeTab] || "Overview"} user={user} />
        <div className="app-content">
        {/* My Attendance Tab (Manager clock in/out) */}
        {activeTab === "my-attendance" && isManager && (
          <MyAttendanceTab api={api} user={user} />
        )}

        {/* Income & Expense Tab (Admin only) */}
        {activeTab === "finance" && can("finance") && (
          <IncomeExpenseTab api={api} />
        )}

        {/* Overview Tab */}
        {activeTab === "overview" && analytics && (
          <OverviewTab analytics={analytics} api={api} heatmapData={heatmapData} />
        )}

        {/* Employees Tab */}
        {activeTab === "employees" && can("employees") && (
          <EmployeesTab
            api={api}
            onOpenAccess={setAccessEmp}
            employees={employees}
            setEmployees={setEmployees}
            managers={managers}
            loading={loading}
            setLoading={setLoading}
            fetchData={fetchData}
            openLeaveBalanceModal={openLeaveBalanceModal}
          />
        )}

        {/* Payroll Tab */}
        {activeTab === "payroll" && can("payroll") && (
          <PayrollTab
            api={api}
            employees={employees}
            payslips={payslips}
            payrollSummary={payrollSummary}
            salaryComponents={salaryComponents}
            setSalaryComponents={setSalaryComponents}
            componentsForm={componentsForm}
            setComponentsForm={setComponentsForm}
            loading={loading}
            setLoading={setLoading}
            fetchData={fetchData}
            payrollSubTab={payrollSubTab}
            setPayrollSubTab={setPayrollSubTab}
            payslipFilterEmp={payslipFilterEmp}
            setPayslipFilterEmp={setPayslipFilterEmp}
            payslipFilterMonth={payslipFilterMonth}
            setPayslipFilterMonth={setPayslipFilterMonth}
            payslipFilterYear={payslipFilterYear}
            setPayslipFilterYear={setPayslipFilterYear}
            bulkMonth={bulkMonth}
            setBulkMonth={setBulkMonth}
            bulkYear={bulkYear}
            setBulkYear={setBulkYear}
            bulkProcessing={bulkProcessing}
            setBulkProcessing={setBulkProcessing}
            payslipForm={payslipForm}
            setPayslipForm={setPayslipForm}
            editingComponents={editingComponents}
            setEditingComponents={setEditingComponents}
            deductionForm={deductionForm}
            setDeductionForm={setDeductionForm}
          />
        )}

        {/* Change Requests Tab */}
        {activeTab === "change-requests" && can("change-requests") && (
          <ChangeRequestsTab
            api={api}
            changeRequests={changeRequests}
            isAdmin={isAdmin || can("change-requests")}
            isManager={isManager}
            fetchData={fetchData}
          />
        )}

        {/* Leave Requests Tab */}
        {activeTab === "leaves" && can("leaves") && (
          <LeaveRequestsTab api={api} leaveRequests={leaveRequests} fetchData={fetchData} />
        )}

        {/* WFH Requests Tab */}
        {activeTab === "wfh" && can("wfh") && (
          <WfhRequestsTab api={api} wfhRequests={wfhRequests} fetchData={fetchData} />
        )}

        {/* Attendance Tab */}
        {activeTab === "attendance" && can("attendance") && (
          <AttendanceTab
            api={api}
            attendance={attendance}
            employees={employees}
            isAdmin={isAdmin}
            loading={loading}
            setLoading={setLoading}
            locationData={locationData}
            setLocationData={setLocationData}
            officeSettings={officeSettings}
            setOfficeSettings={setOfficeSettings}
            officeForm={officeForm}
            setOfficeForm={setOfficeForm}
            attendanceView={attendanceView}
            setAttendanceView={setAttendanceView}
            locationDate={locationDate}
            setLocationDate={setLocationDate}
            exportForm={exportForm}
            setExportForm={setExportForm}
            detectingLocation={detectingLocation}
            setDetectingLocation={setDetectingLocation}
          />
        )}

        {/* Permissions Tab */}
        {activeTab === "permissions" && can("permissions") && (
          <PermissionRequestsTab api={api} permissionRequests={permissionRequests} fetchData={fetchData} />
        )}

        {/* Holidays Tab */}
        {activeTab === "holidays" && (
          <HolidaysTab api={api} holidays={holidays} fetchData={fetchData} />
        )}

        {/* Company Policy Tab */}
        {activeTab === "policy" && can("policy") && (
          <PolicyTab
            api={api}
            policies={policies}
            isAdmin={isAdmin}
            loading={loading}
            setLoading={setLoading}
            fetchData={fetchData}
          />
        )}

        {/* ── Worker Tree (Org Chart) Tab ─────────────────────────────────── */}
        {activeTab === "org-chart" && can("org-chart") && (
          <OrgChartTab
            api={api}
            isAdmin={isAdmin}
            orgNodes={orgNodes}
            setOrgNodes={setOrgNodes}
            orgLevels={orgLevels}
            setOrgLevels={setOrgLevels}
            loading={loading}
            setLoading={setLoading}
          />
        )}

        {/* Module access editor (admins only, opened from the Employees table) */}
        {isAdmin && (
          <AccessDialog api={api} employee={accessEmp} open={!!accessEmp} onOpenChange={(o) => { if (!o) setAccessEmp(null); }} />
        )}

        {/* Global Leave Balance Dialog (accessible from employee table) */}
        {activeTab !== "org-chart" && (
          <LeaveBalanceDialog open={leaveBalanceOpen} onOpenChange={setLeaveBalanceOpen} employee={leaveBalanceEmp} form={leaveBalanceForm} setForm={setLeaveBalanceForm} onSave={handleSaveLeaveBalance} loading={loading} />
        )}

        {/* ── Role Access Tab ─────────────────────────────────────────────── */}
        {activeTab === "vault" && isAdmin && (
          <VaultTab api={api} user={user} />
        )}

        {activeTab === "role-access" && isAdmin && (
          <RoleAccessTab
            api={api}
            rolePerms={rolePerms}
            setRolePerms={setRolePerms}
            rolePermsLoading={rolePermsLoading}
            setRolePermsLoading={setRolePermsLoading}
          />
        )}
        </div>
      </main>
    </div>
  );
}
