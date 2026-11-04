import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { saveBlobAsFile } from "@/lib/api";
import { Textarea } from "@/components/ui/textarea";
import { PromptDialog } from "./LeadDialogs";
import { TONES, Pill, apiError, day, money, selectClass, thisMonth, todayStr, label } from "./constants";

const primary = "bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10";
const Empty = ({ children }) => <p className="text-center text-sm py-10" style={{ color: "var(--text-subtle)" }}>{children}</p>;
const Head = ({ cols }) => <thead><tr>{cols.map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>;

function useList(api, url, params) {
  const [rows, setRows] = useState(null);
  const key = JSON.stringify(params || {});
  const load = useCallback(async () => {
    try { const { data } = await api.get(url, { params }); setRows(data); } catch (e) { toast.error(apiError(e, "Couldn't load")); setRows([]); }
  }, [api, url, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [rows, load];
}
const useClients = (api) => useList(api, "/client-mgmt/clients")[0] || [];

export function InvoicesPanel({ api, canEdit }) {
  const [rows, load] = useList(api, "/client-mgmt/invoices");
  const [contracts] = useList(api, "/client-mgmt/contracts", { status: "ACTIVE" });
  const [nw, setNw] = useState(null);
  const [sug, setSug] = useState(null);
  const [cancel, setCancel] = useState(null);
  const [mail, setMail] = useState(null);       // { invoice, to, message, include_scope }
  const [month, setMonth] = useState(thisMonth());
  const [busy, setBusy] = useState(false);
  const act = async (fn, ok) => { setBusy(true); try { const r = await fn(); toast.success(ok); load(); return r; } catch (e) { toast.error(apiError(e, "That didn't work")); e.handled = true; throw e; } finally { setBusy(false); } };

  useEffect(() => {
    if (!nw?.contract_id || !/^\d{4}-\d{2}$/.test(nw.period)) { setSug(null); return; }
    let live = true;
    api.get(`/client-mgmt/contracts/${nw.contract_id}/invoice-suggestion`, { params: { period: nw.period } }).then(r => live && setSug(r.data)).catch(e => { if (live) { setSug(null); toast.error(apiError(e, "No suggestion")); } });
    return () => { live = false; };
  }, [nw?.contract_id, nw?.period, api]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pdf = async (i) => { try { const r = await api.get(`/client-mgmt/invoices/${i.id}/pdf`, { responseType: "blob" }); saveBlobAsFile(r.data, `${i.code}.pdf`); } catch (e) { toast.error(apiError(e, "Couldn't make the PDF")); } };
  const openMail = async (i) => { let to = ""; try { to = (await api.get(`/client-mgmt/clients/${i.client_id}`)).data.email || ""; } catch { /* the form lets them type it */ } setMail({ invoice: i, to: i.emailed_to || to, message: "", include_scope: false }); };
  const sendMail = () => act(async () => { await api.post(`/client-mgmt/invoices/${mail.invoice.id}/email`, { to: mail.to, message: mail.message, include_scope: mail.include_scope }); setMail(null); }, `Invoice ${mail.invoice.code} emailed`);
  const create = () => act(async () => { await api.post("/client-mgmt/invoices", { contract_id: Number(nw.contract_id), period: nw.period, gross_amount: nw.gross === "" ? null : Number(nw.gross), notes: nw.notes || "" }); setNw(null); }, "Draft invoice created");
  const monthEnd = async () => { const r = await act(() => api.post("/client-mgmt/invoices/month-end", { month }), "Month-end run done"); if (r) toast.message(`Drafted ${r.data.created.length} invoice(s), skipped ${r.data.skipped.length}`); };
  return (
    <div className="section-card p-4 sm:p-5" data-testid="invoices-panel">
      <div className="flex flex-wrap items-center gap-2 mb-3"><h3 className="font-bold font-['Outfit'] mr-auto">Invoices</h3>
        {canEdit && <><Input type="month" value={month} onChange={e => setMonth(e.target.value)} className="h-8 w-40" data-testid="me-month" /><Button size="sm" variant="outline" className="rounded-lg h-8" disabled={busy} onClick={monthEnd} data-testid="month-end">Run month-end</Button>
          <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={() => setNw({ contract_id: "", period: thisMonth(), gross: "", notes: "" })} data-testid="new-invoice"><Plus className="h-3.5 w-3.5 mr-1" weight="bold" /> New invoice</Button></>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px]"><Head cols={["Code", "Client", "Contract", "Period", "Gross", "Tax", "TDS", "Retention", "Net", "Due", "Status", ""]} />
        <tbody>{(rows || []).map(i => (
          <tr key={i.id} className="table-row" data-testid={`invoice-row-${i.id}`}>
            <td className="table-cell font-semibold">{i.code}</td><td className="table-cell">{i.client_name}</td><td className="table-cell">{i.contract_code}</td><td className="table-cell">{i.period}</td>
            <td className="table-cell">{money(i.gross_amount)}</td><td className="table-cell">{money(i.tax_amount)}</td><td className="table-cell">{money(i.tds_amount)}</td><td className="table-cell">{money(i.retention_amount)}</td>
            <td className="table-cell font-semibold">{money(i.net_amount)}</td><td className="table-cell">{i.status === "POSTED" ? money(i.outstanding) : "—"}</td>
            <td className="table-cell"><Pill tone={TONES.invoice[i.status]}>{i.status}</Pill>{i.generated_by === "MONTH_END" && <span className="chip tone-violet ml-1">auto</span>}</td>
            <td className="table-cell"><div className="flex flex-wrap gap-1 min-w-[10rem]"><Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => pdf(i)} data-testid={`invoice-pdf-${i.id}`}>PDF</Button>
              {canEdit && i.status === "POSTED" && <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => openMail(i)} data-testid={`invoice-email-${i.id}`}>{i.emailed_at ? "Email again" : "Email"}</Button>}{i.emailed_to && <span className="text-[11px] w-full" style={{ color: "var(--text-subtle)" }} title={i.emailed_at}>emailed to {i.emailed_to}</span>}</div>
              {canEdit && i.status === "DRAFT" && <><Button size="sm" className="rounded-lg h-8 bg-[#059669] text-white hover:bg-[#047857] mr-1" disabled={busy} onClick={() => act(() => api.post(`/client-mgmt/invoices/${i.id}/post`), `${i.code} posted`)} data-testid={`post-invoice-${i.id}`}>Post</Button>
              <Button size="sm" variant="outline" className="rounded-lg h-8 text-red-600" onClick={() => window.confirm(`Delete draft ${i.code}?`) && act(() => api.delete(`/client-mgmt/invoices/${i.id}`), "Draft deleted")}>Delete</Button></>}
              {canEdit && i.status === "POSTED" && <Button size="sm" variant="outline" className="rounded-lg h-8 text-red-600 mt-1" onClick={() => setCancel(i)} data-testid={`cancel-invoice-${i.id}`}>Cancel</Button>}
              {i.status === "CANCELLED" && <span className="text-[11px]" style={{ color: "var(--text-subtle)" }} title={i.cancel_reason}>{i.cancel_reason}</span>}</td></tr>))}</tbody></table>
        {rows && rows.length === 0 && <Empty>No invoices yet.</Empty>}</div>

      {nw && <Dialog open onOpenChange={(o) => !o && setNw(null)}><DialogContent className="max-w-md" data-testid="invoice-dialog"><DialogHeader><DialogTitle>New invoice</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Contract</Label><select className={selectClass} value={nw.contract_id} onChange={e => setNw({ ...nw, contract_id: e.target.value, gross: "" })} data-testid="inv-contract"><option value="">Select…</option>{(contracts || []).map(k => <option key={k.id} value={k.id}>{k.code} · {k.client_name}</option>)}</select></div>
          <div><Label>Period</Label><Input type="month" value={nw.period} onChange={e => setNw({ ...nw, period: e.target.value })} data-testid="inv-period" /></div>
          {sug && <div className="rounded-xl p-3 text-sm" style={{ background: "var(--surface-elevated)" }} data-testid="inv-suggestion">Suggested gross <strong>{money(sug.suggested_gross)}</strong><span className="block text-xs" style={{ color: "var(--text-muted)" }}>billable to date {money(sug.cumulative_billable)} − already posted {money(sug.already_posted)}</span></div>}
          <div><Label>Gross amount (blank = use the suggestion)</Label><Input type="number" value={nw.gross} onChange={e => setNw({ ...nw, gross: e.target.value })} data-testid="inv-gross" /></div>
          <div><Label>Notes</Label><Input value={nw.notes} onChange={e => setNw({ ...nw, notes: e.target.value })} /></div>
          <Button onClick={create} disabled={busy || !nw.contract_id} className={`w-full ${primary}`} data-testid="inv-create">Create draft</Button></div></DialogContent></Dialog>}
      {mail && <Dialog open onOpenChange={(o) => !o && setMail(null)}><DialogContent className="max-w-md" data-testid="invoice-mail-dialog"><DialogHeader><DialogTitle>Email {mail.invoice.code}</DialogTitle></DialogHeader>
        <div className="space-y-3"><div><Label>Send to</Label><Input value={mail.to} onChange={e => setMail({ ...mail, to: e.target.value })} placeholder="client@example.com" data-testid="inv-mail-to" /></div>
          <div><Label>Message (optional)</Label><Textarea rows={3} value={mail.message} onChange={e => setMail({ ...mail, message: e.target.value })} /></div>
          <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={mail.include_scope} onChange={e => setMail({ ...mail, include_scope: e.target.checked })} /> Also attach the scope of work</label>
          <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>The invoice PDF is attached. Nothing is sent until you press Send.</p>
          <Button onClick={sendMail} disabled={busy || !mail.to.trim()} className={`w-full ${primary}`} data-testid="inv-mail-send">Send</Button></div></DialogContent></Dialog>}
      <PromptDialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)} title={`Cancel ${cancel?.code || "invoice"}`} submitLabel="Cancel invoice" fields={[{ key: "reason", label: "Reason", required: true }]}
        onSubmit={(v) => act(() => api.post(`/client-mgmt/invoices/${cancel.id}/cancel`, { reason: v.reason }), "Invoice cancelled")} />
    </div>
  );
}

