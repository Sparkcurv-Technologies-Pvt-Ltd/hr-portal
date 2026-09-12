import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { Check, X, CalendarCheck, Laptop } from "@phosphor-icons/react";

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

  return (
    <div data-testid="manager-leave-wfh-tab">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Team Leave & WFH</h1>
        <p className="text-gray-500 mt-1">Approve or reject requests from your direct reports</p>
      </div>

      <div className="flex gap-2 mb-6">
        <button data-testid="team-leave-section-btn" onClick={() => setSection("leave")} className={`px-4 py-2 rounded-lg text-sm font-bold ${section === "leave" ? "bg-[#002FA7] text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
          <CalendarCheck className="h-4 w-4 inline mr-1.5 -mt-0.5" /> Leave ({pendingLeaves.length})
        </button>
        <button data-testid="team-wfh-section-btn" onClick={() => setSection("wfh")} className={`px-4 py-2 rounded-lg text-sm font-bold ${section === "wfh" ? "bg-[#002FA7] text-white" : "bg-white border border-slate-200 text-slate-600"}`}>
          <Laptop className="h-4 w-4 inline mr-1.5 -mt-0.5" /> WFH ({pendingWfh.length})
        </button>
      </div>

      {section === "leave" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Employee</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Type</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Dates</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Reason</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {leaves.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-slate-400 text-sm" data-testid="no-team-leaves">No leave requests from your team</td></tr>
              ) : [...pendingLeaves, ...historyLeaves].map((l) => (
                <tr key={l.id} data-testid={`team-leave-row-${l.id}`} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">{l.user_name}</td>
                  <td className="px-5 py-3 text-slate-600 capitalize">{l.leave_type}{l.is_half_day ? " (Half)" : ""}</td>
                  <td className="px-5 py-3 text-slate-600">{format(new Date(l.start_date), "MMM d")} - {format(new Date(l.end_date), "MMM d")}</td>
                  <td className="px-5 py-3 text-slate-500 max-w-[200px] truncate">{l.reason}</td>
                  <td className="px-5 py-3">
                    {l.status === "pending" ? (
                      <div className="flex items-center gap-2">
                        <button data-testid={`team-leave-approve-${l.id}`} onClick={() => actOnLeave(l.id, "approve")} className="text-emerald-500 hover:text-emerald-700"><Check className="h-4 w-4" /></button>
                        <button data-testid={`team-leave-reject-${l.id}`} onClick={() => actOnLeave(l.id, "reject")} className="text-red-500 hover:text-red-700"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${l.status === "approved" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>{l.status}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {section === "wfh" && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Employee</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Date</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Reason</th>
                <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wfhs.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-10 text-slate-400 text-sm" data-testid="no-team-wfh">No WFH requests from your team</td></tr>
              ) : [...pendingWfh, ...historyWfh].map((w) => (
                <tr key={w.id} data-testid={`team-wfh-row-${w.id}`} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-semibold text-slate-800">{w.user_name}</td>
                  <td className="px-5 py-3 text-slate-600">{format(new Date(w.date), "MMM d, yyyy")}</td>
                  <td className="px-5 py-3 text-slate-500 max-w-[220px] truncate">{w.reason}</td>
                  <td className="px-5 py-3">
                    {w.status === "pending" ? (
                      <div className="flex items-center gap-2">
                        <button data-testid={`team-wfh-approve-${w.id}`} onClick={() => actOnWfh(w.id, "approve")} className="text-emerald-500 hover:text-emerald-700"><Check className="h-4 w-4" /></button>
                        <button data-testid={`team-wfh-reject-${w.id}`} onClick={() => actOnWfh(w.id, "reject")} className="text-red-500 hover:text-red-700"><X className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${w.status === "approved" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>{w.status}</span>
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
