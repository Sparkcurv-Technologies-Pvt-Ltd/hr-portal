import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, CalendarX } from "@phosphor-icons/react";
import { getStatusBadge } from "@/components/common/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

const APPROVE_BTN = "h-8 w-8 p-0 rounded-lg border bg-[var(--badge-green-bg)] text-[color:var(--badge-green-text)] border-[color:var(--badge-green-border)] hover:bg-[#16A34A] hover:text-white hover:border-[#16A34A]";
const REJECT_BTN = "h-8 w-8 p-0 rounded-lg border bg-[var(--badge-red-bg)] text-[color:var(--badge-red-text)] border-[color:var(--badge-red-border)] hover:bg-[#DC2626] hover:text-white hover:border-[#DC2626]";

export function LeaveRequestsTab({ api, leaveRequests, fetchData }) {
  const { can } = usePermissions();
  const handleLeaveAction = async (leaveId, action) => {
    try {
      await api.put(`/admin/leave-requests/${leaveId}?action=${action}`);
      toast.success(`Leave request ${action}d`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to process leave request");
    }
  };

  const pendingCount = leaveRequests.filter(r => r.status === "pending").length;

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Leave Requests</h1>
          <p className="text-slate-500 mt-1 text-sm">Review and manage leave applications</p>
        </div>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <h2 className="text-base font-bold font-['Outfit'] text-slate-900">All leave requests</h2>
            <p className="text-xs text-slate-500 mt-0.5">{leaveRequests.length} request{leaveRequests.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="chip tone-amber">{pendingCount} pending</span>
            <span className="chip tone-green">{leaveRequests.filter(r => r.status === "approved").length} approved</span>
            <span className="chip tone-red">{leaveRequests.filter(r => r.status === "rejected").length} rejected</span>
          </div>
        </div>
        <div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Employee</th>
              <th className="table-header">Type</th>
              <th className="table-header">Dates</th>
              <th className="table-header">Reason</th>
              <th className="table-header">Status</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {leaveRequests.length === 0 ? (
              <tr>
                <td colSpan="6">
                  <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                    <span className="stat-icon tone-blue"><CalendarX className="h-5 w-5" weight="duotone" /></span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">No leave requests</p>
                      <p className="text-xs text-slate-500 mt-1">New leave applications will show up here.</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              leaveRequests.map((req) => (
                <tr key={req.id} className="table-row">
                  <td className="table-cell">
                    <p className="font-semibold text-slate-900 text-sm">{req.user_name}</p>
                    <p className="text-xs text-slate-400">{req.user_email}</p>
                  </td>
                  <td className="table-cell"><span className="chip capitalize">{req.leave_type}{req.is_half_day ? " · Half day" : ""}</span></td>
                  <td className="table-cell">
                    <p className="text-sm font-medium text-slate-700">{req.is_half_day ? format(new Date(req.start_date), "MMM d, yyyy") : `${format(new Date(req.start_date), "MMM d")} - ${format(new Date(req.end_date), "MMM d, yyyy")}`}</p>
                    <p className="text-xs text-slate-400">{req.days} day(s)</p>
                  </td>
                  <td className="table-cell max-w-xs truncate" style={{ color: "var(--text-muted)" }}>{req.reason}</td>
                  <td className="table-cell">{getStatusBadge(req.status)}</td>
                  <td className="table-cell">
                    {req.status === "pending" && can("leaves", "edit") && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          data-testid={`approve-leave-${req.id}`}
                          size="sm"
                          onClick={() => handleLeaveAction(req.id, "approve")}
                          title="Approve"
                          variant="ghost"
                          className={APPROVE_BTN}
                        >
                          <Check className="h-4 w-4" weight="bold" />
                        </Button>
                        <Button
                          data-testid={`reject-leave-${req.id}`}
                          size="sm"
                          onClick={() => handleLeaveAction(req.id, "reject")}
                          title="Reject"
                          variant="ghost"
                          className={REJECT_BTN}
                        >
                          <X className="h-4 w-4" weight="bold" />
                        </Button>
                      </div>
                    )}
                    {req.status !== "pending" && req.reviewed_by && (
                      <p className="text-xs text-slate-400">by {req.reviewed_by}</p>
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
