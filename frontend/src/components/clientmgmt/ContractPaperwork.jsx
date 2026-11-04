import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FilePdf, Paperclip, Trash, CheckCircle, Circle, PaperPlaneTilt } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveBlobAsFile } from "@/lib/api";
import { Pill, apiError, day, selectClass } from "./constants";

const AGREEMENT = [["NONE", "Not started"], ["DRAFT", "Draft"], ["SENT", "Sent to client"], ["SIGNED", "Signed"]];
const TONE = { NONE: "tone-teal", DRAFT: "tone-amber", SENT: "tone-blue", SIGNED: "tone-green" };
export const agreementLabel = (s) => (AGREEMENT.find(a => a[0] === s) || [])[1] || s;
export const AgreementPill = ({ status }) => <Pill tone={TONE[status]}>{agreementLabel(status)}</Pill>;
const Check = ({ ok, children }) => <span className="inline-flex items-center gap-1 text-xs" style={{ color: ok ? "#059669" : "var(--text-subtle)" }}>{ok ? <CheckCircle className="h-4 w-4" weight="fill" /> : <Circle className="h-4 w-4" />}{children}</span>;

// Scope of work, the client's PO document and the agreement (draft → sent → signed, signed copy on file) for one contract
export function ContractPaperwork({ api, contractId, open, onOpenChange, canEdit, onChanged }) {
  const [k, setK] = useState(null);
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({ scope_of_work: "", agreement_terms: "", agreement_status: "NONE", agreement_signed_on: "" });
  const [busy, setBusy] = useState(false);
  const [mail, setMail] = useState(null);       // { to, message, documents:[...] } while the send form is open
  const poRef = useRef(null);
  const signedRef = useRef(null);
  const otherRef = useRef(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [c, f] = await Promise.all([api.get(`/client-mgmt/contracts/${contractId}`), api.get(`/client-mgmt/contracts/${contractId}/files`)]);
      if (mine !== seq.current) return;
      setK(c.data); setFiles(f.data);
      setForm({ scope_of_work: c.data.scope_of_work || "", agreement_terms: c.data.agreement_terms || "", agreement_status: c.data.agreement_status, agreement_signed_on: c.data.agreement_signed_on || "" });
    } catch (e) { if (mine === seq.current) { toast.error(apiError(e, "Couldn't load the contract")); onOpenChange(false); } }
  }, [api, contractId, onOpenChange]);
  useEffect(() => { if (open && contractId) { setK(null); load(); } return () => { seq.current++; }; }, [open, contractId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn, ok) => { setBusy(true); try { await fn(); if (ok) toast.success(ok); await load(); onChanged?.(); } catch (e) { toast.error(apiError(e, "That didn't work")); } finally { setBusy(false); } };
  const locked = k?.agreement_status === "SIGNED" || ["COMPLETED", "TERMINATED"].includes(k?.status);
  const save = (extra = {}) => run(() => api.put(`/client-mgmt/contracts/${contractId}/agreement`, { ...(locked ? {} : { scope_of_work: form.scope_of_work, agreement_terms: form.agreement_terms }), ...extra }), "Saved");
  const upload = (kind) => (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const fd = new FormData(); fd.append("file", f); run(() => api.post(`/client-mgmt/contracts/${contractId}/files`, fd, { params: { kind } }), "File added"); };
  const download = async (f) => { try { const r = await api.get(`/client-mgmt/contracts/${contractId}/files/${f.id}`, { responseType: "blob" }); saveBlobAsFile(r.data, f.filename); } catch (e) { toast.error(apiError(e, "Couldn't download")); } };
  const openPdf = async (url, filename) => { try { const r = await api.get(url, { responseType: "blob" }); saveBlobAsFile(r.data, filename); } catch (e) { toast.error(apiError(e, "Couldn't make the PDF")); } };
  const sendDocs = () => run(async () => { await api.post(`/client-mgmt/contracts/${contractId}/send-documents`, { to: mail.to, message: mail.message, documents: mail.documents }); setMail(null); }, `Sent to ${mail.to}`);
  const toggleDoc = (d) => setMail(m => ({ ...m, documents: m.documents.includes(d) ? m.documents.filter(x => x !== d) : [...m.documents, d] }));
  const agreementPdf = async () => { try { const r = await api.get(`/client-mgmt/contracts/${contractId}/agreement-pdf`, { responseType: "blob" }); saveBlobAsFile(r.data, `${k.code}-agreement.pdf`); } catch (e) { toast.error(apiError(e, "Couldn't make the PDF")); } };
  const FileList = ({ kind, title, inputRef }) => (
    <div className="flex flex-wrap items-center gap-2" data-testid={`files-${kind}`}>
      <p className="text-sm font-semibold w-full sm:w-auto sm:min-w-[9rem]">{title}</p>
      {files.filter(f => f.kind === kind).map(f => <span key={f.id} className="inline-flex items-center gap-1 text-xs rounded-lg px-2 py-1" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}><button className="hover:underline" onClick={() => download(f)}>{f.filename}</button>{canEdit && !(kind === "SIGNED_AGREEMENT" && locked) && <button aria-label="Remove file" onClick={() => window.confirm(`Remove ${f.filename}?`) && run(() => api.delete(`/client-mgmt/contracts/${contractId}/files/${f.id}`), "File removed")}><Trash className="h-3 w-3 text-red-600" /></button>}</span>)}
      {files.every(f => f.kind !== kind) && <span className="text-xs" style={{ color: "var(--text-subtle)" }}>none</span>}
      {canEdit && !["COMPLETED", "TERMINATED"].includes(k?.status) && !(locked && kind !== "PO") && <><input ref={inputRef} type="file" className="hidden" onChange={upload(kind)} data-testid={`file-input-${kind}`} /><Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => inputRef.current?.click()}><Paperclip className="h-3.5 w-3.5 mr-1" /> Upload</Button></>}
    </div>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[94vh] overflow-y-auto" data-testid="contract-paperwork">
        <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">{k ? <>{k.code} · {k.client_name}<AgreementPill status={k.agreement_status} /></> : "Contract"}</DialogTitle></DialogHeader>
        {k && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-4" data-testid="readiness"><Check ok={k.readiness.scope_defined}>Scope of work</Check><Check ok={k.readiness.po_document}>Client PO on file</Check><Check ok={k.readiness.agreement_signed}>Agreement signed</Check></div>
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>PO {k.po_reference || "—"} ({day(k.po_date)}) · {day(k.start_date)} → {day(k.end_date)}</p>

            <section className="space-y-3" data-testid="pw-documents"><h3 className="font-bold font-['Outfit']">Documents for the client</h3>
              <div className="flex flex-wrap gap-2">
                {k.proposal_id && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => openPdf(`/client-mgmt/proposals/${k.proposal_id}/pdf`, `${k.code}-commercial-proposal.pdf`)} data-testid="pw-commercial-pdf"><FilePdf className="h-3.5 w-3.5 mr-1" /> Commercial proposal</Button>}
                <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => openPdf(`/client-mgmt/contracts/${contractId}/scope-pdf`, `${k.code}-scope-of-work.pdf`)} data-testid="pw-scope-pdf"><FilePdf className="h-3.5 w-3.5 mr-1" /> Scope of work</Button>
                <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={agreementPdf}><FilePdf className="h-3.5 w-3.5 mr-1" /> Agreement</Button>
                {canEdit && !mail && <Button size="sm" className="rounded-lg h-8 bg-[#059669] text-white hover:bg-[#047857]" onClick={() => setMail({ to: k.client_email || "", message: "", documents: k.proposal_id ? ["commercial", "scope"] : ["scope"] })} data-testid="pw-email-open"><PaperPlaneTilt className="h-3.5 w-3.5 mr-1" /> Email to client…</Button>}
              </div>
              {mail && (
                <div className="rounded-xl p-3 space-y-3" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }} data-testid="pw-email-form">
                  <div className="flex flex-wrap gap-4 text-sm">{[["commercial", "Commercial proposal", !!k.proposal_id], ["scope", "Scope of work", true], ["agreement", "Agreement", true]].map(([d, l, ok]) => ok && <label key={d} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={mail.documents.includes(d)} onChange={() => toggleDoc(d)} data-testid={`pw-doc-${d}`} />{l}</label>)}</div>
                  <div><Label className="text-xs">Send to</Label><Input value={mail.to} onChange={e => setMail({ ...mail, to: e.target.value })} placeholder="client@example.com" data-testid="pw-mail-to" /></div>
                  <div><Label className="text-xs">Message (optional)</Label><Textarea rows={2} value={mail.message} onChange={e => setMail({ ...mail, message: e.target.value })} data-testid="pw-mail-message" /></div>
                  <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>The selected PDFs are attached. Nothing is sent until you press Send.</p>
                  <div className="flex gap-2"><Button disabled={busy || !mail.documents.length || !mail.to.trim()} onClick={sendDocs} className="bg-[#059669] text-white hover:bg-[#047857] rounded-xl h-9" data-testid="pw-mail-send">{busy ? "Sending…" : "Send"}</Button><Button variant="outline" className="rounded-xl h-9" onClick={() => setMail(null)}>Cancel</Button></div>
                </div>)}
            </section>

            <section className="space-y-3"><h3 className="font-bold font-['Outfit']">Scope of work</h3>
              <Textarea rows={5} value={form.scope_of_work} disabled={!canEdit || locked} onChange={e => setForm({ ...form, scope_of_work: e.target.value })} placeholder={"Deliverables, inclusions and exclusions.\nStart a numbered section with a line like:  ## Platform access\nUse \"- \" for bullet points."} data-testid="pw-scope" /></section>

            <section className="space-y-3"><h3 className="font-bold font-['Outfit']">Client purchase order</h3><FileList kind="PO" title="PO document" inputRef={poRef} /></section>

            <section className="space-y-3"><h3 className="font-bold font-['Outfit']">Agreement</h3>
              <div><Label>Agreement terms</Label><Textarea rows={4} value={form.agreement_terms} disabled={!canEdit || locked} onChange={e => setForm({ ...form, agreement_terms: e.target.value })} placeholder="Payment terms, confidentiality, liability, termination…" data-testid="pw-terms" /></div>
              <div className="flex flex-wrap items-center gap-2">
                {canEdit && !locked && <Button size="sm" variant="outline" className="rounded-lg h-8" disabled={busy} onClick={() => save()} data-testid="pw-save">Save wording</Button>}
                <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={agreementPdf} data-testid="pw-pdf"><FilePdf className="h-3.5 w-3.5 mr-1" /> Agreement PDF</Button></div>
              <FileList kind="AGREEMENT" title="Sent copy" inputRef={otherRef} />
              <FileList kind="SIGNED_AGREEMENT" title="Signed copy" inputRef={signedRef} />
              {canEdit && !locked && (
                <div className="grid sm:grid-cols-3 gap-3 items-end rounded-xl p-3" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}>
                  <div><Label className="text-xs">Status</Label><select className={selectClass} value={form.agreement_status} onChange={e => setForm({ ...form, agreement_status: e.target.value })} data-testid="pw-status">{AGREEMENT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                  <div><Label className="text-xs">Signed on</Label><Input type="date" value={form.agreement_signed_on} onChange={e => setForm({ ...form, agreement_signed_on: e.target.value })} data-testid="pw-signed-on" /></div>
                  <Button disabled={busy || form.agreement_status === k.agreement_status && form.agreement_signed_on === (k.agreement_signed_on || "")} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="pw-set-status"
                    onClick={() => save({ agreement_status: form.agreement_status, agreement_signed_on: form.agreement_signed_on || null })}>Update status</Button>
                  {form.agreement_status === "SIGNED" && <p className="sm:col-span-3 text-[11px]" style={{ color: "var(--text-subtle)" }}>Signing needs the date and the signed copy uploaded above. Once signed, the wording is final.</p>}
                </div>)}
              {k.agreement_status === "SIGNED" && <p className="text-sm" style={{ color: "#059669" }}>Signed on {day(k.agreement_signed_on)}. The wording and the signed copy are locked.</p>}
            </section>
          </div>)}
      </DialogContent>
    </Dialog>
  );
}
