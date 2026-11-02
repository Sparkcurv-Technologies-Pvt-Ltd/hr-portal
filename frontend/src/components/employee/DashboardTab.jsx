import { useState } from "react";
import { holidayDateSet, isOffDay } from "@/lib/workdays";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  CalendarBlank, TreePalm, Heartbeat, ClockCounterClockwise, CalendarCheck,
  CaretDown, Hourglass, Warning, Timer, CurrencyCircleDollar, Clock
} from "@phosphor-icons/react";
import { TimeTrackerCard } from "@/components/common/TimeTrackerCard";
import { TeamEventsWidget } from "@/components/common/TeamEventsWidget";
import { formatHours } from "@/lib/format";
import { getStatusBadge } from "@/components/common/StatusBadge";
import { StatCard, SectionHeader, EmptyState } from "@/components/employee/EmployeeUi";
import { HoursChart } from "@/components/employee/HoursChart";

export function DashboardTab({
  user, api, leaveBalance, leaveRequests, attendanceHistory, permissionBalance,
  permissionRequests, workingSummary, monthlyLeaveUsage, leaveForm, setLeaveForm, permissionForm,
  setPermissionForm, loading, setLoading, fetchData, holidays
}) {
  const offDays = holidayDateSet(holidays);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);

  const handleLeaveRequest = async () => {
    if (!leaveForm.start_date || !leaveForm.reason) {
      toast.error("Please fill in all fields");
      return;
    }
    if (!leaveForm.is_half_day && !leaveForm.end_date) {
      toast.error("Please select an end date");
      return;
    }

    setLoading(true);
    try {
      await api.post("/leave/request", {
        leave_type: leaveForm.leave_type,
        start_date: format(leaveForm.start_date, "yyyy-MM-dd"),
        end_date: format(leaveForm.is_half_day ? leaveForm.start_date : leaveForm.end_date, "yyyy-MM-dd"),
        reason: leaveForm.reason,
        is_half_day: leaveForm.is_half_day
      });
      toast.success("Leave request submitted!");
      setLeaveDialogOpen(false);
      setLeaveForm({ leave_type: "casual", start_date: null, end_date: null, reason: "", is_half_day: false });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit leave request");
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionRequest = async () => {
    if (!permissionForm.reason || !permissionForm.date) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      await api.post("/permission/request", permissionForm);
      toast.success("Permission request submitted!");
      setPermissionDialogOpen(false);
      setPermissionForm({ duration_minutes: 60, reason: "", date: format(new Date(), "yyyy-MM-dd") });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit permission request");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelLeave = async (leaveId) => {
    try {
      await api.delete(`/leave/${leaveId}`);
      toast.success("Leave request cancelled");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to cancel leave request");
    }
  };

  const handleCancelPermission = async (permissionId) => {
    try {
      await api.delete(`/permission/${permissionId}`);
      toast.success("Permission request cancelled");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to cancel permission request");
    }
  };

  // ----- Display-only values derived from props (no new data) -----
  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Morning' : now.getHours() < 18 ? 'Afternoon' : 'Evening';
  const todayKey = format(now, "yyyy-MM-dd");
  const todayRecord = attendanceHistory.find((r) => String(r.date).slice(0, 10) === todayKey);
  const leaveLeft = [leaveBalance.casual, leaveBalance.sick].some((v) => v !== null && v !== undefined)
    ? (Number(leaveBalance.casual) || 0) + (Number(leaveBalance.sick) || 0)
    : null;
  const pendingCount = leaveRequests.filter((r) => r.status === "pending").length + permissionRequests.filter((r) => r.status === "pending").length;
  const todayChip = !todayRecord
    ? "Not logged in yet"
    : todayRecord.clock_out
      ? `Logged out · ${todayRecord.working_hours ? formatHours(todayRecord.working_hours) : "done"}`
      : `Logged in since ${format(new Date(todayRecord.clock_in), "h:mm a")}`;
  const inputCls = "h-11 rounded-xl";
  const labelCls = "text-sm font-semibold text-slate-700";
  const primaryBtnCls = "w-full h-11 rounded-xl bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] font-semibold";

  return (
    <>
      {/* Hero */}
      <div className="hero-banner mb-6" data-testid="employee-hero">
        <div className="grid gap-5 lg:flex lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="hero-sub text-sm font-medium">{format(now, "EEEE, MMMM d, yyyy")}</p>
            <h1 className="font-bold font-['Outfit'] tracking-tight mt-1">
              Good {greeting}, {user?.name?.split(' ')[0]}
            </h1>
            <p className="hero-sub text-sm mt-1.5">Here's your workday at a glance.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="hero-chip" data-testid="hero-chip-today">
              <Clock className="h-3.5 w-3.5" weight="bold" /> {todayChip}
            </span>
            <span className="hero-chip" data-testid="hero-chip-leave">
              <TreePalm className="h-3.5 w-3.5" weight="bold" /> {leaveLeft === null ? "Leave not set" : `${leaveLeft} leave day${leaveLeft === 1 ? "" : "s"} left`}
            </span>
            {pendingCount > 0 && (
              <span className="hero-chip" data-testid="hero-chip-pending">
                <Hourglass className="h-3.5 w-3.5" weight="bold" /> {pendingCount} pending request{pendingCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </div>

      <TeamEventsWidget api={api} />

      {/* Working Hours Alert */}
      {workingSummary && workingSummary.short_days_count > 0 && (
        <div
          className="tone-amber mb-6 p-4 rounded-2xl flex items-center gap-3"
          style={{ background: 'var(--badge-amber-bg)', border: '1px solid var(--badge-amber-border)' }}
        >
          <span className="stat-icon tone-amber" style={{ width: 38, height: 38, borderRadius: 12 }}>
            <Warning className="h-5 w-5" weight="duotone" />
          </span>
          <div>
            <p className="font-semibold text-slate-900 text-sm">
              You have {workingSummary.short_days_count} short working day(s) this month
            </p>
            <p className="text-sm text-slate-600">
              {workingSummary.short_days_count >= 3
                ? `${Math.floor(workingSummary.short_days_count / 3) * 0.5} half-day(s) have been deducted from your casual leave.`
                : `${3 - (workingSummary.short_days_count % 3)} more short day(s) will result in 0.5 day leave deduction.`
              }
            </p>
          </div>
        </div>
      )}

      {/* Grid Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Time tracker — the hero card of the day */}
        <div className="xl:col-span-5">
          <TimeTrackerCard user={user} api={api} />
        </div>

        {/* Balances, requests and hours chart */}
        <div className="xl:col-span-7 flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              icon={TreePalm}
              tone="blue"
              label="Casual Leave"
              value={leaveBalance.casual ?? <span className="text-base font-semibold text-slate-400">Not set</span>}
              sub={leaveBalance.casual !== null && leaveBalance.casual !== undefined ? "days remaining" : "contact admin"}
            />
            <StatCard
              icon={Heartbeat}
              tone="green"
              label="Sick Leave"
              value={leaveBalance.sick ?? <span className="text-base font-semibold text-slate-400">Not set</span>}
              sub={leaveBalance.sick !== null && leaveBalance.sick !== undefined ? "days remaining" : "contact admin"}
            />
            <StatCard
              icon={Hourglass}
              tone="amber"
              label="Permission"
              value={`${(permissionBalance.remaining_minutes / 60).toFixed(1)}h`}
              sub={`of ${permissionBalance.monthly_allowance_hours ?? 2} hours remaining · max 1h per use`}
            />
            <StatCard
              icon={CurrencyCircleDollar}
              tone="red"
              label="Loss of Pay"
              value={leaveBalance.loss_of_pay || 0}
              sub="days taken"
            />
          </div>

          {/* Request Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  data-testid="request-leave-btn"
                  className="w-full h-12 bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] rounded-xl font-semibold"
                  style={{ boxShadow: 'var(--shadow-brand)' }}
                >
                  <CalendarBlank className="h-4 w-4 mr-2" weight="duotone" />
                  Request Leave
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-2xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-['Outfit'] text-xl">Request Leave</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-gray-500 -mt-2">Fill in the details below to submit a leave request.</p>
                <div
                  className="grid grid-cols-3 gap-2 rounded-xl p-3 text-center"
                  style={{ background: 'var(--badge-amber-bg)', border: '1px solid var(--badge-amber-border)', color: 'var(--badge-amber-text)' }}
                >
                  <div><p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">Monthly limit</p><p className="text-sm font-bold">1.5 days</p></div>
                  <div><p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">Used</p><p className="text-sm font-bold">{monthlyLeaveUsage.used}</p></div>
                  <div><p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">Remaining</p><p className="text-sm font-bold">{monthlyLeaveUsage.remaining}</p></div>
                </div>
                <div className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <Label className={labelCls}>Leave Type</Label>
                    <Select
                      value={leaveForm.leave_type}
                      onValueChange={(value) => setLeaveForm({ ...leaveForm, leave_type: value })}
                    >
                      <SelectTrigger data-testid="leave-type-select" className={inputCls}>
                        <SelectValue placeholder="Select leave type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="casual">Casual Leave ({leaveBalance.casual ?? "not set"} left)</SelectItem>
                        <SelectItem value="sick">Sick Leave ({leaveBalance.sick ?? "not set"} left)</SelectItem>
                        <SelectItem value="loss_of_pay">Loss of Pay</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <label
                    htmlFor="halfDay"
                    className="flex items-center gap-3 rounded-xl px-3 h-11 cursor-pointer"
                    style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}
                  >
                    <input
                      data-testid="half-day-checkbox"
                      type="checkbox"
                      id="halfDay"
                      checked={leaveForm.is_half_day}
                      onChange={(e) => setLeaveForm({ ...leaveForm, is_half_day: e.target.checked, end_date: e.target.checked ? leaveForm.start_date : leaveForm.end_date })}
                      className="h-4 w-4 rounded border-gray-300 accent-[#0020F8]"
                    />
                    <span className="text-sm font-medium text-gray-700">Half Day Leave (0.5 day)</span>
                  </label>

                  <div className={`grid ${leaveForm.is_half_day ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"} gap-4`}>
                    <div className="space-y-1.5">
                      <Label className={labelCls}>{leaveForm.is_half_day ? "Date" : "Start Date"}</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            data-testid="leave-start-date-btn"
                            variant="outline"
                            className={`w-full justify-start text-left font-normal ${inputCls}`}
                          >
                            <CalendarBlank className="mr-2 h-4 w-4 opacity-60" />
                            {leaveForm.start_date ? format(leaveForm.start_date, "MMM d, yyyy") : "Select date"}
                            <CaretDown className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={leaveForm.start_date}
                            onSelect={(date) => setLeaveForm({ ...leaveForm, start_date: date })}
                            disabled={(date) => date < new Date() || isOffDay(date, offDays)}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    {!leaveForm.is_half_day && (
                    <div className="space-y-1.5">
                      <Label className={labelCls}>End Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            data-testid="leave-end-date-btn"
                            variant="outline"
                            className={`w-full justify-start text-left font-normal ${inputCls}`}
                          >
                            <CalendarBlank className="mr-2 h-4 w-4 opacity-60" />
                            {leaveForm.end_date ? format(leaveForm.end_date, "MMM d, yyyy") : "Select date"}
                            <CaretDown className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={leaveForm.end_date}
                            onSelect={(date) => setLeaveForm({ ...leaveForm, end_date: date })}
                            disabled={(date) => date < (leaveForm.start_date || new Date()) || isOffDay(date, offDays)}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label className={labelCls}>Reason</Label>
                    <Textarea
                      data-testid="leave-reason-input"
                      placeholder="Enter the reason for leave..."
                      value={leaveForm.reason}
                      onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                      rows={3}
                      className="rounded-xl"
                    />
                  </div>

                  <Button
                    data-testid="submit-leave-request-btn"
                    onClick={handleLeaveRequest}
                    disabled={loading}
                    className={primaryBtnCls}
                  >
                    Submit Request
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            {/* Permission Request Button */}
            <Dialog open={permissionDialogOpen} onOpenChange={setPermissionDialogOpen}>
              <DialogTrigger asChild>
                <Button
                  data-testid="request-permission-btn"
                  variant="outline"
                  className="w-full h-12 rounded-xl font-semibold bg-white border-slate-200 text-slate-900 hover:bg-slate-50"
                >
                  <Hourglass className="h-4 w-4 mr-2 text-amber-600" weight="duotone" />
                  Request Permission
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-2xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-['Outfit'] text-xl">Request Permission</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-gray-500 -mt-2">
                  You have {permissionBalance.remaining_minutes} minutes remaining this month. Max 1 hour per request.
                </p>
                <div className="space-y-4 pt-2">
                  <div className="space-y-1.5">
                    <Label className={labelCls}>Duration</Label>
                    <Select
                      value={permissionForm.duration_minutes.toString()}
                      onValueChange={(value) => setPermissionForm({ ...permissionForm, duration_minutes: parseInt(value) })}
                    >
                      <SelectTrigger data-testid="permission-duration-select" className={inputCls}>
                        <SelectValue placeholder="Select duration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="30">30 minutes</SelectItem>
                        <SelectItem value="60">1 hour</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label className={labelCls}>Date</Label>
                    <Input
                      data-testid="permission-date-input"
                      type="date"
                      value={permissionForm.date}
                      onChange={(e) => setPermissionForm({ ...permissionForm, date: e.target.value })}
                      min={format(new Date(), "yyyy-MM-dd")}
                      className={inputCls}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className={labelCls}>Reason</Label>
                    <Textarea
                      data-testid="permission-reason-input"
                      placeholder="Enter the reason for permission..."
                      value={permissionForm.reason}
                      onChange={(e) => setPermissionForm({ ...permissionForm, reason: e.target.value })}
                      rows={3}
                      className="rounded-xl"
                    />
                  </div>

                  <Button
                    data-testid="submit-permission-request-btn"
                    onClick={handlePermissionRequest}
                    disabled={loading || permissionBalance.remaining_minutes < permissionForm.duration_minutes}
                    className={primaryBtnCls}
                  >
                    Submit Request
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <HoursChart attendanceHistory={attendanceHistory} />
        </div>

        {/* Leave Requests */}
        <div className="xl:col-span-6 section-card">
          <SectionHeader icon={CalendarCheck} tone="blue" title="Leave Requests" sub="Your 5 most recent">
            {leaveRequests.length > 0 && <span className="chip">{leaveRequests.length} total</span>}
          </SectionHeader>
          <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
            {leaveRequests.length === 0 ? (
              <EmptyState compact icon={CalendarCheck} tone="blue" title="No leave requests yet" hint="Use “Request Leave” to plan time off." />
            ) : (
              leaveRequests.slice(0, 5).map((request) => (
                <div key={request.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 text-sm capitalize flex flex-wrap items-center gap-2">
                        {request.leave_type} Leave
                        {request.is_half_day && <span className="chip tone-blue normal-case">Half Day</span>}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {request.is_half_day
                          ? format(new Date(request.start_date), "MMM d, yyyy")
                          : `${format(new Date(request.start_date), "MMM d")} - ${format(new Date(request.end_date), "MMM d, yyyy")}`
                        }
                        {" "}({request.days} {request.days === 1 ? "day" : "days"})
                      </p>
                      <p className="text-xs text-slate-400 mt-1 break-words">{request.reason}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 flex-shrink-0">
                      {getStatusBadge(request.status)}
                      {request.status === "pending" && (
                        <Button
                          data-testid={`cancel-leave-${request.id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelLeave(request.id)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs h-7 px-2 rounded-lg"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Permission Requests */}
        <div className="xl:col-span-6 section-card">
          <SectionHeader icon={Timer} tone="amber" title="Permission Requests" sub="Your 5 most recent">
            {permissionRequests.length > 0 && <span className="chip">{permissionRequests.length} total</span>}
          </SectionHeader>
          <div className="divide-y divide-slate-100 max-h-[320px] overflow-y-auto">
            {permissionRequests.length === 0 ? (
              <EmptyState compact icon={Timer} tone="amber" title="No permission requests yet" hint="Short time away? Request up to 1 hour at a time." />
            ) : (
              permissionRequests.slice(0, 5).map((perm) => (
                <div key={perm.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 text-sm">{perm.duration_minutes} minutes</p>
                      <p className="text-xs text-slate-500 mt-1">{format(new Date(perm.date), "MMM d, yyyy")}</p>
                      <p className="text-xs text-slate-400 mt-1 break-words">{perm.reason}</p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-end sm:items-center gap-1.5 flex-shrink-0">
                      {getStatusBadge(perm.status)}
                      {perm.status === "pending" && (
                        <Button
                          data-testid={`cancel-permission-${perm.id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCancelPermission(perm.id)}
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs h-7 px-2 rounded-lg"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Attendance History */}
        <div className="xl:col-span-12 section-card">
          <SectionHeader icon={ClockCounterClockwise} tone="violet" title="Attendance History" sub="Last 10 working days" />
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Date</th>
                <th className="table-header">Login</th>
                <th className="table-header">Logout</th>
                <th className="table-header">Working Hours</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {attendanceHistory.length === 0 ? (
                <tr>
                  <td colSpan="5">
                    <EmptyState inTable compact icon={ClockCounterClockwise} tone="violet" title="No attendance records yet" hint="Log in from the Time Tracker to start your first day." />
                  </td>
                </tr>
              ) : (
                attendanceHistory.slice(0, 10).map((record, idx) => (
                  <tr key={idx} className="table-row">
                    <td className="table-cell font-semibold text-slate-900">{format(new Date(record.date), "MMM d, yyyy")}</td>
                    <td className="table-cell">{format(new Date(record.clock_in), "h:mm a")}</td>
                    <td className="table-cell">{record.clock_out ? format(new Date(record.clock_out), "h:mm a") : "—"}</td>
                    <td className="table-cell">
                      <span className={record.working_hours && record.working_hours < 8 ? "text-red-500 font-semibold" : "font-semibold text-slate-900"}>
                        {record.working_hours ? formatHours(record.working_hours) : "—"}
                      </span>
                    </td>
                    <td className="table-cell">
                      {record.is_short_day ? (
                        <span className="badge-rejected">Short Day</span>
                      ) : record.clock_out ? (
                        <span className="badge-approved">Complete</span>
                      ) : (
                        <span className="badge-pending">Active</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
