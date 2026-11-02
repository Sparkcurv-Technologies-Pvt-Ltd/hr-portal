import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  LockKey, Plus, MagnifyingGlass, Eye, EyeSlash, Copy, PencilSimple, Trash, UsersThree, ClockCounterClockwise,
  LinkSimple, User, Key, ArrowsClockwise, ShieldCheck, UserGear
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar } from "@/components/common/Avatar";

const REVEAL_SECONDS = 30;
const EMPTY_FORM = { title: "", category: "General", username: "", url: "", secret: "", notes: "" };
const ACTION_TONE = { reveal: "tone-amber", copy: "tone-amber", create: "tone-green", update: "tone-blue", share: "tone-violet", delete: "tone-red", editors: "tone-teal" };

// Strong random password (no ambiguous characters)
function generatePassword(length = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
  const bytes = new Uint32Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-secure (http) origins
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
  }
}

// Credential vault: admins manage every credential and choose vault editors; editors add credentials and
// manage the ones they created; other employees see only what's shared with them.
// Secrets are only fetched on Reveal / Copy (each logged server-side) and hidden again after 30s.
export function VaultTab({ api, user }) {
  const isAdmin = user?.role === "admin";
  const canCreate = isAdmin || !!user?.vault_editor;   // admins and vault editors can add credentials
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [revealed, setRevealed] = useState({});     // id -> { secret, notes, until }
  const [, setTick] = useState(0);
  const timers = useRef({});

  const [employees, setEmployees] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(null);     // item being edited, or null when adding
  const [form, setForm] = useState(EMPTY_FORM);
  const [showSecret, setShowSecret] = useState(false);
  const [shares, setShares] = useState({});          // user_id -> "view" | "edit"
  const [saving, setSaving] = useState(false);
  const [shareItem, setShareItem] = useState(null);  // item whose sharing is being edited
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState([]);
  const [editorsOpen, setEditorsOpen] = useState(false);
  const [editorIds, setEditorIds] = useState({});      // user_id -> true (admin's editor picker)

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/vault/items");
      setItems(data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load the vault");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);
  const loadPeople = useCallback(() => {
    if (canCreate) api.get("/vault/people").then(r => setEmployees(r.data || [])).catch(() => {});
  }, [api, canCreate]);
  useEffect(() => { loadPeople(); }, [loadPeople]);

  // Countdown for revealed secrets; clear everything when leaving the page
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    const pending = timers.current;
    return () => { clearInterval(t); Object.values(pending).forEach(clearTimeout); };
  }, []);

  const hide = (id) => {
    clearTimeout(timers.current[id]);
    setRevealed(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const reveal = async (item) => {
    if (revealed[item.id]) { hide(item.id); return; }
    try {
      const { data } = await api.post(`/vault/items/${item.id}/reveal`);
      setRevealed(prev => ({ ...prev, [item.id]: { ...data, until: Date.now() + REVEAL_SECONDS * 1000 } }));
      clearTimeout(timers.current[item.id]);
      timers.current[item.id] = setTimeout(() => hide(item.id), REVEAL_SECONDS * 1000);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't reveal this password");
    }
  };

  const copySecret = async (item) => {
    try {
      const { data } = await api.post(`/vault/items/${item.id}/reveal?purpose=copy`);
      await copyText(data.secret);
      toast.success(`Password for ${item.title} copied`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Couldn't copy this password");
    }
  };

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map(i => i.category || "General"))).sort()], [items]);
  const visible = items.filter(i =>
    (category === "All" || (i.category || "General") === category) &&
    (!search.trim() || [i.title, i.username, i.url, i.category].some(v => (v || "").toLowerCase().includes(search.trim().toLowerCase())))
  );

  // ----- add / edit -----
  const openAdd = () => {
    setEditing(null); setForm(EMPTY_FORM); setShowSecret(false); setShares({}); setDialogOpen(true);
  };
  const openEdit = async (item) => {
    setEditing(item);
    setForm({ title: item.title, category: item.category || "General", username: item.username || "", url: item.url || "", secret: "", notes: "" });
    setShowSecret(false);
    setDialogOpen(true);
    if (item.has_notes) {
      // Notes are encrypted too: load them so editing doesn't wipe them (logged as a reveal)
      try {
        const { data } = await api.post(`/vault/items/${item.id}/reveal`);
        setForm(f => ({ ...f, notes: data.notes || "" }));
      } catch {}
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("Enter a title"); return; }
    if (!editing && !form.secret) { toast.error("Enter the password / secret"); return; }
    setSaving(true);
    try {
      if (editing) {
        const body = { title: form.title, category: form.category, username: form.username, url: form.url, notes: form.notes };
        if (form.secret) body.secret = form.secret;
        await api.put(`/vault/items/${editing.id}`, body);
        hide(editing.id);
        toast.success("Credential updated");
      } else {
        await api.post("/vault/items", {
          ...form,
          shares: Object.entries(shares).map(([user_id, level]) => ({ user_id, can_edit: level === "edit" })),
        });
        toast.success("Credential saved");
      }
      setDialogOpen(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.title}" from the vault? This can't be undone.`)) return;
    try {
      await api.delete(`/vault/items/${item.id}`);
      hide(item.id);
      toast.success("Credential deleted");
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to delete");
    }
  };

  // ----- sharing -----
  const openShare = (item) => {
    setShareItem(item);
    setShares(Object.fromEntries((item.shared_with || []).map(s => [s.user_id, s.can_edit ? "edit" : "view"])));
  };
  const saveShares = async () => {
    setSaving(true);
    try {
      await api.put(`/vault/items/${shareItem.id}/shares`, {
        shares: Object.entries(shares).map(([user_id, level]) => ({ user_id, can_edit: level === "edit" })),
      });
      toast.success("Sharing updated");
      setShareItem(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update sharing");
    } finally {
      setSaving(false);
    }
  };

  const openEditors = () => {
    setEditorIds(Object.fromEntries(employees.filter(e => e.vault_editor).map(e => [e.id, true])));
    setEditorsOpen(true);
  };
  const saveEditors = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/vault/editors", { user_ids: Object.keys(editorIds).filter(id => editorIds[id]) });
      toast.success(data?.editors?.length ? `Vault editors: ${data.editors.join(", ")}` : "No vault editors");
      setEditorsOpen(false);
      loadPeople();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update editors");
    } finally {
      setSaving(false);
    }
  };

  const openAudit = async () => {
    setAuditOpen(true);
    try {
      const { data } = await api.get("/vault/audit");
      setAudit(data || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load the activity log");
    }
  };

  const SharePicker = () => (
    <div className="rounded-xl border max-h-64 overflow-y-auto" style={{ borderColor: 'var(--border-color)' }} data-testid="vault-share-picker">
      {employees.length === 0 && <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>No employees yet</p>}
      {employees.map(emp => {
        const level = shares[emp.id] || "none";
        return (
          <div key={emp.id} className="flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0" style={{ borderColor: 'var(--border-subtle)' }}>
            <Avatar url={emp.avatar_url} name={emp.name} size="h-8 w-8" textSize="text-[11px]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{emp.name}</p>
              <p className="text-[11px] truncate" style={{ color: 'var(--text-subtle)' }}>{emp.department || emp.email}</p>
            </div>
            <div className="inline-flex p-0.5 rounded-lg" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-color)' }}>
              {["none", "view", "edit"].map(opt => (
                <button
                  key={opt}
                  type="button"
                  data-testid={`vault-share-${emp.id}-${opt}`}
                  onClick={() => setShares(prev => { const next = { ...prev }; if (opt === "none") delete next[emp.id]; else next[emp.id] = opt; return next; })}
                  className="px-2.5 h-7 rounded-md text-xs font-semibold capitalize transition-colors"
                  style={level === opt
                    ? { background: opt === "none" ? 'var(--surface)' : 'var(--brand-primary)', color: opt === "none" ? 'var(--text-primary)' : '#FFFFFF', boxShadow: 'var(--shadow-sm)' }
                    : { color: 'var(--text-muted)' }}
                >
                  {opt === "none" ? "No access" : opt}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 font-['Outfit'] tracking-tight">Vault</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {isAdmin
              ? "Company credentials, encrypted and shared only with the people who need them"
              : canCreate
                ? "You're a vault editor: add credentials and manage the ones you created"
                : "Credentials shared with you"}
          </p>
        </div>
        {canCreate && (
          <div className="flex flex-wrap gap-2">
            {isAdmin && (
              <>
                <Button variant="outline" className="rounded-xl" onClick={openEditors} data-testid="vault-editors-btn">
                  <UserGear className="h-4 w-4 mr-1.5" /> Editors
                </Button>
                <Button variant="outline" className="rounded-xl" onClick={openAudit} data-testid="vault-audit-btn">
                  <ClockCounterClockwise className="h-4 w-4 mr-1.5" /> Activity log
                </Button>
              </>
            )}
            <Button className="rounded-xl bg-[#0020F8] hover:bg-[#0019C4] text-white" onClick={openAdd} data-testid="vault-add-btn">
              <Plus className="h-4 w-4 mr-1.5" weight="bold" /> Add credential
            </Button>
          </div>
        )}
      </div>

      {/* Security note */}
      <div className="flex items-start gap-3 rounded-2xl p-4 mb-5 tone-blue" style={{ background: 'var(--tone-bg)' }}>
        <ShieldCheck className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--tone)' }} weight="duotone" />
        <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Passwords are encrypted and stay hidden until you reveal or copy them. Every reveal, copy and change is recorded{isAdmin ? " in the activity log" : " and visible to admins"}. Revealed passwords hide again after {REVEAL_SECONDS} seconds.
        </p>
      </div>

      {/* Search + categories */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="relative w-full sm:w-72">
          <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" style={{ width: 16, height: 16 }} />
          <Input data-testid="vault-search" placeholder="Search credentials" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-10 rounded-xl" />
        </div>
        {categories.length > 2 && categories.map(c => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className="h-9 px-3.5 rounded-full text-sm font-semibold border transition-colors"
            style={category === c
              ? { background: 'var(--brand-primary)', color: '#FFFFFF', borderColor: 'var(--brand-primary)' }
              : { background: 'var(--surface)', color: 'var(--text-secondary)', borderColor: 'var(--border-color)' }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Credentials */}
      {!loading && visible.length === 0 ? (
        <div className="section-card flex flex-col items-center justify-center text-center py-14 px-6">
          <span className="stat-icon tone-blue mb-3"><LockKey className="h-5 w-5" weight="duotone" /></span>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {items.length === 0 ? (canCreate ? "No credentials yet" : "Nothing has been shared with you yet") : "No credentials match"}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            {items.length === 0 && canCreate ? "Click Add credential to store your first password." : ""}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4" data-testid="vault-list">
          {visible.map(item => {
            const shown = revealed[item.id];
            const secondsLeft = shown ? Math.max(0, Math.ceil((shown.until - Date.now()) / 1000)) : 0;
            const manages = item.access === "admin" || item.access === "owner";   // can share + delete
            const canEdit = manages || item.access === "edit";
            return (
              <div key={item.id} className="section-card p-5 flex flex-col gap-4" data-testid={`vault-item-${item.id}`}>
                <div className="flex items-start gap-3">
                  <span className="stat-icon tone-blue"><Key className="h-5 w-5" weight="duotone" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[15px] truncate" style={{ color: 'var(--text-primary)' }}>{item.title}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="chip">{item.category || "General"}</span>
                      {item.access === "owner" && <span className="chip tone-green">Added by you</span>}
                      {(item.access === "edit" || item.access === "view") && <span className={`chip ${item.access === "edit" ? "tone-violet" : "tone-teal"}`}>{item.access === "edit" ? "Can edit" : "View only"}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" title="Edit" onClick={() => openEdit(item)} className="h-8 w-8 p-0 text-slate-400 hover:text-[#0020F8] hover:bg-blue-50" data-testid={`vault-edit-${item.id}`}>
                        <PencilSimple className="h-4 w-4" />
                      </Button>
                      {manages && (
                        <Button variant="ghost" size="sm" title="Delete" onClick={() => handleDelete(item)} className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50" data-testid={`vault-delete-${item.id}`}>
                          <Trash className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2 text-sm">
                  {item.username && (
                    <div className="flex items-center gap-2 min-w-0">
                      <User className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--text-subtle)' }} />
                      <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{item.username}</span>
                      <button title="Copy username" onClick={async () => { await copyText(item.username); toast.success("Username copied"); }} className="ml-auto text-slate-400 hover:text-[#0020F8]">
                        <Copy className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {item.url && (
                    <div className="flex items-center gap-2 min-w-0">
                      <LinkSimple className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--text-subtle)' }} />
                      <a href={/^https?:\/\//i.test(item.url) ? item.url : `https://${item.url}`} target="_blank" rel="noopener noreferrer" className="truncate hover:underline" style={{ color: 'var(--brand-primary)' }}>
                        {item.url}
                      </a>
                    </div>
                  )}
                  <div className="flex items-center gap-2 rounded-xl px-3 h-11" style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <LockKey className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--text-subtle)' }} />
                    <span className="flex-1 min-w-0 truncate font-['JetBrains_Mono'] text-[13px]" style={{ color: 'var(--text-primary)' }} data-testid={`vault-secret-${item.id}`}>
                      {shown ? shown.secret : "••••••••••••"}
                    </span>
                    {shown && <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-subtle)' }}>{secondsLeft}s</span>}
                    <button title={shown ? "Hide" : "Reveal password"} onClick={() => reveal(item)} className="text-slate-400 hover:text-[#0020F8]" data-testid={`vault-reveal-${item.id}`}>
                      {shown ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button title="Copy password" onClick={() => copySecret(item)} className="text-slate-400 hover:text-[#0020F8]" data-testid={`vault-copy-${item.id}`}>
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  {shown && shown.notes && (
                    <p className="text-[13px] whitespace-pre-wrap rounded-xl px-3 py-2" style={{ background: 'var(--badge-amber-bg)', color: 'var(--text-secondary)' }}>{shown.notes}</p>
                  )}
                  {!shown && item.has_notes && <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Has secure notes — reveal to see them</p>}
                </div>

                <div className="mt-auto pt-3 flex items-center justify-between gap-2 border-t text-xs" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-subtle)' }}>
                  {manages ? (
                    <>
                      <span className="flex items-center gap-1.5 min-w-0">
                        <UsersThree className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">
                          {(item.shared_with || []).length === 0 ? (item.access === "owner" ? "Only you and admins" : "Admins only") : (item.shared_with || []).map(s => `${s.name}${s.can_edit ? " (edit)" : ""}`).join(", ")}
                        </span>
                      </span>
                      <button onClick={() => openShare(item)} className="font-semibold flex-shrink-0 hover:underline" style={{ color: 'var(--brand-primary)' }} data-testid={`vault-share-btn-${item.id}`}>Share</button>
                    </>
                  ) : (
                    <span>Updated {item.updated_at ? format(new Date(item.updated_at), "d MMM yyyy") : "—"}{item.updated_by ? ` by ${item.updated_by}` : ""}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto" data-testid="vault-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">{editing ? `Edit ${editing.title}` : "Add credential"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="vault-title">Title</Label>
                <Input id="vault-title" data-testid="vault-title-input" placeholder="e.g. AWS root account" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="rounded-xl h-11" maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="vault-category">Category</Label>
                <Input id="vault-category" list="vault-categories" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="rounded-xl h-11" maxLength={60} />
                <datalist id="vault-categories">{categories.filter(c => c !== "All").map(c => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vault-username">Username / email</Label>
              <Input id="vault-username" data-testid="vault-username-input" autoComplete="off" value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} className="rounded-xl h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vault-url">Website / URL</Label>
              <Input id="vault-url" placeholder="https://" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} className="rounded-xl h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vault-secret">{editing ? "New password (leave empty to keep the current one)" : "Password / secret"}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="vault-secret" data-testid="vault-secret-input" autoComplete="new-password"
                    type={showSecret ? "text" : "password"} value={form.secret}
                    onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
                    className="rounded-xl h-11 pr-10 font-['JetBrains_Mono']"
                  />
                  <button type="button" onClick={() => setShowSecret(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600" aria-label={showSecret ? "Hide" : "Show"}>
                    {showSecret ? <EyeSlash className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button type="button" variant="outline" className="rounded-xl h-11" title="Generate a strong password" onClick={() => { setForm(f => ({ ...f, secret: generatePassword() })); setShowSecret(true); }}>
                  <ArrowsClockwise className="h-4 w-4 mr-1.5" /> Generate
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vault-notes">Secure notes (optional, encrypted)</Label>
              <Textarea id="vault-notes" rows={3} placeholder="Recovery codes, MFA details…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="rounded-xl" />
            </div>
            {canCreate && !editing && (
              <div className="space-y-1.5">
                <Label>Share with</Label>
                <SharePicker />
                <p className="text-xs" style={{ color: 'var(--text-subtle)' }}>Admins always have access{!isAdmin ? ", and so do you" : ""}. "Edit" lets the employee update this credential.</p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button data-testid="vault-save-btn" onClick={handleSave} disabled={saving} className="rounded-xl bg-[#0020F8] hover:bg-[#0019C4] text-white">
                {saving ? "Saving…" : editing ? "Save changes" : "Save credential"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Sharing dialog */}
      <Dialog open={!!shareItem} onOpenChange={(o) => { if (!o) setShareItem(null); }}>
        <DialogContent className="sm:max-w-lg rounded-2xl" data-testid="vault-share-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Share {shareItem?.title}</DialogTitle>
          </DialogHeader>
          <p className="text-sm -mt-1" style={{ color: 'var(--text-muted)' }}>Choose who can see this credential. Admins{shareItem?.access === "owner" ? " and you" : ""} always have access.</p>
          <SharePicker />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" className="rounded-xl" onClick={() => setShareItem(null)}>Cancel</Button>
            <Button data-testid="vault-share-save" onClick={saveShares} disabled={saving} className="rounded-xl bg-[#0020F8] hover:bg-[#0019C4] text-white">
              {saving ? "Saving…" : "Save sharing"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Vault editors (admin) */}
      <Dialog open={editorsOpen} onOpenChange={setEditorsOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl" data-testid="vault-editors-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Vault editors</DialogTitle>
          </DialogHeader>
          <p className="text-sm -mt-1" style={{ color: 'var(--text-muted)' }}>
            Editors can add credentials and manage (edit, share, delete) the ones they add. They only see other credentials when those are shared with them.
          </p>
          <div className="rounded-xl border max-h-72 overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
            {employees.length === 0 && <p className="text-sm p-4 text-center" style={{ color: 'var(--text-muted)' }}>No employees yet</p>}
            {employees.map(emp => (
              <label key={emp.id} className="flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0 cursor-pointer" style={{ borderColor: 'var(--border-subtle)' }}>
                <Avatar url={emp.avatar_url} name={emp.name} size="h-8 w-8" textSize="text-[11px]" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{emp.name}</p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--text-subtle)' }}>{emp.department || emp.email}</p>
                </div>
                <input
                  type="checkbox"
                  data-testid={`vault-editor-${emp.id}`}
                  checked={!!editorIds[emp.id]}
                  onChange={e => setEditorIds(prev => ({ ...prev, [emp.id]: e.target.checked }))}
                  className="h-4 w-4 cursor-pointer"
                  style={{ accentColor: 'var(--brand-primary)' }}
                />
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" className="rounded-xl" onClick={() => setEditorsOpen(false)}>Cancel</Button>
            <Button data-testid="vault-editors-save" onClick={saveEditors} disabled={saving} className="rounded-xl bg-[#0020F8] hover:bg-[#0019C4] text-white">
              {saving ? "Saving…" : "Save editors"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Activity log */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="sm:max-w-2xl rounded-2xl max-h-[85vh] overflow-y-auto" data-testid="vault-audit-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Vault activity</DialogTitle>
          </DialogHeader>
          <div className="section-card">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">When</th>
                  <th className="table-header">Who</th>
                  <th className="table-header">Action</th>
                  <th className="table-header">Credential</th>
                </tr>
              </thead>
              <tbody>
                {audit.length === 0 && (
                  <tr><td colSpan={4} className="table-cell text-center py-8">No activity yet</td></tr>
                )}
                {audit.map(a => (
                  <tr key={a.id} className="table-row">
                    <td className="table-cell whitespace-nowrap">{a.created_at ? format(new Date(a.created_at), "d MMM, h:mm a") : "—"}</td>
                    <td className="table-cell font-semibold">{a.user_name}</td>
                    <td className="table-cell"><span className={`chip ${ACTION_TONE[a.action] || ""}`}>{a.action}</span></td>
                    <td className="table-cell">
                      <span style={{ color: 'var(--text-primary)' }}>{a.item_title}</span>
                      {a.detail && <span className="block text-[11px]" style={{ color: 'var(--text-subtle)' }}>{a.detail}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
