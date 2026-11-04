import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiError } from "./constants";

const primary = "bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";

// Small one-field dialogs: lost reason, tender, proposal title
export function PromptDialog({ open, onOpenChange, title, fields, submitLabel, onSubmit }) {
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setVals(Object.fromEntries(fields.map(f => [f.key, f.initial || ""]))); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps
  const go = async () => {
    const missing = fields.find(f => f.required && !String(vals[f.key] || "").trim());
    if (missing) return toast.error(`Enter ${missing.label.toLowerCase()}`);
    setBusy(true);
    try { await onSubmit(vals); onOpenChange(false); } catch (e) { if (!e?.handled) toast.error(apiError(e, "That didn't work")); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">{fields.map(f => <div key={f.key}><Label>{f.label}</Label>{f.type === "textarea" ? <Textarea rows={3} value={vals[f.key] || ""} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} data-testid={`prompt-${f.key}`} /> : <Input type={f.type || "text"} value={vals[f.key] || ""} onChange={e => setVals({ ...vals, [f.key]: e.target.value })} data-testid={`prompt-${f.key}`} />}</div>)}
          <Button onClick={go} disabled={busy} className={primary} data-testid="prompt-submit">{busy ? "Saving…" : submitLabel}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
