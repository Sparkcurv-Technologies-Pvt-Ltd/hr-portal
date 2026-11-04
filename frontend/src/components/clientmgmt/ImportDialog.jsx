import { useRef, useState } from "react";
import { toast } from "sonner";
import { UploadSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiError } from "./constants";

const KIND = { leads: "Leads", accounts: "Accounts", opportunities: "Opportunities", followups: "Follow-ups", activity: "Activity log" };

// Import the Sales CRM workbook (.xlsx) or one sheet (.csv): preview what would happen, pick the sheets, then import. Safe to run again — existing rows are skipped.
export function ImportDialog({ api, open, onOpenChange, onDone }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [picked, setPicked] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const send = async (apply, sheets) => {
    const fd = new FormData(); fd.append("file", file);
    const { data } = await api.post("/client-mgmt/import", fd, { params: { apply, ...(sheets ? { sheets: sheets.join(",") } : {}) } });
    return data;
  };
  const choose = async (e) => {
    const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
    setFile(f); setPreview(null); setResult(null); setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", f);
      const { data } = await api.post("/client-mgmt/import", fd, { params: { apply: false } });
      setPreview(data); setPicked(Object.fromEntries(data.sheets.filter(s => s.kind).map(s => [s.sheet, true])));
    } catch (er) { toast.error(apiError(er, "Couldn't read that file")); setFile(null); } finally { setBusy(false); }
  };
  const run = async () => {
    setBusy(true);
    try { const data = await send(true, Object.keys(picked).filter(k => picked[k])); setResult(data); toast.success("Import finished"); onDone?.(); }
    catch (er) { toast.error(apiError(er, "Import failed")); } finally { setBusy(false); }
  };
  const shown = result || preview;
  const total = shown ? shown.sheets.reduce((n, s) => n + (picked[s.sheet] || result ? s.created : 0), 0) : 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFile(null); setPreview(null); setResult(null); } }}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto" data-testid="import-dialog">
        <DialogHeader><DialogTitle>Import the Sales CRM workbook</DialogTitle></DialogHeader>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>Choose the <strong>.xlsx</strong> workbook (or one sheet as .csv). Sheets are recognised by their headings (Lead ID, Account ID, Opportunity ID, Follow-up ID, Log ID), so title rows and the per-BDR copies work. Nothing is written until you press Import, and running it again skips what already exists.</p>
        <input ref={ref} type="file" accept=".xlsx,.csv" className="hidden" onChange={choose} data-testid="import-file" />
        <div className="flex items-center gap-3"><Button variant="outline" className="rounded-xl h-10" onClick={() => ref.current?.click()} disabled={busy}><UploadSimple className="h-4 w-4 mr-1.5" /> {file ? "Choose another file" : "Choose file"}</Button><span className="text-sm">{file?.name}</span></div>
        {busy && !shown && <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Reading…</p>}
        {shown && (
          <div className="overflow-x-auto" data-testid="import-result"><table className="w-full min-w-[560px]"><thead><tr>{!result && <th className="table-header w-8" />}{["Sheet", "Looks like", "Rows", result ? "Created" : "Would create", "Skipped / existing"].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
            <tbody>{shown.sheets.map(s => (
              <tr key={s.sheet} className="table-row align-top" data-testid={`import-sheet-${s.sheet}`}>
                {!result && <td className="table-cell">{s.kind && <input type="checkbox" checked={!!picked[s.sheet]} onChange={e => setPicked({ ...picked, [s.sheet]: e.target.checked })} aria-label={`Import ${s.sheet}`} />}</td>}
                <td className="table-cell font-semibold">{s.sheet}</td><td className="table-cell text-xs">{s.kind ? KIND[s.kind] : <span style={{ color: "var(--text-subtle)" }}>{s.note || "skipped"}</span>}</td>
                <td className="table-cell">{s.kind ? s.rows : "—"}</td><td className="table-cell font-semibold">{s.kind && !s.note ? s.created : s.kind ? "—" : ""}{s.updated ? ` (+${s.updated} filled)` : ""}</td>
                <td className="table-cell">{s.kind && !s.note ? s.skipped : ""}{s.errors?.length > 0 && <details className="text-[11px]"><summary className="cursor-pointer">{s.errors.length} problem row(s)</summary>{s.errors.map((er, i) => <p key={i}>Row {er.row}: {er.reason}</p>)}</details>}</td></tr>))}</tbody></table></div>)}
        {preview && !result && <Button onClick={run} disabled={busy || total === 0} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="import-run">{busy ? "Importing…" : `Import ${total} new row${total === 1 ? "" : "s"}`}</Button>}
        {result && <p className="text-sm font-semibold" style={{ color: "#059669" }} data-testid="import-done">Done. Run it again any time — nothing will be duplicated.</p>}
      </DialogContent>
    </Dialog>
  );
}
