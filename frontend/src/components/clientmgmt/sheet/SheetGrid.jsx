import { useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, Trash, ArrowSquareOut, Plus } from "@phosphor-icons/react";

// An Excel-like grid: row numbers, frozen header / first columns, an autofilter row, click-to-sort headers, in-cell editing (text, dropdowns, dates, amounts),
// a typing row at the bottom for new records, and a status bar with counts and sums. Cells save when you leave them (Enter, Tab or a dropdown change).
export const XL_CSS = `
.xl-wrap{--xl-line:var(--border-color);font-size:13px}
.xl-scroll{overflow:auto;position:relative;background:var(--surface);border:1px solid var(--xl-line);border-radius:12px;box-shadow:var(--shadow-sm)}
.xl-table{border-collapse:separate;border-spacing:0;table-layout:fixed}
.xl-table th,.xl-table td{border-bottom:1px solid var(--xl-line);padding:0;height:44px;overflow:hidden;white-space:nowrap}
.xl-table thead th{position:sticky;top:0;z-index:4;background:var(--surface-elevated);color:var(--text-subtle);font-weight:700;font-size:11px;letter-spacing:.04em;text-transform:uppercase;text-align:left;padding:0 12px;height:38px;cursor:pointer;user-select:none}
.xl-table thead tr.xl-group th{height:26px;text-align:center;font-size:10px;top:0;cursor:default;border-bottom:1px solid var(--xl-line);background:var(--surface-elevated)}
.xl-table thead tr.xl-filter th{padding:4px 6px;cursor:default;height:34px;text-transform:none;letter-spacing:0}
.xl-table td.xl-frozen,.xl-table th.xl-frozen{position:sticky;z-index:2}
.xl-table thead th.xl-frozen{z-index:5}
.xl-table td.xl-frozen{background:var(--surface)}
.xl-table tbody tr:hover td{background:var(--surface-elevated)}
.xl-cell{width:100%;height:36px;border:1px solid transparent;border-radius:8px;outline:0;background:transparent;padding:0 10px;font:inherit;color:inherit;text-overflow:ellipsis}
.xl-cell:hover:not(:disabled):not([readonly]){border-color:var(--xl-line);background:var(--surface)}
.xl-cell:focus{border-color:var(--brand-primary,#0020F8);background:var(--surface);box-shadow:0 0 0 3px rgba(0,32,248,.12)}
.xl-cell[readonly],.xl-cell:disabled{color:var(--text-muted);cursor:default}
select.xl-cell{cursor:pointer;appearance:none;-webkit-appearance:none;padding-right:22px;background-image:linear-gradient(45deg,transparent 50%,#9AA4B5 50%),linear-gradient(135deg,#9AA4B5 50%,transparent 50%);background-position:calc(100% - 13px) 16px,calc(100% - 9px) 16px;background-size:4px 4px,4px 4px;background-repeat:no-repeat}
select.xl-cell:disabled{background-image:none;padding-right:10px}
.xl-ro{display:block;padding:0 12px;line-height:42px;overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)}
.xl-new td{background:rgba(22,163,74,.06)}
.xl-new .xl-cell{border-color:var(--xl-line);background:var(--surface)}
.xl-bar{display:flex;gap:14px;flex-wrap:wrap;align-items:center;padding:6px 2px 10px;font-size:12px;color:var(--text-muted)}
.xl-tag{display:inline-block;border-radius:999px;padding:1px 10px;font-size:11px;font-weight:600;line-height:20px}
.xl-act{display:flex;gap:2px;justify-content:center}
.xl-iconbtn{border:0;background:transparent;cursor:pointer;color:var(--text-subtle);padding:6px;border-radius:8px;line-height:0}
.xl-iconbtn:hover{background:var(--surface-elevated);color:var(--text-primary)}
.xl-iconbtn.danger:hover{color:#B91C1C}
.xl-link{border:0;background:transparent;cursor:pointer;font-size:12px;font-weight:600;padding:6px 10px;border-radius:8px}
.xl-link:hover{background:var(--surface-elevated)}
`;

const fmtNum = (n) => (n == null || n === "" ? "" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n));

// colour chips for dropdown values (like the sheet's conditional formatting)
export const TAG = {
  blue: ["#DBEAFE", "#1E40AF"], violet: ["#EDE9FE", "#5B21B6"], amber: ["#FEF3C7", "#92400E"], teal: ["#CCFBF1", "#115E59"], red: ["#FEE2E2", "#991B1B"], green: ["#DCFCE7", "#166534"], grey: ["#E5E7EB", "#374151"],
};
const toneStyle = (tone) => { const t = TAG[(tone || "").replace("tone-", "").replace("teal", "teal")] || null; return t ? { background: t[0], color: t[1], fontWeight: 600 } : undefined; };

