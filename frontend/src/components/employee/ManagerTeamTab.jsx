import { useState, useEffect } from "react";
import { UsersThree } from "@phosphor-icons/react";
import { TabHeader, EmptyState } from "@/components/employee/EmployeeUi";
import { Avatar } from "@/components/common/Avatar";

// Manager-only: lists direct reports (users with reporting_manager_id === current manager)
export function ManagerTeamTab({ api }) {
  const [members, setMembers] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/team/members").then(r => setMembers(r.data || [])).catch(() => setMembers([])).finally(() => setLoaded(true));
  }, [api]);

  return (
    <div data-testid="manager-team-tab">
      <TabHeader title="My Team" description="Employees who report directly to you">
        {members.length > 0 && <span className="chip tone-blue">{members.length} {members.length === 1 ? "member" : "members"}</span>}
      </TabHeader>

      {loaded && members.length === 0 ? (
        <div className="section-card">
          <EmptyState icon={UsersThree} tone="blue" title="No one reports to you yet." hint="Contact Admin to assign reporting employees." testId="no-team-members" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {members.map((m) => {
            return (
              <div key={m.id} data-testid={`team-member-card-${m.id}`} className="stat-card flex-row items-center gap-3.5" style={{ flexDirection: 'row', padding: 18 }}>
                <Avatar url={m.avatar_url} name={m.name} size="h-12 w-12" textSize="text-sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 truncate">{m.name}</p>
                  <p className="text-xs text-slate-500 truncate mt-0.5">{m.position} · {m.department}</p>
                  {m.employee_code && <span className="chip mt-1.5 font-['JetBrains_Mono'] text-[10.5px]">{m.employee_code}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
