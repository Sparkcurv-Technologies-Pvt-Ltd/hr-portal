import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

// Edit an employee's leave / permission / WFH allocations (opened from the Employees table)
export function LeaveBalanceDialog({ open, onOpenChange, employee, form, setForm, onSave, loading }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-['Outfit']">Edit Leave Balance — {employee?.name}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-slate-500 -mt-2">Customize leave allocations for this employee.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          {[
            { key: "casual_leave", label: "Casual Leave (days)" },
            { key: "sick_leave", label: "Sick Leave (days)" },
            { key: "loss_of_pay", label: "Loss of Pay (days)" },
            { key: "permission_hours", label: "Permission Hours" },
            { key: "wfh_limit", label: "WFH Limit (days/month)" },
          ].map(({ key, label }) => (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">{label}</Label>
              <Input
                data-testid={`lb-${key}`}
                type="number"
                min="0"
                step={key === "wfh_limit" ? "1" : "0.5"}
                placeholder={key === "wfh_limit" ? "No limit" : "0"}
                value={form[key] ?? ""}
                onChange={e => {
                  const raw = e.target.value;
                  const val = raw === "" ? null : (key === "wfh_limit" ? parseInt(raw) : parseFloat(raw));
                  setForm(f => ({ ...f, [key]: isNaN(val) ? null : val }));
                }}
                className="rounded-xl h-11"
              />
              {key === "wfh_limit" && (
                <p className="text-xs text-slate-400">Clear to remove limit</p>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <Button variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button data-testid="save-leave-balance-btn" onClick={onSave} disabled={loading} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl">
            Save Leave Balance
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
