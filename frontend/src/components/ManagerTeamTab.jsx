import { useState, useEffect } from "react";
import { UsersThree } from "@phosphor-icons/react";

const API_BASE = process.env.REACT_APP_BACKEND_URL || "";
const getAvatarUrl = (url) => {
  if (!url || url === "") return null;
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
};
const getInitials = (name) => {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
};

// Manager-only: lists direct reports (users with reporting_manager_id === current manager)
export function ManagerTeamTab({ api }) {
  const [members, setMembers] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.get("/team/members").then(r => setMembers(r.data || [])).catch(() => setMembers([])).finally(() => setLoaded(true));
  }, [api]);

  return (
    <div data-testid="manager-team-tab">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">My Team</h1>
        <p className="text-gray-500 mt-1">Employees who report directly to you</p>
      </div>

      {loaded && members.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <UsersThree className="h-10 w-10 text-slate-300 mx-auto mb-3" weight="duotone" />
          <p className="text-slate-400 text-sm" data-testid="no-team-members">No one reports to you yet. Contact Admin to assign reporting employees.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {members.map((m) => {
            const src = getAvatarUrl(m.avatar_url);
            return (
              <div key={m.id} data-testid={`team-member-card-${m.id}`} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
                {src ? (
                  <img src={src} alt={m.name} className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-[#002FA7] text-white flex items-center justify-center font-bold text-sm">
                    {getInitials(m.name)}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 truncate">{m.name}</p>
                  <p className="text-xs text-slate-500 truncate">{m.position} · {m.department}</p>
                  <p className="text-[11px] text-slate-400">{m.employee_code}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
