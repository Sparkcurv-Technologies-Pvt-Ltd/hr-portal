import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { CalendarStar, Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BirthdayWidget } from "@/components/common/BirthdayWidget";
import { usePermissions } from "@/hooks/usePermissions";

const EMPTY_FORM = { date: "", festival: "" };

export function HolidaysTab({ api, holidays, fetchData }) {
  const { can } = usePermissions();
  const canEdit = can("holidays", "edit");
  const canDelete = can("holidays", "delete");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);   // null = adding a new holiday
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const openAdd = () => { setEditingId(null); setForm(EMPTY_FORM); setDialogOpen(true); };
  const openEdit = (holiday) => { setEditingId(holiday.id); setForm({ date: holiday.date, festival: holiday.festival }); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.date || !form.festival.trim()) {
      toast.error("Enter a date and a holiday name");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/holidays/${editingId}`, form);
        toast.success("Holiday updated");
      } else {
        await api.post("/holidays", form);
        toast.success("Holiday added");
      }
      setDialogOpen(false);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save holiday");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (holiday) => {
    if (!window.confirm(`Delete ${holiday.festival} (${format(new Date(holiday.date + "T00:00:00"), "dd MMM yyyy")})?`)) return;
    try {
      await api.delete(`/holidays/${holiday.id}`);
      toast.success("Holiday deleted");
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to delete holiday");
    }
  };

  const showActions = canEdit || canDelete;
  const today = new Date(new Date().toDateString());
  const upcomingCount = holidays.filter(h => new Date(h.date + "T00:00:00") >= today).length;

  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Calendar & Holidays</h1>
          <p className="text-slate-500 mt-1 text-sm">Public holidays, weekly offs and team birthdays</p>
        </div>
        {canEdit && (
          <div>
            <Button
              data-testid="add-holiday-btn"
              onClick={openAdd}
              className="bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10 px-4"
            >
              <Plus className="h-4 w-4 mr-1.5" weight="bold" /> Add Holiday
            </Button>
          </div>
        )}
      </div>

      <BirthdayWidget api={api} holidays={holidays} />

      {/* Weekend Info */}
      <div className="flex items-center gap-3 rounded-2xl p-4 mb-6 border" style={{ background: "var(--brand-primary-light)", borderColor: "color-mix(in srgb, var(--brand-primary) 18%, transparent)" }}>
        <span className="stat-icon tone-blue" style={{ width: 36, height: 36, borderRadius: 11, background: "var(--surface)" }}>
          <CalendarStar className="h-5 w-5" weight="duotone" />
        </span>
        <p className="text-sm font-semibold text-slate-900">
          Every Saturday &amp; Sunday is a weekly holiday for all employees
        </p>
      </div>

      {/* Holidays Table */}
      <div className="section-card">
        <div className="section-header">
          <div>
            <h2 className="text-base font-bold font-['Outfit'] text-slate-900">Public holidays</h2>
            <p className="text-xs text-slate-500 mt-0.5">Total public holidays: <strong className="text-slate-900">{holidays.length}</strong></p>
          </div>
          <span className="chip tone-green">{upcomingCount} upcoming</span>
        </div>
        <div>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">#</th>
              <th className="table-header">Date</th>
              <th className="table-header">Day</th>
              <th className="table-header">Festival</th>
              <th className="table-header">Status</th>
              {showActions && <th className="table-header text-right" style={{ textAlign: "right" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {holidays.length === 0 && (
              <tr>
                <td colSpan={showActions ? 6 : 5}>
                  <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                    <span className="stat-icon tone-blue"><CalendarStar className="h-5 w-5" weight="duotone" /></span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">No holidays yet</p>
                      {canEdit && <p className="text-xs text-slate-500 mt-1">Click Add Holiday to create one.</p>}
                    </div>
                  </div>
                </td>
              </tr>
            )}
            {holidays.map((holiday, index) => {
              const holidayDate = new Date(holiday.date + "T00:00:00");
              const isPast = holidayDate < new Date(new Date().toDateString());
              return (
                <tr key={holiday.id || index} className="table-row" data-testid={`holiday-row-${holiday.id}`}>
                  <td className={`table-cell ${isPast ? "opacity-50" : ""}`} style={{ color: "var(--text-subtle)" }}>{index + 1}</td>
                  <td className={`table-cell font-semibold whitespace-nowrap ${isPast ? "opacity-50" : ""}`} style={{ color: "var(--text-primary)" }}>
                    {format(holidayDate, "dd MMM yyyy")}
                  </td>
                  <td className={`table-cell ${isPast ? "opacity-50" : ""}`} style={{ color: "var(--text-muted)" }}>{holiday.day}</td>
                  <td className={`table-cell font-medium ${isPast ? "opacity-50" : ""}`} style={{ color: "var(--text-secondary)" }}>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: "var(--brand-primary)" }}></span>
                      {holiday.festival}
                    </span>
                  </td>
                  <td className={`table-cell ${isPast ? "opacity-50" : ""}`}>
                    {isPast ? <span className="chip">Passed</span> : <span className="badge-approved">Upcoming</span>}
                  </td>
                  {showActions && (
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit && (
                          <Button
                            data-testid={`edit-holiday-${holiday.id}`}
                            variant="ghost"
                            size="sm"
                            title="Edit holiday"
                            onClick={() => openEdit(holiday)}
                            className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[#0020F8] hover:bg-[var(--brand-primary-light)]"
                          >
                            <PencilSimple className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            data-testid={`delete-holiday-${holiday.id}`}
                            variant="ghost"
                            size="sm"
                            title="Delete holiday"
                            onClick={() => handleDelete(holiday)}
                            className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[color:var(--badge-red-text)] hover:bg-[var(--badge-red-bg)]"
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Add / Edit Holiday Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl" data-testid="holiday-dialog">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">{editingId ? "Edit Holiday" : "Add Holiday"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date" className="text-xs font-semibold text-slate-600">Date</Label>
              <Input
                id="holiday-date"
                data-testid="holiday-date-input"
                type="date"
                value={form.date}
                onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                className="rounded-xl h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name" className="text-xs font-semibold text-slate-600">Holiday name</Label>
              <Input
                id="holiday-name"
                data-testid="holiday-name-input"
                placeholder="e.g. Pongal"
                maxLength={150}
                value={form.festival}
                onChange={e => setForm(f => ({ ...f, festival: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
                className="rounded-xl h-11"
              />
            </div>
            <p className="text-xs text-slate-400">Employees can't log in, request WFH, or use leave days on a holiday.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" className="rounded-xl" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button
                data-testid="holiday-save-btn"
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-[#0020F8] hover:bg-[#0019C4] text-white"
              >
                {saving ? "Saving…" : editingId ? "Save Changes" : "Add Holiday"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
