import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PromptDialog } from "./Prompt";
import { ProposalEditor } from "./ProposalEditor";
import { ContractPaperwork, AgreementPill } from "./ContractPaperwork";
import { TONES, Pill, apiError, day, errorDetail, money, selectClass } from "./constants";

const primary = "bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";
const Empty = ({ children }) => <p className="text-center text-sm py-10" style={{ color: "var(--text-subtle)" }}>{children}</p>;

function useList(api, url, params) {
  const [rows, setRows] = useState(null);
  const key = JSON.stringify(params || {});
  const load = useCallback(async () => {
    try { const { data } = await api.get(url, { params }); setRows(data); } catch (e) { toast.error(apiError(e, "Couldn't load")); setRows([]); }
  }, [api, url, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [rows, load];
}

export function ProposalsPanel({ api, user, level }) {
  const [rows, load] = useList(api, "/client-mgmt/proposals");
  const [open, setOpen] = useState(null);
  const shown = rows || [];
  return (
    <div className="section-card p-4 sm:p-5" data-testid="proposals-panel">
      <h3 className="font-bold font-['Outfit'] mb-3">Proposals</h3>
      <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><thead><tr>{["Code", "Title", "Client", "Opportunity", "Total", "Status", "Review"].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
        <tbody>{shown.map(p => (
          <tr key={p.id} className="table-row cursor-pointer" onClick={() => setOpen(p)} data-testid={`proposal-row-${p.id}`}>
            <td className="table-cell font-semibold">{p.code}</td><td className="table-cell">{p.title}</td><td className="table-cell">{p.client_name}</td><td className="table-cell text-xs">{p.opportunity_name || "—"}</td><td className="table-cell">{money(p.total_amount)}</td>
            <td className="table-cell"><Pill tone={TONES.proposal[p.status]}>{p.status}</Pill></td><td className="table-cell">{p.status === "SENT" ? <Pill tone={TONES.review[p.review_status]}>{p.review_status.replace("_", " ").toLowerCase()}</Pill> : "—"}</td></tr>))}</tbody></table>
        {rows && shown.length === 0 && <Empty>No proposals here yet.</Empty>}</div>
      {open && <ProposalEditor api={api} proposalId={open.id} open onOpenChange={(o) => !o && setOpen(null)} level={level} isOwner={open.owner_id === user.id} onChanged={load} />}
    </div>
  );
}

export function ContractsPanel({ api, level, canAccounts, openId }) {
  const [rows, load] = useList(api, "/client-mgmt/contracts");
  const [engage, setEngage] = useState(null);
  const [edit, setEdit] = useState(null);
  const [status, setStatus] = useState(null);
  const [paper, setPaper] = useState(openId || null);
  const isMgr = level === "mgr";
  const shown = rows || [];
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(apiError(e, "That didn't work")); e.handled = true; throw e; } };
  return (
    <div className="section-card p-4 sm:p-5" data-testid="contracts-panel">
      <h3 className="font-bold font-['Outfit'] mb-3">Contracts</h3>
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px]"><thead><tr>{["Code", "Client", "PO", "Value", "Margin", "Period", "Engagement", "Agreement", "Status", ""].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
        <tbody>{shown.map(k => (
          <tr key={k.id} className="table-row" data-testid={`contract-row-${k.id}`}>
            <td className="table-cell font-semibold whitespace-nowrap">{k.code}<span className="block text-[11px] font-normal" style={{ color: "var(--text-subtle)" }}>{k.contract_no || ""}</span></td><td className="table-cell">{k.client_name}</td><td className="table-cell whitespace-nowrap">{k.po_reference || "—"}</td>
            <td className="table-cell whitespace-nowrap">{money(k.contract_value)}</td><td className="table-cell">{k.margin_pct == null ? "—" : `${k.margin_pct}%`}</td><td className="table-cell text-xs whitespace-nowrap">{day(k.start_date)} →<br />{day(k.end_date)}</td>
            <td className="table-cell">{k.engagement_name || "—"}</td><td className="table-cell"><span className="whitespace-nowrap"><AgreementPill status={k.agreement_status} /></span><span className="block text-[11px] mt-0.5" style={{ color: k.po_files ? "#059669" : "var(--text-subtle)" }}>{k.po_files ? "PO on file" : "no PO document"}</span></td><td className="table-cell"><Pill tone={TONES.contract[k.status]}>{k.status}</Pill></td>
            <td className="table-cell"><div className="flex flex-wrap gap-1 min-w-[12rem]">
              <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setPaper(k.id)} data-testid={`paperwork-${k.id}`}>Paperwork</Button>
              {k.status === "DRAFT" && isMgr && <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={() => setEngage(k)} data-testid={`engage-${k.id}`}>Create engagement</Button>}
              {k.status === "DRAFT" && isMgr && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setEdit({ ...k })} data-testid={`edit-contract-${k.id}`}>Edit</Button>}
              {k.status === "ACTIVE" && isMgr && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setStatus(k)} data-testid={`close-${k.id}`}>Close out</Button>}</div></td></tr>))}</tbody></table>
        {rows && shown.length === 0 && <Empty>No contracts yet. They appear when a PO is booked.</Empty>}</div>

      <PromptDialog open={!!engage} onOpenChange={(o) => !o && setEngage(null)} title="Create the engagement" submitLabel="Create engagement"
        fields={[{ key: "name", label: "Project name", initial: engage ? `${engage.client_name} – ${engage.code}` : "" }, { key: "project_id", label: "…or link an existing project (id)", type: "number" }]}
        onSubmit={(v) => act(() => api.post(`/client-mgmt/contracts/${engage.id}/engagement`, v.project_id ? { project_id: Number(v.project_id) } : { name: v.name }), "Engagement created — the contract is active")} />
      <PromptDialog open={!!status} onOpenChange={(o) => !o && setStatus(null)} title="Close out the contract" submitLabel="Close out"
        fields={[{ key: "status", label: "Outcome (COMPLETED or TERMINATED)", initial: "COMPLETED", required: true }, { key: "note", label: "Note", type: "textarea" }]}
        onSubmit={(v) => act(() => api.post(`/client-mgmt/contracts/${status.id}/status`, { status: v.status.toUpperCase(), note: v.note || "" }), "Contract closed")} />
      {paper && <ContractPaperwork api={api} contractId={paper} open onOpenChange={(o) => !o && setPaper(null)} canEdit={isMgr} onChanged={load} />}
      {edit && <EditContract api={api} k={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function EditContract({ api, k, onClose, onSaved }) {
  const [f, setF] = useState({ contract_no: k.contract_no || "", po_reference: k.po_reference || "", po_date: k.po_date || "", start_date: k.start_date || "", end_date: k.end_date || "", contract_value: k.contract_value, estimated_cost: k.estimated_cost });
  const save = async () => { try { await api.put(`/client-mgmt/contracts/${k.id}`, { ...f, po_date: f.po_date || null, start_date: f.start_date || null, end_date: f.end_date || null, contract_value: Number(f.contract_value), estimated_cost: Number(f.estimated_cost) }); toast.success("Contract updated"); onSaved(); } catch (e) { toast.error(apiError(e, "Couldn't save")); } };
  const field = (key, label, type = "text") => <div><Label className="text-xs">{label}</Label><Input type={type} value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })} data-testid={`ec-${key}`} /></div>;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Edit {k.code}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">{field("contract_no", "Contract no.")}{field("po_reference", "PO reference")}{field("po_date", "PO date", "date")}{field("contract_value", "Contract value", "number")}{field("start_date", "Start", "date")}{field("end_date", "End", "date")}{field("estimated_cost", "Estimated cost", "number")}</div>
      <Button onClick={save} className={`w-full ${primary}`} data-testid="ec-save">Save</Button></DialogContent></Dialog>
  );
}
