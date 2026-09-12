import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Check, X, GitPullRequest } from "@phosphor-icons/react";

const priorityColor = { high: "bg-red-50 text-red-600", medium: "bg-amber-50 text-amber-600", low: "bg-emerald-50 text-emerald-600" };
const statusColor = {
  pending: "bg-slate-100 text-slate-600",
  manager_approved: "bg-blue-50 text-[#002FA7]",
  approved: "bg-emerald-50 text-emerald-600",
  rejected: "bg-red-50 text-red-500"
};

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
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Team Requests</h1>
        <p className="text-gray-500 mt-1">Change requests submitted by your direct reports</p>
      </div>

      {crs.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <GitPullRequest className="h-10 w-10 text-slate-300 mx-auto mb-3" weight="duotone" />
          <p className="text-slate-400 text-sm" data-testid="no-team-requests">No change requests from your team yet</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3 mb-8">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Pending Your Review ({pending.length})</h3>
          {pending.map((cr) => (
            <div key={cr.id} data-testid={`team-cr-card-${cr.id}`} className="bg-white border border-slate-200 rounded-xl p-5" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-slate-400">{cr.cr_number}</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${priorityColor[cr.priority] || priorityColor.medium}`}>{(cr.priority || "medium").toUpperCase()}</span>
                  </div>
                  <p className="text-base font-bold text-slate-900">{cr.title}</p>
                  <p className="text-sm text-slate-500 mt-1">{cr.description}</p>
                  <p className="text-xs text-slate-400 mt-2">By {cr.requester_name} \u00b7 {cr.cr_type}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button data-testid={`team-cr-approve-${cr.id}`} size="sm" onClick={() => openDialog(cr.id, "approve")} className="bg-[#00C853] hover:bg-green-600 text-white">
                    <Check className="h-4 w-4 mr-1" /> Approve
                  </Button>
                  <Button data-testid={`team-cr-reject-${cr.id}`} size="sm" variant="outline" onClick={() => openDialog(cr.id, "reject")} className="text-red-500 border-red-200 hover:bg-red-50">
                    <X className="h-4 w-4 mr-1" /> Reject
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">History</h3>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-2.5 text-xs font-bold text-slate-500 uppercase">CR</th>
                  <th className="text-left px-5 py-2.5 text-xs font-bold text-slate-500 uppercase">Requester</th>
                  <th className="text-left px-5 py-2.5 text-xs font-bold text-slate-500 uppercase">Your Notes</th>
                  <th className="text-left px-5 py-2.5 text-xs font-bold text-slate-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((cr) => (
                  <tr key={cr.id} data-testid={`team-cr-history-row-${cr.id}`}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-800">{cr.title}</p>
                      <p className="text-xs text-slate-400">{cr.cr_number}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{cr.requester_name}</td>
                    <td className="px-5 py-3 text-slate-500 max-w-[220px] truncate">{cr.manager_notes || "\u2014"}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${statusColor[cr.status] || statusColor.pending}`}>{(cr.status || "").replace("_", " ")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <DialogContent className="max-w-md">
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
              className={`w-full rounded-xl ${target?.action === "approve" ? "bg-[#00C853] hover:bg-green-600 text-white" : "bg-red-500 hover:bg-red-600 text-white"}`}
            >
              {target?.action === "approve" ? "Confirm Approve" : "Confirm Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
