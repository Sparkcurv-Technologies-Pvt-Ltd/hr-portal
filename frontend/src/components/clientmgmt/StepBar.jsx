import { CaretRight } from "@phosphor-icons/react";

// The Sales Flow step bar: Lead Capture → Qualify → Proposal Sent → Review → PO Won → Convert to Engagement → Closed, with live counts.
// Seven equal cards (two columns on a phone, one row from the large breakpoint up); clicking a step opens the matching list.
export function StepBar({ steps, active, onPick }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6" data-testid="step-bar">
      {steps.map((s, i) => {
        const on = active === s.step;
        return (
          <div key={s.step} className="relative min-w-0">
            <button onClick={() => onPick(s.step)} data-testid={`step-${i}`} aria-pressed={on}
              className="w-full h-full min-h-[92px] rounded-xl px-3 py-3 flex flex-col items-center justify-between gap-1 text-center transition-shadow hover:shadow-md"
              style={on ? { background: "var(--brand-primary)", color: "#fff" } : { background: "var(--surface)", border: "1px solid var(--border-color)" }}>
              <span className="text-[11px] font-semibold" style={{ opacity: 0.75 }}>{i + 1}</span>
              <span className="text-[13px] font-bold leading-tight">{s.step}</span>
              <span className="text-xl font-bold leading-none" data-testid={`step-count-${i}`}>{s.count}</span>
            </button>
            {i < steps.length - 1 && <CaretRight className="hidden lg:block absolute top-1/2 -right-[10px] -translate-y-1/2 h-3.5 w-3.5 z-10" style={{ color: "var(--text-subtle)" }} weight="bold" />}
          </div>);
      })}
    </div>
  );
}
