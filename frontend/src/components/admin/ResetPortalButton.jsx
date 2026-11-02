import { useState } from "react";
import { toast } from "sonner";
import { Trash, Eye, EyeSlash } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ResetPortalButton({ api, onDone }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleOpen = () => { setPassword(""); setError(""); setShowPw(false); setOpen(true); };

  const handleReset = async () => {
    if (!password) { setError("Enter your admin password to confirm."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/admin/reset-portal", { password });
      toast.success(res.data.message || "Portal reset complete");
      setOpen(false);
      onDone?.();
    } catch (e) {
      const msg = e.response?.data?.detail || "Reset failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        data-testid="reset-portal-btn"
        onClick={handleOpen}
        className="w-full mt-1 flex items-center gap-2 px-3 h-9 rounded-xl text-sm font-medium text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
      >
        <Trash className="h-4 w-4" />
        Reset Portal Data
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 font-['Outfit']">
              <span className="stat-icon tone-red" style={{ width: 34, height: 34, borderRadius: 10 }}><Trash className="h-[18px] w-[18px]" weight="duotone" /></span>
              Reset Portal Data
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 pt-1 text-sm text-slate-600">
                <p>This will permanently delete:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>All employees (your account is kept)</li>
                  <li>All attendance, leave &amp; payroll records</li>
                  <li>All change requests and uploaded media</li>
                </ul>
                <p className="font-medium text-slate-700">
                  Worker Tree data is <span className="text-[color:var(--badge-green-text)]">preserved</span>.
                </p>
                <div className="pt-1">
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Confirm with your admin password
                  </label>
                  <div className="relative">
                    <input
                      data-testid="reset-password-input"
                      type={showPw ? "text" : "password"}
                      value={password}
                      onChange={e => { setPassword(e.target.value); setError(""); }}
                      onKeyDown={e => e.key === "Enter" && handleReset()}
                      placeholder="Enter your password"
                      className="w-full h-11 border border-slate-200 rounded-xl px-3 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 bg-white"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPw ? <EyeSlash size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 h-11 rounded-xl" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="reset-confirm-btn"
              disabled={!password || loading}
              onClick={handleReset}
              className="flex-1 h-11 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white disabled:opacity-40"
            >
              {loading ? "Resetting…" : "Reset Everything"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
