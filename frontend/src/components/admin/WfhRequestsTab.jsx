import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, X, HouseLine } from "@phosphor-icons/react";
import { getStatusBadge } from "@/components/common/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

const APPROVE_BTN = "h-8 w-8 p-0 rounded-lg border bg-[var(--badge-green-bg)] text-[color:var(--badge-green-text)] border-[color:var(--badge-green-border)] hover:bg-[#16A34A] hover:text-white hover:border-[#16A34A]";
const REJECT_BTN = "h-8 w-8 p-0 rounded-lg border bg-[var(--badge-red-bg)] text-[color:var(--badge-red-text)] border-[color:var(--badge-red-border)] hover:bg-[#DC2626] hover:text-white hover:border-[#DC2626]";

export function WfhRequestsTab({ api, wfhRequests, fetchData }) {
  const { can } = usePermissions();
  const canEdit = can("wfh", "edit");
  const handleWfhAction = async (wfhId, action) => {
    try {
      await api.put(`/admin/wfh-requests/${wfhId}?action=${action}`);
      toast.success(`WFH request ${action}d`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to process WFH request");
    }
  };

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Work From Home Requests</h1>
          <p className="text-slate-500 mt-1 text-sm">Review and manage employee WFH requests</p>
        </div>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <h2 className="text-base font-bold font-['Outfit'] text-slate-900">All WFH requests</h2>
            <p className="text-xs text-slate-500 mt-0.5">{wfhRequests.length} request{wfhRequests.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="chip tone-amber">{wfhRequests.filter(r => r.status === "pending").length} pending</span>
            <span className="chip tone-green">{wfhRequests.filter(r => r.status === "approved").length} approved</span>
            <span className="chip tone-red">{wfhRequests.filter(r => r.status === "rejected").length} rejected</span>
          </div>
        </div>
        <div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Employee</th>
              <th className="table-header">Date</th>
              <th className="table-header">Reason</th>
              <th className="table-header">Status</th>
              <th className="table-header">Reviewed By</th>
              {canEdit && <th className="table-header text-right" style={{ textAlign: "right" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {wfhRequests.length === 0 ? (
              <tr>
                <td colSpan={canEdit ? 6 : 5}>
                  <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                    <span className="stat-icon tone-blue"><HouseLine className="h-5 w-5" weight="duotone" /></span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">No WFH requests</p>
                      <p className="text-xs text-slate-500 mt-1">Work-from-home requests will show up here.</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              wfhRequests.map((req) => (
                <tr key={req.id} data-testid={`wfh-row-${req.id}`} className="table-row">
                  <td className="table-cell font-semibold text-sm" style={{ color: "var(--text-primary)" }}>{req.user_name}</td>
                  <td className="table-cell font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{req.date}</td>
                  <td className="table-cell max-w-[200px] truncate" style={{ color: "var(--text-muted)" }}>{req.reason}</td>
                  <td className="table-cell">
                    {getStatusBadge(req.status)}
                  </td>
                  <td className="table-cell text-sm" style={{ color: "var(--text-muted)" }}>{req.reviewed_by || "-"}</td>
                  {canEdit && (
                  <td className="table-cell text-right">
                    {req.status === "pending" && (
                      <div className="flex gap-1.5 justify-end">
                        <Button
                          data-testid={`wfh-approve-${req.id}`}
                          size="sm"
                          onClick={() => handleWfhAction(req.id, "approve")}
                          title="Approve"
                          variant="ghost"
                          className={APPROVE_BTN}
                        >
                          <Check className="h-4 w-4" weight="bold" />
                        </Button>
                        <Button
                          data-testid={`wfh-reject-${req.id}`}
                          size="sm"
                          onClick={() => handleWfhAction(req.id, "reject")}
                          title="Reject"
                          variant="ghost"
                          className={REJECT_BTN}
                        >
                          <X className="h-4 w-4" weight="bold" />
                        </Button>
                      </div>
                    )}
                  </td>
                  )}
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
