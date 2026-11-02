import { useState, useEffect, useCallback } from "react";
import { format, isValid } from "date-fns";
import { Input } from "@/components/ui/input";
import { UsersThree, Clock, CheckCircle, Warning, ClockCounterClockwise } from "@phosphor-icons/react";
import { StatCard, SectionHeader, EmptyState, TonePill } from "@/components/employee/EmployeeUi";

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

  const working = records.filter((r) => !r.clock_out).length;
  const shortDays = records.filter((r) => r.clock_out && r.is_short_day).length;
  const complete = records.filter((r) => r.clock_out && !r.is_short_day).length;

  return (
    <div data-testid="manager-attendance-tab">
      <div className="flex items-center justify-between mb-7 flex-wrap gap-3">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Team Attendance</h1>
          <p className="text-slate-500 mt-1.5 text-sm">Login/logout status of your direct reports</p>
        </div>
        <div className="flex items-center gap-2">
          <Input data-testid="team-attendance-date-filter" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44 h-11 rounded-xl bg-white" />
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <StatCard icon={UsersThree} tone="blue" label="Logged in" value={records.length} sub="team members that day" />
        <StatCard icon={Clock} tone="violet" label="Working" value={working} sub="not logged out yet" />
        <StatCard icon={CheckCircle} tone="green" label="Complete" value={complete} sub="met the day" />
        <StatCard icon={Warning} tone="amber" label="Short Days" value={shortDays} sub="logged out early" />
      </div>

      <div className="section-card">
        <SectionHeader icon={ClockCounterClockwise} tone="blue" title="Attendance" sub={isValid(new Date(`${date}T00:00:00`)) ? format(new Date(`${date}T00:00:00`), "EEEE, MMM d, yyyy") : undefined} />
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Employee</th>
              <th className="table-header">Login</th>
              <th className="table-header">Logout</th>
              <th className="table-header">Working Hours</th>
              <th className="table-header">Status</th>
            </tr>
          </thead>
          <tbody>
            {!loading && records.length === 0 ? (
              <tr><td colSpan={5}><EmptyState inTable compact icon={ClockCounterClockwise} tone="blue" title="No attendance records for this date" testId="no-team-attendance" /></td></tr>
            ) : records.map((r) => (
              <tr key={`${r.user_id}-${r.date}`} data-testid={`team-attendance-row-${r.user_id}`} className="table-row">
                <td className="table-cell font-semibold text-slate-900">{r.user_name}</td>
                <td className="table-cell">{fmtTime(r.clock_in)}</td>
                <td className="table-cell">{fmtTime(r.clock_out)}</td>
                <td className="table-cell">{r.working_hours ? `${r.working_hours}h` : "—"}</td>
                <td className="table-cell">
                  {!r.clock_out ? (
                    <TonePill tone="blue">Working</TonePill>
                  ) : r.is_short_day ? (
                    <span className="badge-pending">Short Day</span>
                  ) : (
                    <span className="badge-approved">Complete</span>
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