export function PaymentsPanel({ api, canEdit }) {
  const [rows, load] = useList(api, "/client-mgmt/payments");
  const clients = useClients(api);
  const [nw, setNw] = useState(null);
  const [alloc, setAlloc] = useState(null);       // { payment, invoices, amounts }
  const [cancel, setCancel] = useState(null);
  const act = async (fn, ok) => { try { const r = await fn(); if (ok) toast.success(ok); load(); return r; } catch (e) { toast.error(apiError(e, "That didn't work")); e.handled = true; throw e; } };
  const create = () => act(async () => { await api.post("/client-mgmt/payments", { client_id: Number(nw.client_id), amount: Number(nw.amount), payment_date: nw.payment_date, reference: nw.reference || null, notes: "" }); setNw(null); }, "Payment drafted");
  const openAlloc = async (p) => {
    try { const { data } = await api.get("/client-mgmt/invoices", { params: { client_id: p.client_id, status: "POSTED" } }); setAlloc({ payment: p, invoices: data.filter(i => i.outstanding > 0), amounts: {}, post: p.status === "DRAFT" }); }
    catch (e) { toast.error(apiError(e, "Couldn't load invoices")); }
  };
  const submitAlloc = async () => {
    const allocations = Object.entries(alloc.amounts).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ invoice_id: Number(id), amount: Number(v) }));
    await act(() => alloc.post ? api.post(`/client-mgmt/payments/${alloc.payment.id}/post`, { allocations }) : api.post(`/client-mgmt/payments/${alloc.payment.id}/allocate`, { allocations }), alloc.post ? "Payment posted" : "Allocated").then(() => setAlloc(null)).catch(() => {});
  };
  const total = alloc ? Object.values(alloc.amounts).reduce((s, v) => s + (Number(v) || 0), 0) : 0;
  const room = alloc ? (alloc.post ? alloc.payment.amount : alloc.payment.unallocated) : 0;
  return (
    <div className="section-card p-4 sm:p-5" data-testid="payments-panel">
      <div className="flex items-center justify-between mb-3"><h3 className="font-bold font-['Outfit']">Payments</h3>{canEdit && <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={() => setNw({ client_id: "", amount: "", payment_date: todayStr(), reference: "" })} data-testid="new-payment"><Plus className="h-3.5 w-3.5 mr-1" weight="bold" /> New payment</Button>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[760px]"><Head cols={["Code", "Client", "Date", "Reference", "Amount", "Unallocated", "Status", ""]} />
        <tbody>{(rows || []).map(p => (
          <tr key={p.id} className="table-row" data-testid={`payment-row-${p.id}`}>
            <td className="table-cell font-semibold">{p.code}</td><td className="table-cell">{p.client_name}</td><td className="table-cell">{day(p.payment_date)}</td><td className="table-cell">{p.reference || "—"}</td>
            <td className="table-cell">{money(p.amount)}</td><td className="table-cell">{p.status === "POSTED" ? money(p.unallocated) : "—"}</td><td className="table-cell"><Pill tone={TONES.payment[p.status]}>{p.status}</Pill></td>
            <td className="table-cell whitespace-nowrap">{canEdit && p.status === "DRAFT" && <><Button size="sm" className="rounded-lg h-8 bg-[#059669] text-white hover:bg-[#047857] mr-1" onClick={() => openAlloc(p)} data-testid={`post-payment-${p.id}`}>Post…</Button><Button size="sm" variant="outline" className="rounded-lg h-8 text-red-600" onClick={() => window.confirm(`Delete draft ${p.code}?`) && act(() => api.delete(`/client-mgmt/payments/${p.id}`), "Draft deleted")}>Delete</Button></>}
              {canEdit && p.status === "POSTED" && <>{p.unallocated > 0 && <Button size="sm" variant="outline" className="rounded-lg h-8 mr-1" onClick={() => openAlloc(p)} data-testid={`allocate-${p.id}`}>Allocate</Button>}<Button size="sm" variant="outline" className="rounded-lg h-8 text-red-600" onClick={() => setCancel(p)} data-testid={`cancel-payment-${p.id}`}>Cancel</Button></>}</td></tr>))}</tbody></table>
        {rows && rows.length === 0 && <Empty>No payments yet.</Empty>}</div>

      {nw && <Dialog open onOpenChange={(o) => !o && setNw(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>New payment</DialogTitle></DialogHeader>
        <div className="space-y-3"><div><Label>Client</Label><select className={selectClass} value={nw.client_id} onChange={e => setNw({ ...nw, client_id: e.target.value })} data-testid="pay-client"><option value="">Select…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Amount</Label><Input type="number" value={nw.amount} onChange={e => setNw({ ...nw, amount: e.target.value })} data-testid="pay-amount" /></div><div><Label>Date</Label><Input type="date" value={nw.payment_date} onChange={e => setNw({ ...nw, payment_date: e.target.value })} /></div></div>
          <div><Label>Reference (UTR / cheque no.)</Label><Input value={nw.reference} onChange={e => setNw({ ...nw, reference: e.target.value })} data-testid="pay-ref" /></div>
          <Button onClick={create} disabled={!nw.client_id || !(Number(nw.amount) > 0)} className={`w-full ${primary}`} data-testid="pay-create">Save draft</Button></div></DialogContent></Dialog>}

      {alloc && <Dialog open onOpenChange={(o) => !o && setAlloc(null)}><DialogContent className="max-w-lg" data-testid="alloc-dialog"><DialogHeader><DialogTitle>{alloc.post ? "Post" : "Allocate"} {alloc.payment.code} · {money(room)} to place</DialogTitle></DialogHeader>
        <div className="space-y-2">{alloc.invoices.length === 0 && <p className="text-sm" style={{ color: "var(--text-subtle)" }}>No open invoices for this client{alloc.post ? " — it will be posted as an unallocated payment." : "."}</p>}
          {alloc.invoices.map(i => <div key={i.id} className="flex items-center gap-2 text-sm"><span className="flex-1 min-w-0">{i.code} · due {money(i.outstanding)}</span><Input type="number" className="h-9 w-32" placeholder="0" value={alloc.amounts[i.id] ?? ""} onChange={e => setAlloc({ ...alloc, amounts: { ...alloc.amounts, [i.id]: e.target.value } })} data-testid={`alloc-${i.id}`} /><button className="text-xs underline" onClick={() => setAlloc({ ...alloc, amounts: { ...alloc.amounts, [i.id]: Math.min(i.outstanding, Math.max(0, room - total + (Number(alloc.amounts[i.id]) || 0))) } })}>fill</button></div>)}
          <p className="text-xs" style={{ color: total > room ? "#E11D48" : "var(--text-muted)" }}>Allocated {money(total)} of {money(room)}</p>
          <Button onClick={submitAlloc} disabled={total > room} className={`w-full ${primary}`} data-testid="alloc-submit">{alloc.post ? "Post payment" : "Save allocation"}</Button></div></DialogContent></Dialog>}
      <PromptDialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)} title={`Cancel ${cancel?.code || "payment"}`} submitLabel="Cancel payment" fields={[{ key: "reason", label: "Reason", required: true }]}
        onSubmit={(v) => act(() => api.post(`/client-mgmt/payments/${cancel.id}/cancel`, { reason: v.reason }), "Payment cancelled")} />
    </div>
  );
}

