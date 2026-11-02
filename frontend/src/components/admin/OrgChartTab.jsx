import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { X, Plus, PencilLine, TreeStructure } from "@phosphor-icons/react";
import { OrgTreeNode } from "@/components/common/OrgTreeNode";
import { compressImage } from "@/lib/image";
import { usePermissions } from "@/hooks/usePermissions";

export function OrgChartTab({
  api, isAdmin, orgNodes, setOrgNodes, orgLevels, setOrgLevels, loading, setLoading
}) {
  const { can } = usePermissions();
  const canEdit = can("org-chart", "edit");
  const canDelete = can("org-chart", "delete");
  const [orgNodeDialogOpen, setOrgNodeDialogOpen] = useState(false);
  const [editingOrgNode, setEditingOrgNode] = useState(null);
  const [orgNodeForm, setOrgNodeForm] = useState({ employee_name: "", job_title: "", description: "", parent_id: "", sort_order: 0, level_num: 0 });

  const [editLevelsOpen, setEditLevelsOpen] = useState(false);
  const [levelsForm, setLevelsForm] = useState([]);

  const handleSaveOrgLevels = async () => {
    try {
      await api.put("/admin/org-levels", levelsForm);
      setOrgLevels(levelsForm);
      setEditLevelsOpen(false);
      toast.success("Level labels saved!");
    } catch (e) {
      toast.error("Failed to save level labels");
    }
  };

  const openEditLevels = () => {
    // Pre-populate from current nodes (auto-detect max depth)
    const maxDepth = Math.max(0, ...orgNodes.map(n => {
      // rough depth via parent traversal
      let d = 0, cur = n;
      while (cur.parent_id) { d++; cur = orgNodes.find(x => x.id === cur.parent_id) || {}; if (d > 10) break; }
      return d;
    }));
    const levels = Array.from({ length: Math.max(maxDepth + 1, orgLevels.length, 3) }, (_, i) => {
      const existing = orgLevels.find(l => l.level_num === i);
      return { level_num: i, label: existing?.label || ["Executive", "Director", "Manager", "Team Lead", "Employee", "Associate"][i] || `Level ${i + 1}` };
    });
    setLevelsForm(levels);
    setEditLevelsOpen(true);
  };

  // ── Org Chart Handlers ──────────────────────────────────────────────
  const handleSaveOrgNode = async () => {
    setLoading(true);
    try {
      const payload = {
        ...orgNodeForm,
        parent_id: orgNodeForm.parent_id ? parseInt(orgNodeForm.parent_id) : null,
        sort_order: parseInt(orgNodeForm.sort_order) || 0,
        level_num: parseInt(orgNodeForm.level_num) || 0
      };
      if (editingOrgNode) {
        await api.put(`/admin/org-chart/${editingOrgNode.id}`, payload);
        toast.success("Node updated");
      } else {
        await api.post("/admin/org-chart", payload);
        toast.success("Node added");
      }
      setOrgNodeDialogOpen(false);
      api.get("/admin/org-chart").then(r => setOrgNodes(r.data)).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteOrgNode = async (nodeId) => {
    if (!window.confirm("Delete this node?")) return;
    try {
      await api.delete(`/admin/org-chart/${nodeId}`);
      toast.success("Node deleted");
      api.get("/admin/org-chart").then(r => setOrgNodes(r.data)).catch(() => {});
    } catch (e) {
      toast.error("Failed to delete");
    }
  };

  const handleOrgNodeImageUpload = async (nodeId, file) => {
    try {
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("file", compressed);
      await api.post(`/admin/org-chart/${nodeId}/image`, formData);
      toast.success("Image uploaded");
      api.get("/admin/org-chart").then(r => setOrgNodes(r.data)).catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail || "Image upload failed");
    }
  };

  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Worker Tree</h1>
          <p className="text-slate-500 mt-1 text-sm">Organizational hierarchy — managers and employees can view</p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              data-testid="edit-levels-btn"
              variant="outline"
              onClick={openEditLevels}
              className="gap-2 rounded-xl h-10 px-4"
            >
              <PencilLine className="h-4 w-4" /> Edit Levels
            </Button>
            <Button
              data-testid="add-org-node-btn"
              onClick={() => { setEditingOrgNode(null); setOrgNodeForm({ employee_name: "", job_title: "", description: "", parent_id: "", sort_order: 0, level_num: 0 }); setOrgNodeDialogOpen(true); }}
              className="bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2 rounded-xl h-10 px-4"
            >
              <Plus className="h-4 w-4" weight="bold" /> Add Person
            </Button>
          </div>
        )}
      </div>

      {/* Org Tree Render */}
      {orgNodes.length === 0 ? (
        <div className="section-card flex flex-col items-center justify-center text-center py-20 px-6 gap-3">
          <span className="stat-icon tone-blue"><TreeStructure className="h-5 w-5" weight="duotone" /></span>
          <div>
            <p className="text-sm font-semibold text-slate-900">No org chart yet</p>
            {canEdit && <p className="text-xs text-slate-500 mt-1">Click "Add Person" to start building the worker tree.</p>}
          </div>
        </div>
      ) : (
        <OrgTreeNode
          nodes={orgNodes}
          levelLabels={orgLevels}
          isAdmin={canEdit || canDelete}
          onEdit={canEdit ? (node) => { setEditingOrgNode(node); setOrgNodeForm({ employee_name: node.employee_name, job_title: node.job_title || "", description: node.description || "", parent_id: node.parent_id || "", sort_order: node.sort_order || 0, level_num: node.level_num ?? 0 }); setOrgNodeDialogOpen(true); } : undefined}
          onDelete={canDelete ? handleDeleteOrgNode : undefined}
          onImageUpload={canEdit ? handleOrgNodeImageUpload : undefined}
        />
      )}

      {/* Org Node Add/Edit Dialog */}
      <Dialog open={orgNodeDialogOpen} onOpenChange={setOrgNodeDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">{editingOrgNode ? "Edit Person" : "Add Person"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Full Name <span className="text-red-500">*</span></Label>
              <Input data-testid="org-name-input" value={orgNodeForm.employee_name} onChange={e => setOrgNodeForm(f => ({ ...f, employee_name: e.target.value }))} placeholder="e.g. John Smith" className="rounded-xl h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Job Title</Label>
              <Input data-testid="org-title-input" value={orgNodeForm.job_title} onChange={e => setOrgNodeForm(f => ({ ...f, job_title: e.target.value }))} placeholder="e.g. Senior Engineer" className="rounded-xl h-11" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Level <span className="text-red-500">*</span></Label>
              <Select data-testid="org-level-select" value={String(orgNodeForm.level_num)} onValueChange={v => setOrgNodeForm(f => ({ ...f, level_num: parseInt(v) }))}>
                <SelectTrigger data-testid="org-level-select-trigger" className="rounded-xl h-11"><SelectValue placeholder="Select level" /></SelectTrigger>
                <SelectContent>
                  {orgLevels.length > 0
                    ? orgLevels.map(l => (
                        <SelectItem key={l.level_num} value={String(l.level_num)}>
                          L{l.level_num + 1} — {l.label}
                        </SelectItem>
                      ))
                    : [0, 1, 2, 3, 4].map(i => (
                        <SelectItem key={i} value={String(i)}>L{i + 1}</SelectItem>
                      ))
                  }
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Reports To (Parent)</Label>
              <Select value={String(orgNodeForm.parent_id)} onValueChange={v => setOrgNodeForm(f => ({ ...f, parent_id: v === "none" ? "" : v }))}>
                <SelectTrigger data-testid="org-parent-select" className="rounded-xl h-11"><SelectValue placeholder="No parent (top level)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No parent (top level)</SelectItem>
                  {orgNodes.filter(n => !editingOrgNode || n.id !== editingOrgNode.id).map(n => (
                    <SelectItem key={n.id} value={String(n.id)}>{n.employee_name} {n.job_title ? `(${n.job_title})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Description / Notes</Label>
              <Input data-testid="org-desc-input" value={orgNodeForm.description} onChange={e => setOrgNodeForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. Manages engineering team" className="rounded-xl h-11" />
            </div>
            <Button data-testid="save-org-node-btn" onClick={handleSaveOrgNode} disabled={loading || !orgNodeForm.employee_name} className="w-full h-11 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl">
              {editingOrgNode ? "Update" : "Add Person"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Leave Balance Edit Dialog (global — used from employee table) */}

      {/* Edit Level Labels Dialog */}
      <Dialog open={editLevelsOpen} onOpenChange={setEditLevelsOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Edit Level Labels</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-slate-500 -mt-2">Rename each swimlane level to match your hierarchy.</p>
          <div className="space-y-3 pt-2 max-h-80 overflow-y-auto pr-1">
            {levelsForm.map((lvl, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="flex-shrink-0 w-10 h-10 rounded-xl text-white text-xs font-bold flex items-center justify-center" style={{ background: "var(--brand-gradient)" }}>
                  L{lvl.level_num + 1}
                </span>
                <Input
                  data-testid={`level-label-${lvl.level_num}`}
                  value={lvl.label}
                  placeholder={`Level ${lvl.level_num + 1}`}
                  onChange={e => setLevelsForm(f => f.map((l, idx) => idx === i ? { ...l, label: e.target.value } : l))}
                  className="rounded-xl h-11"
                />
                {levelsForm.length > 1 && (
                  <button
                    onClick={() => setLevelsForm(f => f.filter((_, idx) => idx !== i).map((l, idx) => ({ ...l, level_num: idx })))}
                    title="Remove level"
                    className="h-8 w-8 flex items-center justify-center flex-shrink-0 rounded-lg text-slate-400 hover:text-[color:var(--badge-red-text)] hover:bg-[var(--badge-red-bg)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => setLevelsForm(f => [...f, { level_num: f.length, label: `Level ${f.length + 1}` }])}
              className="flex-1 h-11 rounded-xl border-dashed"
            >
              <Plus className="h-4 w-4 mr-1" /> Add Level
            </Button>
            <Button
              data-testid="save-levels-btn"
              onClick={handleSaveOrgLevels}
              className="flex-1 h-11 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl"
            >
              Save Labels
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
