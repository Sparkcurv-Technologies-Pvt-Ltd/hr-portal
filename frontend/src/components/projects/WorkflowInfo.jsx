import { useState } from "react";
import { FlowArrow, ArrowRight } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { nextStatuses } from "./constants";

// Read-only view of a workflow: every status and the statuses it can move to
export function WorkflowInfo({ title, statuses, workflow }) {
  const [open, setOpen] = useState(false);
  if (!workflow) return null;
  return (
    <>
      <Button variant="outline" className="rounded-xl h-9" onClick={() => setOpen(true)} data-testid="workflow-btn"><FlowArrow className="h-4 w-4 mr-1.5" /> Workflow</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
          <p className="text-xs text-slate-500">New items start as <strong>{statuses.find(s => s.key === workflow.initial)?.label}</strong>. A status can only move to the ones listed after it.</p>
          <div className="space-y-2" data-testid="workflow-list">
            {statuses.map(s => (
              <div key={s.key} className="flex flex-wrap items-center gap-2 rounded-xl p-3" style={{ background: "var(--surface-elevated)", border: "1px solid var(--border-color)" }}>
                <span className={`chip ${s.tone}`}>{s.label}</span>
                <ArrowRight className="h-4 w-4 text-slate-400" weight="bold" />
                {nextStatuses(workflow, s.key).map(k => { const n = statuses.find(x => x.key === k); return <span key={k} className={`chip ${n.tone}`}>{n.label}</span>; })}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
