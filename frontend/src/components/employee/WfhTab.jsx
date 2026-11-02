import { useState } from "react";
import { holidayDateSet, isOffDay } from "@/lib/workdays";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { format } from "date-fns";
import { CalendarBlank, Laptop, Trash, CalendarCheck, CheckCircle, Hourglass } from "@phosphor-icons/react";
import { TabHeader, StatCard, SectionHeader, EmptyState, StatusPill } from "@/components/employee/EmployeeUi";

export function WfhTab({
  api, wfhBalance, wfhRequests, wfhForm, setWfhForm, loading, setLoading, fetchData, holidays
}) {
  const offDays = holidayDateSet(holidays);
  const [wfhDialogOpen, setWfhDialogOpen] = useState(false);

  const handleRequestWfh = async () => {
    if (!wfhForm.date || !wfhForm.reason) {
      toast.error("Please select a date and enter a reason");
      return;
    }
    setLoading(true);
    try {
      await api.post("/wfh/request", {
        date: format(wfhForm.date, "yyyy-MM-dd"),
        reason: wfhForm.reason
      });
      toast.success("WFH request submitted!");
      setWfhDialogOpen(false);
      setWfhForm({ date: null, reason: "" });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit WFH request");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelWfh = async (wfhId) => {
    try {
      await api.delete(`/wfh/${wfhId}`);
      toast.success("WFH request cancelled");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to cancel WFH request");
    }
  };

  return (
    <>
      <TabHeader title="Work From Home" description="Request and track your WFH days">
        <Dialog open={wfhDialogOpen} onOpenChange={setWfhDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="request-wfh-btn" className="h-11 px-5 rounded-xl bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] font-semibold" style={{ boxShadow: 'var(--shadow-brand)' }}>
              <Laptop className="h-4 w-4 mr-2" weight="bold" /> Request WFH
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md rounded-2xl">
            <DialogHeader>
              <DialogTitle className="font-['Outfit'] text-xl">Request Work From Home</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-slate-700">Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-11 rounded-xl justify-start text-left font-normal" data-testid="wfh-date-picker">
                      <CalendarBlank className="mr-2 h-4 w-4 opacity-60" />
                      {wfhForm.date ? format(wfhForm.date, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={wfhForm.date} onSelect={(date) => setWfhForm({ ...wfhForm, date })} disabled={(date) => isOffDay(date, offDays)} />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold text-slate-700">Reason</Label>
                <Textarea
                  data-testid="wfh-reason"
                  value={wfhForm.reason}
                  onChange={(e) => setWfhForm({ ...wfhForm, reason: e.target.value })}
                  placeholder="Why do you need to work from home?"
                  className="rounded-xl"
                />
              </div>
              <div className="tone-blue p-3 rounded-xl text-sm" style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}>
                {wfhBalance.limit === null
                  ? <span>WFH limit <strong>not set</strong> — contact admin</span>
                  : <span>Monthly WFH Balance: <strong>{wfhBalance.remaining}</strong> of {wfhBalance.limit} days remaining</span>
                }
              </div>
              <Button
                data-testid="submit-wfh-btn"
                onClick={handleRequestWfh}
                disabled={loading}
                className="w-full h-11 rounded-xl bg-[var(--brand-primary)] text-white hover:bg-[var(--brand-primary-hover)] font-semibold"
              >
                Submit Request
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </TabHeader>

      {/* WFH Balance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={CalendarCheck}
          tone="blue"
          label="Monthly Limit"
          value={wfhBalance.limit ?? <span className="text-base font-semibold text-slate-400">Not set</span>}
          sub={wfhBalance.limit === null ? "contact admin" : "days per month"}
        />
        <StatCard icon={Hourglass} tone="amber" label="Used" value={wfhBalance.used} sub="days this month" />
        <StatCard
          icon={CheckCircle}
          tone="green"
          label="Remaining"
          value={wfhBalance.remaining ?? <span className="text-base font-semibold text-slate-400">—</span>}
          sub="days left this month"
        />
      </div>

      {/* WFH Requests Table */}
      <div className="section-card">
        <SectionHeader icon={Laptop} tone="blue" title="My WFH requests">
          {wfhRequests.length > 0 && <span className="chip">{wfhRequests.length} total</span>}
        </SectionHeader>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Date</th>
              <th className="table-header">Reason</th>
              <th className="table-header">Status</th>
              <th className="table-header">Reviewed By</th>
              <th className="table-header text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {wfhRequests.length === 0 ? (
              <tr><td colSpan={5}><EmptyState inTable icon={Laptop} tone="blue" title="No WFH requests yet" hint="Use “Request WFH” to ask for a work-from-home day." /></td></tr>
            ) : (
              wfhRequests.map((req) => (
                <tr key={req.id} data-testid={`wfh-request-${req.id}`} className="table-row">
                  <td className="table-cell font-semibold text-slate-900 whitespace-nowrap">{req.date}</td>
                  <td className="table-cell max-w-[280px] truncate">{req.reason}</td>
                  <td className="table-cell">
                    <StatusPill status={req.status} />
                  </td>
                  <td className="table-cell">{req.reviewed_by || "-"}</td>
                  <td className="table-cell text-right">
                    {req.status === "pending" && (
                      <Button
                        data-testid={`cancel-wfh-${req.id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => handleCancelWfh(req.id)}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50 h-8 rounded-lg"
                      >
                        <Trash className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
