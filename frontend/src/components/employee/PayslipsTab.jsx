import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { DownloadSimple, Money, MinusCircle, Wallet, Receipt } from "@phosphor-icons/react";
import { TabHeader, StatCard, SectionHeader, EmptyState } from "@/components/employee/EmployeeUi";
import { saveBlobAsFile } from "@/lib/api";

export function PayslipsTab({ api, payslips }) {
  const handleDownloadPayslip = async (payslipId) => {
    try {
      const response = await api.get(`/payslip/download/${payslipId}`, {
        responseType: 'blob'
      });
      saveBlobAsFile(response.data, `payslip_${payslipId}.pdf`);
      toast.success("Payslip downloaded!");
    } catch (error) {
      toast.error("Failed to download payslip");
    }
  };

  const latest = payslips[0];

  return (
    <>
      <TabHeader title="My Payslips" description="View and download your salary slips" />

      {/* Latest payslip summary */}
      {payslips.length > 0 && (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
            Latest payslip · {latest?.month_name} {latest?.year}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={Money} tone="blue" label="Basic Salary" value={`₹${latest?.basic_salary?.toLocaleString()}`} />
            <StatCard icon={MinusCircle} tone="red" label="Total Deductions" value={`-₹${latest?.total_deductions?.toLocaleString()}`}>
              {latest?.deduction_details?.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                  {latest.deduction_details.map((d, i) => (
                    <li key={i}>{d.description}: ₹{d.amount}</li>
                  ))}
                </ul>
              )}
            </StatCard>
            <StatCard icon={Wallet} tone="green" label="Net Pay" value={`₹${latest?.net_pay?.toLocaleString()}`} />
          </div>
        </div>
      )}

      <div className="section-card">
        <SectionHeader icon={Receipt} tone="blue" title="All payslips" sub="Download any month as PDF">
          {payslips.length > 0 && <span className="chip">{payslips.length} total</span>}
        </SectionHeader>
        <table className="w-full">
          <thead>
            <tr>
              <th className="table-header">Pay Period</th>
              <th className="table-header">Basic Salary</th>
              <th className="table-header">Deductions</th>
              <th className="table-header">Net Pay</th>
              <th className="table-header">Generated On</th>
              <th className="table-header">Actions</th>
            </tr>
          </thead>
          <tbody>
            {payslips.length === 0 ? (
              <tr>
                <td colSpan="6">
                  <EmptyState inTable icon={Receipt} tone="blue" title="No payslips available yet" hint="Your payslips will appear here once payroll is processed." />
                </td>
              </tr>
            ) : (
              payslips.map((ps) => (
                <tr key={ps.id} className="table-row">
                  <td className="table-cell font-semibold text-slate-900">{ps.month_name} {ps.year}</td>
                  <td className="table-cell">₹{ps.basic_salary?.toLocaleString()}</td>
                  <td className="table-cell font-medium" style={{ color: 'var(--badge-red-text)' }}>-₹{ps.total_deductions?.toLocaleString()}</td>
                  <td className="table-cell font-bold" style={{ color: 'var(--badge-green-text)' }}>₹{ps.net_pay?.toLocaleString()}</td>
                  <td className="table-cell text-slate-500">
                    {format(new Date(ps.created_at), "MMM d, yyyy")}
                  </td>
                  <td className="table-cell">
                    <Button
                      data-testid={`download-payslip-${ps.id}`}
                      size="sm"
                      onClick={() => handleDownloadPayslip(ps.id)}
                      className="bg-[var(--brand-primary)] hover:bg-[var(--brand-primary-hover)] text-white gap-1.5 rounded-lg h-8"
                    >
                      <DownloadSimple className="h-4 w-4" weight="bold" />
                      PDF
                    </Button>
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
