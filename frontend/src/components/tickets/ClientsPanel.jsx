import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, PencilSimple, Trash, UserPlus, CaretDown, CaretRight, Buildings } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectClass, apiError, when } from "./constants";

const EMPTY_CLIENT = { name: "", email: "", phone: "", address: "", notes: "", status: "active" };
const EMPTY_CONTACT = { name: "", email: "", phone: "", password: "", active: true };

// Client companies and the people at each who can sign in to the client portal
export function ClientsPanel({ api, clients, canEdit, canDelete, reload }) {
  const [openId, setOpenId] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [clientDialog, setClientDialog] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [clientForm, setClientForm] = useState(EMPTY_CLIENT);
  const [contactDialog, setContactDialog] = useState(false);
  const [editingContact, setEditingContact] = useState(null);
  const [contactForm, setContactForm] = useState(EMPTY_CONTACT);
  const [saving, setSaving] = useState(false);

  const contactsSeq = useRef(0);   // contacts of the client that is currently open only
  const loadContacts = useCallback(async (id) => {
    const seq = ++contactsSeq.current;
    try { const { data } = await api.get(`/tickets/clients/${id}/contacts`); if (seq === contactsSeq.current) setContacts(data); }
    catch (e) { if (seq === contactsSeq.current) toast.error(apiError(e, "Failed to load contacts")); }
  }, [api]);
  useEffect(() => { setContacts([]); if (openId) loadContacts(openId); }, [openId, loadContacts]);

  const saveClient = async () => {
    if (!clientForm.name.trim()) return toast.error("Enter the client's name");
    setSaving(true);
    try {
      if (editingClient) await api.put(`/tickets/clients/${editingClient.id}`, clientForm); else await api.post("/tickets/clients", clientForm);
      toast.success(editingClient ? "Client updated" : "Client added"); setClientDialog(false); reload();
    } catch (e) { toast.error(apiError(e, "Failed to save client")); } finally { setSaving(false); }
  };
  const deleteClient = async (c) => {
    if (!window.confirm(`Delete ${c.name} and its logins?`)) return;
    try { await api.delete(`/tickets/clients/${c.id}`); toast.success("Client deleted"); if (openId === c.id) setOpenId(null); reload(); }
    catch (e) { toast.error(apiError(e, "Failed to delete client")); }
  };

  const saveContact = async () => {
    if (!contactForm.name.trim()) return toast.error("Enter the contact's name");
    setSaving(true);
    try {
      if (editingContact) await api.put(`/tickets/contacts/${editingContact.id}`, { name: contactForm.name, phone: contactForm.phone, active: contactForm.active, password: contactForm.password });
      else await api.post(`/tickets/clients/${openId}/contacts`, contactForm);
      toast.success(editingContact ? "Contact updated" : "Contact added — share the login details with them"); setContactDialog(false); loadContacts(openId); reload();
    } catch (e) { toast.error(apiError(e, "Failed to save contact")); } finally { setSaving(false); }
  };
  const deleteContact = async (c) => {
    if (!window.confirm(`Remove ${c.name}'s login?`)) return;
    try { await api.delete(`/tickets/contacts/${c.id}`); toast.success("Contact removed"); loadContacts(openId); reload(); }
    catch (e) { toast.error(apiError(e, "Failed to remove contact")); }
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        {canEdit && <Button data-testid="add-client-btn" onClick={() => { setEditingClient(null); setClientForm(EMPTY_CLIENT); setClientDialog(true); }} className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10 px-4"><Plus className="h-4 w-4 mr-1.5" weight="bold" /> Add client</Button>}
      </div>
      {clients.length === 0 ? (
        <div className="section-card"><div className="flex flex-col items-center text-center py-14 px-6 gap-3"><span className="stat-icon tone-blue"><Buildings className="h-5 w-5" weight="duotone" /></span>
          <p className="text-sm font-semibold text-slate-900">No clients yet</p>{canEdit && <p className="text-xs text-slate-500">Add a client, then give its contacts a portal login.</p>}</div></div>
      ) : clients.map(c => (
        <div key={c.id} className="section-card mb-3" data-testid={`client-${c.id}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <button onClick={() => setOpenId(openId === c.id ? null : c.id)} className="flex items-center gap-2 min-w-0 text-left" aria-label="Show contacts" data-testid={`client-toggle-${c.id}`}>
              {openId === c.id ? <CaretDown className="h-4 w-4" weight="bold" /> : <CaretRight className="h-4 w-4" weight="bold" />}
              <span className="font-bold font-['Outfit'] break-words">{c.name}</span>
            </button>
            <span className={`chip ${c.status === "active" ? "tone-green" : "tone-amber"}`}>{c.status}</span>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>{c.contacts} contact{c.contacts === 1 ? "" : "s"} · {c.open_tickets} open / {c.total_tickets} tickets{c.email ? ` · ${c.email}` : ""}{c.phone ? ` · ${c.phone}` : ""}</span>
            <div className="flex items-center gap-1 ml-auto">
              {canEdit && <button className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Edit client" onClick={() => { setEditingClient(c); setClientForm({ name: c.name, email: c.email, phone: c.phone, address: c.address, notes: c.notes, status: c.status }); setClientDialog(true); }}><PencilSimple className="h-4 w-4" /></button>}
              {canDelete && <button className="p-1.5 rounded-lg hover:bg-slate-100 text-red-600" aria-label="Delete client" onClick={() => deleteClient(c)}><Trash className="h-4 w-4" /></button>}
            </div>
          </div>
          {openId === c.id && (
            <div style={{ borderTop: "1px solid var(--border-color)" }}>
              {contacts.length === 0 && <p className="text-xs px-4 py-4" style={{ color: "var(--text-subtle)" }}>No contacts yet. Add one so they can sign in to the client portal.</p>}
              {contacts.map(ct => (
                <div key={ct.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm" style={{ borderTop: "1px solid var(--border-color)" }}>
                  <span className="font-semibold">{ct.name}</span><span style={{ color: "var(--text-muted)" }}>{ct.email}</span>
                  {!ct.active && <span className="chip tone-amber">disabled</span>}
                  <span className="text-xs" style={{ color: "var(--text-subtle)" }}>Last login: {ct.last_login ? when(ct.last_login) : "never"}</span>
                  <div className="flex items-center gap-1 ml-auto">
                    {canEdit && <button className="p-1.5 rounded-lg hover:bg-slate-100" aria-label="Edit contact" onClick={() => { setEditingContact(ct); setContactForm({ ...EMPTY_CONTACT, name: ct.name, email: ct.email, phone: ct.phone, active: ct.active }); setContactDialog(true); }}><PencilSimple className="h-4 w-4" /></button>}
                    {canDelete && <button className="p-1.5 rounded-lg hover:bg-slate-100 text-red-600" aria-label="Remove contact" onClick={() => deleteContact(ct)}><Trash className="h-4 w-4" /></button>}
                  </div>
                </div>
              ))}
              {canEdit && <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border-color)" }}><Button size="sm" variant="outline" className="rounded-lg h-8" data-testid="add-contact-btn" onClick={() => { setEditingContact(null); setContactForm(EMPTY_CONTACT); setContactDialog(true); }}><UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add contact login</Button></div>}
            </div>
          )}
        </div>
      ))}

      <Dialog open={clientDialog} onOpenChange={setClientDialog}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editingClient ? "Edit client" : "Add client"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Company name</Label><Input value={clientForm.name} onChange={e => setClientForm({ ...clientForm, name: e.target.value })} data-testid="client-name-input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Email</Label><Input value={clientForm.email} onChange={e => setClientForm({ ...clientForm, email: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={clientForm.phone} onChange={e => setClientForm({ ...clientForm, phone: e.target.value })} /></div>
            </div>
            <div><Label>Address</Label><Input value={clientForm.address} onChange={e => setClientForm({ ...clientForm, address: e.target.value })} /></div>
            <div><Label>Notes</Label><Textarea rows={2} value={clientForm.notes} onChange={e => setClientForm({ ...clientForm, notes: e.target.value })} /></div>
            <div><Label>Status</Label><select className={selectClass} value={clientForm.status} onChange={e => setClientForm({ ...clientForm, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive (logins disabled)</option></select></div>
            <Button onClick={saveClient} disabled={saving} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-client-btn">{saving ? "Saving…" : "Save client"}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={contactDialog} onOpenChange={setContactDialog}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{editingContact ? "Edit contact login" : "Add contact login"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name</Label><Input value={contactForm.name} onChange={e => setContactForm({ ...contactForm, name: e.target.value })} data-testid="contact-name-input" /></div>
            <div><Label>Email (their login)</Label><Input value={contactForm.email} disabled={!!editingContact} onChange={e => setContactForm({ ...contactForm, email: e.target.value })} data-testid="contact-email-input" /></div>
            <div><Label>Phone</Label><Input value={contactForm.phone} onChange={e => setContactForm({ ...contactForm, phone: e.target.value })} /></div>
            <div><Label>{editingContact ? "New password (leave blank to keep)" : "Initial password"}</Label><Input type="text" autoComplete="off" placeholder="At least 8 characters" value={contactForm.password} onChange={e => setContactForm({ ...contactForm, password: e.target.value })} data-testid="contact-password-input" />
              <p className="text-[11px] mt-1" style={{ color: "var(--text-subtle)" }}>Share it with the contact yourself — it isn't emailed.</p></div>
            {editingContact && <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={contactForm.active} onChange={e => setContactForm({ ...contactForm, active: e.target.checked })} /> Can sign in</label>}
            <Button onClick={saveContact} disabled={saving} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-contact-btn">{saving ? "Saving…" : "Save contact"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
