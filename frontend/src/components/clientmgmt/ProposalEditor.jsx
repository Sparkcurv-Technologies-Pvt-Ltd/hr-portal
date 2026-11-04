import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash, FilePdf, PaperPlaneTilt, Warning, Paperclip, CheckCircle, ArrowCounterClockwise, Handshake } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveBlobAsFile } from "@/lib/api";
import { TONES, Pill, apiError, errorDetail, money, day, when, label, selectClass, todayStr } from "./constants";

const BLANK = { description: "", quantity: 1, unit: "", rate: 0, cost: 0 };
const primary = "bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";
const num = (v) => (v === "" || v == null ? 0 : Number(v));

// Proposal editor: items with cost (flagged when priced below cost), totals and margin, PDF, send (with the below-cost override), review, PO and files
export function ProposalEditor({ api, proposalId, open, onOpenChange, level, isOwner, onChanged }) {
  const [p, setP] = useState(null);
  const [form, setForm] = useState({ title: "", terms: "", scope_of_work: "", tax_pct: 18, valid_until: "" });
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [send, setSend] = useState({ to: "", message: "", override_reason: "" });
  const [overrideNeeded, setOverrideNeeded] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(null);       // "APPROVED" | "CHANGES_ASKED"
  const [reviewNote, setReviewNote] = useState("");
  const [poOpen, setPoOpen] = useState(false);
  const [po, setPo] = useState({ po_reference: "", po_date: todayStr(), contract_no: "", start_date: "", end_date: "", contract_value: "" });
  const fileRef = useRef(null);
  const seq = useRef(0);
  const isMgr = level === "mgr";
  const editable = p && (p.status === "DRAFT") && (isMgr || (level === "sales" && isOwner));

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const { data } = await api.get(`/client-mgmt/proposals/${proposalId}`);
      if (mine !== seq.current) return;
      setP(data); setForm({ title: data.title, terms: data.terms || "", scope_of_work: data.scope_of_work || "", tax_pct: data.tax_pct ?? 18, valid_until: data.valid_until || "" });
      setItems(data.items.map(i => ({ description: i.description, quantity: i.quantity, unit: i.unit, rate: i.rate, cost: i.cost })));
    } catch (e) { if (mine === seq.current) { toast.error(apiError(e, "Couldn't load the proposal")); onOpenChange(false); } }
  }, [api, proposalId, onOpenChange]);
  useEffect(() => { if (open && proposalId) { setP(null); setOverrideNeeded(null); load(); } return () => { seq.current++; }; }, [open, proposalId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const totals = useMemo(() => items.reduce((t, i) => ({ amount: t.amount + num(i.quantity) * num(i.rate), cost: t.cost + num(i.quantity) * num(i.cost) }), { amount: 0, cost: 0 }), [items]);
  const setItem = (idx, k, v) => setItems(list => list.map((it, i) => i === idx ? { ...it, [k]: v } : it));
  const run = async (fn, ok) => { setBusy(true); try { const r = await fn(); if (ok) toast.success(ok); await load(); onChanged?.(); return r; } catch (e) { toast.error(apiError(e, "That didn't work")); return null; } finally { setBusy(false); } };
  const payload = () => ({ ...form, tax_pct: num(form.tax_pct), valid_until: form.valid_until || null, items: items.map(i => ({ ...i, quantity: num(i.quantity), rate: num(i.rate), cost: num(i.cost) })) });
  const save = () => run(() => api.put(`/client-mgmt/proposals/${proposalId}`, payload()), "Proposal saved");

  const pdf = async () => { try { const r = await api.get(`/client-mgmt/proposals/${proposalId}/pdf`, { responseType: "blob" }); saveBlobAsFile(r.data, `${p.code}.pdf`); } catch (e) { toast.error(apiError(e, "Couldn't make the PDF")); } };
  const doSend = async () => {
    setBusy(true);
    try { await api.post(`/client-mgmt/proposals/${proposalId}/send`, { ...send, override_reason: send.override_reason || null }); toast.success(`Sent to ${send.to}`); setSendOpen(false); setOverrideNeeded(null); await load(); onChanged?.(); }
    catch (e) { const d = errorDetail(e); if (d?.needs_override) setOverrideNeeded(d); else toast.error(apiError(e, "Couldn't send")); }
    finally { setBusy(false); }
  };
  const review = () => run(() => api.post(`/client-mgmt/proposals/${proposalId}/review`, { status: reviewOpen, note: reviewNote }), reviewOpen === "APPROVED" ? "Approved" : "Sent back for changes").then(r => { if (r) setReviewOpen(null); });
  const bookPo = async () => {
    const r = await run(() => api.post(`/client-mgmt/proposals/${proposalId}/book-po`, { ...po, contract_value: po.contract_value === "" ? null : Number(po.contract_value), start_date: po.start_date || null, end_date: po.end_date || null, contract_no: po.contract_no || null }), null);
    if (r) { toast.success(`PO booked — contract ${r.data.code} created`); setPoOpen(false); }
  };
  const reject = () => { const reason = window.prompt("Why is this proposal being rejected?"); if (reason) run(() => api.post(`/client-mgmt/proposals/${proposalId}/reject`, { reason }), "Proposal rejected"); };
  const upload = (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const fd = new FormData(); fd.append("file", f); run(() => api.post(`/client-mgmt/proposals/${proposalId}/files`, fd), "File added"); };
  const download = async (f) => { try { const r = await api.get(`/client-mgmt/proposals/${proposalId}/files/${f.id}`, { responseType: "blob" }); saveBlobAsFile(r.data, f.filename); } catch (e) { toast.error(apiError(e, "Couldn't download")); } };
  const delFile = (f) => window.confirm(`Remove ${f.filename}?`) && run(() => api.delete(`/client-mgmt/proposals/${proposalId}/files/${f.id}`), "File removed");

  const canSend = p && p.status === "DRAFT" && (isMgr || (level === "sales" && isOwner));
  const canReopenEdit = p && p.status === "SENT" && p.review_status === "CHANGES_ASKED" && (isMgr || (level === "sales" && isOwner));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[94vh] overflow-y-auto overflow-x-hidden" data-testid="proposal-editor">
        <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">{p ? <><span className="text-sm font-semibold" style={{ color: "var(--text-subtle)" }}>{p.code}</span><span className="break-words">{p.title}</span><Pill tone={TONES.proposal[p.status]}>{p.status}</Pill>{p.status === "SENT" && <Pill tone={TONES.review[p.review_status]}>Review: {label(p.review_status)}</Pill>}</> : "Proposal"}</DialogTitle></DialogHeader>
        {p && (
          <div className="space-y-5 min-w-0">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>{p.client_name} · owner {p.owner_name || "—"}{p.sent_at ? ` · sent ${when(p.sent_at)} to ${p.sent_to}` : ""}</p>
            {p.client_response && <div className="rounded-xl p-3 text-sm" style={{ background: p.client_response === "ACCEPTED" ? "#F0FDF4" : "#FFFBEB", border: `1px solid ${p.client_response === "ACCEPTED" ? "#BBF7D0" : "#FDE68A"}` }} data-testid="client-response"><strong>Client {p.client_response === "ACCEPTED" ? "accepted" : "asked for changes"}</strong> ({when(p.client_response_at)}){p.client_message ? ` — ${p.client_message}` : ""}</div>}
            {p.review_note && <p className="text-xs rounded-lg p-2" style={{ background: "var(--surface-elevated)" }}>Review note: {p.review_note}</p>}
            {p.override_reason && <p className="text-xs rounded-lg p-2" style={{ background: "#FFFBEB" }}>Below-cost override: {p.override_reason}</p>}

            <div className="grid sm:grid-cols-4 gap-3">
              <div className="sm:col-span-2"><Label>Title</Label><Input value={form.title} disabled={!editable && !canReopenEdit} onChange={e => setForm({ ...form, title: e.target.value })} data-testid="pe-title" /></div>
              <div><Label>GST %</Label><Input type="number" min="0" max="100" value={form.tax_pct} disabled={!editable && !canReopenEdit} onChange={e => setForm({ ...form, tax_pct: e.target.value })} data-testid="pe-tax" /></div>
              <div><Label>Valid until</Label><Input type="date" value={form.valid_until} disabled={!editable && !canReopenEdit} onChange={e => setForm({ ...form, valid_until: e.target.value })} /></div>
            </div>

            <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><thead><tr>{["#", "Description", "Qty", "Unit", "Rate", "Cost", "Amount", ""].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
              <tbody>{items.map((it, i) => { const below = num(it.rate) < num(it.cost); const edit = editable || canReopenEdit; return (
                <tr key={i} className="table-row" data-testid={`item-row-${i}`} style={below ? { background: "#FEF2F2" } : undefined}>
                  <td className="table-cell text-xs">{i + 1}</td>
                  <td className="table-cell"><Input value={it.description} disabled={!edit} onChange={e => setItem(i, "description", e.target.value)} className="h-9 min-w-[12rem]" data-testid={`item-desc-${i}`} /></td>
                  <td className="table-cell"><Input type="number" value={it.quantity} disabled={!edit} onChange={e => setItem(i, "quantity", e.target.value)} className="h-9 min-w-[4.5rem]" data-testid={`item-qty-${i}`} /></td>
                  <td className="table-cell"><Input value={it.unit} disabled={!edit} onChange={e => setItem(i, "unit", e.target.value)} className="h-9 min-w-[5.5rem]" /></td>
                  <td className="table-cell"><Input type="number" value={it.rate} disabled={!edit} onChange={e => setItem(i, "rate", e.target.value)} className="h-9 min-w-[7rem]" data-testid={`item-rate-${i}`} /></td>
                  <td className="table-cell"><Input type="number" value={it.cost} disabled={!edit} onChange={e => setItem(i, "cost", e.target.value)} className="h-9 min-w-[7rem]" data-testid={`item-cost-${i}`} /></td>
                  <td className="table-cell text-sm font-semibold whitespace-nowrap">{money(num(it.quantity) * num(it.rate))}{below && <span className="block text-[10px] font-bold" style={{ color: "#E11D48" }} data-testid={`below-cost-${i}`}><Warning className="h-3 w-3 inline" weight="fill" /> below cost</span>}</td>
                  <td className="table-cell">{edit && <button className="p-1.5 rounded-lg hover:bg-slate-100 text-red-600" aria-label="Remove line" onClick={() => setItems(l => l.filter((_, x) => x !== i))}><Trash className="h-4 w-4" /></button>}</td></tr>); })}
                {items.length === 0 && <tr><td colSpan={8} className="table-cell text-center text-sm py-6" style={{ color: "var(--text-subtle)" }}>No items yet.</td></tr>}</tbody></table></div>
            {(editable || canReopenEdit) && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => setItems(l => [...l, { ...BLANK }])} data-testid="add-item"><Plus className="h-3.5 w-3.5 mr-1" weight="bold" /> Add line</Button>}
            <div className="flex flex-wrap gap-6 justify-end text-sm" data-testid="pe-totals"><span>Subtotal <strong data-testid="pe-total">{money(totals.amount)}</strong></span><span data-testid="pe-gst">GST {num(form.tax_pct)}% {money(totals.amount * num(form.tax_pct) / 100)}</span><span>Total <strong data-testid="pe-grand">{money(totals.amount * (1 + num(form.tax_pct) / 100))}</strong></span><span style={{ color: "var(--text-muted)" }}>Cost {money(totals.cost)}</span><span style={{ color: totals.amount - totals.cost < 0 ? "#E11D48" : "#059669" }}>Margin {money(totals.amount - totals.cost)}{totals.amount ? ` (${Math.round((totals.amount - totals.cost) / totals.amount * 1000) / 10}%)` : ""}</span></div>
            <div><Label>Scope of work</Label><Textarea rows={4} value={form.scope_of_work} disabled={!editable && !canReopenEdit} onChange={e => setForm({ ...form, scope_of_work: e.target.value })} placeholder={"What will be delivered, what is included and excluded.\nStart a numbered section with a line like:  ## Platform access\nUse \"- \" for bullet points."} data-testid="pe-scope" /></div>
            <div><Label>Terms & conditions <span className="font-normal text-xs" style={{ color: "var(--text-subtle)" }}>(each “## Heading” becomes a numbered clause in the PDF)</span></Label><Textarea rows={5} placeholder={"## Payment Terms\nPayable in full, upfront.\n\n## Renewal\nPlease renew 30 days before expiry."} value={form.terms} disabled={!editable && !canReopenEdit} onChange={e => setForm({ ...form, terms: e.target.value })} /></div>

            <div className="flex flex-wrap items-center gap-2" data-testid="pe-files">
              <p className="text-sm font-semibold">Files</p>{p.files.length === 0 && <span className="text-xs" style={{ color: "var(--text-subtle)" }}>none</span>}
              {p.files.map(f => <span key={f.id} className="inline-flex items-center gap-1 text-xs rounded-lg px-2 py-1" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}><button className="hover:underline" onClick={() => download(f)}>{f.filename}</button>{(isMgr || isOwner) && <button aria-label="Remove file" onClick={() => delFile(f)}><Trash className="h-3 w-3 text-red-600" /></button>}</span>)}
              {(isMgr || (level === "sales" && isOwner)) && !["ACCEPTED", "REJECTED"].includes(p.status) && <><input ref={fileRef} type="file" className="hidden" onChange={upload} data-testid="pe-file-input" /><Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => fileRef.current?.click()}><Paperclip className="h-3.5 w-3.5 mr-1" /> Attach</Button></>}
            </div>

            <div className="flex flex-wrap gap-2 pt-2" style={{ borderTop: "1px solid var(--border-color)" }}>
              {(editable || canReopenEdit) && <Button onClick={save} disabled={busy} className={primary} data-testid="pe-save">Save{canReopenEdit ? " (back to draft)" : ""}</Button>}
              <Button variant="outline" className="rounded-xl h-10" onClick={pdf} data-testid="pe-pdf"><FilePdf className="h-4 w-4 mr-1.5" /> PDF</Button>
              {canSend && <Button onClick={() => { setSend({ to: "", message: "", override_reason: "" }); setOverrideNeeded(null); setSendOpen(true); }} className="rounded-xl h-10 bg-[#059669] text-white hover:bg-[#047857]" data-testid="pe-send"><PaperPlaneTilt className="h-4 w-4 mr-1.5" /> Send to client</Button>}
              {p.status === "SENT" && (isMgr || isOwner) && <Button variant="outline" className="rounded-xl h-10" onClick={() => { const to = window.prompt("Email the proposal again to:", p.sent_to || ""); if (to) run(() => api.post(`/client-mgmt/proposals/${proposalId}/email`, { to }), "Emailed again"); }}>Email again</Button>}
              {p.status === "SENT" && isMgr && <><Button onClick={() => { setReviewNote(""); setReviewOpen("APPROVED"); }} className="rounded-xl h-10 bg-[#0020F8] text-white hover:bg-[#0019C4]" data-testid="pe-approve"><CheckCircle className="h-4 w-4 mr-1.5" /> Approve review</Button>
                <Button variant="outline" className="rounded-xl h-10" onClick={() => { setReviewNote(""); setReviewOpen("CHANGES_ASKED"); }} data-testid="pe-changes"><ArrowCounterClockwise className="h-4 w-4 mr-1.5" /> Ask for changes</Button></>}
              {p.status === "SENT" && isMgr && <Button onClick={() => { setPo({ po_reference: "", po_date: todayStr(), contract_no: "", start_date: "", end_date: "", contract_value: "" }); setPoOpen(true); }} className="rounded-xl h-10 bg-[#059669] text-white hover:bg-[#047857]" data-testid="pe-book-po"><Handshake className="h-4 w-4 mr-1.5" /> Book PO</Button>}
              {["DRAFT", "SENT"].includes(p.status) && (isMgr || (level === "sales" && isOwner)) && <Button variant="outline" className="rounded-xl h-10 text-red-600 ml-auto" onClick={reject}>Reject</Button>}
            </div>
            {p.status === "SENT" && isMgr && p.review_status !== "APPROVED" && <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>The PO can only be booked once the review is approved.</p>}
          </div>)}

        <Dialog open={sendOpen} onOpenChange={setSendOpen}>
          <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Send proposal</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>To (client email)</Label><Input value={send.to} onChange={e => setSend({ ...send, to: e.target.value })} data-testid="send-to" /></div>
              <div><Label>Message</Label><Textarea rows={3} value={send.message} onChange={e => setSend({ ...send, message: e.target.value })} /></div>
              {overrideNeeded && <div className="rounded-xl p-3 text-sm space-y-2" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }} data-testid="override-box"><p className="font-semibold" style={{ color: "#991B1B" }}><Warning className="h-4 w-4 inline mr-1" weight="fill" />{overrideNeeded.message}</p>
                {isMgr ? <><Label>Override reason (manager)</Label><Textarea rows={2} value={send.override_reason} onChange={e => setSend({ ...send, override_reason: e.target.value })} data-testid="override-reason" /></> : <p className="text-xs">Only a sales manager can approve sending a below-cost proposal. Raise the rates, or ask a manager to send it.</p>}</div>}
              <Button onClick={doSend} disabled={busy || (overrideNeeded && !isMgr)} className={`w-full ${primary}`} data-testid="send-submit">{busy ? "Sending…" : overrideNeeded ? "Override and send" : "Send"}</Button>
            </div></DialogContent>
        </Dialog>
        <Dialog open={!!reviewOpen} onOpenChange={(o) => !o && setReviewOpen(null)}>
          <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{reviewOpen === "APPROVED" ? "Approve the review" : "Ask for changes"}</DialogTitle></DialogHeader>
            <div className="space-y-3"><div><Label>{reviewOpen === "APPROVED" ? "Note (optional)" : "What needs to change?"}</Label><Textarea rows={3} value={reviewNote} onChange={e => setReviewNote(e.target.value)} data-testid="review-note" /></div>
              <Button onClick={review} disabled={busy} className={`w-full ${primary}`} data-testid="review-submit">Confirm</Button></div></DialogContent>
        </Dialog>
        <Dialog open={poOpen} onOpenChange={setPoOpen}>
          <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Book the PO</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label>PO reference</Label><Input value={po.po_reference} onChange={e => setPo({ ...po, po_reference: e.target.value })} data-testid="po-ref" /></div>
                <div><Label>PO date</Label><Input type="date" value={po.po_date} onChange={e => setPo({ ...po, po_date: e.target.value })} /></div>
                <div><Label>Contract no.</Label><Input value={po.contract_no} onChange={e => setPo({ ...po, contract_no: e.target.value })} /></div>
                <div><Label>Contract value</Label><Input type="number" placeholder={String(p?.total_amount ?? "")} value={po.contract_value} onChange={e => setPo({ ...po, contract_value: e.target.value })} /></div>
                <div><Label>Start date</Label><Input type="date" value={po.start_date} onChange={e => setPo({ ...po, start_date: e.target.value })} data-testid="po-start" /></div>
                <div><Label>End date</Label><Input type="date" value={po.end_date} onChange={e => setPo({ ...po, end_date: e.target.value })} data-testid="po-end" /></div>
              </div>
              <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>Sets the proposal Accepted, the tender Won and the lead Won, and creates the contract as a draft.</p>
              <Button onClick={bookPo} disabled={busy || !po.po_reference.trim()} className={`w-full ${primary}`} data-testid="po-submit">Book PO</Button></div></DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
export { selectClass, day };
