import { useState } from "react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useEmployeeDashboardData } from "@/hooks/useEmployeeDashboardData";
import { useSidebarCollapsed } from "@/hooks/useSidebarCollapsed";
import { EmployeeSidebar, EMPLOYEE_NAV_LABELS } from "@/components/employee/EmployeeSidebar";
import { PageHeader } from "@/components/common/PageHeader";
import { DashboardTab } from "@/components/employee/DashboardTab";
import { WorkSummaryTab } from "@/components/employee/WorkSummaryTab";
import { PayslipsTab } from "@/components/employee/PayslipsTab";
import { SalaryTab } from "@/components/employee/SalaryTab";
import { ChangeRequestsTab } from "@/components/employee/ChangeRequestsTab";
import { WfhTab } from "@/components/employee/WfhTab";
import { PolicyTab } from "@/components/employee/PolicyTab";
import { HolidaysTab } from "@/components/employee/HolidaysTab";
import { OrgTreeTab } from "@/components/employee/OrgTreeTab";
import { VaultTab } from "@/components/common/VaultTab";
import { ManagerTeamTab } from "@/components/employee/ManagerTeamTab";
import { ManagerRequestsTab } from "@/components/employee/ManagerRequestsTab";
import { ManagerAttendanceTab } from "@/components/employee/ManagerAttendanceTab";
import { ManagerLeaveWfhTab } from "@/components/employee/ManagerLeaveWfhTab";

export default function EmployeeDashboard() {
  const { user, logout, api } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [sidebarCollapsed, toggleSidebarCollapsed] = useSidebarCollapsed();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Server data (polled every 60s)
  const {
    rolePermissions, orgNodes, orgLevels, leaveBalance, leaveRequests, attendanceHistory,
    permissionBalance, permissionRequests, workingSummary, payslips, holidays, policies,
    wfhBalance, wfhRequests, monthlyLeaveUsage, salaryStructure, myCRs, crTypes, myManager,
    fetchData,
  } = useEmployeeDashboardData(api);

  // Shared "request in flight" flag used by the request forms
  const [loading, setLoading] = useState(false);

  // Request form drafts kept here so they survive switching between tabs
  const [wfhForm, setWfhForm] = useState({ date: null, reason: "" });
  const [crForm, setCrForm] = useState({ title: "", description: "", cr_type: "General", priority: "medium", requested_value: "" });
  const [leaveForm, setLeaveForm] = useState({
    leave_type: "casual",
    start_date: null,
    end_date: null,
    reason: "",
    is_half_day: false
  });
  const [permissionForm, setPermissionForm] = useState({
    duration_minutes: 60,
    reason: "",
    date: format(new Date(), "yyyy-MM-dd")
  });

  const isManagerRole = user?.role === "manager";

  return (
    <div className="min-h-screen transition-colors duration-200" style={{ background: 'var(--bg-page)' }}>
      <EmployeeSidebar
        user={user}
        logout={logout}
        rolePermissions={rolePermissions}
        isManagerRole={isManagerRole}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        sidebarCollapsed={sidebarCollapsed}
        toggleSidebarCollapsed={toggleSidebarCollapsed}
        mobileSidebarOpen={mobileSidebarOpen}
        setMobileSidebarOpen={setMobileSidebarOpen}
      />

      {/* Main Content */}
      <main className={`app-main pt-14 lg:pt-0 ${sidebarCollapsed ? "lg:ml-20" : "lg:ml-64"}`}>
        <PageHeader area="Employee Portal" page={EMPLOYEE_NAV_LABELS[activeTab] || "Dashboard"} user={user} />
        <div className="app-content">
        {activeTab === "dashboard" && (
          <DashboardTab
            user={user}
            api={api}
            leaveBalance={leaveBalance}
            leaveRequests={leaveRequests}
            attendanceHistory={attendanceHistory}
            permissionBalance={permissionBalance}
            permissionRequests={permissionRequests}
            workingSummary={workingSummary}
            monthlyLeaveUsage={monthlyLeaveUsage}
            leaveForm={leaveForm}
            setLeaveForm={setLeaveForm}
            permissionForm={permissionForm}
            setPermissionForm={setPermissionForm}
            loading={loading}
            setLoading={setLoading}
            fetchData={fetchData}
            holidays={holidays}
          />
        )}

        {/* Work Summary Tab */}
        {activeTab === "summary" && workingSummary && (
          <WorkSummaryTab workingSummary={workingSummary} />
        )}

        {/* Payslips Tab */}
        {activeTab === "payslips" && (
          <PayslipsTab api={api} payslips={payslips} />
        )}

        {/* Salary Structure Tab */}
        {activeTab === "salary" && (
          <SalaryTab salaryStructure={salaryStructure} />
        )}

        {/* Change Requests Tab */}
        {activeTab === "change-requests" && (
          <ChangeRequestsTab
            api={api}
            myCRs={myCRs}
            crTypes={crTypes}
            myManager={myManager}
            crForm={crForm}
            setCrForm={setCrForm}
            loading={loading}
            setLoading={setLoading}
            fetchData={fetchData}
          />
        )}

        {/* WFH Tab */}
        {activeTab === "wfh" && (
          <WfhTab
            api={api}
            wfhBalance={wfhBalance}
            wfhRequests={wfhRequests}
            wfhForm={wfhForm}
            setWfhForm={setWfhForm}
            holidays={holidays}
            loading={loading}
            setLoading={setLoading}
            fetchData={fetchData}
          />
        )}

        {/* Company Policy Tab */}
        {activeTab === "policy" && (
          <PolicyTab policies={policies} />
        )}

        {/* Holidays Tab */}
        {activeTab === "holidays" && (
          <HolidaysTab api={api} holidays={holidays} />
        )}

        {activeTab === "vault" && user?.vault_access && (
          <VaultTab api={api} user={user} />
        )}

        {activeTab === "org-tree" && (
          <OrgTreeTab orgNodes={orgNodes} orgLevels={orgLevels} />
        )}

        {/* Manager-only tabs */}
        {activeTab === "team" && isManagerRole && (
          <ManagerTeamTab api={api} />
        )}
        {activeTab === "team-requests" && isManagerRole && (
          <ManagerRequestsTab api={api} />
        )}
        {activeTab === "team-attendance" && isManagerRole && (
          <ManagerAttendanceTab api={api} />
        )}
        {activeTab === "team-leave-wfh" && isManagerRole && (
          <ManagerLeaveWfhTab api={api} />
        )}
        </div>
      </main>
    </div>
  );
}
