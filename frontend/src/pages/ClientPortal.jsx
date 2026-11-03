import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, SignOut, PaperPlaneTilt, CheckCircle, Headset, Envelope, Lock } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NetworkBackground } from "@/components/common/NetworkBackground";
import { StatusPill as ServerStatus, ago as agoText } from "@/components/monitoring/constants";
import { STATUSES, STATUS, PRIORITIES, PRIORITY, CATEGORIES, CATEGORY_LABEL, selectClass, when, apiError, Pill } from "@/components/tickets/constants";

const EMPTY = { subject: "", description: "", category: "support", priority: "medium" };

function ClientLogin({ onLoggedIn }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { const { data } = await api.post("/client/login", form); onLoggedIn(data); }
    catch (err) { toast.error(apiError(err, "Could not sign in")); }
    finally { setBusy(false); }
  };
  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center px-5 py-10" style={{ background: "var(--brand-gradient)" }}>
      <NetworkBackground />
      <form onSubmit={submit} className="relative z-10 w-full max-w-md rounded-3xl p-8 shadow-2xl" style={{ background: "#fff" }} data-testid="client-login-form">
        <img src="/sparkcurv-logo-full.png" alt="Sparkcurv" style={{ height: 44, width: "auto" }} className="mb-6" />
        <h1 className="text-2xl font-bold font-['Outfit'] text-slate-900">Client support portal</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">Sign in to raise tickets and follow their progress.</p>
        <div className="space-y-4">
          <div><Label>Email</Label><div className="relative"><Envelope className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input type="email" required className="pl-9 h-11 rounded-xl" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} data-testid="client-email-input" /></div></div>
          <div><Label>Password</Label><div className="relative"><Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <Input type="password" required className="pl-9 h-11 rounded-xl" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} data-testid="client-password-input" /></div></div>
          <Button type="submit" disabled={busy} className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]" data-testid="client-login-btn">{busy ? "Signing in…" : "Sign in"}</Button>
        </div>
        <p className="text-xs text-slate-400 mt-6 text-center">Need access? Ask your Sparkcurv contact to create your login.</p>
      </form>
    </div>
  );
}