function Cell({ col, row, value, onSave, setFocus, disabled }) {
  const ref = useRef(null);
  const common = { className: "xl-cell", disabled, "data-testid": `cell-${row?.id ?? "new"}-${col.key}`, "aria-label": col.label };
  const commit = (v) => { const old = value ?? ""; if (String(v) !== String(old)) onSave(v); };
  const key = `${row?.id}-${col.key}-${value ?? ""}`;
  if (col.type === "select") {
    const tone = col.tone ? col.tone(value) : null;
    return (
      <select {...common} value={value ?? ""} onChange={e => commit(e.target.value)} onFocus={() => setFocus(value)} style={{ ...toneStyle(tone), borderRadius: tone ? 6 : 0 }}>
        {col.allowEmpty !== false && <option value="">{col.emptyLabel ?? ""}</option>}{(typeof col.options === "function" ? col.options(row) : col.options).map(o => (typeof o === "object" ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o}>{o}</option>))}
      </select>
    );
  }
  if (col.type === "date") {
    return <input {...common} type="date" defaultValue={value ?? ""} key={key} onFocus={() => setFocus(value)} onBlur={e => commit(e.target.value)} onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()} style={col.dateStyle ? col.dateStyle(row) : undefined} />;
  }
  if (col.type === "money" || col.type === "number") {
    return <input {...common} ref={ref} key={key} defaultValue={value == null ? "" : fmtNum(value)} inputMode="decimal" style={{ textAlign: "right" }}
      onFocus={e => { setFocus(value); e.target.value = value == null ? "" : String(value); e.target.select(); }}
      onBlur={e => { const raw = e.target.value.replace(/[,\s]/g, ""); if (raw === "") { commit(""); e.target.value = ""; return; } const n = Number(raw); if (Number.isNaN(n)) { e.target.value = value == null ? "" : fmtNum(value); return; } commit(n); e.target.value = fmtNum(n); }}
      onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()} />;
  }
  return <input {...common} ref={ref} key={key} defaultValue={value ?? ""} list={col.datalist} onFocus={() => setFocus(value)} onBlur={e => commit(e.target.value)}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { e.currentTarget.value = value ?? ""; e.currentTarget.blur(); } }} />;
}

