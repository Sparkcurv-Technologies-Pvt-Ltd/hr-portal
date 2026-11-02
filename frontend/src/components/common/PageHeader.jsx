import { format } from "date-fns";
import { CalendarBlank, CaretRight } from "@phosphor-icons/react";
import { Avatar } from "@/components/common/Avatar";

// Slim sticky bar above every tab: breadcrumb (area / current page), today's date and the signed-in user
export function PageHeader({ area, page, user, subtitle }) {
  return (
    <header className="page-header" data-testid="page-header">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--text-subtle)' }}>
          <span className="truncate">{area}</span>
          <CaretRight style={{ width: 11, height: 11, flexShrink: 0 }} />
          <span className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{page}</span>
        </div>
        {subtitle && (
          <p className="text-[13px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        <div
          className="hidden sm:flex items-center gap-2 h-9 px-3 rounded-[10px] text-[13px] font-medium"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
        >
          <CalendarBlank style={{ width: 15, height: 15, color: 'var(--brand-primary)' }} weight="duotone" />
          {format(new Date(), "EEE, d MMM yyyy")}
        </div>
        <div
          className="hidden md:flex items-center gap-2.5 h-9 pl-1 pr-3 rounded-full"
          style={{ background: 'var(--surface)', border: '1px solid var(--border-color)' }}
        >
          <Avatar url={user?.avatar_url} name={user?.name} size="h-7 w-7" textSize="text-[10px]" />
          <span className="text-[13px] font-semibold max-w-[160px] truncate" style={{ color: 'var(--text-primary)' }}>{user?.name}</span>
        </div>
      </div>
    </header>
  );
}
