import { useState, useEffect, useCallback } from "react";
import { format } from "date-fns";
import { Input } from "./ui/input";

export function ManagerAttendanceTab({ api }) {
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/attendance?date=${date}`);
      setRecords(res.data || []);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [api, date]);

  useEffect(() => { fetchAttendance(); }, [fetchAttendance]);

  const fmtTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "—";

  return (
    <div data-testid="manager-attendance-tab">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Team Attendance</h1>
          <p className="text-gray-500 mt-1">Clock in/out status of your direct reports</p>
        </div>
        <Input data-testid="team-attendance-date-filter" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Employee</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Clock In</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Clock Out</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Break</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Working Hours</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!loading && records.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-slate-400 text-sm" data-testid="no-team-attendance">No attendance records for this date</td></tr>
            ) : records.map((r) => (
              <tr key={`${r.user_id}-${r.date}`} data-testid={`team-attendance-row-${r.user_id}`} className="hover:bg-slate-50">
                <td className="px-5 py-3 font-semibold text-slate-800">{r.user_name}</td>
                <td className="px-5 py-3 text-slate-600">{fmtTime(r.clock_in)}</td>
                <td className="px-5 py-3 text-slate-600">{fmtTime(r.clock_out)}</td>
                <td className="px-5 py-3 text-slate-600">{r.total_break_minutes || 0} min</td>
                <td className="px-5 py-3 text-slate-600">{r.working_hours ? `${r.working_hours}h` : "—"}</td>
                <td className="px-5 py-3">
                  {!r.clock_out ? (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-50 text-[#002FA7]">Working</span>
                  ) : r.is_short_day ? (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-amber-50 text-amber-600">Short Day</span>
                  ) : (
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">Complete</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
