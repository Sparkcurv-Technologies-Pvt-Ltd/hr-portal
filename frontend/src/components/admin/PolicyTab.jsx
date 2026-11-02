import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Scroll, Plus, PencilLine, TrashSimple } from "@phosphor-icons/react";
import { usePermissions } from "@/hooks/usePermissions";

export function PolicyTab({ api, policies, isAdmin, loading, setLoading, fetchData }) {
  const { can } = usePermissions();
  const canEdit = can("policy", "edit");
  const canDelete = can("policy", "delete");
  const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState(null);
  const [policyForm, setPolicyForm] = useState({ title: "", category: "", content: "", icon: "article", sort_order: 0 });

  const handleSavePolicy = async () => {
    if (!policyForm.title || !policyForm.content || !policyForm.category) {
      toast.error("Title, category and content are required");
      return;
    }
    setLoading(true);
    try {
      if (editingPolicy) {
        await api.put(`/policy/${editingPolicy.id}`, policyForm);
        toast.success("Policy updated");
      } else {
        await api.post("/policy/create", policyForm);
        toast.success("Policy created");
      }
      setPolicyDialogOpen(false);
      setEditingPolicy(null);
      setPolicyForm({ title: "", category: "", content: "", icon: "article", sort_order: 0 });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to save policy");
    } finally {
      setLoading(false);
    }
  };

  const handleDeletePolicy = async (policyId) => {
    if (!window.confirm("Delete this policy?")) return;
    try {
      await api.delete(`/policy/${policyId}`);
      toast.success("Policy deleted");
      fetchData();
    } catch (error) {
      toast.error("Failed to delete policy");
    }
  };

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Company Policy</h1>
          <p className="text-slate-500 mt-1 text-sm">Rules and guidelines for all employees</p>
        </div>
        {canEdit && (
          <Button
            data-testid="add-policy-btn"
            onClick={() => {
              setEditingPolicy(null);
              setPolicyForm({ title: "", category: "", content: "", icon: "article", sort_order: policies.length + 1 });
              setPolicyDialogOpen(true);
            }}
            className="bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2 rounded-xl h-10 px-4"
          >
            <Plus className="h-4 w-4" weight="bold" /> Add Policy
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {policies.map((policy) => (
          <div key={policy.id} className="stat-card" style={{ gap: 0 }}>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="stat-icon tone-blue"><Scroll className="h-5 w-5" weight="duotone" /></span>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 font-['Outfit'] text-[15px] leading-snug">{policy.title}</h3>
                  <span className="chip tone-blue mt-1">{policy.category}</span>
                </div>
              </div>
              {(canEdit || canDelete) && (
                <div className="flex gap-1">
                  {canEdit && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`edit-policy-${policy.id}`}
                    onClick={() => {
                      setEditingPolicy(policy);
                      setPolicyForm({ title: policy.title, category: policy.category, content: policy.content, icon: policy.icon || "article", sort_order: policy.sort_order || 0 });
                      setPolicyDialogOpen(true);
                    }}
                    className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[#0020F8] hover:bg-[var(--brand-primary-light)]"
                  >
                    <PencilLine className="h-4 w-4" />
                  </Button>
                  )}
                  {canDelete && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`delete-policy-${policy.id}`}
                    onClick={() => handleDeletePolicy(policy.id)}
                    className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[color:var(--badge-red-text)] hover:bg-[var(--badge-red-bg)]"
                  >
                    <TrashSimple className="h-4 w-4" />
                  </Button>
                  )}
                </div>
              )}
            </div>
            <div className="text-sm text-slate-600 whitespace-pre-line leading-relaxed pt-4 border-t border-slate-100">
              {policy.content}
            </div>
          </div>
        ))}
      </div>

      {policies.length === 0 && (
        <div className="section-card flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
          <span className="stat-icon tone-blue"><Scroll className="h-5 w-5" weight="duotone" /></span>
          <div>
            <p className="text-sm font-semibold text-slate-900">No policies added yet</p>
            {canEdit && <p className="text-xs text-slate-500 mt-1">Click "Add Policy" to create company policies.</p>}
          </div>
        </div>
      )}

      {/* Policy Add/Edit Dialog */}
      <Dialog open={policyDialogOpen} onOpenChange={setPolicyDialogOpen}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">
              {editingPolicy ? "Edit Policy" : "Add New Policy"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Title</Label>
              <Input
                data-testid="policy-title-input"
                placeholder="e.g., Leave Policy"
                value={policyForm.title}
                onChange={(e) => setPolicyForm({ ...policyForm, title: e.target.value })}
                className="rounded-xl h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Category</Label>
              <Select value={policyForm.category} onValueChange={(v) => setPolicyForm({ ...policyForm, category: v })}>
                <SelectTrigger data-testid="policy-category-select" className="rounded-xl h-11">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Leave">Leave</SelectItem>
                  <SelectItem value="Attendance">Attendance</SelectItem>
                  <SelectItem value="Shift">Shift</SelectItem>
                  <SelectItem value="Permission">Permission</SelectItem>
                  <SelectItem value="Holiday">Holiday</SelectItem>
                  <SelectItem value="Payroll">Payroll</SelectItem>
                  <SelectItem value="General">General</SelectItem>
                  <SelectItem value="Conduct">Conduct</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Content</Label>
              <textarea
                data-testid="policy-content-input"
                className="flex min-h-[160px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                placeholder="Write the policy details here..."
                value={policyForm.content}
                onChange={(e) => setPolicyForm({ ...policyForm, content: e.target.value })}
              />
            </div>
            <Button
              data-testid="save-policy-btn"
              onClick={handleSavePolicy}
              disabled={loading}
              className="w-full h-11 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl"
            >
              {editingPolicy ? "Update Policy" : "Add Policy"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
