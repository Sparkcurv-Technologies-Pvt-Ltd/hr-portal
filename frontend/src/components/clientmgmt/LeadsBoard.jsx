import { useState } from "react";
import { CalendarBlank, Warning } from "@phosphor-icons/react";
import { STAGES, SOURCE_LABEL, money, day } from "./constants";

function Card({ lead, canMove, dragging, onOpen, onDragStart, onDragEnd, onSelectStage }) {
  return (
    <div role="button" tabIndex={0} draggable={canMove} data-testid={`lead-card-${lead.id}`}
      onDragStart={e => { e.dataTransfer.setData("text/plain", String(lead.id)); e.dataTransfer.effectAllowed = "move"; onDragStart(lead); }} onDragEnd={onDragEnd}
      onClick={() => onOpen(lead)} onKeyDown={e => e.key === "Enter" && onOpen(lead)} className="rounded-xl p-3 text-left transition-shadow hover:shadow-md"
      style={{ background: "var(--surface)", border: `1px solid ${lead.followup_overdue ? "#FCA5A5" : "var(--border-color)"}`, cursor: canMove ? "grab" : "pointer", opacity: dragging ? 0.45 : 1 }}>
      <p className="text-sm font-semibold break-words">{lead.company_name || lead.client_name || lead.contact_name || lead.code}</p>
      <p className="text-[11px] mt-0.5" style={{ color: "var(--text-subtle)" }}>{lead.code}{lead.contact_name && lead.company_name ? ` · ${lead.contact_name}` : ""}</p>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="text-sm font-bold">{lead.estimated_value != null ? money(lead.estimated_value) : <span className="text-xs font-normal" style={{ color: "var(--text-subtle)" }}>No value</span>}</span>
        <span className="text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: "#EEF2FF", color: "#3730A3" }}>{SOURCE_LABEL[lead.source] || lead.source}</span>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <span className="truncate">{lead.owner_name || "—"}</span>
        {lead.next_followup_at && <span className="flex items-center gap-1 font-semibold flex-shrink-0" style={{ color: lead.followup_overdue ? "#E11D48" : undefined }}>{lead.followup_overdue ? <Warning className="h-3 w-3" weight="fill" /> : <CalendarBlank className="h-3 w-3" />}{day(lead.next_followup_at)}</span>}
      </div>
      {canMove && (
        <select value={lead.stage} aria-label="Move stage" onClick={e => e.stopPropagation()} onChange={e => onSelectStage(lead, e.target.value)} className="mt-2 w-full h-8 rounded-lg border px-2 text-xs bg-white sm:hidden">
          {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>)}
    </div>
  );
}

// Leads board: drag a card to another column. New ⇄ Contacted moves straight away; Lost asks for a reason; Qualified, Tender and Proposal open their
// own forms (they enforce the rules); Won only happens by booking the PO on an approved proposal.
export function LeadsBoard({ leads, canMove, onOpen, onDropStage }) {
  const [dragged, setDragged] = useState(null);
  const [over, setOver] = useState(null);
  const drop = (stage) => { const l = dragged; setDragged(null); setOver(null); if (l && l.stage !== stage) onDropStage(l, stage); };
  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid gap-3 min-w-[1000px] lg:min-w-0" style={{ gridTemplateColumns: "repeat(7, minmax(130px, 1fr))" }}>
        {STAGES.map(col => {
          const items = leads.filter(l => l.stage === col.key);
          const total = items.reduce((n, l) => n + (l.estimated_value || 0), 0);
          const active = over === col.key && dragged && dragged.stage !== col.key;
          return (
            <div key={col.key} data-testid={`column-${col.key}`} onDragOver={e => { if (dragged) { e.preventDefault(); setOver(col.key); } }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }} onDrop={e => { e.preventDefault(); drop(col.key); }}
              className="rounded-2xl p-2.5 min-w-0 transition-colors" style={{ background: active ? "#EAF0FF" : "var(--surface-elevated)", border: `1px solid ${active ? "var(--brand-primary)" : "var(--border-color)"}` }}>
              <div className="px-1 mb-3 flex items-start justify-between gap-2"><span className={`chip ${col.tone}`}>{col.label}</span>
                <div className="text-right leading-tight"><p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{items.length}</p><p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{total ? money(total) : "—"}</p></div></div>
              <div className="space-y-2.5 min-h-[110px] flex flex-col">
                {items.length === 0 && <p className="flex-1 flex items-center justify-center text-xs rounded-xl py-4" style={{ color: "var(--text-subtle)", border: "1px dashed var(--border-color)" }}>{active ? "Drop here" : "Empty"}</p>}
                {items.map(l => <Card key={l.id} lead={l} canMove={canMove && l.stage !== "WON"} dragging={dragged?.id === l.id} onOpen={onOpen} onDragStart={setDragged} onDragEnd={() => { setDragged(null); setOver(null); }} onSelectStage={onDropStage} />)}
              </div>
            </div>);
        })}
      </div>
    </div>
  );
}
