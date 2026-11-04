import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INDUSTRIES, apiError, selectClass } from "./constants";

const primary = "bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";

// Convert: finds / creates the account by company name and opens a Discovery opportunity
export function ConvertDialog({ api, lead, onClose, onDone }) {
  const [f, setF] = useState({ opp_name: "", deal_value: "", expected_close_date: "", industry: "", start_cadence: true });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/client-mgmt/leads/${lead.id}/convert`, { start_cadence: f.start_cadence, opp_name: f.opp_name || undefined, deal_value: f.deal_value === "" ? undefined : Number(f.deal_value), expected_close_date: f.expected_close_date || undefined, industry: f.industry || undefined });
      toast.success(`Converted — opportunity ${data.opportunity.code}${data.account_created ? " and a new account" : ""}`); onDone(data);
    } catch (e) { toast.error(apiError(e, "Couldn't convert")); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md" data-testid="convert-dialog">
        <DialogHeader><DialogTitle>Convert {lead.company_name || lead.code}</DialogTitle></DialogHeader>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Finds the account by company name (or creates it) and opens an opportunity at Discovery. Do this once a demo call is scheduled.</p>
        <div className="space-y-3">
          <div><Label>Opportunity name (optional)</Label><Input value={f.opp_name} onChange={e => setF({ ...f, opp_name: e.target.value })} placeholder={`${lead.company_name || "Company"} - Nov 26`} data-testid="cv-name" /></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Deal value (INR)</Label><Input type="number" value={f.deal_value} onChange={e => setF({ ...f, deal_value: e.target.value })} data-testid="cv-value" /></div>
            <div><Label>Expected close</Label><Input type="date" value={f.expected_close_date} onChange={e => setF({ ...f, expected_close_date: e.target.value })} /></div></div>
          <div><Label>Industry (for a new account)</Label><select className={selectClass} value={f.industry} onChange={e => setF({ ...f, industry: e.target.value })}><option value="">—</option>{INDUSTRIES.map(i => <option key={i}>{i}</option>)}</select></div>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={f.start_cadence} onChange={e => setF({ ...f, start_cadence: e.target.checked })} /> Start the follow-up cadence (Email 1 due today)</label>
          <Button onClick={go} disabled={busy} className={`w-full ${primary}`} data-testid="cv-submit">{busy ? "Converting…" : "Convert"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