export function AdvancesPanel({ api, canEdit }) {
  const [rows, load] = useList(api, "/client-mgmt/advances");
  const clients = useClients(api);
  const [nw, setNw] = useState(null);
  const [adj, setAdj] = useState(null);
  const [cancel, setCancel] = useState(null);
  const act = async (fn, ok) => { try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(apiError(e, "That didn't work")); e.handled = true; throw e; } };
  const create = () => act(async () => { await api.post("/client-mgmt/advances", { client_id: Number(nw.client_id), amount: Number(nw.amount), advance_date: nw.advance_date, reference: nw.reference || null, notes: "" }); setNw(null); }, "Advance recorded");
  const openAdj = async (a) => { try { const { data } = await api.get("/client-mgmt/invoices", { params: { client_id: a.client_id, status: "POSTED" } }); setAdj({ a, invoices: data.filter(i => i.outstanding > 0), invoice_id: "", amount: "" }); } catch (e) { toast.error(apiError(e, "Couldn't load invoices")); } };
  return (
    <div className="section-card p-4 sm:p-5" data-testid="advances-panel">
      <div className="flex items-center justify-between mb-3"><h3 className="font-bold font-['Outfit']">Advances</h3>{canEdit && <Button size="sm" className="rounded-lg h-8 bg-[#0020F8] text-white hover:bg-[#0019C4]" onClick={() => setNw({ client_id: "", amount: "", advance_date: todayStr(), reference: "" })} data-testid="new-advance"><Plus className="h-3.5 w-3.5 mr-1" weight="bold" /> New advance</Button>}</div>
      <div className="overflow-x-auto"><table className="w-full min-w-[700px]"><Head cols={["Code", "Client", "Date", "Amount", "Remaining", "Status", ""]} />
        <tbody>{(rows || []).map(a => (
          <tr key={a.id} className="table-row" data-testid={`advance-row-${a.id}`}><td className="table-cell font-semibold">{a.code}</td><td className="table-cell">{a.client_name}</td><td className="table-cell">{day(a.advance_date)}</td><td className="table-cell">{money(a.amount)}</td><td className="table-cell">{money(a.remaining)}</td><td className="table-cell"><Pill tone={TONES.advance[a.status]}>{label(a.status)}</Pill></td>
            <td className="table-cell whitespace-nowrap">{canEdit && a.status !== "CANCELLED" && <>{a.remaining > 0 && <Button size="sm" variant="outline" className="rounded-lg h-8 mr-1" onClick={() => openAdj(a)} data-testid={`adjust-${a.id}`}>Adjust</Button>}<Button size="sm" variant="outline" className="rounded-lg h-8 text-red-600" onClick={() => setCancel(a)}>Cancel</Button></>}</td></tr>))}</tbody></table>
        {rows && rows.length === 0 && <Empty>No advances yet.</Empty>}</div>
      {nw && <Dialog open onOpenChange={(o) => !o && setNw(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>New advance</DialogTitle></DialogHeader>
        <div className="space-y-3"><div><Label>Client</Label><select className={selectClass} value={nw.client_id} onChange={e => setNw({ ...nw, client_id: e.target.value })} data-testid="adv-client"><option value="">Select…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-3"><div><Label>Amount</Label><Input type="number" value={nw.amount} onChange={e => setNw({ ...nw, amount: e.target.value })} data-testid="adv-amount" /></div><div><Label>Date</Label><Input type="date" value={nw.advance_date} onChange={e => setNw({ ...nw, advance_date: e.target.value })} /></div></div>
          <Button onClick={create} disabled={!nw.client_id || !(Number(nw.amount) > 0)} className={`w-full ${primary}`} data-testid="adv-create">Record advance</Button></div></DialogContent></Dialog>}
      {adj && <Dialog open onOpenChange={(o) => !o && setAdj(null)}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>Adjust {adj.a.code} · {money(adj.a.remaining)} left</DialogTitle></DialogHeader>
        <div className="space-y-3"><div><Label>Invoice</Label><select className={selectClass} value={adj.invoice_id} onChange={e => setAdj({ ...adj, invoice_id: e.target.value })} data-testid="adj-invoice"><option value="">Select…</option>{adj.invoices.map(i => <option key={i.id} value={i.id}>{i.code} · due {money(i.outstanding)}</option>)}</select></div>
          <div><Label>Amount</Label><Input type="number" value={adj.amount} onChange={e => setAdj({ ...adj, amount: e.target.value })} data-testid="adj-amount" /></div>
          <Button disabled={!adj.invoice_id || !(Number(adj.amount) > 0)} className={`w-full ${primary}`} data-testid="adj-submit" onClick={() => act(() => api.post(`/client-mgmt/advances/${adj.a.id}/adjust`, { invoice_id: Number(adj.invoice_id), amount: Number(adj.amount) }), "Adjusted").then(() => setAdj(null)).catch(() => {})}>Adjust</Button></div></DialogContent></Dialog>}
      <PromptDialog open={!!cancel} onOpenChange={(o) => !o && setCancel(null)} title={`Cancel ${cancel?.code || "advance"}`} submitLabel="Cancel advance" fields={[{ key: "reason", label: "Reason", required: true }]}
        onSubmit={(v) => act(() => api.post(`/client-mgmt/advances/${cancel.id}/cancel`, { reason: v.reason }), "Advance cancelled")} />
    </div>
  );
}

export function LedgerPanel({ api }) {
  const [summary] = useList(api, "/client-mgmt/ledger");
  const [clientId, setClientId] = useState(null);
  const [data, setData] = useState(null);
  useEffect(() => { if (!clientId) { setData(null); return; } let live = true; api.get(`/client-mgmt/clients/${clientId}/ledger`).then(r => live && setData(r.data)).catch(e => toast.error(apiError(e, "Couldn't load the ledger"))); return () => { live = false; }; }, [clientId, api]);
  return (
    <div className="section-card p-4 sm:p-5" data-testid="ledger-panel">
      <h3 className="font-bold font-['Outfit'] mb-3">Client ledger</h3>
      {!clientId ? (
        <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><Head cols={["Client", "Balance (owed to us)", "Open invoices", "Unallocated payments", "Advances left"]} />
          <tbody>{(summary || []).map(r => <tr key={r.client_id} className="table-row cursor-pointer" onClick={() => setClientId(r.client_id)} data-testid={`ledger-row-${r.client_id}`}><td className="table-cell font-semibold">{r.client}</td><td className="table-cell" style={{ color: r.balance > 0 ? "#E11D48" : undefined }}>{money(r.balance)}</td><td className="table-cell">{money(r.outstanding_invoices)}</td><td className="table-cell">{money(r.unallocated_payments)}</td><td className="table-cell">{money(r.advances_remaining)}</td></tr>)}</tbody></table>
          {summary && summary.length === 0 && <Empty>No ledger activity yet.</Empty>}</div>
      ) : data && (
        <div data-testid="ledger-detail"><button className="text-sm underline mb-3" onClick={() => setClientId(null)}>← All clients</button>
          <p className="font-semibold mb-1">{data.client.name} <span className="font-normal text-xs" style={{ color: "var(--text-subtle)" }}>{data.client.code}</span></p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">{[["Balance", data.balance], ["Invoiced", data.totals.invoiced], ["Paid", data.totals.payments], ["Advances", data.totals.advances]].map(([l, v]) => <div key={l} className="stat-card"><p className="text-xs" style={{ color: "var(--text-muted)" }}>{l}</p><p className="text-lg font-bold" data-testid={`ledger-${l.toLowerCase()}`}>{money(v)}</p></div>)}</div>
          {data.open_invoices.length > 0 && <div className="mb-4"><p className="text-sm font-semibold mb-1">Open invoices</p>{data.open_invoices.map(o => <p key={o.invoice_id} className="text-sm">{o.code} · {money(o.outstanding)} · {o.age_days} days{o.overdue_60 && <span className="chip tone-red ml-2">overdue 60+</span>}</p>)}</div>}
          <div className="overflow-x-auto"><table className="w-full min-w-[640px]"><Head cols={["Date", "Entry", "Debit", "Credit", "Balance"]} />
            <tbody>{data.entries.map((e, i) => <tr key={i} className="table-row"><td className="table-cell">{day(e.date)}</td><td className="table-cell">{label(e.type)} {e.ref}<span className="block text-[11px]" style={{ color: "var(--text-subtle)" }}>{e.note || ""}</span></td><td className="table-cell">{e.debit ? money(e.debit) : ""}</td><td className="table-cell">{e.credit ? money(e.credit) : ""}</td><td className="table-cell font-semibold">{money(e.balance)}</td></tr>)}</tbody></table></div></div>)}
    </div>
  );
}
