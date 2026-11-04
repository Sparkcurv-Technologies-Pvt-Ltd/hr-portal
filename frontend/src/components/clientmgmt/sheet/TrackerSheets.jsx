import { useMemo } from "react";
import { toast } from "sonner";
import { SheetGrid, XL_CSS } from "./SheetGrid";
import { useSheet } from "./useSheet";
import { useList, canEditRow } from "../data";
import { ACTIVITY_TYPES, OUTCOMES, TONES, apiError, todayStr } from "../constants";

const CADENCE = ["Email 1", "Call 1", "Email 2", "Call 2", "Email 3", "Call 3", "Email 4", "Call 4", "Email 5", "Call 5"];
const personOptions = (people) => people.map(p => ({ value: String(p.id), label: p.name }));
const isDue = (s) => s.date && s.date <= todayStr() && (!s.outcome || s.outcome === "Pending" || s.outcome === "Rescheduled");

// ============================================================== Follow-ups (the cadence tracker)
export function FollowupsSheet({ api, user, level, bdr, refreshKey, search, onChanged }) {
  const { rows, loading, run, load } = useSheet(api, "/client-mgmt/followups", bdr, refreshKey);
  const [opps] = useList(api, "/client-mgmt/opportunities", useMemo(() => ({ open_only: true, _r: refreshKey }), [refreshKey]));
  const withoutCadence = useMemo(() => (opps || []).filter(o => !rows.some(r => r.opportunity_id === o.id)), [opps, rows]);
  const mine = (r) => canEditRow(level, user, r.owner_id);
  const save = async (r, key, val) => {
    const m = /^s(\d+)_(date|outcome)$/.exec(key);
    if (m) {
      const step = r.steps[Number(m[1]) - 1];
      let date = m[2] === "date" ? (val || null) : step.date, outcome = m[2] === "outcome" ? (val || null) : step.outcome;
      // marking a scheduled touch done means it happened today; clearing the date clears the touch
      if (m[2] === "outcome" && outcome && outcome !== "Pending" && outcome !== "Rescheduled" && (!date || date > todayStr())) date = todayStr();
      if (m[2] === "date" && !val) { date = null; outcome = null; }
      if (await run(() => api.put(`/client-mgmt/followups/${r.id}/steps/${step.step_no}`, { date, outcome }))) onChanged();
    } else if (await run(() => api.put(`/client-mgmt/followups/${r.id}`, { [key]: val }))) onChanged();
  };
  const create = async (v) => {
    if (!v.company_name) return false;
    try { await api.post("/client-mgmt/followups", { opportunity_id: Number(v.company_name) }); toast.success("Cadence started — Email 1 is next"); await load(); onChanged(); return true; }
    catch (e) { toast.error(apiError(e, "Couldn't start the cadence")); return false; }
  };
  const columns = useMemo(() => [
    { key: "company_name", label: "Company Name", width: 210, type: "readonly", draftType: "select", draftEmpty: "Pick an opportunity to start its cadence…", draftOptions: () => withoutCadence.map(o => ({ value: String(o.id), label: `${o.account_name} — ${o.opp_name}` })) },
    { key: "code", label: "Follow-up ID", width: 84, type: "readonly" },
    { key: "contact_person", label: "Contact Person", width: 130 },
    { key: "bdr", label: "BDR Name", width: 100, type: "readonly" },
    { key: "opportunity_stage", label: "Opportunity Stage (ref)", shortLabel: "Opp Stage (ref)", width: 170, type: "readonly", tone: v => TONES.stage[v] },
    ...CADENCE.flatMap((label, i) => [
      { key: `s${i + 1}_date`, group: label, label: "Date", width: 124, type: "date", value: r => r.steps[i].date || "", filter: false, sortable: false, dateStyle: r => (isDue(r.steps[i]) ? { color: "#B91C1C", fontWeight: 700 } : undefined) },
      { key: `s${i + 1}_outcome`, group: label, label: "Outcome", width: 112, type: "select", options: OUTCOMES, value: r => r.steps[i].outcome || "", tone: v => TONES.outcome[v], filter: false, sortable: false },
    ]),
    { key: "current_step", label: "Current Step", width: 140, type: "readonly", group: "Overall" },
    { key: "notes", label: "Notes", width: 260, group: "Overall" },
  ], [withoutCadence]);
  return (
    <SheetGrid columns={columns} rows={rows} loading={loading} search={search} canEditRow={mine} onCellSave={save} freeze={1} maxHeight="calc(100vh - 330px)"
      empty="No follow-up cadences yet. Convert a lead (it starts automatically) or pick an opportunity in the green row."
      canDeleteRow={mine} onDelete={r => window.confirm(`Delete the cadence for ${r.company_name}?`) && run(() => api.delete(`/client-mgmt/followups/${r.id}`), "Deleted")}
      newRow={{ canAdd: level === "mgr" || level === "sales", fields: ["company_name"], onCreate: create, placeholder: "" }} />
  );
}

