import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PromptDialog } from "./Prompt";
import { ProposalEditor } from "./ProposalEditor";
import { useList, canEditRow } from "./data";
import { LEAD_SOURCES, OPP_STAGES, TONES, Pill, apiError, day, miniSelect, money, moneyShort, selectClass, todayStr } from "./constants";

const primary = "bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";

function ContractDialog({ api, opp, onClose, onDone }) {
  const [f, setF] = useState({ po_reference: "", po_date: todayStr(), contract_no: "", start_date: "", end_date: "", contract_value: "" });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { const { data } = await api.post(`/client-mgmt/opportunities/${opp.id}/contract`, { ...f, contract_value: f.contract_value === "" ? null : Number(f.contract_value), start_date: f.start_date || null, end_date: f.end_date || null, contract_no: f.contract_no || null }); toast.success(`Contract ${data.code} created`); onDone(data); }
    catch (e) { toast.error(apiError(e, "Couldn't create the contract")); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}><DialogContent className="max-w-md" data-testid="opp-contract-dialog"><DialogHeader><DialogTitle>Book the PO — {opp.opp_name}</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>PO reference</Label><Input value={f.po_reference} onChange={e => setF({ ...f, po_reference: e.target.value })} data-testid="oc-ref" /></div><div><Label>PO date</Label><Input type="date" value={f.po_date} onChange={e => setF({ ...f, po_date: e.target.value })} /></div>
        <div><Label>Contract no.</Label><Input value={f.contract_no} onChange={e => setF({ ...f, contract_no: e.target.value })} /></div><div><Label>Contract value</Label><Input type="number" placeholder={String(opp.deal_value ?? "")} value={f.contract_value} onChange={e => setF({ ...f, contract_value: e.target.value })} /></div>
        <div><Label>Start date</Label><Input type="date" value={f.start_date} onChange={e => setF({ ...f, start_date: e.target.value })} /></div><div><Label>End date</Label><Input type="date" value={f.end_date} onChange={e => setF({ ...f, end_date: e.target.value })} /></div>
      </div>
      <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>Creates the contract as a draft. Convert it to an engagement from Contracts, then invoice and collect.</p>
      <Button onClick={go} disabled={busy || !f.po_reference.trim()} className={primary} data-testid="oc-submit">Create contract</Button></DialogContent></Dialog>
  );
}

// One opportunity: edit it, draft proposals, start its follow-up cadence, book the PO once it is Closed Won
export function OpportunityDialog({ api, user, level, people, oppId, onClose, onChanged, onGoTo }) {
  const [opp, , reload] = useOne(api, `/client-mgmt/opportunities/${oppId}`);
  return opp ? <OppForm key={opp.updated_at} {...{ api, user, level, people, opp, onClose, onChanged, onGoTo, reload }} /> : null;
}

function useOne(api, url) {
  const [rows, load] = useList(api, url, undefined);
  return [rows && !Array.isArray(rows) ? rows : null, null, load];
}

