import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Check, X } from "@phosphor-icons/react";
import { CR_AUTO_APPLY_TYPES as AUTO_APPLY_TYPES } from "@/lib/constants";
import { usePermissions } from "@/hooks/usePermissions";

function parseMeta(metadata) {
  if (!metadata) return null;
  try {
    return typeof metadata === "string" ? JSON.parse(metadata) : metadata;
  } catch {
    return null;
  }
}

export function CRApproveDialog({ open, onOpenChange, cr, applyData, onApplyDataChange, onConfirm }) {
  const { can } = usePermissions();
  if (!cr) return null;
  const meta = parseMeta(cr.metadata);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-['Outfit']">Review &amp; Approve Change Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {/* CR Details */}
          <div className="rounded-xl p-4 space-y-2 border" style={{ background: "var(--surface-elevated)", borderColor: "var(--border-color)" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="chip tone-blue">{cr.cr_type}</span>
              <span className={`chip capitalize ${
                cr.priority === "high" ? "tone-red" :
                cr.priority === "low" ? "tone-green" :
                "tone-amber"
              }`}>{cr.priority} priority</span>
            </div>
            <p className="font-bold text-slate-900 text-[15px] font-['Outfit'] pt-1">{cr.title}</p>
            <p className="text-sm text-slate-600 leading-relaxed">{cr.description}</p>
            <p className="text-xs text-slate-400">
              Requested by: <span className="font-medium text-slate-600">{cr.requester_name}</span>
            </p>
            {meta?.requested_value && (
              <p className="text-xs text-slate-500">
                Requested value: <span className="font-bold text-slate-700">{meta.requested_value}</span>
              </p>
            )}
          </div>

          {/* Auto-apply value field */}
          {AUTO_APPLY_TYPES.includes(cr.cr_type) && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">
                {cr.cr_type === "Salary Revision" && "New Salary (₹)"}
                {cr.cr_type === "Leave Adjustment" && "Casual Leave Days to Set"}
                {cr.cr_type === "Shift Change" && "New Shift (HH:MM-HH:MM)"}
              </Label>
              <Input
                data-testid="cr-apply-value-input"
                type={cr.cr_type === "Shift Change" ? "text" : "number"}
                min="0"
                placeholder={
                  cr.cr_type === "Salary Revision" ? "e.g. 50000" :
                  cr.cr_type === "Leave Adjustment" ? "e.g. 15" :
                  "e.g. 09:30-17:30"
                }
                value={applyData.apply_value}
                onChange={e => onApplyDataChange({ ...applyData, apply_value: e.target.value })}
                className="rounded-xl h-11"
              />
              <p className="text-xs text-slate-400">This value will be auto-applied to the employee record on approval.</p>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-slate-600">Admin Notes (optional)</Label>
            <Input
              data-testid="cr-admin-notes-input"
              placeholder="Add notes..."
              value={applyData.notes}
              onChange={e => onApplyDataChange({ ...applyData, notes: e.target.value })}
              className="rounded-xl h-11"
            />
          </div>

          {/* Actions */}
          {can("change-requests", "edit") && (
          <div className="flex gap-3 pt-1">
            <Button
              data-testid="cr-confirm-approve-btn"
              onClick={() => onConfirm("approve")}
              className="flex-1 h-11 bg-[#0020F8] hover:bg-[#0019C4] text-white rounded-xl"
            >
              <Check className="h-4 w-4 mr-2" /> Approve &amp; Apply
            </Button>
            <Button
              data-testid="cr-confirm-reject-btn"
              variant="outline"
              onClick={() => onConfirm("reject")}
              className="flex-1 h-11 rounded-xl text-[color:var(--badge-red-text)] border-[color:var(--badge-red-border)] hover:bg-[var(--badge-red-bg)] hover:text-[color:var(--badge-red-text)]"
            >
              <X className="h-4 w-4 mr-2" /> Reject
            </Button>
          </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
