import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { PaperPlaneTilt, Trash, LockSimple } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { canTransition } from "@/components/projects/constants";
import { STATUSES, PRIORITIES, CATEGORIES, selectClass, when, toLocalInput, fromLocalInput, apiError, Pill, STATUS, PRIORITY } from "./constants";

const EMPTY = { client_id: "", contact_id: "", subject: "", description: "", category: "support", priority: "medium", status: "open", assignee_id: "", due_at: "" };
const describe = (a) => (a.field === "created" ? "created this ticket" : `changed ${a.field} from ${a.old_value || "None"} to ${a.new_value || "None"}`);

// Create a ticket for a client, or open one: details, conversation (with staff-only notes) and history
export function TicketDialog({ open, onOpenChange, api, ticketId, clients, staff, workflow, canEdit, canDelete, onChanged }) {
  const [t, setT] = useState(null);                 // loaded ticket (null when creating)
  const [form, setForm] = useState(EMPTY);
  const [contacts, setContacts] = useState([]);
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [tab, setTab] = useState("thread");
  const [saving, setSaving] = useState(false);
  const creating = !ticketId;

  const closeRef = useRef(onOpenChange);   // the parent's callback can change every render; it must not trigger a reload
  closeRef.current = onOpenChange;

  const load = useCallback(async (isStale = () => false) => {
    const { data } = await api.get(`/tickets/${ticketId}`);
    if (isStale()) return;
    setT(data);
    setForm({ ...EMPTY, client_id: data.client_id, subject: data.subject, description: data.description, category: data.category, priority: data.priority, status: data.status, assignee_id: data.assignee_id || "", due_at: toLocalInput(data.due_at) });
  }, [api, ticketId]);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setReply(""); setInternal(false); setTab("thread"); setContacts([]);
    setT(null); setForm(EMPTY);   // never show (or save) the previously opened ticket while this one loads
    if (!creating) load(() => stale).catch(e => { if (!stale) { toast.error(apiError(e, "Failed to load ticket")); closeRef.current(false); } });
    return () => { stale = true; };
  }, [open, creating, load]);

  useEffect(() => {
    if (!open || !creating || !form.client_id) { setContacts([]); return; }
    api.get(`/tickets/clients/${form.client_id}/contacts`).then(r => setContacts(r.data.filter(c => c.active))).catch(() => setContacts([]));
  }, [open, creating, form.client_id, api]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const payload = () => ({ ...form, client_id: Number(form.client_id), contact_id: form.contact_id ? Number(form.contact_id) : null, assignee_id: form.assignee_id ? Number(form.assignee_id) : null, due_at: fromLocalInput(form.due_at) });

  const save = async () => {
    if (!form.subject.trim()) return toast.error("Enter a subject");
    if (creating && !form.client_id) return toast.error("Choose a client");
    setSaving(true);
    try {
      if (creating) { await api.post("/tickets", payload()); toast.success("Ticket created"); onOpenChange(false); }
      else { await api.put(`/tickets/${ticketId}`, payload()); toast.success("Ticket updated"); onChanged(); await load().catch(() => toast.error("Saved, but couldn't refresh the ticket")); return; }
      onChanged();
    } catch (e) { toast.error(apiError(e, "Failed to save ticket")); }
    finally { setSaving(false); }
  };

  const setStatusOnly = async () => {
    setSaving(true);
    try { await api.put(`/tickets/${ticketId}/status`, { status: form.status }); toast.success("Status updated"); onChanged(); await load().catch(() => toast.error("Saved, but couldn't refresh the ticket")); }
    catch (e) { toast.error(apiError(e, "Failed to update status")); }
    finally { setSaving(false); }
  };

  const send = async () => {
    if (!reply.trim()) return;
    try { await api.post(`/tickets/${ticketId}/replies`, { body: reply, internal }); setReply(""); toast.success(internal ? "Note added" : "Reply sent to the client"); onChanged(); await load().catch(() => toast.error("Sent, but couldn't refresh the conversation")); }
    catch (e) { toast.error(apiError(e, "Failed to send")); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${t.number}?`)) return;
    try { await api.delete(`/tickets/${ticketId}`); toast.success("Ticket deleted"); onOpenChange(false); onChanged(); }
    catch (e) { toast.error(apiError(e, "Failed to delete")); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {creating ? "New ticket" : <><span className="text-sm font-semibold" style={{ color: "var(--text-subtle)" }}>{t?.number}</span><span className="break-words">{t?.subject}</span></>}
          </DialogTitle>
        </DialogHeader>

        {(creating || t) && (
          <div className="space-y-4">
            {!creating && (
              <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                <Pill item={STATUS[t.status]} /><Pill item={PRIORITY[t.priority]} />
                <span><strong>{t.client_name}</strong>{t.contact_name ? ` · ${t.contact_name}` : ""}</span>
                <span>· Opened {when(t.created_at)}</span>
                {t.overdue && <span className="font-bold" style={{ color: "#E11D48" }}>· Overdue (due {when(t.due_at)})</span>}
              </div>
            )}

            {creating && (
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1"><Label>Client</Label>
                  <select className={selectClass} value={form.client_id} onChange={e => { set("client_id", e.target.value); set("contact_id", ""); }} data-testid="ticket-client-select">
                    <option value="">Choose a client…</option>{clients.filter(c => c.status === "active").map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
                <div className="col-span-2 sm:col-span-1"><Label>Raised by (contact)</Label>
                  <select className={selectClass} value={form.contact_id} onChange={e => set("contact_id", e.target.value)} data-testid="ticket-contact-select">
                    <option value="">No specific contact</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              </div>
            )}

            <div><Label>Subject</Label><Input value={form.subject} disabled={!canEdit} onChange={e => set("subject", e.target.value)} data-testid="ticket-subject-input" /></div>
            <div><Label>Description</Label><Textarea rows={3} value={form.description} disabled={!canEdit} onChange={e => set("description", e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Category</Label><select className={selectClass} value={form.category} disabled={!canEdit} onChange={e => set("category", e.target.value)}>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
              <div><Label>Priority</Label><select className={selectClass} value={form.priority} disabled={!canEdit} onChange={e => set("priority", e.target.value)} data-testid="ticket-priority-select">{PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
              {!creating && <div><Label>Status</Label><select className={selectClass} value={form.status} onChange={e => set("status", e.target.value)} data-testid="ticket-status-select">{STATUSES.filter(s => canTransition(workflow, t.status, s.key)).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></div>}
              <div><Label>Assignee</Label>
                {canEdit ? <select className={selectClass} value={form.assignee_id} onChange={e => set("assignee_id", e.target.value)} data-testid="ticket-assignee-select"><option value="">Unassigned</option>{staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                  : <Input disabled value={t?.assignee_name || "Unassigned"} />}</div>
              <div className="col-span-2 sm:col-span-1"><Label>SLA due {creating ? "(optional)" : ""}</Label><Input type="datetime-local" value={form.due_at} disabled={!canEdit} onChange={e => set("due_at", e.target.value)} /></div>
            </div>
            {creating && <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>Leave the due time blank to use the SLA for the priority (Urgent 4h · High 8h · Medium 24h · Low 72h).</p>}

            <div className="flex gap-2">
              {!creating && canDelete && <Button variant="outline" className="rounded-xl h-10 text-red-600" onClick={remove} aria-label="Delete ticket"><Trash className="h-4 w-4" /></Button>}
              {(canEdit || !creating) && (
                <Button onClick={canEdit ? save : setStatusOnly} disabled={saving} className="flex-1 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-ticket-btn">
                  {saving ? "Saving…" : creating ? "Create ticket" : canEdit ? "Save changes" : "Update status"}
                </Button>
              )}
            </div>

            {!creating && (
              <div className="pt-4" style={{ borderTop: "1px solid var(--border-color)" }}>
                <div className="flex gap-4 mb-3">
                  {[["thread", `Conversation (${t.replies.length})`], ["history", `History (${t.activity.length})`]].map(([k, label]) => (
                    <button key={k} onClick={() => setTab(k)} data-testid={`ticket-tab-${k}`} className="text-sm font-bold pb-1"
                      style={{ color: tab === k ? "var(--brand-primary)" : "var(--text-subtle)", borderBottom: tab === k ? "2px solid var(--brand-primary)" : "2px solid transparent" }}>{label}</button>
                  ))}
                </div>
                {tab === "thread" ? (
                  <>
                    <div className="space-y-3 mb-3 max-h-64 overflow-y-auto" data-testid="ticket-thread">
                      {t.replies.length === 0 && <p className="text-xs" style={{ color: "var(--text-subtle)" }}>No replies yet</p>}
                      {t.replies.map(r => (
                        <div key={r.id} className="rounded-xl p-3 text-sm" style={{ background: r.internal ? "#FFFBEB" : r.author_type === "client" ? "#EEF3FF" : "var(--surface-elevated)", border: `1px solid ${r.internal ? "#FDE68A" : "var(--border-color)"}` }}>
                          <p className="text-xs mb-1"><strong>{r.author_name}</strong> <span style={{ color: "var(--text-subtle)" }}>{r.author_type === "client" ? "client" : "staff"} · {when(r.created_at)}</span>
                            {r.internal && <span className="ml-2 inline-flex items-center gap-0.5 font-bold" style={{ color: "#B45309" }}><LockSimple className="h-3 w-3" weight="bold" />Internal note</span>}</p>
                          <p className="break-words whitespace-pre-wrap">{r.body}</p>
                        </div>
                      ))}
                    </div>
                    <Textarea rows={2} placeholder={internal ? "Write an internal note (the client can't see it)…" : "Reply to the client…"} value={reply} onChange={e => setReply(e.target.value)} data-testid="ticket-reply-input" />
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} data-testid="ticket-internal-check" /> Internal note (staff only)</label>
                      <Button onClick={send} className="rounded-xl h-9 bg-[#0020F8] text-white hover:bg-[#0019C4]" data-testid="ticket-send-btn"><PaperPlaneTilt className="h-4 w-4 mr-1.5" />{internal ? "Add note" : "Send reply"}</Button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto" data-testid="ticket-history">
                    {t.activity.map(a => <p key={a.id} className="text-xs break-words" style={{ color: "var(--text-muted)" }}><strong style={{ color: "var(--text-primary)" }}>{a.user_name}</strong> {describe(a)} <span style={{ color: "var(--text-subtle)" }}>· {when(a.created_at)}</span></p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