// ============================================================== Activity log
export function ActivitySheet({ api, user, level, people, bdr, refreshKey, search, onChanged }) {
  const { rows, loading, run, load } = useSheet(api, "/client-mgmt/activity", bdr, refreshKey, useMemo(() => ({ limit: 3000 }), []));
  const [accounts] = useList(api, "/client-mgmt/clients", undefined);
  const mgr = level === "mgr";
  const mine = (r) => canEditRow(level, user, r.owner_id) && !r.from_cadence;
  const save = async (r, key, val) => {
    const body = key === "bdr" ? { owner_id: val ? Number(val) : null } : { [key]: val === "" ? null : val };
    if (await run(() => api.put(`/client-mgmt/activity/${r.id}`, body))) onChanged();
  };
  const create = async (v) => {
    try { await api.post("/client-mgmt/activity", { log_date: v.log_date || todayStr(), company_name: v.company_name, activity_type: v.activity_type || "Call", outcome: v.outcome || null, notes: v.notes || "" }); toast.success("Logged"); await load(); onChanged(); return true; }
    catch (e) { toast.error(apiError(e, "Couldn't log it")); return false; }
  };
  const columns = useMemo(() => [
    { key: "code", label: "Log ID", width: 84, type: "readonly" },
    { key: "log_date", label: "Date", width: 124, type: "date" },
    mgr ? { key: "bdr", label: "BDR Name", width: 120, type: "select", options: personOptions(people), value: r => (r.owner_id == null ? "" : String(r.owner_id)), emptyLabel: "—", filter: "select", sortValue: r => r.bdr || "" } : { key: "bdr", label: "BDR Name", width: 120, type: "readonly" },
    { key: "company_name", label: "Company Name", width: 240, datalist: "cm-activity-accounts" },
    { key: "activity_type", label: "Activity Type", width: 120, type: "select", options: ACTIVITY_TYPES, allowEmpty: false, filter: "select" },
    { key: "outcome", label: "Outcome", width: 130, type: "select", options: OUTCOMES, tone: v => TONES.outcome[v], filter: "select" },
    { key: "notes", label: "Notes", width: 420 },
  ], [mgr, people]);
  return (
    <>
      <datalist id="cm-activity-accounts">{(accounts || []).map(a => <option key={a.id} value={a.name} />)}</datalist>
      <SheetGrid columns={columns} rows={rows} loading={loading} search={search} canEditRow={mine} onCellSave={save} freeze={1} empty="Nothing logged yet. Every email and call gets its own row — log it the same day it happens."
        canDeleteRow={mine} onDelete={r => window.confirm("Delete this activity?") && run(() => api.delete(`/client-mgmt/activity/${r.id}`), "Deleted")}
        newRow={{ canAdd: level === "mgr" || level === "sales", fields: ["log_date", "company_name", "activity_type", "outcome", "notes"], defaults: { log_date: todayStr(), activity_type: "Call", outcome: "Completed" }, required: ["company_name"], onCreate: create, placeholder: "" }} />
    </>
  );
}

// ============================================================== Lists (read-only, like the sheet's Lists tab)
export function ListsSheet({ api }) {
  const [ls] = useList(api, "/client-mgmt/lists", undefined);
  if (!ls || Array.isArray(ls)) return <p className="text-sm py-10 text-center" style={{ color: "var(--text-subtle)" }}>Loading…</p>;
  const cols = [["Lead Source", ls.lead_sources], ["Lead Status", ls.lead_statuses], ["Industry", ls.industries], ["Opportunity Stage", ls.opportunity_stages.map(s => s.stage)], ["Probability", ls.opportunity_stages.map(s => `${s.probability}%`)],
                ["Account Type", ls.account_types], ["Follow-up Outcome", ls.followup_outcomes], ["Activity Type", ls.activity_types], ["Cadence step", ls.cadence], ["Next touch after (days)", ls.cadence_gap_days.map(d => `+${d}`)]];
  const n = Math.max(...cols.map(c => c[1].length));
  return (
    <div className="xl-wrap" data-testid="lists-sheet">
      <style>{XL_CSS}</style>
      <div className="xl-scroll" style={{ maxHeight: "calc(100vh - 290px)" }}>
        <table className="xl-table" style={{ width: cols.length * 160 }}>
          <thead><tr>{cols.map(([h]) => <th key={h} style={{ width: 160, cursor: "default" }}>{h}</th>)}</tr></thead>
          <tbody>{Array.from({ length: n }).map((_, i) => <tr key={i}>{cols.map(([h, list]) => <td key={h}><span className="xl-ro" style={{ color: "var(--text-primary)" }}>{list[i] ?? ""}</span></td>)}</tr>)}</tbody>
        </table>
      </div>
      <p className="text-xs mt-3" style={{ color: "var(--text-muted)" }}>These dropdown lists are used by every screen. After a touch is done the next one is scheduled automatically (see "Next touch after"; weekends are skipped).</p>
    </div>
  );
}
