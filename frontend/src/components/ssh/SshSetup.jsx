import { useEffect, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Plus, PencilSimple, Trash, Key, ShieldCheck, ArrowsClockwise, Password } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const selectClass = "w-full h-10 rounded-xl border px-3 text-sm bg-white";
const apiError = (e, f) => e.response?.data?.detail || f;
const EMPTY_SERVER = { client_id: "", name: "", host: "", port: 22 };
const EMPTY_LOGIN = { username: "", auth_type: "password", secret: "", passphrase: "" };

// Admin side: servers (with the pinned host key), the L1 / L2 logins (stored encrypted, never shown again) and who is on the team
export function SshSetup({ api, servers, clients, canDelete, reload }) {
  const [serverDialog, setServerDialog] = useState(false);
  const [editing, setEditing] = useState(null);
  const [serverForm, setServerForm] = useState(EMPTY_SERVER);
  const [loginDialog, setLoginDialog] = useState(null);   // { server, level, existing }
  const [loginForm, setLoginForm] = useState(EMPTY_LOGIN);
  const [team, setTeam] = useState([]);
  const [saving, setSaving] = useState(false);

  const loadTeam = () => api.get("/ssh/team").then(r => setTeam(r.data)).catch(() => {});
  useEffect(() => { loadTeam(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps

  const saveServer = async () => {
    if (!serverForm.client_id || !serverForm.name.trim() || !serverForm.host.trim()) return toast.error("Choose a client and enter a name and host");
    setSaving(true);
    try {
      const body = { ...serverForm, client_id: Number(serverForm.client_id), port: Number(serverForm.port) || 22 };
      const { data } = editing ? await api.put(`/ssh/servers/${editing.id}`, body) : await api.post("/ssh/servers", body);
      toast.success(editing ? "Server updated" : `Server added. Host key ${data.fingerprint}`, { duration: 8000 });
      setServerDialog(false); reload();
    } catch (e) { toast.error(apiError(e, "Failed to save server")); } finally { setSaving(false); }
  };
  const removeServer = async (s) => {
    if (!window.confirm(`Delete ${s.name} and its stored logins?`)) return;
    try { await api.delete(`/ssh/servers/${s.id}`); toast.success("Server deleted"); reload(); } catch (e) { toast.error(apiError(e, "Failed to delete")); }
  };
  const repin = async (s) => {
    if (!window.confirm(`Read ${s.name}'s SSH host key again? Only do this if you know the server was rebuilt or its key changed.`)) return;
    try { const { data } = await api.post(`/ssh/servers/${s.id}/repin`); toast.success(data.changed ? `Host key changed — now ${data.fingerprint}` : "Host key is unchanged", { duration: 8000 }); reload(); }
    catch (e) { toast.error(apiError(e, "Couldn't read the host key")); }
  };

  const openLogin = (server, level) => { setLoginDialog({ server, level, existing: server.logins?.[level] }); const ex = server.logins?.[level]; setLoginForm({ ...EMPTY_LOGIN, username: ex?.username || "", auth_type: ex?.auth_type || "password" }); };
  const saveLogin = async () => {
    const { server, level, existing } = loginDialog;
    if (!loginForm.username.trim()) return toast.error("Enter the SSH username");
    if (!existing && !loginForm.secret) return toast.error("Enter the password or private key");
    setSaving(true);
    try {
      await api.put(`/ssh/servers/${server.id}/logins/${level}`, { username: loginForm.username, auth_type: loginForm.auth_type, secret: loginForm.secret, passphrase: loginForm.auth_type === "key" && loginForm.passphrase ? loginForm.passphrase : null });
      toast.success(`${level.toUpperCase()} login saved`); setLoginDialog(null); reload();
    } catch (e) { toast.error(apiError(e, "Failed to save login")); } finally { setSaving(false); }
  };
  const removeLogin = async (server, level) => {
    if (!window.confirm(`Remove the ${level.toUpperCase()} login for ${server.name}?`)) return;
    try { await api.delete(`/ssh/servers/${server.id}/logins/${level}`); toast.success("Login removed"); reload(); } catch (e) { toast.error(apiError(e, "Failed to remove")); }
  };
  const setLevel = async (u, level) => {
    try { await api.put(`/ssh/team/${u.id}`, { level: level || null }); setTeam(t => t.map(x => x.id === u.id ? { ...x, level: level || null } : x)); }
    catch (e) { toast.error(apiError(e, "Failed to update the team")); }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold font-['Outfit']">Servers & logins</h2>
        <Button data-testid="add-ssh-server-btn" onClick={() => { setEditing(null); setServerForm(EMPTY_SERVER); setServerDialog(true); }} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-9 px-4"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> Add server</Button>
      </div>
      {servers.length === 0 && <div className="section-card p-8 text-center text-sm text-slate-500 mb-6">No servers yet. Add one, then store its L1 and/or L2 login.</div>}
      {servers.map(s => (
        <div key={s.id} className="section-card mb-3" data-testid={`ssh-setup-${s.id}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <div className="min-w-0"><p className="font-bold font-['Outfit'] break-words">{s.name} <span className="text-xs font-normal" style={{ color: "var(--text-subtle)" }}>{s.client_name}</span></p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>{s.host}:{s.port}</p></div>
            <div className="flex items-center gap-1 ml-auto">
              <button className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Edit server" onClick={() => { setEditing(s); setServerForm({ client_id: s.client_id, name: s.name, host: s.host, port: s.port }); setServerDialog(true); }}><PencilSimple className="h-4 w-4" /></button>
              {canDelete && <button className="p-1.5 rounded-lg hover:bg-slate-100 text-red-600" aria-label="Delete server" onClick={() => removeServer(s)}><Trash className="h-4 w-4" /></button>}
            </div>
          </div>
          <div className="px-4 pb-3 text-xs flex flex-wrap items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <ShieldCheck className="h-4 w-4" style={{ color: "#059669" }} weight="duotone" /> Host key pinned {s.pinned_at ? format(new Date(s.pinned_at), "d MMM yyyy") : ""}: <code className="break-all">{s.fingerprint}</code>
            <button className="underline font-semibold" onClick={() => repin(s)} data-testid={`repin-${s.id}`}><ArrowsClockwise className="h-3 w-3 inline mr-0.5" />Re-read</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-px" style={{ borderTop: "1px solid var(--border-color)", background: "var(--border-color)" }}>
            {["l1", "l2"].map(level => { const lg = s.logins?.[level]; return (
              <div key={level} className="p-4" style={{ background: "var(--surface)" }}>
                <p className="text-xs font-bold mb-1">{level.toUpperCase()} login <span className="font-normal" style={{ color: "var(--text-subtle)" }}>{level === "l1" ? "(limited account)" : "(privileged account)"}</span></p>
                {lg ? <p className="text-sm flex items-center gap-1.5">{lg.auth_type === "key" ? <Key className="h-4 w-4" /> : <Password className="h-4 w-4" />}<strong>{lg.username}</strong> <span className="text-xs" style={{ color: "var(--text-subtle)" }}>{lg.auth_type === "key" ? "private key" : "password"} · stored encrypted</span></p> : <p className="text-sm" style={{ color: "var(--text-subtle)" }}>Not set</p>}
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" className="rounded-lg h-8" onClick={() => openLogin(s, level)} data-testid={`login-${s.id}-${level}`}>{lg ? "Change" : "Set login"}</Button>
                  {lg && canDelete && <Button size="sm" variant="outline" className="rounded-lg h-8 text-red-600" onClick={() => removeLogin(s, level)}>Remove</Button>}
                </div>
              </div>); })}
          </div>
        </div>
      ))}

      <h2 className="font-bold font-['Outfit'] mt-8 mb-3">L1 / L2 team</h2>
      <p className="text-xs text-slate-500 mb-3">Only people on the team can open a terminal. L1 uses the L1 login; L2 can use either. Admins are always L2. People also need the SSH Terminal row in the permission matrix.</p>
      <div className="section-card overflow-x-auto"><table className="w-full min-w-[460px]"><thead><tr>{["Employee", "Role", "Team level"].map(h => <th key={h} className="table-header">{h}</th>)}</tr></thead>
        <tbody>{team.map(u => (
          <tr key={u.id} className="table-row" data-testid={`team-row-${u.id}`}><td className="table-cell font-medium">{u.name}</td><td className="table-cell text-xs">{u.role}</td>
            <td className="table-cell"><select className="h-8 rounded-lg border px-2 text-sm bg-white" value={u.level || ""} onChange={e => setLevel(u, e.target.value)} aria-label={`Team level for ${u.name}`}><option value="">Not on the team</option><option value="l1">L1</option><option value="l2">L2</option></select></td></tr>))}
          {team.length === 0 && <tr><td colSpan={3} className="table-cell text-center text-sm text-slate-500 py-8">No employees yet</td></tr>}</tbody></table></div>

      <Dialog open={serverDialog} onOpenChange={setServerDialog}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editing ? "Edit server" : "Add server"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Client</Label><select className={selectClass} value={serverForm.client_id} onChange={e => setServerForm({ ...serverForm, client_id: e.target.value })} data-testid="ssh-client-select"><option value="">Choose a client…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><Label>Name</Label><Input value={serverForm.name} placeholder="e.g. Production web" onChange={e => setServerForm({ ...serverForm, name: e.target.value })} data-testid="ssh-name-input" /></div>
            <div className="grid grid-cols-3 gap-3"><div className="col-span-2"><Label>Host or IP</Label><Input value={serverForm.host} onChange={e => setServerForm({ ...serverForm, host: e.target.value })} data-testid="ssh-host-input" /></div>
              <div><Label>SSH port</Label><Input type="number" value={serverForm.port} onChange={e => setServerForm({ ...serverForm, port: e.target.value })} /></div></div>
            <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>The portal reads the server's SSH host key now and only ever connects to that exact key. Check the fingerprint it shows against the server's real one.</p>
            <Button onClick={saveServer} disabled={saving} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-ssh-server-btn">{saving ? "Connecting…" : "Save server"}</Button>
          </div></DialogContent>
      </Dialog>

      <Dialog open={!!loginDialog} onOpenChange={(o) => !o && setLoginDialog(null)}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{loginDialog?.level.toUpperCase()} login — {loginDialog?.server.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>SSH username</Label><Input value={loginForm.username} onChange={e => setLoginForm({ ...loginForm, username: e.target.value })} data-testid="login-username-input" /></div>
            <div><Label>Sign in with</Label><select className={selectClass} value={loginForm.auth_type} onChange={e => setLoginForm({ ...loginForm, auth_type: e.target.value })}><option value="password">Password</option><option value="key">Private key</option></select></div>
            {loginForm.auth_type === "password"
              ? <div><Label>{loginDialog?.existing ? "New password (leave blank to keep)" : "Password"}</Label><Input type="password" autoComplete="new-password" value={loginForm.secret} onChange={e => setLoginForm({ ...loginForm, secret: e.target.value })} data-testid="login-secret-input" /></div>
              : <>
                <div><Label>{loginDialog?.existing ? "New private key (leave blank to keep)" : "Private key"}</Label><Textarea rows={5} className="font-mono text-xs" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={loginForm.secret} onChange={e => setLoginForm({ ...loginForm, secret: e.target.value })} data-testid="login-secret-input" /></div>
                <div><Label>Key passphrase (if it has one)</Label><Input type="password" autoComplete="new-password" value={loginForm.passphrase} onChange={e => setLoginForm({ ...loginForm, passphrase: e.target.value })} /></div></>}
            <p className="text-[11px]" style={{ color: "var(--text-subtle)" }}>Stored encrypted and never shown again. Engineers connect through the portal without seeing it.</p>
            <Button onClick={saveLogin} disabled={saving} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-login-btn">{saving ? "Saving…" : "Save login"}</Button>
          </div></DialogContent>
      </Dialog>
    </>
  );
}
