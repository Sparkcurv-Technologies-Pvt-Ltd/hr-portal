import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { Warning, Trash, Plus, UserCircle, GitPullRequest, Clock, CheckCircle, XCircle } from "@phosphor-icons/react";
import { TabHeader, StatCard, SectionHeader, EmptyState, StatusPill, TonePill } from "@/components/employee/EmployeeUi";
import { CR_AUTO_APPLY_TYPES } from "@/lib/constants";

export function ChangeRequestsTab({
  api, myCRs, crTypes, myManager, crForm, setCrForm, loading, setLoading, fetchData
}) {
  const [crDialogOpen, setCrDialogOpen] = useState(false);

  const handleSubmitCR = async () => {
    if (!crForm.title || !crForm.description) {
      toast.error("Title and description are required");
      return;
    }
    if (!myManager?.has_manager) {
      toast.error("No reporting manager assigned. Contact Admin first.");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        title: crForm.title,
        description: crForm.description,
        cr_type: crForm.cr_type,
        priority: crForm.priority,
        metadata: crForm.requested_value ? { requested_value: crForm.requested_value } : null
      };
      const res = await api.post("/cr/create", payload);
      toast.success(`Change request ${res.data.cr_number} submitted!`);
      setCrDialogOpen(false);
      setCrForm({ title: "", description: "", cr_type: "General", priority: "medium", requested_value: "" });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit CR");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCR = async (crId) => {
    try {
      await api.delete(`/cr/${crId}`);
      toast.success("CR deleted");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to delete CR");
    }
  };

  return (
    <>
      <TabHeader title="Change Requests" description="Submit and track your work/installation requests">
        <Dialog open={crDialogOpen} onOpenChange={setCrDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-cr-btn" className="h-11 px-5 rounded-xl bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] gap-2 font-semibold" style={{ boxShadow: 'var(--shadow-brand)' }}>
              <Plus className="h-4 w-4" weight="bold" />
              New Request
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg rounded-2xl max-h-[92vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="font-['Outfit'] text-xl">New Change Request</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-gray-500 -mt-2">Submit a new work or installation request for approval.</p>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Title</Label>
                <Input
                  data-testid="cr-title-input"
                  className="h-11 rounded-xl"
                  placeholder="e.g. Install software, Fix desk lamp"
                  value={crForm.title}
                  onChange={(e) => setCrForm({ ...crForm, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Description</Label>
                <Textarea
                  data-testid="cr-description-input"
                  placeholder="Describe the request in detail..."
                  value={crForm.description}
                  onChange={(e) => setCrForm({ ...crForm, description: e.target.value })}
                  className="min-h-[100px] rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Reporting Manager</Label>
                {myManager?.has_manager ? (
                  <div data-testid="cr-reporting-manager-display" className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-blue-50 border border-blue-100">
                    <UserCircle className="h-5 w-5 text-[#0020F8]" weight="duotone" />
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{myManager.name}</p>
                      <p className="text-xs text-slate-400">
                        {myManager.role?.charAt(0).toUpperCase() + myManager.role?.slice(1)} · This request will only be visible to them
                      </p>
                    </div>
                  </div>
                ) : (
                  <div data-testid="cr-no-manager-warning" className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm" style={{ background: 'var(--badge-amber-bg)', border: '1px solid var(--badge-amber-border)', color: 'var(--badge-amber-text)' }}>
                    <Warning className="h-4 w-4" weight="bold" />
                    No reporting manager assigned yet. Contact Admin before submitting a request.
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">Type</Label>
                  <Select value={crForm.cr_type} onValueChange={(v) => setCrForm({ ...crForm, cr_type: v, requested_value: "" })}>
                    <SelectTrigger data-testid="cr-type-select" className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {crTypes.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">Priority</Label>
                  <Select value={crForm.priority} onValueChange={(v) => setCrForm({ ...crForm, priority: v })}>
                    <SelectTrigger data-testid="cr-priority-select" className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {CR_AUTO_APPLY_TYPES.includes(crForm.cr_type) && (
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">
                    {crForm.cr_type === "Salary Revision" && "Requested Salary (₹)"}
                    {crForm.cr_type === "Leave Adjustment" && "Requested Casual Leave Days"}
                    {crForm.cr_type === "Shift Change" && "Requested Shift (HH:MM-HH:MM)"}
                  </Label>
                  <Input
                    data-testid="cr-requested-value-input"
                    className="h-11 rounded-xl"
                    type={crForm.cr_type === "Shift Change" ? "text" : "number"}
                    min="0"
                    placeholder={
                      crForm.cr_type === "Salary Revision" ? "e.g. 50000" :
                      crForm.cr_type === "Leave Adjustment" ? "e.g. 15" :
                      "e.g. 09:30-17:30"
                    }
                    value={crForm.requested_value}
                    onChange={(e) => setCrForm({ ...crForm, requested_value: e.target.value })}
                  />
                </div>
              )}
              <Button
                data-testid="submit-cr-btn"
                onClick={handleSubmitCR}
                disabled={loading}
                className="w-full h-11 rounded-xl bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] font-semibold"
              >
                Submit Request
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </TabHeader>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard icon={GitPullRequest} tone="blue" label="Total" value={myCRs.length} sub="requests submitted" />
        <StatCard icon={Clock} tone="amber" label="In Review" value={myCRs.filter((c) => c.status === "pending" || c.status === "manager_approved").length} sub="awaiting a decision" />
        <StatCard icon={CheckCircle} tone="green" label="Approved" value={myCRs.filter((c) => c.status === "approved").length} sub="fully approved" />
        <StatCard icon={XCircle} tone="red" label="Rejected" value={myCRs.filter((c) => c.status === "rejected").length} sub="not approved" />
      </div>

      <div className="section-card">
        <SectionHeader icon={GitPullRequest} tone="blue" title="My requests" sub="Manager approval first, then Admin" />
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Title</th>
              <th className="table-header">Type</th>
              <th className="table-header">Priority</th>
              <th className="table-header">Manager</th>
              <th className="table-header">Admin</th>
              <th className="table-header">Status</th>
              <th className="table-header">Created</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {myCRs.length === 0 ? (
              <tr>
                <td colSpan="8">
                  <EmptyState inTable icon={GitPullRequest} tone="blue" title="No change requests submitted yet" hint="Use “New Request” to ask for software, equipment or other changes." />
                </td>
              </tr>
            ) : (
              myCRs.map((cr) => (
                <tr key={cr.id} className="table-row">
                  <td className="table-cell">
                    <p className="font-semibold text-slate-900 text-sm">{cr.title}</p>
                    <p className="text-xs text-slate-500 line-clamp-1 max-w-[280px]">{cr.description}</p>
                    {cr.cr_number && <p className="text-xs text-[#0020F8] font-mono mt-0.5">{cr.cr_number}</p>}
                    {cr.assigned_manager_name && (
                      <p className="text-xs text-slate-400 mt-0.5">Manager: {cr.assigned_manager_name}</p>
                    )}
                  </td>
                  <td className="table-cell">
                    <span className="chip">{cr.cr_type}</span>
                  </td>
                  <td className="table-cell">
                    <TonePill tone={cr.priority === "high" ? "red" : cr.priority === "low" ? "green" : "amber"}>{cr.priority}</TonePill>
                  </td>
                  <td className="table-cell">
                    <StatusPill status={cr.manager_approval} label={cr.manager_approval === "approved" ? "Approved" : cr.manager_approval === "rejected" ? "Rejected" : "Pending"} />
                  </td>
                  <td className="table-cell">
                    <StatusPill status={cr.admin_approval} label={cr.admin_approval === "approved" ? "Approved" : cr.admin_approval === "rejected" ? "Rejected" : "Pending"} />
                  </td>
                  <td className="table-cell">
                    {cr.status === "manager_approved"
                      ? <TonePill tone="blue">Awaiting Admin</TonePill>
                      : <StatusPill status={cr.status} />}
                  </td>
                  <td className="table-cell text-slate-500 whitespace-nowrap">
                    {cr.created_at ? format(new Date(cr.created_at), "MMM d, yyyy") : "—"}
                  </td>
                  <td className="table-cell">
                    {cr.status === "pending" && (
                      <Button
                        data-testid={`delete-cr-${cr.id}`}
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteCR(cr.id)}
                        className="text-slate-400 hover:text-red-500 hover:bg-red-50 h-8 w-8 p-0 rounded-lg"
                      >
                        <Trash className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
