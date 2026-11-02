import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Check, X, GitPullRequest, ClockCounterClockwise } from "@phosphor-icons/react";
import { TabHeader, SectionHeader, EmptyState, TonePill } from "@/components/employee/EmployeeUi";

const priorityTone = { high: "red", medium: "amber", low: "green" };
const statusTone = { pending: "", manager_approved: "tone-blue", approved: "tone-green", rejected: "tone-red" };

// Manager-only: Change Requests assigned to them (CRs from their direct reports)
export function ManagerRequestsTab({ api }) {
  const [crs, setCrs] = useState([]);
  const [notesDialogOpen, setNotesDialogOpen] = useState(false);
  const [target, setTarget] = useState(null); // { id, action }
  const [notes, setNotes] = useState("");

  const fetchCRs = useCallback(async () => {
    try {
      const res = await api.get("/admin/change-requests");
      setCrs(res.data || []);
    } catch {
      setCrs([]);
    }
  }, [api]);

  useEffect(() => { fetchCRs(); }, [fetchCRs]);

  const openDialog = (id, action) => {
    setTarget({ id, action });
    setNotes("");
    setNotesDialogOpen(true);
  };

  const confirmAction = async () => {
    if (!target) return;
    try {
      await api.put(`/admin/change-requests/${target.id}/manager-action?action=${target.action}&notes=${encodeURIComponent(notes)}`);
      toast.success(`Request ${target.action}d`);
      setNotesDialogOpen(false);
      setTarget(null);
      fetchCRs();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit decision");
    }
  };

  const pending = crs.filter((c) => c.manager_approval === "pending");
  const history = crs.filter((c) => c.manager_approval !== "pending");

  return (
    <div data-testid="manager-requests-tab">
      <TabHeader title="Team Requests" description="Change requests submitted by your direct reports" />

      {crs.length === 0 && (
        <div className="section-card">
          <EmptyState icon={GitPullRequest} tone="blue" title="No change requests from your team yet" testId="no-team-requests" />
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3 mb-8">
          <h3 className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
            Pending Your Review <span className="badge-pending normal-case tracking-normal">{pending.length}</span>
          </h3>
          {pending.map((cr) => (
            <div key={cr.id} data-testid={`team-cr-card-${cr.id}`} className="section-card p-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex items-start gap-3.5 min-w-0">
                  <span className="stat-icon tone-blue hidden sm:inline-flex">
                    <GitPullRequest className="h-5 w-5" weight="duotone" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="text-xs font-['JetBrains_Mono'] text-slate-400">{cr.cr_number}</span>
                      <TonePill tone={priorityTone[cr.priority] || priorityTone.medium} className="uppercase text-[10px]">{(cr.priority || "medium").toUpperCase()}</TonePill>
                    </div>
                    <p className="text-base font-bold text-slate-900 font-['Outfit']">{cr.title}</p>
                    <p className="text-sm text-slate-500 mt-1 break-words">{cr.description}</p>
                    <p className="text-xs text-slate-400 mt-2">By {cr.requester_name} · {cr.cr_type}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button data-testid={`team-cr-approve-${cr.id}`} size="sm" onClick={() => openDialog(cr.id, "approve")} className="h-9 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                    <Check className="h-4 w-4 mr-1" weight="bold" /> Approve
                  </Button>
                  <Button data-testid={`team-cr-reject-${cr.id}`} size="sm" variant="outline" onClick={() => openDialog(cr.id, "reject")} className="h-9 rounded-xl text-red-500 border-red-200 hover:bg-red-50 font-semibold">
                    <X className="h-4 w-4 mr-1" weight="bold" /> Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="section-card">
          <SectionHeader icon={ClockCounterClockwise} tone="violet" title="History" sub="Requests you've already reviewed" />
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">CR</th>
                <th className="table-header">Requester</th>
                <th className="table-header">Your Notes</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map((cr) => (
                <tr key={cr.id} data-testid={`team-cr-history-row-${cr.id}`} className="table-row">
                  <td className="table-cell">
                    <p className="font-semibold text-slate-900">{cr.title}</p>
                    <p className="text-xs text-slate-400 font-['JetBrains_Mono']">{cr.cr_number}</p>
                  </td>
                  <td className="table-cell">{cr.requester_name}</td>
                  <td className="table-cell text-slate-500 max-w-[240px] truncate">{cr.manager_notes || "\u2014"}</td>
                  <td className="table-cell">
                    <span className={`chip capitalize ${statusTone[cr.status] ?? ""}`}>{(cr.status || "").replace("_", " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">{target?.action === "approve" ? "Approve Request" : "Reject Request"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Notes (visible to Admin)</Label>
              <Textarea data-testid="team-cr-notes-input" placeholder="Add your notes or reasons here..." value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[90px] rounded-xl" />
            </div>
            <Button
              data-testid="team-cr-confirm-btn"
              onClick={confirmAction}
              className={`w-full h-11 rounded-xl font-semibold ${target?.action === "approve" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "bg-red-500 hover:bg-red-600 text-white"}`}
            >
              {target?.action === "approve" ? "Confirm Approve" : "Confirm Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
