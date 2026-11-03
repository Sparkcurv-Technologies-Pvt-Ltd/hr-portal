import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  CalendarCheck, Clock, UserPlus, Trash, PencilSimple, Timer, CurrencyDollar,
  ClockClockwise, Key, Camera, ShieldCheck, WifiNone, WifiHigh, DotsThreeVertical, Users, UserCircleGear, Buildings, HourglassHigh, Bell, BellSlash
} from "@phosphor-icons/react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/components/ui/dropdown-menu";
import { compressImage } from "@/lib/image";
import { Avatar } from "@/components/common/Avatar";
import { useAuth } from "@/contexts/AuthContext";
import { EmailPrefsDialog } from "@/components/admin/EmailPrefsDialog";
import { usePermissions } from "@/hooks/usePermissions";

export function EmployeesTab({
  api, employees, setEmployees, managers, loading, setLoading, fetchData, openLeaveBalanceModal,
  onOpenAccess
}) {
  const { user } = useAuth();
  const { can } = usePermissions();
  const isAdminUser = user?.role === "admin";
  const canEdit = can("employees", "edit");
  const canDelete = can("employees", "delete");
  const canViewSalary = can("payroll", "view");
  const canEditSalary = can("payroll", "edit");
  const showActions = canEdit || canDelete || canEditSalary || isAdminUser;
  const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
  const [editEmployeeOpen, setEditEmployeeOpen] = useState(false);
  const [salaryDialogOpen, setSalaryDialogOpen] = useState(false);

  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [shiftTimes, setShiftTimes] = useState({ start_time: "09:00", end_time: "18:00" });

  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [salaryAmount, setSalaryAmount] = useState("");
  const avatarInputRef = useRef(null);
  const [uploadingAvatarFor, setUploadingAvatarFor] = useState(null);

  const [newEmployee, setNewEmployee] = useState({
    email: "",
    password: "",
    name: "",
    department: "",
    position: "",
    role: "employee",
    employee_code: "",
    date_of_birth: ""
  });

  const [editForm, setEditForm] = useState({
    name: "",
    department: "",
    position: "",
    casual_leave: 0,
    sick_leave: 0,
    permission_hours: 2,
    role: "employee",
    wfh_limit: null,
    employee_code: "",
    date_of_birth: ""
  });

  const handleAddEmployee = async () => {
    if (!newEmployee.email || !newEmployee.password || !newEmployee.name) {
      toast.error("Please fill in required fields");
      return;
    }

    setLoading(true);
    try {
      await api.post("/admin/employees", newEmployee);
      toast.success("Employee added successfully!");
      setAddEmployeeOpen(false);
      setNewEmployee({ email: "", password: "", name: "", department: "", position: "", role: "employee", employee_code: "", date_of_birth: "" });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to add employee");
    } finally {
      setLoading(false);
    }
  };

  const openAddEmployeeModal = async () => {
    try {
      const res = await api.get("/admin/next-employee-code");
      setNewEmployee({ email: "", password: "", name: "", department: "", position: "", role: "employee", employee_code: res.data.next_code || "", date_of_birth: "" });
    } catch {
      setNewEmployee({ email: "", password: "", name: "", department: "", position: "", role: "employee", employee_code: "", date_of_birth: "" });
    }
    setAddEmployeeOpen(true);
  };

  const handleAutoGenerateCode = async (target) => {
    try {
      const res = await api.get("/admin/next-employee-code");
      const code = res.data.next_code || "";
      if (target === "new") setNewEmployee(f => ({ ...f, employee_code: code }));
      else setEditForm(f => ({ ...f, employee_code: code }));
    } catch { /* silent */ }
  };

  const handleEditEmployee = async () => {
    if (!selectedEmployee) return;

    setLoading(true);
    try {
      await api.put(`/admin/employees/${selectedEmployee.id}`, editForm);
      toast.success("Employee updated successfully!");
      setEditEmployeeOpen(false);
      setSelectedEmployee(null);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update employee");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmployee = async (employeeId) => {
    if (!window.confirm("Are you sure you want to delete this employee?")) return;

    try {
      await api.delete(`/admin/employees/${employeeId}`);
      toast.success("Employee deleted");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to delete employee");
    }
  };

  const handleToggleGps = async (emp) => {
    const newVal = !emp.gps_tracking_enabled;
    try {
      await api.put(`/admin/employees/${emp.id}/gps-tracking`, { gps_tracking_enabled: newVal });
      toast.success(`GPS tracking ${newVal ? "enabled" : "disabled"} for ${emp.name}`);
      // Optimistically update local state without full refetch
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, gps_tracking_enabled: newVal } : e));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update GPS tracking");
    }
  };

  const handleToggleTimerAccess = async (emp) => {
    const newVal = !emp.timer_access_enabled;
    try {
      await api.put(`/admin/employees/${emp.id}/timer-access`, { timer_access_enabled: newVal });
      toast.success(`Flexible timer ${newVal ? "enabled" : "disabled"} for ${emp.name}`);
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, timer_access_enabled: newVal } : e));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update timer access");
    }
  };

  // 8-hour rule: on = Logout blocked until the day is complete; off = can log out any time
  const handleToggleFullDayRule = async (emp) => {
    const newVal = emp.full_day_required === false;
    try {
      await api.put(`/admin/employees/${emp.id}/full-day-rule`, { full_day_required: newVal });
      toast.success(`8-hour rule ${newVal ? "on" : "off"} for ${emp.name}`);
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, full_day_required: newVal } : e));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update the 8-hour rule");
    }
  };

  // Email notifications: which kinds of email this person receives (dialog), reflected on the row's bell
  const [emailPrefsEmp, setEmailPrefsEmp] = useState(null);
  const handleEmailPrefsChanged = (id, patch) => setEmployees(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));

  const handleToggleCRApprover = async (emp) => {
    const newVal = !emp.is_cr_approver;
    try {
      await api.put(`/admin/employees/${emp.id}/cr-approver`, { is_cr_approver: newVal });
      toast.success(`${emp.name} ${newVal ? "added to" : "removed from"} CR approvers`);
      setEmployees(prev => prev.map(e => e.id === emp.id ? { ...e, is_cr_approver: newVal } : e));
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update CR approver");
    }
  };

  const handleResetPassword = async () => {
    if (!selectedEmployee || !resetPasswordValue) {
      toast.error("Please enter a new password");
      return;
    }
    if (resetPasswordValue.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      await api.post(`/admin/employees/${selectedEmployee.id}/reset-password`, { new_password: resetPasswordValue });
      toast.success(`Password reset for ${selectedEmployee.name}`);
      setResetPasswordOpen(false);
      setResetPasswordValue("");
      setSelectedEmployee(null);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingAvatarFor) return;
    setLoading(true);
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressed);
      await api.post(`/admin/employees/${uploadingAvatarFor}/avatar`, formData);
      toast.success("Photo uploaded successfully");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to upload photo");
    } finally {
      setLoading(false);
      setUploadingAvatarFor(null);
      e.target.value = "";
    }
  };

  const openEditModal = (employee) => {
    setSelectedEmployee(employee);
    setEditForm({
      name: employee.name,
      department: employee.department || "",
      position: employee.position || "",
      casual_leave: employee.casual_leave ?? null,
      sick_leave: employee.sick_leave ?? null,
      permission_hours: employee.permission_hours ?? null,
      role: employee.role || "employee",
      wfh_limit: employee.wfh_limit ?? null,
      employee_code: employee.employee_code || "",
      reporting_manager_id: employee.reporting_manager_id ?? null,
      date_of_birth: employee.date_of_birth || ""
    });
    setEditEmployeeOpen(true);
  };

  const openSalaryModal = async (employee) => {
    setSelectedEmployee(employee);
    try {
      const { data } = await api.get(`/admin/employees/${employee.id}/salary`);
      setSalaryAmount(data.basic_salary?.toString() || "");
    } catch (error) {
      setSalaryAmount("");
    }
    setSalaryDialogOpen(true);
  };

  const handleSetSalary = async () => {
    if (!salaryAmount || isNaN(parseFloat(salaryAmount))) {
      toast.error("Please enter a valid salary amount");
      return;
    }

    setLoading(true);
    try {
      await api.put(`/admin/employees/${selectedEmployee.id}/salary`, {
        basic_salary: parseFloat(salaryAmount)
      });
      toast.success("Salary updated successfully!");
      setSalaryDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update salary");
    } finally {
      setLoading(false);
    }
  };

  const handleAssignShift = async () => {
    if (!selectedEmployee) return;
    if (!shiftTimes.start_time || !shiftTimes.end_time) {
      toast.error("Please set both start and end times");
      return;
    }
    setLoading(true);
    try {
      const endpoint = selectedEmployee.shift
        ? `/admin/employees/${selectedEmployee.id}/shift/change`
        : `/admin/employees/${selectedEmployee.id}/shift`;
      await api.put(endpoint, shiftTimes);
      toast.success(`Shift set to ${shiftTimes.start_time}–${shiftTimes.end_time}`);
      setShiftDialogOpen(false);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to set shift");
    } finally {
      setLoading(false);
    }
  };

  const openShiftModal = (employee) => {
    setSelectedEmployee(employee);
    // Pre-fill existing shift times if set, otherwise use defaults
    if (employee.shift && employee.shift.includes("-")) {
      const [start, end] = employee.shift.split("-");
      setShiftTimes({ start_time: start.trim(), end_time: end.trim() });
    } else {
      setShiftTimes({ start_time: "09:00", end_time: "18:00" });
    }
    setShiftDialogOpen(true);
  };

  const teamMembers = employees.filter(e => e.role !== "admin");
  const teamCount = teamMembers.length;
  const managerCount = teamMembers.filter(e => e.role === "manager").length;
  const departmentCount = new Set(teamMembers.map(e => (e.department || "").trim()).filter(Boolean)).size;
  const shiftCount = teamMembers.filter(e => e.shift && e.shift.includes("-")).length;

  return (
    <>
      <EmailPrefsDialog open={!!emailPrefsEmp} onOpenChange={(o) => !o && setEmailPrefsEmp(null)} api={api} emp={emailPrefsEmp} onChanged={handleEmailPrefsChanged} />
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Employees</h1>
          <p className="text-slate-500 mt-1 text-sm">Manage your team members</p>
        </div>
        {canEdit && (
        <Dialog open={addEmployeeOpen} onOpenChange={setAddEmployeeOpen}>
          <DialogTrigger asChild>
            <Button data-testid="add-employee-btn" onClick={openAddEmployeeModal} className="bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2 rounded-xl h-10 px-4">
              <UserPlus className="h-4 w-4" weight="bold" />
              Add Employee
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-['Outfit']">Add New Employee</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-500 -mt-2">Enter the details for the new employee.</p>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Full Name *</Label>
                <Input className="rounded-xl h-11"
                  data-testid="new-employee-name"
                  placeholder="John Doe"
                  value={newEmployee.name}
                  onChange={(e) => setNewEmployee({ ...newEmployee, name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Email *</Label>
                <Input className="rounded-xl h-11"
                  data-testid="new-employee-email"
                  type="email"
                  placeholder="john@company.com"
                  value={newEmployee.email}
                  onChange={(e) => setNewEmployee({ ...newEmployee, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Password *</Label>
                <Input className="rounded-xl h-11"
                  data-testid="new-employee-password"
                  type="password"
                  placeholder="Enter password"
                  value={newEmployee.password}
                  onChange={(e) => setNewEmployee({ ...newEmployee, password: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600">Department</Label>
                  <Input className="rounded-xl h-11"
                    data-testid="new-employee-department"
                    placeholder="Engineering"
                    value={newEmployee.department}
                    onChange={(e) => setNewEmployee({ ...newEmployee, department: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600">Position</Label>
                  <Input className="rounded-xl h-11"
                    data-testid="new-employee-position"
                    placeholder="Developer"
                    value={newEmployee.position}
                    onChange={(e) => setNewEmployee({ ...newEmployee, position: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Role</Label>
                <Select value={newEmployee.role} onValueChange={(value) => setNewEmployee({ ...newEmployee, role: value })}>
                  <SelectTrigger data-testid="new-employee-role" className="rounded-xl h-11">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Employee ID</Label>
                <div className="flex gap-2">
                  <Input
                    data-testid="new-employee-code"
                    placeholder="e.g. SC24005"
                    value={newEmployee.employee_code}
                    onChange={(e) => setNewEmployee({ ...newEmployee, employee_code: e.target.value.toUpperCase() })}
                    className="font-mono rounded-xl h-11"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="auto-gen-code-btn"
                    onClick={() => handleAutoGenerateCode("new")}
                    className="shrink-0 h-11 rounded-xl border-[#0020F8] text-[#0020F8] hover:bg-[#0020F8] hover:text-white text-xs font-semibold px-4"
                  >
                    Auto
                  </Button>
                </div>
                <p className="text-[11px] text-slate-400">Leave blank to auto-assign next ID</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Date of Birth (optional)</Label>
                <Input className="rounded-xl h-11"
                  data-testid="new-employee-dob"
                  type="date"
                  value={newEmployee.date_of_birth}
                  onChange={(e) => setNewEmployee({ ...newEmployee, date_of_birth: e.target.value })}
                />
              </div>
              <Button
                data-testid="submit-new-employee"
                onClick={handleAddEmployee}
                disabled={loading}
                className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]"
              >
                Add Employee
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </div>

      {/* Employees Table */}
      <input
        type="file"
        ref={avatarInputRef}
        className="hidden"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleAvatarUpload}
      />
      {/* Team summary */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 mb-6">
        {[
          { label: "Team Members", value: teamCount, sub: `${employees.length} accounts incl. admins`, icon: Users, tone: "tone-blue" },
          { label: "Managers", value: managerCount, sub: `${teamCount - managerCount} employee${teamCount - managerCount === 1 ? "" : "s"}`, icon: UserCircleGear, tone: "tone-violet" },
          { label: "Departments", value: departmentCount, sub: departmentCount ? "Across the team" : "None assigned yet", icon: Buildings, tone: "tone-teal" },
          { label: "Shift Assigned", value: shiftCount, sub: `${Math.max(teamCount - shiftCount, 0)} without fixed hours`, icon: Clock, tone: "tone-amber" },
        ].map(({ label, value, sub, icon: Icon, tone }) => (
          <div key={label} className="stat-card">
            <div className="stat-top">
              <span className="stat-label">{label}</span>
              <span className={`stat-icon ${tone}`}><Icon className="h-5 w-5" weight="duotone" /></span>
            </div>
            <div>
              <p className="stat-value">{value}</p>
              <p className="stat-sub mt-1">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <h2 className="text-base font-bold font-['Outfit'] text-slate-900">Team directory</h2>
            <p className="text-xs text-slate-500 mt-0.5">{employees.length} member{employees.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Employee</th>
              <th className="table-header">Department</th>
              <th className="table-header">Shift</th>
              {canViewSalary && <th className="table-header">Salary</th>}
              <th className="table-header">Role</th>
              {showActions && <th className="table-header">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {employees.map((emp) => (
              <tr key={emp.id} className="table-row">
                <td className="table-cell">
                  <div className="flex items-center gap-3">
                    <div className="relative group">
                      <Avatar url={emp.avatar_url} name={emp.name} />
                      {emp.role !== "admin" && canEdit && (
                        <button
                          data-testid={`upload-avatar-${emp.id}`}
                          onClick={() => {
                            setUploadingAvatarFor(emp.id);
                            avatarInputRef.current?.click();
                          }}
                          className="absolute -bottom-1 -right-1 bg-[#0020F8] text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Upload Photo"
                        >
                          <Camera className="h-3 w-3" weight="bold" />
                        </button>
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900 text-sm">{emp.name}</p>
                      <p className="text-xs text-slate-400">{emp.email}</p>
                    </div>
                  </div>
                </td>
                <td className="table-cell" style={{ color: "var(--text-muted)" }}>{emp.department || <span className="text-slate-400">—</span>}</td>
                <td className="table-cell">
                  {emp.shift && emp.shift.includes("-") ? (
                    <span className="chip tone-blue whitespace-nowrap tabular-nums">
                      <Clock className="h-3 w-3" weight="bold" />{emp.shift}
                    </span>
                  ) : (
                    <span className="text-slate-400 text-xs">Not set</span>
                  )}
                </td>
                {canViewSalary && (
                <td className="table-cell">
                  {emp.basic_salary ? (
                    <span className="font-semibold tabular-nums whitespace-nowrap text-slate-900">₹{emp.basic_salary.toLocaleString()}</span>
                  ) : (
                    <span className="text-slate-400 text-xs">Not set</span>
                  )}
                </td>
                )}
                <td className="table-cell">
                  <span className={`chip capitalize ${
                    emp.role === "admin" ? "tone-blue"
                    : emp.role === "manager" ? "tone-violet"
                    : ""
                  }`}>
                    {emp.role}
                  </span>
                </td>
                {showActions && (
                <td className="table-cell">
                  <div className="flex items-center gap-1 flex-nowrap">
                    {emp.role !== "admin" && (
                      <>
                        {/* Secondary actions in a dropdown */}
                        {(canEdit || canEditSalary) && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100"
                              title="More actions"
                            >
                              <DotsThreeVertical className="h-4 w-4" weight="bold" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            {canEdit && (
                            <DropdownMenuItem onClick={() => openShiftModal(emp)} className="gap-2 cursor-pointer">
                              <ClockClockwise className="h-4 w-4 text-slate-500" />
                              Assign Shift
                            </DropdownMenuItem>
                            )}
                            {canEditSalary && (
                            <DropdownMenuItem onClick={() => openSalaryModal(emp)} className="gap-2 cursor-pointer">
                              <CurrencyDollar className="h-4 w-4 text-slate-500" />
                              Set Salary
                            </DropdownMenuItem>
                            )}
                            {canEdit && (
                            <>
                            <DropdownMenuItem onClick={() => openLeaveBalanceModal(emp)} className="gap-2 cursor-pointer">
                              <CalendarCheck className="h-4 w-4 text-slate-500" />
                              Edit Leave Balance
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => { setSelectedEmployee(emp); setResetPasswordValue(""); setResetPasswordOpen(true); }}
                              className="gap-2 cursor-pointer"
                            >
                              <Key className="h-4 w-4 text-slate-500" />
                              Reset Password
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleToggleCRApprover(emp)}
                              className="gap-2 cursor-pointer"
                            >
                              <ShieldCheck className={`h-4 w-4 ${emp.is_cr_approver ? 'text-amber-500' : 'text-slate-400'}`} weight={emp.is_cr_approver ? "fill" : "regular"} />
                              {emp.is_cr_approver ? "Remove from CR Approvers" : "Add as CR Approver"}
                            </DropdownMenuItem>
                            </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                        )}

                        {canEdit && (
                        <>
                        {/* GPS toggle */}
                        <button
                          data-testid={`gps-toggle-${emp.id}`}
                          onClick={() => handleToggleGps(emp)}
                          title={emp.gps_tracking_enabled !== false ? "GPS ON — click to disable" : "GPS OFF — click to enable"}
                          className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-all cursor-pointer ${emp.gps_tracking_enabled !== false ? 'bg-[var(--badge-green-bg)] text-[color:var(--badge-green-text)] border-[color:var(--badge-green-border)] hover:brightness-95' : 'bg-transparent text-slate-400 border-slate-200 hover:bg-slate-100'}`}
                        >
                          {emp.gps_tracking_enabled !== false
                            ? <WifiHigh className="h-4 w-4" weight="bold" />
                            : <WifiNone className="h-4 w-4" weight="bold" />
                          }
                        </button>

                        {/* Timer toggle */}
                        <button
                          data-testid={`timer-toggle-${emp.id}`}
                          onClick={() => handleToggleTimerAccess(emp)}
                          title={emp.timer_access_enabled ? "Timer ON — click to disable" : "Timer OFF — click to enable"}
                          className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-all cursor-pointer ${emp.timer_access_enabled ? 'tone-violet bg-[var(--tone-bg)] text-[color:var(--tone)] border-[color:var(--tone)] hover:brightness-95' : 'bg-transparent text-slate-400 border-slate-200 hover:bg-slate-100'}`}
                        >
                          <Timer className="h-4 w-4" weight={emp.timer_access_enabled ? "bold" : "regular"} />
                        </button>

                        {/* 8-hour Logout rule toggle */}
                        <button
                          data-testid={`full-day-toggle-${emp.id}`}
                          onClick={() => handleToggleFullDayRule(emp)}
                          title={emp.full_day_required !== false ? "8-hour rule ON — Logout blocked until 8h. Click to turn off" : "8-hour rule OFF — can log out any time. Click to turn on"}
                          className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-all cursor-pointer ${emp.full_day_required !== false ? 'tone-blue bg-[var(--tone-bg)] text-[color:var(--tone)] border-[color:var(--tone)] hover:brightness-95' : 'bg-transparent text-slate-400 border-slate-200 hover:bg-slate-100'}`}
                        >
                          <HourglassHigh className="h-4 w-4" weight={emp.full_day_required !== false ? "bold" : "regular"} />
                        </button>

                        {/* Email notifications: opens the per-module dialog */}
                        {(() => {
                          const allOff = emp.email_notifications === false;
                          const partial = !allOff && (emp.email_muted_modules || []).length > 0;
                          return (
                            <button
                              data-testid={`email-toggle-${emp.id}`}
                              onClick={() => setEmailPrefsEmp(emp)}
                              title={allOff ? "Email notifications OFF — click to choose" : partial ? `Some emails off (${emp.email_muted_modules.length}) — click to choose` : "Email notifications ON — click to choose"}
                              className={`h-8 w-8 flex items-center justify-center rounded-lg border transition-all cursor-pointer ${allOff ? 'bg-transparent text-slate-400 border-slate-200 hover:bg-slate-100' : partial ? 'tone-amber bg-[var(--tone-bg)] text-[color:var(--tone)] border-[color:var(--tone)] hover:brightness-95' : 'tone-green bg-[var(--tone-bg)] text-[color:var(--tone)] border-[color:var(--tone)] hover:brightness-95'}`}
                            >
                              {allOff ? <BellSlash className="h-4 w-4" /> : <Bell className="h-4 w-4" weight="bold" />}
                            </button>
                          );
                        })()}
                        </>
                        )}
                      </>
                    )}

                    {/* Edit */}
                    {canEdit && (
                    <Button
                      data-testid={`edit-employee-${emp.id}`}
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(emp)}
                      className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[#0020F8] hover:bg-[var(--brand-primary-light)]"
                      title="Edit Employee"
                    >
                      <PencilSimple className="h-4 w-4" />
                    </Button>
                    )}

                    {/* Management access: any admin for managers, only the superadmin for employees */}
                    {isAdminUser && (emp.role === "manager" || (emp.role === "employee" && user?.is_superadmin)) && (
                      <Button
                        data-testid={`access-btn-${emp.id}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenAccess?.(emp)}
                        className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[#0020F8] hover:bg-[var(--brand-primary-light)]"
                        title="Access permissions"
                      >
                        <ShieldCheck className="h-4 w-4" />
                      </Button>
                    )}

                    {/* Delete */}
                    {emp.role !== "admin" && canDelete && (
                      <Button
                        data-testid={`delete-employee-${emp.id}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteEmployee(emp.id)}
                        className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[color:var(--badge-red-text)] hover:bg-[var(--badge-red-bg)]"
                        title="Delete Employee"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Edit Employee Dialog */}
      <Dialog open={editEmployeeOpen} onOpenChange={setEditEmployeeOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Edit Employee</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 -mt-2">Update employee information and leave balances.</p>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Full Name</Label>
              <Input className="rounded-xl h-11"
                data-testid="edit-employee-name"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Department</Label>
                <Input className="rounded-xl h-11"
                  data-testid="edit-employee-department"
                  value={editForm.department}
                  onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Position</Label>
                <Input className="rounded-xl h-11"
                  data-testid="edit-employee-position"
                  value={editForm.position}
                  onChange={(e) => setEditForm({ ...editForm, position: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Casual Leave</Label>
                <Input className="rounded-xl h-11"
                  data-testid="edit-casual-leave"
                  type="number"
                  placeholder="Not set"
                  value={editForm.casual_leave ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, casual_leave: e.target.value === "" ? null : parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Sick Leave</Label>
                <Input className="rounded-xl h-11"
                  data-testid="edit-sick-leave"
                  type="number"
                  placeholder="Not set"
                  value={editForm.sick_leave ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, sick_leave: e.target.value === "" ? null : parseFloat(e.target.value) })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">WFH Limit (days/month)</Label>
                <Input className="rounded-xl h-11"
                  data-testid="edit-wfh-limit"
                  type="number"
                  value={editForm.wfh_limit ?? ""}
                  onChange={(e) => setEditForm({ ...editForm, wfh_limit: e.target.value === "" ? null : parseInt(e.target.value) || null })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Role</Label>
              <Select value={editForm.role} onValueChange={(value) => setEditForm({ ...editForm, role: value })}>
                <SelectTrigger data-testid="edit-role" className="rounded-xl h-11">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="employee">Employee</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Reporting Manager</Label>
              <Select
                value={editForm.reporting_manager_id ? String(editForm.reporting_manager_id) : "none"}
                onValueChange={(value) => setEditForm({ ...editForm, reporting_manager_id: value === "none" ? null : parseInt(value) })}
              >
                <SelectTrigger data-testid="edit-reporting-manager" className="rounded-xl h-11">
                  <SelectValue placeholder="Select reporting manager" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {managers.filter(m => m.id !== selectedEmployee?.id).map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name} ({m.role.charAt(0).toUpperCase() + m.role.slice(1)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Employee ID</Label>
              <div className="flex gap-2">
                <Input
                  data-testid="edit-employee-code"
                  placeholder="e.g. SC24005"
                  value={editForm.employee_code}
                  onChange={(e) => setEditForm({ ...editForm, employee_code: e.target.value.toUpperCase() })}
                  className="font-mono rounded-xl h-11"
                />
                <Button
                  type="button"
                  variant="outline"
                  data-testid="auto-gen-edit-code-btn"
                  onClick={() => handleAutoGenerateCode("edit")}
                  className="shrink-0 h-11 rounded-xl border-[#0020F8] text-[#0020F8] hover:bg-[#0020F8] hover:text-white text-xs font-semibold px-4"
                >
                  Auto
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Date of Birth (optional)</Label>
              <Input className="rounded-xl h-11"
                data-testid="edit-employee-dob"
                type="date"
                value={editForm.date_of_birth || ""}
                onChange={(e) => setEditForm({ ...editForm, date_of_birth: e.target.value })}
              />
            </div>
            <Button
              data-testid="save-employee-changes"
              onClick={handleEditEmployee}
              disabled={loading}
              className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]"
            >
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Salary Dialog */}
      <Dialog open={salaryDialogOpen} onOpenChange={setSalaryDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Set Employee Salary</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 -mt-2">
            Set monthly basic salary for {selectedEmployee?.name}
          </p>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Basic Salary (₹)</Label>
              <Input className="rounded-xl h-11"
                data-testid="salary-amount-input"
                type="number"
                placeholder="50000"
                value={salaryAmount}
                onChange={(e) => setSalaryAmount(e.target.value)}
              />
            </div>
            <Button
              data-testid="save-salary-btn"
              onClick={handleSetSalary}
              disabled={loading}
              className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]"
            >
              Save Salary
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fixed Time Dialog */}
      <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">
              {selectedEmployee?.shift ? "Update Work Hours" : "Set Work Hours"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 -mt-2">
            {selectedEmployee?.shift
              ? `Update fixed shift times for ${selectedEmployee?.name} (currently: ${selectedEmployee?.shift})`
              : `Set fixed start & end times for ${selectedEmployee?.name}`}
          </p>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Start Time</Label>
                <Input
                  data-testid="shift-start-time"
                  type="time"
                  value={shiftTimes.start_time}
                  onChange={(e) => setShiftTimes(t => ({ ...t, start_time: e.target.value }))}
                  className="h-11 rounded-xl text-base"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">End Time</Label>
                <Input
                  data-testid="shift-end-time"
                  type="time"
                  value={shiftTimes.end_time}
                  onChange={(e) => setShiftTimes(t => ({ ...t, end_time: e.target.value }))}
                  className="h-11 rounded-xl text-base"
                />
              </div>
            </div>
            {shiftTimes.start_time && shiftTimes.end_time && (
              <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl border" style={{ background: "var(--brand-primary-light)", borderColor: "color-mix(in srgb, var(--brand-primary) 18%, transparent)" }}>
                <Clock className="h-4 w-4 text-[#0020F8]" weight="duotone" />
                <span className="text-sm font-semibold text-[#0020F8]">
                  {shiftTimes.start_time} – {shiftTimes.end_time}
                </span>
                <span className="text-xs text-slate-500 ml-auto">
                  8 hrs minimum required
                </span>
              </div>
            )}
            <Button
              data-testid="assign-shift-btn"
              onClick={handleAssignShift}
              disabled={loading}
              className="w-full h-11 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl"
            >
              {selectedEmployee?.shift ? "Update Work Hours" : "Set Work Hours"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-['Outfit'] flex items-center gap-2">
              <span className="stat-icon tone-amber" style={{ width: 34, height: 34, borderRadius: 10 }}><Key className="h-[18px] w-[18px]" weight="duotone" /></span>
              Reset Password
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 -mt-2">
            Set a new password for <strong>{selectedEmployee?.name}</strong>
          </p>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">New Password</Label>
              <Input className="rounded-xl h-11"
                data-testid="reset-password-input"
                type="password"
                placeholder="Enter new password (min 6 chars)"
                value={resetPasswordValue}
                onChange={(e) => setResetPasswordValue(e.target.value)}
              />
            </div>
            <Button
              data-testid="reset-password-submit-btn"
              onClick={handleResetPassword}
              disabled={loading}
              className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]"
            >
              Reset Password
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