function TicketView({ id, open, onOpenChange, onChanged, onAuthError }) {
  const [t, setT] = useState(null);
  const [reply, setReply] = useState("");
  const load = useCallback(async () => { setT((await api.get(`/client/tickets/${id}`)).data); }, [id]);
  useEffect(() => { if (open && id) { setT(null); setReply(""); load().catch(e => { onAuthError(e) || toast.error(apiError(e, "Failed to load ticket")); onOpenChange(false); }); } }, [open, id, load, onOpenChange, onAuthError]);
  const send = async () => {
    if (!reply.trim()) return;
    try { await api.post(`/client/tickets/${id}/replies`, { body: reply }); setReply(""); toast.success("Reply sent"); await load(); onChanged(); }
    catch (e) { onAuthError(e) || toast.error(apiError(e, "Failed to send")); }
  };
  const close = async () => {
    if (!window.confirm("Close this ticket? You can open a new one any time.")) return;
    try { await api.post(`/client/tickets/${id}/close`); toast.success("Ticket closed"); await load(); onChanged(); }
    catch (e) { onAuthError(e) || toast.error(apiError(e, "Failed to close")); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[92vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex flex-wrap items-center gap-2">{t && <><span className="text-sm font-semibold text-slate-400">{t.number}</span><span className="break-words">{t.subject}</span></>}</DialogTitle></DialogHeader>
        {t && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500"><Pill item={STATUS[t.status]} /><Pill item={PRIORITY[t.priority]} /><span>{CATEGORY_LABEL[t.category]}</span><span>· Opened {when(t.created_at)}</span></div>
            {t.description && <p className="text-sm whitespace-pre-wrap break-words rounded-xl p-3" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}>{t.description}</p>}
            <div className="space-y-3 max-h-64 overflow-y-auto" data-testid="client-thread">
              {t.replies.length === 0 && <p className="text-xs text-slate-400">No replies yet — we'll get back to you soon.</p>}
              {t.replies.map(r => (
                <div key={r.id} className="rounded-xl p-3 text-sm" style={{ background: r.author_type === "client" ? "#EEF3FF" : "var(--surface-elevated)", border: "1px solid var(--border-color)" }}>
                  <p className="text-xs mb-1"><strong>{r.author_type === "client" ? r.author_name : `${r.author_name} (Sparkcurv)`}</strong> <span className="text-slate-400">· {when(r.created_at)}</span></p>
                  <p className="break-words whitespace-pre-wrap">{r.body}</p>
                </div>
              ))}
            </div>
            {t.status === "closed" ? <p className="text-sm text-slate-500">This ticket is closed. Please open a new ticket if you need more help.</p> : (
              <>
                <Textarea rows={3} placeholder="Write a reply…" value={reply} onChange={e => setReply(e.target.value)} data-testid="client-reply-input" />
                <div className="flex flex-wrap gap-2 justify-between">
                  {t.status === "resolved" ? <Button variant="outline" className="rounded-xl h-10" onClick={close} data-testid="client-close-btn"><CheckCircle className="h-4 w-4 mr-1.5" /> Confirm it's fixed &amp; close</Button> : <span />}
                  <Button onClick={send} className="rounded-xl h-10 bg-[#0020F8] text-white hover:bg-[#0019C4]" data-testid="client-send-btn"><PaperPlaneTilt className="h-4 w-4 mr-1.5" /> Send reply</Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Client-facing support portal: sign in, raise tickets, follow replies. Uses its own session (client_token cookie),
// separate from staff sign-in.
export default function ClientPortal() {
  const [me, setMe] = useState(undefined);   // undefined = checking, null = signed out
  const [tickets, setTickets] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [servers, setServers] = useState([]);

  const load = useCallback(async () => {
    try { setTickets((await api.get("/client/tickets")).data); setLoadFailed(false); }
    catch (e) { if (e.response?.status === 401) setMe(null); else setLoadFailed(true); }
  }, []);
  // Session ended (expired / account disabled): back to the sign-in screen. Returns true when it handled the error.
  const onAuthError = useCallback((e) => { if (e.response?.status === 401) { toast.error("Your session has ended. Please sign in again."); setMe(null); return true; } return false; }, []);
  useEffect(() => { api.get("/client/me").then(r => setMe(r.data)).catch(() => setMe(null)); }, []);
  useEffect(() => { if (me) { load(); api.get("/client/servers").then(r => setServers(r.data)).catch(() => {}); } }, [me, load]);

  const logout = async () => { try { await api.post("/client/logout"); } catch { /* signing out anyway */ } setMe(null); setTickets([]); };
  const create = async () => {
    if (!form.subject.trim()) return toast.error("Enter a subject");
    setSaving(true);
    try { const { data } = await api.post("/client/tickets", form); toast.success(`Ticket ${data.number} created`); setCreateOpen(false); setForm(EMPTY); load(); }
    catch (e) { onAuthError(e) || toast.error(apiError(e, "Failed to create ticket")); } finally { setSaving(false); }
  };

  if (me === undefined) return <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-page)" }}><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "var(--brand-primary)" }} /></div>;
  if (!me) return <ClientLogin onLoggedIn={setMe} />;

  const shown = tickets.filter(t => !filter || (filter === "open" ? ["open", "in_progress", "waiting_client"].includes(t.status) : t.status === filter));
  const count = (...s) => tickets.filter(t => s.includes(t.status)).length;
  return (
    <div className="min-h-screen" style={{ background: "var(--bg-page)" }}>
      <header className="bg-white border-b" style={{ borderColor: "var(--border-color)" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <img src="/sparkcurv-logo-full.png" alt="Sparkcurv" style={{ height: 34, width: "auto" }} />
          <div className="flex items-center gap-3 min-w-0">
            <div className="text-right min-w-0 hidden sm:block"><p className="text-sm font-semibold truncate">{me.name}</p><p className="text-xs text-slate-500 truncate">{me.client_name}</p></div>
            <Button variant="outline" className="rounded-xl h-9" onClick={logout} data-testid="client-logout-btn"><SignOut className="h-4 w-4 mr-1.5" /> Sign out</Button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div><h1 className="text-2xl font-bold font-['Outfit'] tracking-tight text-slate-900">Support tickets</h1><p className="text-sm text-slate-500 mt-1">Hi {me.name.split(" ")[0]}, here's everything you've raised with us.</p></div>
          <Button onClick={() => setCreateOpen(true)} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10 px-4" data-testid="client-new-ticket-btn"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> New ticket</Button>
        </div>
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[["Open", count("open", "in_progress", "waiting_client"), "tone-blue", "open"], ["Resolved", count("resolved"), "tone-green", "resolved"], ["Closed", count("closed"), "tone-teal", "closed"]].map(([label, v, tone, key]) => (
            <button key={label} onClick={() => setFilter(filter === key ? "" : key)} className={`stat-card ${tone} text-left`} style={{ display: "block", outline: filter === key ? "2px solid var(--brand-primary)" : "none" }}>
              <span className="text-xs font-semibold text-slate-500">{label}</span><p className="text-2xl font-bold mt-1" style={{ color: "var(--tone)" }}>{v}</p></button>
          ))}
        </div>
        {servers.length > 0 && (
          <div className="mb-6" data-testid="client-servers">
            <h2 className="text-sm font-bold font-['Outfit'] text-slate-900 mb-3">Your servers</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {servers.map(sv => (
                <div key={sv.id} className="rounded-2xl p-4" style={{ background: "var(--surface)", border: "1px solid var(--border-color)" }}>
                  <div className="flex items-start justify-between gap-2"><p className="font-semibold break-words">{sv.name}</p><ServerStatus status={sv.status} /></div>
                  <p className="text-xs text-slate-500 mt-2">Uptime (30 days): <strong>{sv.uptime_30d == null ? "—" : `${sv.uptime_30d}%`}</strong> · checked {agoText(sv.last_checked_at)}</p>
                </div>))}
            </div>
          </div>
        )}
        {shown.length === 0 ? (
          <div className="section-card"><div className="flex flex-col items-center text-center py-14 px-6 gap-3"><span className="stat-icon tone-blue"><Headset className="h-5 w-5" weight="duotone" /></span>
            <p className="text-sm font-semibold text-slate-900">{loadFailed ? "Couldn't load your tickets. Please refresh the page." : tickets.length ? "No tickets here" : "You haven't raised any tickets yet"}</p></div></div>
        ) : (
          <div className="space-y-3">
            {shown.map(t => (
              <button key={t.id} onClick={() => { setOpenId(t.id); setViewOpen(true); }} data-testid={`client-ticket-${t.id}`} className="w-full text-left rounded-2xl p-4 transition-shadow hover:shadow-md" style={{ background: "var(--surface)", border: "1px solid var(--border-color)" }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><p className="text-xs font-semibold text-slate-400">{t.number} · {CATEGORY_LABEL[t.category]}</p><p className="font-semibold break-words">{t.subject}</p></div>
                  <div className="flex items-center gap-2 flex-shrink-0"><Pill item={PRIORITY[t.priority]} /><Pill item={STATUS[t.status]} /></div>
                </div>
                <p className="text-xs text-slate-500 mt-2">Opened {when(t.created_at)} · Updated {when(t.updated_at)}{t.reply_count ? ` · ${t.reply_count} repl${t.reply_count === 1 ? "y" : "ies"}` : ""}</p>
              </button>
            ))}
          </div>
        )}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg"><DialogHeader><DialogTitle>New support ticket</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Subject</Label><Input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} data-testid="client-subject-input" /></div>
            <div><Label>Describe the issue</Label><Textarea rows={5} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} data-testid="client-description-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Category</Label><select className={selectClass} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></div>
              <div><Label>Priority</Label><select className={selectClass} value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>{PRIORITIES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</select></div>
            </div>
            <Button onClick={create} disabled={saving} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="client-submit-ticket-btn">{saving ? "Submitting…" : "Submit ticket"}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <TicketView id={openId} open={viewOpen} onOpenChange={setViewOpen} onChanged={load} onAuthError={onAuthError} />
    </div>
  );
}
