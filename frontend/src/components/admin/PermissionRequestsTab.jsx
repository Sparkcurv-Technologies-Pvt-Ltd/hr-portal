import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, Clock } from "@phosphor-icons/react";
import { getStatusBadge } from "@/components/common/StatusBadge";
import { usePermissions } from "@/hooks/usePermissions";

const APPROVE_BTN = "h-8 w-8 p-0 rounded-lg border bg-[var(--badge-green-bg)] text-[color:var(--badge-green-text)] border-[color:var(--badge-green-border)] hover:bg-[#16A34A] hover:text-white hover:border-[#16A34A]";
const REJECT_BTN = "h-8 w-8 p-0 rounded-lg border bg-[var(--badge-red-bg)] text-[color:var(--badge-red-text)] border-[color:var(--badge-red-border)] hover:bg-[#DC2626] hover:text-white hover:border-[#DC2626]";

export function PermissionRequestsTab({ api, permissionRequests, fetchData }) {
  const { can } = usePermissions();
  const handlePermissionAction = async (permissionId, action) => {
    try {
      await api.put(`/admin/permissions/${permissionId}?action=${action}`);
      toast.success(`Permission request ${action}d`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to process permission request");
    }
  };

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Permission Requests</h1>
          <p className="text-slate-500 mt-1 text-sm">Short-absence requests — 2 hours per month per employee, max 1 hour per use</p>
        </div>
      </div>

      <div className="section-card">
        <div className="section-header">
          <div>
            <h2 className="text-base font-bold font-['Outfit'] text-slate-900">All permission requests</h2>
            <p className="text-xs text-slate-500 mt-0.5">{permissionRequests.length} request{permissionRequests.length === 1 ? "" : "s"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="chip tone-amber">{permissionRequests.filter(r => r.status === "pending").length} pending</span>
            <span className="chip tone-green">{permissionRequests.filter(r => r.status === "approved").length} approved</span>
            <span className="chip tone-red">{permissionRequests.filter(r => r.status === "rejected").length} rejected</span>
          </div>
        </div>
        <div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Employee</th>
              <th className="table-header">Duration</th>
              <th className="table-header">Date</th>
              <th className="table-header">Reason</th>
              <th className="table-header">Status</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {permissionRequests.length === 0 ? (
              <tr>
                <td colSpan="6">
                  <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                    <span className="stat-icon tone-blue"><Clock className="h-5 w-5" weight="duotone" /></span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">No permission requests</p>
                      <p className="text-xs text-slate-500 mt-1">Permission requests will show up here.</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              permissionRequests.map((perm) => (
                <tr key={perm.id} className="table-row">
                  <td className="table-cell">
                    <p className="font-semibold text-slate-900 text-sm">{perm.user_name}</p>
                    <p className="text-xs text-slate-400">{perm.user_email}</p>
                  </td>
                  <td className="table-cell"><span className="chip tone-violet">{perm.duration_minutes} min</span></td>
                  <td className="table-cell font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{format(new Date(perm.date), "MMM d, yyyy")}</td>
                  <td className="table-cell max-w-xs truncate" style={{ color: "var(--text-muted)" }}>{perm.reason}</td>
                  <td className="table-cell">{getStatusBadge(perm.status)}</td>
                  <td className="table-cell">
                    {perm.status === "pending" && can("permissions", "edit") && (
                      <div className="flex items-center gap-1.5">
                        <Button
                          data-testid={`approve-permission-${perm.id}`}
                          size="sm"
                          onClick={() => handlePermissionAction(perm.id, "approve")}
                          title="Approve"
                          variant="ghost"
                          className={APPROVE_BTN}
                        >
                          <Check className="h-4 w-4" weight="bold" />
                        </Button>
                        <Button
                          data-testid={`reject-permission-${perm.id}`}
                          size="sm"
                          onClick={() => handlePermissionAction(perm.id, "reject")}
                          title="Reject"
                          variant="ghost"
                          className={REJECT_BTN}
                        >
                          <X className="h-4 w-4" weight="bold" />
                        </Button>
                      </div>
                    )}
                    {perm.status !== "pending" && perm.reviewed_by && (
                      <p className="text-xs text-slate-400">by {perm.reviewed_by}</p>
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