function OppForm({ api, user, level, people, opp, onClose, onChanged, onGoTo, reload }) {
  const [f, setF] = useState({ opp_name: opp.opp_name, contact_person: opp.contact_person || "", stage: opp.stage, deal_value: opp.deal_value ?? "", expected_close_date: opp.expected_close_date || "", lead_source: opp.lead_source || "", next_action: opp.next_action || "", notes: opp.notes || "", owner_id: opp.owner_id ?? "" });
  const [busy, setBusy] = useState(false);
  const [proposals, reloadProposals] = useList(api, "/client-mgmt/proposals", useMemo(() => ({ opportunity_id: opp.id }), [opp.id]));
  const [fus, reloadFus] = useList(api, "/client-mgmt/followups", useMemo(() => ({ opportunity_id: opp.id }), [opp.id]));
  const [acts] = useList(api, "/client-mgmt/activity", useMemo(() => ({ client_id: opp.client_id, limit: 6 }), [opp.client_id]));
  const [newProposal, setNewProposal] = useState(false);
  const [editor, setEditor] = useState(null);
  const [contract, setContract] = useState(false);
  const mine = canEditRow(level, user, opp.owner_id);
  const closed = ["Closed Won", "Closed Lost"].includes(opp.stage);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/client-mgmt/opportunities/${opp.id}`, { opp_name: f.opp_name, contact_person: f.contact_person, stage: f.stage === opp.stage ? undefined : f.stage, deal_value: f.deal_value === "" ? null : Number(f.deal_value),
        expected_close_date: f.expected_close_date || null, lead_source: f.lead_source || null, next_action: f.next_action, notes: f.notes, ...(level === "mgr" && String(f.owner_id) !== String(opp.owner_id ?? "") ? { owner_id: f.owner_id ? Number(f.owner_id) : null } : {}) });
      toast.success("Opportunity saved"); onChanged(); reload();
    } catch (e) { toast.error(apiError(e, "Couldn't save")); } finally { setBusy(false); }
  };
  const startCadence = async () => { try { await api.post("/client-mgmt/followups", { opportunity_id: opp.id }); toast.success("Follow-up cadence started"); reloadFus(); onChanged(); } catch (e) { toast.error(apiError(e, "Couldn't start the cadence")); } };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[94vh] overflow-y-auto" data-testid="opportunity-dialog">
        <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2"><span className="text-sm font-semibold" style={{ color: "var(--text-subtle)" }}>{opp.code}</span><span className="break-words">{opp.opp_name}</span><Pill tone={TONES.stage[opp.stage]}>{opp.stage}</Pill></DialogTitle></DialogHeader>
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{opp.account_name} · BDR {opp.bdr || "—"} · probability {opp.probability}% · weighted {money(opp.weighted_value)}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2"><Label className="text-xs">Opportunity name</Label><Input value={f.opp_name} onChange={set("opp_name")} disabled={!mine} data-testid="op-name" /></div>
          <div><Label className="text-xs">Stage</Label><select className={selectClass} value={f.stage} onChange={set("stage")} disabled={!mine || (closed && level !== "mgr")} data-testid="op-stage">{OPP_STAGES.map(s => <option key={s}>{s}</option>)}</select></div>
          <div><Label className="text-xs">Deal value (INR)</Label><Input type="number" value={f.deal_value} onChange={set("deal_value")} disabled={!mine} data-testid="op-value" /></div>
          <div><Label className="text-xs">Contact person</Label><Input value={f.contact_person} onChange={set("contact_person")} disabled={!mine} /></div>
          <div><Label className="text-xs">Expected close date</Label><Input type="date" value={f.expected_close_date} onChange={set("expected_close_date")} disabled={!mine} /></div>
          <div><Label className="text-xs">Lead source</Label><select className={selectClass} value={f.lead_source} onChange={set("lead_source")} disabled={!mine}><option value="">—</option>{LEAD_SOURCES.map(s => <option key={s}>{s}</option>)}</select></div>
          {level === "mgr" ? <div><Label className="text-xs">BDR</Label><select className={selectClass} value={f.owner_id} onChange={set("owner_id")}><option value="">Unassigned</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div> : <div />}
          <div className="sm:col-span-2"><Label className="text-xs">Next action</Label><Input value={f.next_action} onChange={set("next_action")} disabled={!mine} data-testid="op-next" /></div>
          <div className="sm:col-span-2"><Label className="text-xs">Notes</Label><Textarea rows={3} value={f.notes} onChange={set("notes")} disabled={!mine} data-testid="op-notes" /></div>
        </div>
        {mine && <Button onClick={save} disabled={busy} className={primary} data-testid="op-save">{busy ? "Saving…" : "Save"}</Button>}

        <section data-testid="opp-followup"><h4 className="font-bold font-['Outfit'] mb-1.5">Follow-up cadence</h4>
          {(fus || []).length === 0 ? <div className="flex flex-wrap items-center gap-2 text-sm"><span style={{ color: "var(--text-subtle)" }}>Not started (Email 1 → Call 1 → … → Call 5).</span>{mine && !closed && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={startCadence} data-testid="start-cadence">Start cadence</Button>}</div>
            : (fus || []).map(x => <p key={x.id} className="text-sm">{x.code} · current step <strong>{x.current_step}</strong> <button className="underline ml-2 text-xs" onClick={() => onGoTo("followups")}>open tracker</button></p>)}</section>

        <section data-testid="opp-proposals"><div className="flex items-center justify-between mb-1.5"><h4 className="font-bold font-['Outfit']">Proposals</h4>{mine && !closed && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setNewProposal(true)} data-testid="new-proposal"><Plus className="h-3.5 w-3.5 mr-1" weight="bold" /> New proposal</Button>}</div>
          {(proposals || []).length === 0 && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>None yet. Draft one when the client asks for pricing.</p>}
          {(proposals || []).map(p => <div key={p.id} className="flex flex-wrap items-center gap-2 py-1 text-sm"><button className="font-semibold hover:underline" onClick={() => setEditor(p)}>{p.code} · {p.title}</button><span>{money(p.total_amount)}</span><Pill tone={TONES.proposal[p.status]}>{p.status}</Pill>{p.status === "SENT" && <Pill tone={TONES.review[p.review_status]}>{p.review_status.replace("_", " ").toLowerCase()}</Pill>}</div>)}</section>

        {opp.stage === "Closed Won" && (
          <section data-testid="opp-after-sales"><h4 className="font-bold font-['Outfit'] mb-1.5">After the sale</h4>
            {opp.contract_id ? <p className="text-sm">A contract exists. <button className="underline" onClick={() => onGoTo("contracts")} data-testid="go-contracts">Open contracts</button> to create the engagement, then invoice and collect payment.</p>
              : level === "mgr" ? <div className="flex flex-wrap items-center gap-2 text-sm"><span style={{ color: "var(--text-subtle)" }}>Won — book the client's PO to create the contract.</span><Button size="sm" className="rounded-lg h-8 bg-[#059669] text-white hover:bg-[#047857]" onClick={() => setContract(true)} data-testid="book-po-direct">Book PO / create contract</Button></div>
                : <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Won. A sales manager books the PO to create the contract.</p>}</section>)}

        <section><h4 className="font-bold font-['Outfit'] mb-1.5">Recent activity with {opp.account_name}</h4>{(acts || []).length === 0 && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>Nothing logged yet.</p>}
          {(acts || []).map(a => <p key={a.id} className="text-sm"><span className="chip tone-blue mr-2">{a.activity_type.toLowerCase()}</span>{day(a.log_date)} · {a.bdr} {a.outcome ? `· ${a.outcome}` : ""}{a.notes ? ` — ${a.notes}` : ""}</p>)}</section>

        <PromptDialog open={newProposal} onOpenChange={setNewProposal} title="New proposal" submitLabel="Create" fields={[{ key: "title", label: "Proposal title", required: true, initial: `Proposal for ${opp.account_name}` }]}
          onSubmit={async (v) => { const { data } = await api.post(`/client-mgmt/opportunities/${opp.id}/proposals`, { title: v.title, items: [] }); toast.success(`Proposal ${data.code} drafted`); reloadProposals(); onChanged(); setEditor(data); }} />
        {editor && <ProposalEditor api={api} proposalId={editor.id} open onOpenChange={(o) => { if (!o) { setEditor(null); reloadProposals(); reload(); onChanged(); } }} level={level} isOwner={mine} onChanged={() => { reloadProposals(); reload(); onChanged(); }} />}
        {contract && <ContractDialog api={api} opp={opp} onClose={() => setContract(false)} onDone={() => { setContract(false); reload(); onChanged(); }} />}
      </DialogContent>
    </Dialog>
  );
}
