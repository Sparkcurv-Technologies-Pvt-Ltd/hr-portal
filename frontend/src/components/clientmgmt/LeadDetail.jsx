import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PencilSimple, Phone, Envelope, Buildings, CalendarBlank, NotePencil } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QualifyDialog, PromptDialog } from "./LeadDialogs";
import { ProposalEditor } from "./ProposalEditor";
import { KINDS, SOURCES, SOURCE_LABEL, STAGE, TONES, Pill, apiError, day, money, selectClass, when } from "./constants";

// One lead: details, activity log (who / when / note, incl. every stage change), tenders, proposals, and the next step for its stage
export function LeadDetail({ api, user, leadId, open, onOpenChange, level, clients, people, onChanged, onOpenContract }) {
  const [lead, setLead] = useState(null);
  const [acts, setActs] = useState([]);
  const [tenders, setTenders] = useState([]);
  const [props, setProps] = useState([]);
  const [note, setNote] = useState({ kind: "CALL", body: "", next_followup_at: "" });
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({});
  const [qualify, setQualify] = useState(false);
  const [dialog, setDialog] = useState(null);            // "lost" | "tender" | "proposal"
  const [proposalId, setProposalId] = useState(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const isMgr = level === "mgr";
  const writable = lead && (isMgr || (level === "sales" && lead.owner_id === user.id));

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [l, a, t, p] = await Promise.all([api.get(`/client-mgmt/leads/${leadId}`), api.get(`/client-mgmt/leads/${leadId}/activities`), api.get(`/client-mgmt/leads/${leadId}/tenders`), api.get("/client-mgmt/proposals", { params: { lead_id: leadId } })]);
      if (mine !== seq.current) return;
      setLead(l.data); setActs(a.data); setTenders(t.data); setProps(p.data);
    } catch (e) { if (mine === seq.current) { toast.error(apiError(e, "Couldn't load the lead")); onOpenChange(false); } }
  }, [api, leadId, onOpenChange]);
  useEffect(() => { if (open && leadId) { setLead(null); setEditing(false); setNote({ kind: "CALL", body: "", next_followup_at: "" }); load(); } return () => { seq.current++; }; }, [open, leadId]);   // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { await load(); onChanged?.(); };
  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); await refresh(); } catch (e) { toast.error(apiError(e, "That didn't work")); } finally { setBusy(false); } };

  const addNote = () => (!note.body.trim() ? toast.error("Write a short note") : run(() => api.post(`/client-mgmt/leads/${leadId}/activities`, { ...note, next_followup_at: note.next_followup_at || null }).then(() => setNote({ kind: "CALL", body: "", next_followup_at: "" })), "Logged"));
  const startEdit = () => { setEdit({ company_name: lead.company_name || "", contact_name: lead.contact_name || "", phone: lead.phone || "", email: lead.email || "", estimated_value: lead.estimated_value ?? "", source: lead.source, next_followup_at: lead.next_followup_at || "", owner_id: lead.owner_id || "" }); setEditing(true); };
  const saveEdit = () => run(async () => { await api.put(`/client-mgmt/leads/${leadId}`, { ...edit, estimated_value: edit.estimated_value === "" ? null : Number(edit.estimated_value), next_followup_at: edit.next_followup_at || null, ...(isMgr ? { owner_id: edit.owner_id ? Number(edit.owner_id) : null } : { owner_id: undefined }) }); setEditing(false); }, "Saved");
  const field = (k, label, props = {}) => <div><Label className="text-xs">{label}</Label><Input value={edit[k] ?? ""} onChange={e => setEdit({ ...edit, [k]: e.target.value })} {...props} /></div>;
  const stage = lead?.stage;
  const moveTo = (s) => run(() => api.post(`/client-mgmt/leads/${leadId}/stage`, { stage: s }), `Moved to ${STAGE[s].label}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[94vh] overflow-y-auto" data-testid="lead-detail">
        <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">{lead ? <><span className="break-words">{lead.company_name || lead.client_name || lead.contact_name || lead.code}</span><Pill tone={STAGE[stage].tone}>{STAGE[stage].label}</Pill><span className="text-xs font-normal" style={{ color: "var(--text-subtle)" }}>{lead.code}</span></> : "Lead"}</DialogTitle></DialogHeader>
        {lead && (
          <div className="space-y-6">
            <section>
              {!editing ? (
                <>
                  <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                    <p className="flex items-center gap-2"><Buildings className="h-4 w-4" />{lead.client_name ? <span>Client <strong>{lead.client_name}</strong></span> : lead.company_name || "—"}</p>
                    <p><span style={{ color: "var(--text-subtle)" }}>Contact:</span> {lead.contact_name || "—"}</p>
                    <p className="flex items-center gap-2"><Phone className="h-4 w-4" />{lead.phone || "—"}</p><p className="flex items-center gap-2"><Envelope className="h-4 w-4" />{lead.email || "—"}</p>
                    <p><span style={{ color: "var(--text-subtle)" }}>Estimated value:</span> <strong>{lead.estimated_value != null ? money(lead.estimated_value) : "—"}</strong></p>
                    <p><span style={{ color: "var(--text-subtle)" }}>Source:</span> {SOURCE_LABEL[lead.source]} · <span style={{ color: "var(--text-subtle)" }}>Owner:</span> {lead.owner_name || "—"}</p>
                    <p className="flex items-center gap-2" style={{ color: lead.followup_overdue ? "#E11D48" : undefined }}><CalendarBlank className="h-4 w-4" />Follow-up: {lead.next_followup_at ? day(lead.next_followup_at) : "—"}{lead.followup_overdue ? " (overdue)" : ""}</p>
                    {lead.lost_reason && <p style={{ color: "#991B1B" }}>Lost: {lead.lost_reason}</p>}
                  </div>
                  {writable && !["WON", "LOST"].includes(stage) && <Button size="sm" variant="outline" className="rounded-lg h-8 mt-3" onClick={startEdit} data-testid="edit-lead"><PencilSimple className="h-3.5 w-3.5 mr-1" /> Edit</Button>}
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3" data-testid="lead-edit-form">
                  <div className="col-span-2">{field("company_name", "Company")}</div>{field("contact_name", "Contact name")}{field("estimated_value", "Estimated value", { type: "number" })}{field("phone", "Phone")}{field("email", "Email")}
                  <div><Label className="text-xs">Source</Label><select className={selectClass} value={edit.source} onChange={e => setEdit({ ...edit, source: e.target.value })}>{SOURCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>{field("next_followup_at", "Next follow-up", { type: "date" })}
                  {isMgr && <div className="col-span-2"><Label className="text-xs">Owner</Label><select className={selectClass} value={edit.owner_id} onChange={e => setEdit({ ...edit, owner_id: e.target.value })}>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>}
                  <div className="col-span-2 flex gap-2"><Button onClick={saveEdit} disabled={busy} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-9" data-testid="save-lead">Save</Button><Button variant="outline" className="rounded-xl h-9" onClick={() => setEditing(false)}>Cancel</Button></div>
                </div>)}
            </section>

            {writable && (
              <section className="rounded-xl p-3 flex flex-wrap gap-2 items-center" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }} data-testid="lead-actions">
                <p className="text-xs font-bold mr-1">Next step</p>
                {["NEW", "CONTACTED"].includes(stage) && <>
                  <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={() => setQualify(true)} data-testid="act-qualify">Qualify</Button>
                  <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => moveTo(stage === "NEW" ? "CONTACTED" : "NEW")} data-testid="act-contacted">{stage === "NEW" ? "Mark contacted" : "Back to new"}</Button></>}
                {stage === "QUALIFIED" && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setDialog("tender")} data-testid="act-tender">Open a tender</Button>}
                {["QUALIFIED", "TENDER", "PROPOSAL"].includes(stage) && <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={() => setDialog("proposal")} data-testid="act-proposal">{stage === "PROPOSAL" ? "Another proposal" : "Create proposal"}</Button>}
                {!["WON", "LOST"].includes(stage) && <Button size="sm" variant="outline" className="rounded-lg h-8 text-red-600" onClick={() => setDialog("lost")} data-testid="act-lost">Mark lost</Button>}
                {stage === "LOST" && isMgr && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => moveTo("NEW")} data-testid="act-reopen">Reopen as new</Button>}
              </section>)}

            {tenders.length > 0 && <section><h3 className="font-bold font-['Outfit'] mb-2">Tenders</h3>{tenders.map(t => <p key={t.id} className="text-sm">{t.reference || `Tender #${t.id}`} · due {day(t.due_date)} <Pill tone="tone-amber">{t.status}</Pill></p>)}</section>}
            <section data-testid="lead-proposals"><h3 className="font-bold font-['Outfit'] mb-2">Proposals</h3>
              {props.length === 0 && <p className="text-sm" style={{ color: "var(--text-subtle)" }}>None yet.</p>}
              {props.map(p => <div key={p.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm" data-testid={`lp-${p.id}`}><button className="font-semibold hover:underline" onClick={() => setProposalId(p.id)}>{p.code} · {p.title}</button><span>{money(p.total_amount)}</span><Pill tone={TONES.proposal[p.status]}>{p.status}</Pill>{p.status === "SENT" && <Pill tone={TONES.review[p.review_status]}>{p.review_status.replace("_", " ").toLowerCase()}</Pill>}</div>)}
              {stage === "WON" && <Button size="sm" variant="outline" className="rounded-lg h-8 mt-2" onClick={() => onOpenContract?.(leadId)} data-testid="open-contracts">View contract</Button>}</section>

            <section>
              <h3 className="font-bold font-['Outfit'] mb-3">Activity</h3>
              {writable && !["WON", "LOST"].includes(stage) && (
                <div className="rounded-xl p-3 mb-4 space-y-2" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }} data-testid="activity-form">
                  <div className="grid grid-cols-3 gap-2"><select className={selectClass} value={note.kind} onChange={e => setNote({ ...note, kind: e.target.value })} data-testid="act-kind">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><div className="col-span-2"><Input type="date" aria-label="Next follow-up" value={note.next_followup_at} onChange={e => setNote({ ...note, next_followup_at: e.target.value })} data-testid="act-followup" /></div></div>
                  <Textarea rows={2} placeholder="What happened? (set a date to be reminded)" value={note.body} onChange={e => setNote({ ...note, body: e.target.value })} data-testid="act-body" />
                  <Button size="sm" onClick={addNote} disabled={busy} className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" data-testid="act-save"><NotePencil className="h-3.5 w-3.5 mr-1" /> Log it</Button></div>)}
              <div className="space-y-2.5" data-testid="activity-log">{acts.map(a => (
                <div key={a.id} className="flex gap-3 text-sm"><span className="chip tone-blue flex-shrink-0 h-fit">{a.kind === "STAGE_CHANGE" ? "Stage" : a.kind.toLowerCase()}</span>
                  <div className="min-w-0"><p className="break-words">{a.body}</p><p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>{when(a.at)} · {a.by_user_name}</p></div></div>))}</div>
            </section>
          </div>)}
        <QualifyDialog open={qualify} onOpenChange={setQualify} api={api} lead={lead} clients={clients} onDone={refresh} />
        <PromptDialog open={dialog === "lost"} onOpenChange={(o) => !o && setDialog(null)} title="Mark the lead lost" submitLabel="Mark lost" fields={[{ key: "reason", label: "Reason", required: true }, { key: "note", label: "Note (optional)", type: "textarea" }]}
          onSubmit={async (v) => { await api.post(`/client-mgmt/leads/${leadId}/stage`, { stage: "LOST", lost_reason: v.reason, note: v.note }); toast.success("Marked lost"); await refresh(); }} />
        <PromptDialog open={dialog === "tender"} onOpenChange={(o) => !o && setDialog(null)} title="Open a tender" submitLabel="Open tender" fields={[{ key: "reference", label: "Tender reference" }, { key: "due_date", label: "Due date", type: "date" }]}
          onSubmit={async (v) => { await api.post(`/client-mgmt/leads/${leadId}/to-tender`, { reference: v.reference || null, due_date: v.due_date || null }); toast.success("Tender opened"); await refresh(); }} />
        <PromptDialog open={dialog === "proposal"} onOpenChange={(o) => !o && setDialog(null)} title="Create a proposal" submitLabel="Create" fields={[{ key: "title", label: "Proposal title", required: true, initial: lead ? `Proposal for ${lead.company_name || lead.client_name || ""}`.trim() : "" }]}
          onSubmit={async (v) => { const { data } = await api.post(`/client-mgmt/leads/${leadId}/to-proposal`, { title: v.title, items: [] }); toast.success(`Proposal ${data.code} drafted`); await refresh(); setProposalId(data.id); }} />
        <ProposalEditor api={api} proposalId={proposalId} open={!!proposalId} onOpenChange={(o) => !o && setProposalId(null)} level={level} isOwner={!!lead && lead.owner_id === user.id} onChanged={refresh} />
      </DialogContent>
    </Dialog>
  );
}
