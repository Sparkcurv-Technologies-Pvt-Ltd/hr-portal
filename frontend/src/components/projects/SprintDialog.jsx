import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const EMPTY = { name: "", goal: "", start_date: "", end_date: "" };

export function SprintDialog({ open, onOpenChange, sprint, defaultName, saving, onSave }) {
  const [form, setForm] = useState(EMPTY);
  useEffect(() => {
    if (open) setForm(sprint ? { name: sprint.name, goal: sprint.goal, start_date: sprint.start_date || "", end_date: sprint.end_date || "" } : { ...EMPTY, name: defaultName });
  }, [open, sprint, defaultName]);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{sprint ? "Edit sprint" : "New sprint"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Name</Label><Input value={form.name} onChange={e => set("name", e.target.value)} data-testid="sprint-name-input" /></div>
          <div><Label>Goal</Label><Textarea rows={2} value={form.goal} onChange={e => set("goal", e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start</Label><Input type="date" value={form.start_date} onChange={e => set("start_date", e.target.value)} /></div>
            <div><Label>End</Label><Input type="date" value={form.end_date} onChange={e => set("end_date", e.target.value)} /></div>
          </div>
          <Button disabled={saving} onClick={() => onSave({ ...form, start_date: form.start_date || null, end_date: form.end_date || null })} className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl h-10" data-testid="save-sprint-btn">{saving ? "Saving…" : "Save sprint"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