export function SheetGrid({ columns, rows, rowId = r => r.id, onCellSave, canEditRow = () => true, canDeleteRow, onDelete, onOpenRow, openLabel = "Open", newRow, freeze = 1, loading, empty, maxHeight, search = "", extraStatus }) {
  const [sort, setSort] = useState(null);                    // { key, dir }
  const [filters, setFilters] = useState({});
  const [showFilters, setShowFilters] = useState(false);
  const [draft, setDraft] = useState({});
  const firstNew = useRef(null);
  const hasGroups = columns.some(c => c.group);
  const hasActions = !!(onOpenRow || onDelete);
  const text = (c, r) => { const v = c.value ? c.value(r) : r[c.key]; return v == null ? "" : String(v); };
  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter(r => (!q || columns.some(c => text(c, r).toLowerCase().includes(q))) && columns.every(c => !filters[c.key] || (c.filter === "select" ? text(c, r) === filters[c.key] : text(c, r).toLowerCase().includes(filters[c.key].toLowerCase()))));
    if (sort) { const c = columns.find(x => x.key === sort.key); const val = (r) => (c.sortValue ? c.sortValue(r) : (c.value ? c.value(r) : r[c.key])); out = [...out].sort((a, b) => { const x = val(a), y = val(b); if (x == null || x === "") return 1; if (y == null || y === "") return -1; return (x > y ? 1 : x < y ? -1 : 0) * (sort.dir === "asc" ? 1 : -1); }); }
    return out;
  }, [rows, columns, filters, sort, search]);   // eslint-disable-line react-hooks/exhaustive-deps
  const sums = columns.filter(c => c.sum).map(c => ({ label: c.sumLabel || c.label, total: view.reduce((t, r) => t + (Number(c.value ? c.value(r) : r[c.key]) || 0), 0) }));
  const ACT_W = hasActions ? 86 : 0;
  const offsets = []; let acc = 0; columns.forEach((c, i) => { offsets.push(acc); acc += c.width || 120; });
  const total = acc + ACT_W;
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const toggleSort = (c) => { if (c.sortable === false) return; setSort(s => (!s || s.key !== c.key ? { key: c.key, dir: "asc" } : s.dir === "asc" ? { key: c.key, dir: "desc" } : null)); };
  const create = async () => {
    if (!newRow) return;
    if ((newRow.required || []).some(k => !String(draft[k] ?? "").trim())) return;
    const ok = await newRow.onCreate({ ...(newRow.defaults || {}), ...draft });
    if (ok !== false) { setDraft({}); setTimeout(() => firstNew.current?.focus(), 50); }
  };
  const draftCell = (c) => {
    const v = draft[c.key] ?? (newRow.defaults || {})[c.key] ?? "";
    const set = (val) => setDraft(d => ({ ...d, [c.key]: val }));
    const onKey = (e) => { if (e.key === "Enter") { e.preventDefault(); create(); } };
    const dtype = c.draftType || c.type, dopts = c.draftOptions || c.options;
    if (dtype === "select") return <select className="xl-cell" value={v} onChange={e => set(e.target.value)} onKeyDown={onKey} aria-label={`New ${c.label}`} data-testid={`new-${c.key}`}><option value="">{c.draftEmpty ?? c.emptyLabel ?? ""}</option>{(typeof dopts === "function" ? dopts(null) : dopts).map(o => (typeof o === "object" ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o}>{o}</option>))}</select>;
    return <input ref={newRow.fields[0] === c.key ? firstNew : undefined} className="xl-cell" type={c.type === "date" ? "date" : "text"} inputMode={c.type === "money" || c.type === "number" ? "decimal" : undefined} list={c.datalist} value={v} onChange={e => set(e.target.value)} onKeyDown={onKey}
      placeholder={newRow.fields[0] === c.key ? (newRow.placeholder || "Type here and press Enter to add…") : ""} aria-label={`New ${c.label}`} data-testid={`new-${c.key}`} style={c.type === "money" || c.type === "number" ? { textAlign: "right" } : undefined} />;
  };
  const fopts = (c) => (typeof c.options === "function" ? c.options(null) : c.options || []);
  const ftop = hasGroups ? 64 : 38;
  return (
    <div className="xl-wrap" data-testid="sheet-grid">
      <style>{XL_CSS}</style>
      <div className="xl-bar" data-testid="status-bar">
        <span data-testid="status-count" className="font-semibold" style={{ color: "var(--text-primary)" }}>{view.length === rows.length ? `${rows.length} row${rows.length === 1 ? "" : "s"}` : `${view.length} of ${rows.length} rows`}</span>
        {sums.map(s => <span key={s.label}>{s.label}: <b style={{ color: "var(--text-primary)" }}>{fmtNum(s.total)}</b></span>)}{extraStatus}
        <button className="xl-link ml-auto" style={{ color: activeFilters ? "var(--brand-primary)" : "var(--text-muted)" }} onClick={() => setShowFilters(v => !v)} data-testid="toggle-filters">{showFilters ? "Hide filters" : `Filters${activeFilters ? ` (${activeFilters})` : ""}`}</button>
        {activeFilters > 0 && <button className="xl-link" style={{ color: "var(--text-muted)" }} onClick={() => setFilters({})}>Clear</button>}
      </div>
      <div className="xl-scroll" style={{ maxHeight: maxHeight || "calc(100vh - 290px)", minHeight: 160 }}>
        <table className="xl-table" style={{ width: total }}>
          <colgroup>{columns.map(c => <col key={c.key} style={{ width: c.width || 120 }} />)}{hasActions && <col style={{ width: ACT_W }} />}</colgroup>
          <thead>
            {hasGroups && <tr className="xl-group">{(() => { const cells = []; let i = 0; while (i < columns.length) { const g = columns[i].group; let j = i; while (j < columns.length && columns[j].group === g) j++; cells.push(<th key={i} colSpan={j - i} className={i < freeze ? "xl-frozen" : ""} style={{ left: i < freeze ? offsets[i] : undefined }}>{g || ""}</th>); i = j; } return <>{cells}{hasActions && <th />}</>; })()}</tr>}
            <tr className="xl-cols">
              {columns.map((c, i) => <th key={c.key} className={i < freeze ? "xl-frozen" : ""} style={{ left: i < freeze ? offsets[i] : undefined, textAlign: c.align || "left", ...(hasGroups ? { top: 26 } : {}) }} onClick={() => toggleSort(c)} title={c.label} data-testid={`col-${c.key}`}>
                {c.shortLabel || c.label}{sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="inline h-3 w-3 ml-1" weight="bold" /> : <ArrowDown className="inline h-3 w-3 ml-1" weight="bold" />)}</th>)}
              {hasActions && <th style={hasGroups ? { top: 26 } : undefined} />}</tr>
            {showFilters && <tr className="xl-filter">{columns.map((c, i) => (
              <th key={c.key} className={i < freeze ? "xl-frozen" : ""} style={{ left: i < freeze ? offsets[i] : undefined, top: ftop }}>
                {c.filter === false ? null : c.filter === "select" ? <select className="w-full h-7 text-[12px] rounded-md border bg-white px-1" value={filters[c.key] || ""} onChange={e => setFilters(f => ({ ...f, [c.key]: e.target.value }))} aria-label={`Filter ${c.label}`}><option value="">All</option>{fopts(c).map(o => (typeof o === "object" ? <option key={o.value} value={o.value}>{o.label}</option> : <option key={o}>{o}</option>))}</select>
                  : <input className="w-full h-7 text-[12px] rounded-md border px-2 bg-white" placeholder="contains…" value={filters[c.key] || ""} onChange={e => setFilters(f => ({ ...f, [c.key]: e.target.value }))} aria-label={`Filter ${c.label}`} />}</th>))}{hasActions && <th style={{ top: ftop }} />}</tr>}
          </thead>
          <tbody>
            {newRow && newRow.canAdd !== false && (
              <tr className="xl-new" data-testid="new-row">
                {columns.map((c, i) => <td key={c.key} className={i < freeze ? "xl-frozen" : ""} style={{ left: i < freeze ? offsets[i] : undefined, background: "rgba(22,163,74,.06)" }}>{newRow.fields.includes(c.key) ? draftCell(c) : null}</td>)}
                {hasActions && <td><div className="xl-act"><button className="xl-iconbtn" aria-label="Add row" title="Add (Enter)" onClick={create} data-testid="new-row-add"><Plus className="h-4 w-4" weight="bold" /></button></div></td>}
              </tr>)}
            {view.map((r) => {
              const editable = canEditRow(r);
              return (
                <tr key={rowId(r)} data-testid={`row-${rowId(r)}`}>
                  {columns.map((c, i) => {
                    const v = c.value ? c.value(r) : r[c.key];
                    const ro = c.type === "readonly" || c.type === "custom" || (c.editable ? !c.editable(r) : false) || !editable;
                    return (
                      <td key={c.key} className={i < freeze ? "xl-frozen" : ""} style={{ left: i < freeze ? offsets[i] : undefined, textAlign: c.align || "left" }}>
                        {c.render ? c.render(r, { editable: !ro, save: (val) => onCellSave(r, c.key, val) })
                          : ro ? (c.tone && v ? <span className="xl-ro"><span className="xl-tag" style={toneStyle(c.tone(v))}>{v}</span></span> : <span className="xl-ro" style={{ textAlign: c.align || "left", ...(i === 0 ? { color: "var(--text-primary)", fontWeight: 600 } : {}) }} title={v == null ? "" : String(v)}>{c.type === "money" || c.type === "number" ? fmtNum(v) : (c.display ? c.display(v, r) : v ?? "")}</span>)
                          : <Cell col={c} row={r} value={v} disabled={false} onSave={(val) => onCellSave(r, c.key, val)} setFocus={() => {}} />}
                      </td>);
                  })}
                  {hasActions && <td><div className="xl-act">
                    {onOpenRow && <button className="xl-iconbtn" title={openLabel} aria-label={openLabel} onClick={() => onOpenRow(r)} data-testid={`open-${rowId(r)}`}><ArrowSquareOut className="h-4 w-4" /></button>}
                    {onDelete && canDeleteRow?.(r) && <button className="xl-iconbtn danger" title="Delete" aria-label="Delete" onClick={() => onDelete(r)} data-testid={`delete-${rowId(r)}`}><Trash className="h-4 w-4" /></button>}</div></td>}
                </tr>);
            })}
          </tbody>
        </table>
        {loading && <p className="text-center text-xs py-6" style={{ color: "var(--text-subtle)" }}>Loading…</p>}
        {!loading && view.length === 0 && <p className="text-center text-sm py-8" style={{ color: "var(--text-subtle)", position: "sticky", left: 0 }}>{empty || "No rows."}</p>}
      </div>
    </div>
  );
}

export const Tag = ({ tone, children }) => <span className="xl-tag" style={toneStyle(tone)}>{children}</span>;
