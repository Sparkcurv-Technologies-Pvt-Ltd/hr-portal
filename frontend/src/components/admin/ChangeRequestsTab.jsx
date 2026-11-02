import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, ClockCountdown, UserCheck, CheckCircle, XCircle, GitPullRequest } from "@phosphor-icons/react";
import { CRApproveDialog } from "@/components/admin/CRApproveDialog";
import { CR_AUTO_APPLY_TYPES as AUTO_APPLY_TYPES } from "@/lib/constants";
import { usePermissions } from "@/hooks/usePermissions";

export function ChangeRequestsTab({ api, changeRequests, isAdmin, isManager, fetchData }) {
  const { can } = usePermissions();
  const canEdit = can("change-requests", "edit");
  const [crActionNotes, setCrActionNotes] = useState("");

  // CR approve dialog
  const [crApproveDialogOpen, setCrApproveDialogOpen] = useState(false);
  const [selectedCR, setSelectedCR] = useState(null);
  const [crApplyData, setCrApplyData] = useState({ notes: "", apply_value: "" });

  // Manager CR action dialog (with notes, visible to admin later)
  const [crManagerDialogOpen, setCrManagerDialogOpen] = useState(false);
  const [crManagerTarget, setCrManagerTarget] = useState(null); // { id, action }

  const handleCRAction = async (crId, step, action) => {
    try {
      const endpoint = step === "manager"
        ? `/admin/change-requests/${crId}/manager-action?action=${action}&notes=${encodeURIComponent(crActionNotes)}`
        : `/admin/change-requests/${crId}/admin-action?action=${action}&notes=${encodeURIComponent(crActionNotes)}`;
      await api.put(endpoint);
      toast.success(`CR ${action}d successfully`);
      setCrActionNotes("");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || `Failed to ${action} CR`);
    }
  };

  const openCRManagerDialog = (crId, action) => {
    setCrManagerTarget({ id: crId, action });
    setCrActionNotes("");
    setCrManagerDialogOpen(true);
  };

  const confirmCRManagerAction = async () => {
    if (!crManagerTarget) return;
    await handleCRAction(crManagerTarget.id, "manager", crManagerTarget.action);
    setCrManagerDialogOpen(false);
    setCrManagerTarget(null);
  };

  const openAdminApproveDialog = (cr) => {
    setSelectedCR(cr);
    setCrApplyData({ notes: "", apply_value: "" });
    setCrApproveDialogOpen(true);
  };

  const handleAdminApproveCR = async (action) => {
    if (!selectedCR) return;
    try {
      await api.put(`/admin/change-requests/${selectedCR.id}/admin-action`, {
        action,
        notes: crApplyData.notes,
        apply_value: crApplyData.apply_value
      });
      toast.success(`CR ${action}d successfully${action === "approve" && AUTO_APPLY_TYPES.includes(selectedCR.cr_type) ? " — changes applied!" : ""}`);
      setCrApproveDialogOpen(false);
      setSelectedCR(null);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || `Failed to ${action} CR`);
    }
  };

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Change Requests</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {isAdmin ? "Review and approve work/installation requests (2-step approval)" : "Change requests assigned to you for approval"}
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 mb-6">
        {[
          { label: "Pending", value: changeRequests.filter(c => c.status === "pending").length, icon: ClockCountdown, tone: "tone-amber", sub: "Awaiting manager" },
          { label: "Manager Approved", value: changeRequests.filter(c => c.status === "manager_approved").length, icon: UserCheck, tone: "tone-blue", sub: "Awaiting admin" },
          { label: "Approved", value: changeRequests.filter(c => c.status === "approved").length, icon: CheckCircle, tone: "tone-green", sub: "Completed" },
          { label: "Rejected", value: changeRequests.filter(c => c.status === "rejected").length, icon: XCircle, tone: "tone-red", sub: "Declined" },
        ].map(({ label, value, icon: Icon, tone, sub }) => (
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
            <h2 className="text-base font-bold font-['Outfit'] text-slate-900">{isAdmin ? "All change requests" : "Assigned to you"}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{changeRequests.length} request{changeRequests.length === 1 ? "" : "s"}</p>
          </div>
        </div>
        <div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Requester</th>
              <th className="table-header">Title</th>
              <th className="table-header">Type</th>
              <th className="table-header">Priority</th>
              {isAdmin && <th className="table-header">Assigned To</th>}
              <th className="table-header">Manager</th>
              {isAdmin && <th className="table-header">Admin</th>}
              <th className="table-header">Status</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {changeRequests.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 9 : 6}>
                  <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                    <span className="stat-icon tone-blue"><GitPullRequest className="h-5 w-5" weight="duotone" /></span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">No change requests{isManager ? " assigned to you" : ""}</p>
                      <p className="text-xs text-slate-500 mt-1">Submitted requests will show up here for review.</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              changeRequests.map((cr) => (
                <tr key={cr.id} className="table-row">
                  <td className="table-cell">
                    <p className="font-semibold text-slate-900 text-sm">{cr.requester_name}</p>
                    <p className="text-xs text-slate-400">{cr.created_at ? format(new Date(cr.created_at), "MMM d, yyyy") : ""}</p>
                  </td>
                  <td className="table-cell">
                    <p className="font-semibold text-slate-900 text-sm">{cr.title}</p>
                    <p className="text-xs text-slate-500 line-clamp-1 max-w-[260px]">{cr.description}</p>
                  </td>
                  <td className="table-cell">
                    <span className="chip whitespace-nowrap">{cr.cr_type}</span>
                  </td>
                  <td className="table-cell">
                    <span className={`chip capitalize ${
                      cr.priority === "high" ? "tone-red" :
                      cr.priority === "low" ? "tone-green" :
                      "tone-amber"
                    }`}>{cr.priority}</span>
                  </td>
                  {isAdmin && (
                    <td className="table-cell">
                      <p className="text-sm font-medium text-slate-700">{cr.assigned_manager_name || "—"}</p>
                    </td>
                  )}
                  <td className="table-cell">
                    <span className={`text-xs font-semibold ${
                      cr.manager_approval === "approved" ? "text-[color:var(--badge-green-text)]" :
                      cr.manager_approval === "rejected" ? "text-[color:var(--badge-red-text)]" :
                      "text-slate-400"
                    }`}>
                      {cr.manager_approval === "approved" ? `Approved${cr.manager_name ? ` (${cr.manager_name})` : ""}` :
                       cr.manager_approval === "rejected" ? "Rejected" : "Pending"}
                    </span>
                    {cr.manager_notes && <p className="text-xs text-slate-400 mt-0.5">{cr.manager_notes}</p>}
                  </td>
                  {isAdmin && (
                  <td className="table-cell">
                    <span className={`text-xs font-semibold ${
                      cr.admin_approval === "approved" ? "text-[color:var(--badge-green-text)]" :
                      cr.admin_approval === "rejected" ? "text-[color:var(--badge-red-text)]" :
                      "text-slate-400"
                    }`}>
                      {cr.admin_approval === "approved" ? `Approved${cr.admin_name ? ` (${cr.admin_name})` : ""}` :
                       cr.admin_approval === "rejected" ? "Rejected" : "Pending"}
                    </span>
                    {cr.admin_notes && <p className="text-xs text-slate-400 mt-0.5">{cr.admin_notes}</p>}
                  </td>
                  )}
                  <td className="table-cell">
                    {cr.status === "approved" ? <span className="badge-approved">Approved</span> :
                     cr.status === "rejected" ? <span className="badge-rejected">Rejected</span> :
                     cr.status === "manager_approved" ? <span className="chip tone-blue whitespace-nowrap">Awaiting Admin</span> :
                     <span className="badge-pending capitalize">{cr.status}</span>}
                  </td>
                  <td className="table-cell">
                    <div className="flex flex-col gap-1">
                      {/* Manager can approve pending CRs */}
                      {canEdit && cr.manager_approval === "pending" && (
                        <div className="flex gap-1.5">
                          <Button
                            data-testid={`cr-mgr-approve-${cr.id}`}
                            size="sm"
                            onClick={() => openCRManagerDialog(cr.id, "approve")}
                            className="h-8 px-2.5 text-xs font-semibold rounded-lg border bg-[var(--badge-green-bg)] text-[color:var(--badge-green-text)] border-[color:var(--badge-green-border)] hover:bg-[#16A34A] hover:text-white hover:border-[#16A34A]"
                          >
                            <Check className="h-3.5 w-3.5 mr-1" weight="bold" /> Mgr
                          </Button>
                          <Button
                            data-testid={`cr-mgr-reject-${cr.id}`}
                            size="sm"
                            variant="ghost"
                            onClick={() => openCRManagerDialog(cr.id, "reject")}
                            title="Reject"
                            className="h-8 w-8 p-0 rounded-lg border bg-[var(--badge-red-bg)] text-[color:var(--badge-red-text)] border-[color:var(--badge-red-border)] hover:bg-[#DC2626] hover:text-white hover:border-[#DC2626]"
                          >
                            <X className="h-4 w-4" weight="bold" />
                          </Button>
                        </div>
                      )}
                      {/* Admin can approve manager-approved CRs */}
                      {isAdmin && canEdit && cr.manager_approval === "approved" && cr.admin_approval === "pending" && (
                        <div className="flex gap-1.5">
                          <Button
                            data-testid={`cr-admin-approve-${cr.id}`}
                            size="sm"
                            onClick={() => openAdminApproveDialog(cr)}
                            className="bg-[#0020F8] hover:bg-[#0019C4] text-white h-8 text-xs font-semibold px-2.5 rounded-lg"
                          >
                            <Check className="h-3.5 w-3.5 mr-1" weight="bold" /> Admin
                          </Button>
                          <Button
                            data-testid={`cr-admin-reject-${cr.id}`}
                            size="sm"
                            variant="ghost"
                            onClick={() => openAdminApproveDialog(cr)}
                            title="Reject"
                            className="h-8 w-8 p-0 rounded-lg border bg-[var(--badge-red-bg)] text-[color:var(--badge-red-text)] border-[color:var(--badge-red-border)] hover:bg-[#DC2626] hover:text-white hover:border-[#DC2626]"
                          >
                            <X className="h-4 w-4" weight="bold" />
                          </Button>
                        </div>
                      )}
                      {(cr.status === "approved" || cr.status === "rejected") && (
                        <span className="text-xs font-medium text-slate-400">Done</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* CR Admin Approve Dialog */}
      <CRApproveDialog
        open={crApproveDialogOpen}
        onOpenChange={setCrApproveDialogOpen}
        cr={selectedCR}
        applyData={crApplyData}
        onApplyDataChange={setCrApplyData}
        onConfirm={handleAdminApproveCR}
      />

      {/* Manager CR Notes Dialog */}
      <Dialog open={crManagerDialogOpen} onOpenChange={setCrManagerDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">
              {crManagerTarget?.action === "approve" ? "Approve Change Request" : "Reject Change Request"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Notes (visible to Admin)</Label>
              <Textarea
                data-testid="cr-manager-notes-input"
                placeholder="Add your notes or reasons here..."
                value={crActionNotes}
                onChange={(e) => setCrActionNotes(e.target.value)}
                className="min-h-[90px] rounded-xl"
              />
            </div>
            <Button
              data-testid="cr-manager-confirm-btn"
              onClick={confirmCRManagerAction}
              className={`w-full h-11 rounded-xl text-white ${crManagerTarget?.action === "approve" ? "bg-[#16A34A] hover:bg-[#15803D]" : "bg-[#DC2626] hover:bg-[#B91C1C]"}`}
            >
              {crManagerTarget?.action === "approve" ? "Confirm Approve" : "Confirm Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
