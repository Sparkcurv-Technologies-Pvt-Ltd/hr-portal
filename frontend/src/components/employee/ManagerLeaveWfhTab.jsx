import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Check, X, CalendarCheck, Laptop } from "@phosphor-icons/react";
import { TabHeader, SectionHeader, EmptyState, StatusPill } from "@/components/employee/EmployeeUi";

// Manager-only: Approve/Reject Leave & WFH requests from direct reports
export function ManagerLeaveWfhTab({ api }) {
  const [leaves, setLeaves] = useState([]);
  const [wfhs, setWfhs] = useState([]);
  const [section, setSection] = useState("leave");

  const fetchAll = useCallback(async () => {
    try {
      const [leaveRes, wfhRes] = await Promise.all([
        api.get("/admin/leave-requests"),
        api.get("/admin/wfh-requests")
      ]);
      setLeaves(leaveRes.data || []);
      setWfhs(wfhRes.data || []);
    } catch {
      setLeaves([]); setWfhs([]);
    }
  }, [api]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const actOnLeave = async (id, action) => {
    try {
      await api.put(`/admin/leave-requests/${id}?action=${action}`);
      toast.success(`Leave request ${action}d`);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update");
    }
  };

  const actOnWfh = async (id, action) => {
    try {
      await api.put(`/admin/wfh-requests/${id}?action=${action}`);
      toast.success(`WFH request ${action}d`);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to update");
    }
  };

  const pendingLeaves = leaves.filter((l) => l.status === "pending");
  const historyLeaves = leaves.filter((l) => l.status !== "pending");
  const pendingWfh = wfhs.filter((w) => w.status === "pending");
  const historyWfh = wfhs.filter((w) => w.status !== "pending");

  const segBtn = (active) =>
    `inline-flex items-center gap-2 h-10 px-4 rounded-xl text-sm font-semibold transition-colors ${
      active ? "bg-[var(--brand-primary)] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
    }`;
  const actionBtn = "inline-flex items-center justify-center h-8 w-8 rounded-lg border transition-colors";

  return (
    <div data-testid="manager-leave-wfh-tab">
      <TabHeader title="Team Leave & WFH" description="Approve or reject requests from your direct reports" />

      <div className="inline-flex flex-wrap gap-1 p-1 mb-6 rounded-2xl bg-white border border-slate-200" style={{ boxShadow: 'var(--shadow-sm)' }}>
        <button data-testid="team-leave-section-btn" onClick={() => setSection("leave")} className={segBtn(section === "leave")}>
          <CalendarCheck className="h-4 w-4" weight="duotone" /> Leave ({pendingLeaves.length})
        </button>
        <button data-testid="team-wfh-section-btn" onClick={() => setSection("wfh")} className={segBtn(section === "wfh")}>
          <Laptop className="h-4 w-4" weight="duotone" /> WFH ({pendingWfh.length})
        </button>
      </div>

      {section === "leave" && (
        <div className="section-card">
          <SectionHeader icon={CalendarCheck} tone="blue" title="Leave requests" sub="Pending first, then history">
            {pendingLeaves.length > 0 && <span className="badge-pending">{pendingLeaves.length} pending</span>}
          </SectionHeader>
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Employee</th>
                <th className="table-header">Type</th>
                <th className="table-header">Dates</th>
                <th className="table-header">Reason</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {leaves.length === 0 ? (
                <tr><td colSpan={5}><EmptyState inTable compact icon={CalendarCheck} tone="blue" title="No leave requests from your team" testId="no-team-leaves" /></td></tr>
              ) : [...pendingLeaves, ...historyLeaves].map((l) => (
                <tr key={l.id} data-testid={`team-leave-row-${l.id}`} className="table-row">
                  <td className="table-cell font-semibold text-slate-900">{l.user_name}</td>
                  <td className="table-cell capitalize">{l.leave_type}{l.is_half_day ? " (Half)" : ""}</td>
                  <td className="table-cell whitespace-nowrap">{format(new Date(l.start_date), "MMM d")} - {format(new Date(l.end_date), "MMM d")}</td>
                  <td className="table-cell text-slate-500 max-w-[220px] truncate">{l.reason}</td>
                  <td className="table-cell">
                    {l.status === "pending" ? (
                      <div className="flex items-center gap-2">
                        <button data-testid={`team-leave-approve-${l.id}`} onClick={() => actOnLeave(l.id, "approve")} title="Approve" className={`${actionBtn} tone-green`} style={{ background: 'var(--tone-bg)', color: 'var(--tone)', borderColor: 'var(--badge-green-border)' }}><Check className="h-4 w-4" weight="bold" /></button>
                        <button data-testid={`team-leave-reject-${l.id}`} onClick={() => actOnLeave(l.id, "reject")} title="Reject" className={`${actionBtn} tone-red`} style={{ background: 'var(--tone-bg)', color: 'var(--tone)', borderColor: 'var(--badge-red-border)' }}><X className="h-4 w-4" weight="bold" /></button>
                      </div>
                    ) : (
                      <StatusPill status={l.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === "wfh" && (
        <div className="section-card">
          <SectionHeader icon={Laptop} tone="teal" title="WFH requests" sub="Pending first, then history">
            {pendingWfh.length > 0 && <span className="badge-pending">{pendingWfh.length} pending</span>}
          </SectionHeader>
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Employee</th>
                <th className="table-header">Date</th>
                <th className="table-header">Reason</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {wfhs.length === 0 ? (
                <tr><td colSpan={4}><EmptyState inTable compact icon={Laptop} tone="teal" title="No WFH requests from your team" testId="no-team-wfh" /></td></tr>
              ) : [...pendingWfh, ...historyWfh].map((w) => (
                <tr key={w.id} data-testid={`team-wfh-row-${w.id}`} className="table-row">
                  <td className="table-cell font-semibold text-slate-900">{w.user_name}</td>
                  <td className="table-cell whitespace-nowrap">{format(new Date(w.date), "MMM d, yyyy")}</td>
                  <td className="table-cell text-slate-500 max-w-[240px] truncate">{w.reason}</td>
                  <td className="table-cell">
                    {w.status === "pending" ? (
                      <div className="flex items-center gap-2">
                        <button data-testid={`team-wfh-approve-${w.id}`} onClick={() => actOnWfh(w.id, "approve")} title="Approve" className={`${actionBtn} tone-green`} style={{ background: 'var(--tone-bg)', color: 'var(--tone)', borderColor: 'var(--badge-green-border)' }}><Check className="h-4 w-4" weight="bold" /></button>
                        <button data-testid={`team-wfh-reject-${w.id}`} onClick={() => actOnWfh(w.id, "reject")} title="Reject" className={`${actionBtn} tone-red`} style={{ background: 'var(--tone-bg)', color: 'var(--tone)', borderColor: 'var(--badge-red-border)' }}><X className="h-4 w-4" weight="bold" /></button>
                      </div>
                    ) : (
                      <StatusPill status={w.status} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
