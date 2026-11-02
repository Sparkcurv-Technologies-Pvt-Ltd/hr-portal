import { CurrencyDollar, Money, MinusCircle, Wallet, TrendUp, Receipt } from "@phosphor-icons/react";
import { TabHeader, StatCard, SectionHeader, EmptyState } from "@/components/employee/EmployeeUi";

export function SalaryTab({ salaryStructure }) {
  return (
    <>
      <TabHeader title="My Salary" description="View your salary structure and deductions" />

      {salaryStructure ? (
        <div className="space-y-6">
          {/* Salary overview */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={Money} tone="blue" label="Gross Salary" value={`₹${salaryStructure.gross_salary?.toLocaleString()}`} valueTestId="emp-gross-salary" sub="per month" />
            <StatCard icon={MinusCircle} tone="red" label="Total Deductions" value={`-₹${salaryStructure.total_deductions?.toLocaleString()}`} valueTestId="emp-total-deductions" sub="per month" />
            <StatCard icon={Wallet} tone="green" label="Net Salary" value={`₹${salaryStructure.net_salary?.toLocaleString()}`} valueTestId="emp-net-salary" sub="take-home per month" />
          </div>

          {/* Earnings Breakdown */}
          <div className="section-card">
            <SectionHeader icon={TrendUp} tone="green" title="Earnings Breakdown" sub="How your gross salary is made up" />
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Component</th>
                  <th className="table-header">Percentage</th>
                  <th className="table-header text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {salaryStructure.earnings?.map((e, i) => (
                  <tr key={i} className="table-row">
                    <td className="table-cell font-medium text-gray-900">{e.name}</td>
                    <td className="table-cell text-gray-500">{e.percentage}%</td>
                    <td className="table-cell text-right font-medium">₹{e.amount?.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200" style={{ background: 'var(--table-header-bg)' }}>
                  <td className="table-cell font-bold text-gray-900">Total Earnings</td>
                  <td className="table-cell">100%</td>
                  <td className="table-cell text-right font-bold text-gray-900">₹{salaryStructure.gross_salary?.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Deductions */}
          <div className="section-card">
            <SectionHeader icon={Receipt} tone="red" title="Deductions" sub="Taken out of your gross salary each month" />
            {salaryStructure.deductions?.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Component</th>
                    <th className="table-header">Type</th>
                    <th className="table-header text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {salaryStructure.deductions.map((d, i) => (
                    <tr key={i} className="table-row">
                      <td className="table-cell font-medium text-gray-900">{d.name}</td>
                      <td className="table-cell text-gray-500">{d.is_percentage ? `${d.percentage}% of salary` : "Fixed"}</td>
                      <td className="table-cell text-right font-medium" style={{ color: 'var(--badge-red-text)' }}>-₹{d.amount?.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-200" style={{ background: 'var(--table-header-bg)' }}>
                    <td className="table-cell font-bold text-gray-900" colSpan="2">Total Deductions</td>
                    <td className="table-cell text-right font-bold" style={{ color: 'var(--badge-red-text)' }}>-₹{salaryStructure.total_deductions?.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <EmptyState compact icon={Receipt} tone="green" title="No custom deductions applied" />
            )}
          </div>
        </div>
      ) : (
        <div className="section-card">
          <EmptyState icon={CurrencyDollar} tone="blue" title="Salary not configured yet" hint="Contact your admin to set up your salary structure" />
        </div>
      )}
    </>
  );
}
