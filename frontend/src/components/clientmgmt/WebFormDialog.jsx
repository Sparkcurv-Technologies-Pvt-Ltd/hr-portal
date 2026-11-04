import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ArrowSquareOut, Check } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiError } from "./constants";

function CopyRow({ label, value, testId, multiline }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1800); toast.success("Copied"); }
    catch { toast.error("Couldn't copy — select the text and copy it"); }
  };
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2 mt-1 items-start">
        {multiline
          ? <textarea readOnly rows={3} value={value} onFocus={e => e.target.select()} className="flex-1 min-w-0 rounded-xl border px-3 py-2 text-xs font-mono bg-white" data-testid={testId} />
          : <input readOnly value={value} onFocus={e => e.target.select()} className="flex-1 min-w-0 h-10 rounded-xl border px-3 text-sm bg-white" data-testid={testId} />}
        <Button variant="outline" className="rounded-xl h-10 flex-shrink-0" onClick={copy} data-testid={`${testId}-copy`}>{done ? <Check className="h-4 w-4 mr-1.5" /> : <Copy className="h-4 w-4 mr-1.5" />}{done ? "Copied" : "Copy"}</Button>
      </div>
    </div>
  );
}

// The public lead-capture form: a link to share (website, email signature, QR code) and an embed snippet
export function WebFormDialog({ api, open, onOpenChange }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setInfo(null);
    api.get("/client-mgmt/web-form").then(r => live && setInfo(r.data)).catch(e => { if (live) { toast.error(apiError(e, "Couldn't load the web form link")); onOpenChange(false); } });
    return () => { live = false; };
  }, [open, api]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="webform-dialog">
        <DialogHeader><DialogTitle>Web form link</DialogTitle></DialogHeader>
        {!info ? <p className="text-sm py-6 text-center" style={{ color: "var(--text-subtle)" }}>Loading…</p> : (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>Share this link, or embed the form on your website. Anyone can fill it in without logging in; each submission becomes a <strong>New</strong> lead (source Website) with no owner, for a manager to assign. If the email or phone already belongs to a lead, it is added to that lead as a note instead.</p>
            <CopyRow label="Form link" value={info.url} testId="webform-url" />
            <a href={info.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: "var(--brand-primary)" }} data-testid="webform-open"><ArrowSquareOut className="h-4 w-4" /> Open the form</a>
            <CopyRow label="Embed on your website" value={info.embed} testId="webform-embed" multiline />
          </div>)}
      </DialogContent>
    </Dialog>
  );
}
