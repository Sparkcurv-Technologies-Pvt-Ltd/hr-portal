// Small presentational building blocks shared by the employee tabs.
// Purely visual: they wrap the design-system classes from index.css (.stat-card, .section-card, …).

// Tab title row: h1 + one-line description on the left, optional actions on the right.
// Keeps the `div.flex > div > h1` shape that index.css wraps on narrow screens.
export function TabHeader({ title, description, children }) {
  return (
    <div className="mb-7 flex items-center justify-between">
      <div>
        <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">{title}</h1>
        {description && <p className="text-slate-500 mt-1.5 text-sm">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

// Icon tile + label + big value (+ sub line). `tone` = blue|green|amber|red|violet|teal
export function StatCard({ icon: Icon, label, value, sub, tone = "blue", testId, valueTestId, children }) {
  return (
    <div className={`stat-card tone-${tone}`} data-testid={testId}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {Icon && (
          <span className={`stat-icon tone-${tone}`}>
            <Icon className="h-5 w-5" weight="duotone" />
          </span>
        )}
      </div>
      <div>
        <p className="stat-value" data-testid={valueTestId}>{value}</p>
        {sub && <p className="stat-sub mt-1">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

// Card header with a small tinted icon tile, title and optional right-side content
export function SectionHeader({ icon: Icon, tone = "blue", title, sub, children }) {
  return (
    <div className="section-header">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className={`stat-icon tone-${tone}`} style={{ width: 34, height: 34, borderRadius: 11 }}>
            <Icon className="h-[18px] w-[18px]" weight="duotone" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold font-['Outfit']" style={{ color: 'var(--text-primary)' }}>{title}</h2>
          {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

// Empty state: tinted icon tile + message (+ optional hint)
// `inTable`: rendered inside a <td colSpan> — stays centred in the visible card while the table scrolls sideways on phones
export function EmptyState({ icon: Icon, tone = "blue", title, hint, testId, compact = false, inTable = false }) {
  const tableCls = inTable ? "sticky left-0 max-sm:w-[calc(100vw-34px)] sm:max-lg:w-[calc(100vw-50px)]" : "";
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? "py-8 px-4" : "py-14 px-6"} ${tableCls}`}>
      {Icon && (
        <span className={`stat-icon tone-${tone} mb-3`} style={compact ? { width: 40, height: 40 } : { width: 52, height: 52, borderRadius: 16 }}>
          <Icon className={compact ? "h-5 w-5" : "h-6 w-6"} weight="duotone" />
        </span>
      )}
      <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }} data-testid={testId}>{title}</p>
      {hint && <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

// Coloured pill driven by a tone class (works in both themes)
export function TonePill({ tone = "blue", children, className = "", testId }) {
  return <span className={`chip tone-${tone} capitalize ${className}`} data-testid={testId}>{children}</span>;
}

// Map a status string to the shared badge classes
export function StatusPill({ status, label, testId }) {
  const cls = status === "approved" ? "badge-approved" : status === "rejected" ? "badge-rejected" : "badge-pending";
  return <span className={`${cls} capitalize`} data-testid={testId}>{label ?? status}</span>;
}
