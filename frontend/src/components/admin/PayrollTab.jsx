import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Trash, PencilSimple, Receipt, CurrencyDollar, DownloadSimple, ClockClockwise,
  Plus, TrashSimple, Bell, Wallet, MinusCircle, Users
} from "@phosphor-icons/react";
import { saveBlobAsFile } from "@/lib/api";
import { Avatar } from "@/components/common/Avatar";
import { usePermissions } from "@/hooks/usePermissions";

const months = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
  { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" }
];

export function PayrollTab({
  api, employees, payslips, payrollSummary, salaryComponents, setSalaryComponents, componentsForm,
  setComponentsForm, loading, setLoading, fetchData, payrollSubTab, setPayrollSubTab,
  payslipFilterEmp, setPayslipFilterEmp, payslipFilterMonth, setPayslipFilterMonth,
  payslipFilterYear, setPayslipFilterYear, bulkMonth, setBulkMonth, bulkYear, setBulkYear,
  bulkProcessing, setBulkProcessing, payslipForm, setPayslipForm, editingComponents,
  setEditingComponents, deductionForm, setDeductionForm
}) {
  const { can } = usePermissions();
  const canEdit = can("payroll", "edit");
  const canDelete = can("payroll", "delete");
  const [selectedEmpDeductions, setSelectedEmpDeductions] = useState([]);
  const [deductionDialogOpen, setDeductionDialogOpen] = useState(false);
  const [selectedDeductionEmp, setSelectedDeductionEmp] = useState(null);

  const [generatePayslipOpen, setGeneratePayslipOpen] = useState(false);

  // Payroll handlers
  const handleBulkProcess = async () => {
    setBulkProcessing(true);
    try {
      const res = await api.post("/admin/payroll/process", { month: bulkMonth, year: bulkYear });
      toast.success(`Payroll processed: ${res.data.generated} payslips generated, ${res.data.skipped} skipped${res.data.emailed ? ` — emailing ${res.data.emailed} to employees` : ""}`);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to process payroll");
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleSaveSalaryComponents = async () => {
    try {
      await api.put("/admin/salary-components", { components: componentsForm });
      setSalaryComponents(componentsForm);
      setEditingComponents(false);
      toast.success("Salary structure updated");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    }
  };

  const handleEmailPayslip = async (psId, empName) => {
    try {
      await api.post(`/admin/payslips/${psId}/email`);
      toast.success(`Payslip emailed to ${empName}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send email");
    }
  };

  const handleLoadDeductions = async (emp) => {
    setSelectedDeductionEmp(emp);
    try {
      const res = await api.get(`/admin/deductions/${emp.id}`);
      setSelectedEmpDeductions(res.data);
      setDeductionDialogOpen(true);
    } catch { setSelectedEmpDeductions([]); setDeductionDialogOpen(true); }
  };

  const handleAddDeduction = async () => {
    if (!deductionForm.deduction_name) { toast.error("Enter deduction name"); return; }
    try {
      await api.post("/admin/deductions", {
        user_id: parseInt(selectedDeductionEmp.id),
        deduction_name: deductionForm.deduction_name,
        amount: deductionForm.is_percentage ? 0 : deductionForm.amount,
        is_percentage: deductionForm.is_percentage,
        percentage: deductionForm.is_percentage ? deductionForm.percentage : 0
      });
      toast.success("Deduction added");
      setDeductionForm({ deduction_name: "", amount: 0, is_percentage: false, percentage: 0 });
      const res = await api.get(`/admin/deductions/${selectedDeductionEmp.id}`);
      setSelectedEmpDeductions(res.data);
    } catch (error) { toast.error(error.response?.data?.detail || "Failed"); }
  };

  const handleDeleteDeduction = async (dedId) => {
    try {
      await api.delete(`/admin/deductions/${dedId}`);
      toast.success("Deduction removed");
      const res = await api.get(`/admin/deductions/${selectedDeductionEmp.id}`);
      setSelectedEmpDeductions(res.data);
    } catch (error) { toast.error("Failed to delete"); }
  };

  const handleGeneratePayslip = async () => {
    if (!payslipForm.employee_id) {
      toast.error("Please select an employee");
      return;
    }

    setLoading(true);
    try {
      const res = await api.post("/admin/payslip/generate", payslipForm);
      toast.success(res.data?.emailed_to ? `Payslip generated — emailing it to ${res.data.emailed_to}` : "Payslip generated successfully!");
      setGeneratePayslipOpen(false);
      setPayslipForm({
        employee_id: "",
        month: new Date().getMonth() + 1,
        year: new Date().getFullYear()
      });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to generate payslip");
    } finally {
      setLoading(false);
    }
  };

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

  const handleDeletePayslip = async (payslipId) => {
    if (!window.confirm("Are you sure you want to delete this payslip?")) return;

    try {
      await api.delete(`/admin/payslips/${payslipId}`);
      toast.success("Payslip deleted");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to delete payslip");
    }
  };

  return (
    <>
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Payroll</h1>
          <p className="text-slate-500 mt-1 text-sm">Manage salaries, deductions, and payslips</p>
        </div>
      </div>

      {/* Sub-tab Navigation */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit max-w-full overflow-x-auto" style={{ background: "var(--surface)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-sm)" }} data-testid="payroll-subtabs">
        {[
          { id: "dashboard", label: "Dashboard" },
          { id: "salary-structure", label: "Salary Structure" },
          { id: "deductions", label: "Deductions" },
          { id: "process", label: "Process Payroll" },
          { id: "payslips", label: "Payslips" }
        ].filter(tab => tab.id !== "process" || canEdit).map(tab => (
          <button
            key={tab.id}
            data-testid={`payroll-subtab-${tab.id}`}
            onClick={() => setPayrollSubTab(tab.id)}
            className={`px-4 h-9 text-sm font-semibold rounded-lg transition-all whitespace-nowrap flex-shrink-0 ${
              payrollSubTab === tab.id
                ? "bg-[#0020F8] text-white shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-tab: Dashboard */}
      {payrollSubTab === "dashboard" && (
        <>
          {/* YTD Summary Cards */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5 mb-6">
            <div className="stat-card">
              <div className="stat-top">
                <span className="stat-label">YTD Gross Pay</span>
                <span className="stat-icon tone-blue"><Wallet className="h-5 w-5" weight="duotone" /></span>
              </div>
              <div>
                <p className="stat-value" data-testid="ytd-gross">₹{(payrollSummary?.ytd?.total_gross || 0).toLocaleString()}</p>
                <p className="stat-sub mt-1">Before deductions</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-top">
                <span className="stat-label">YTD Deductions</span>
                <span className="stat-icon tone-red"><MinusCircle className="h-5 w-5" weight="duotone" /></span>
              </div>
              <div>
                <p className="stat-value" data-testid="ytd-deductions">₹{(payrollSummary?.ytd?.total_deductions || 0).toLocaleString()}</p>
                <p className="stat-sub mt-1">PF, ESI, TDS, LOP</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-top">
                <span className="stat-label">YTD Net Pay</span>
                <span className="stat-icon tone-green"><CurrencyDollar className="h-5 w-5" weight="duotone" /></span>
              </div>
              <div>
                <p className="stat-value" data-testid="ytd-net">₹{(payrollSummary?.ytd?.total_net || 0).toLocaleString()}</p>
                <p className="stat-sub mt-1">Paid out this year</p>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-top">
                <span className="stat-label">Total Payslips</span>
                <span className="stat-icon tone-violet"><Receipt className="h-5 w-5" weight="duotone" /></span>
              </div>
              <div>
                <p className="stat-value" data-testid="ytd-count">{payrollSummary?.ytd?.total_payslips || 0}</p>
                <p className="stat-sub mt-1">Generated this year</p>
              </div>
            </div>
          </div>

          {/* Monthly Breakdown */}
          <div className="section-card mb-6">
            <div className="section-header">
              <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Monthly Breakdown — {payrollSummary?.year || new Date().getFullYear()}</h2>
            </div>
            {payrollSummary?.monthly?.length > 0 ? (
              <div>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Month</th>
                    <th className="table-header">Employees</th>
                    <th className="table-header">Gross Pay</th>
                    <th className="table-header">Deductions</th>
                    <th className="table-header">Net Pay</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollSummary.monthly.map((m) => (
                    <tr key={m.month} className="table-row">
                      <td className="table-cell font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{m.month_name} {m.year}</td>
                      <td className="table-cell">{m.employee_count}</td>
                      <td className="table-cell">₹{m.total_gross.toLocaleString()}</td>
                      <td className="table-cell tabular-nums" style={{ color: "var(--badge-red-text)" }}>-₹{m.total_deductions.toLocaleString()}</td>
                      <td className="table-cell tabular-nums font-bold" style={{ color: "var(--badge-green-text)" }}>₹{m.total_net.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center py-12 px-6 gap-3">
                <span className="stat-icon tone-blue"><CurrencyDollar className="h-5 w-5" weight="duotone" /></span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">No payroll data for this year yet</p>
                  <p className="text-xs text-slate-500 mt-1">Process payroll to see the monthly breakdown.</p>
                </div>
              </div>
            )}
          </div>

          {/* Department Breakdown */}
          {payrollSummary?.departments?.length > 0 && (
            <div className="section-card mb-6">
              <div className="section-header">
                <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Department-wise Breakdown</h2>
              </div>
              <div>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Department</th>
                    <th className="table-header">Employees</th>
                    <th className="table-header">Total Gross</th>
                    <th className="table-header">Total Net</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollSummary.departments.map((d, i) => (
                    <tr key={i} className="table-row">
                      <td className="table-cell font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{d.department}</td>
                      <td className="table-cell">{d.employee_count}</td>
                      <td className="table-cell">₹{d.total_gross.toLocaleString()}</td>
                      <td className="table-cell tabular-nums font-bold" style={{ color: "var(--badge-green-text)" }}>₹{d.total_net.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Recent Payroll Runs */}
          {payrollSummary?.runs?.length > 0 && (
            <div className="section-card">
              <div className="section-header">
                <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Payroll Run History</h2>
              </div>
              <div>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Period</th>
                    <th className="table-header">Employees</th>
                    <th className="table-header">Total Gross</th>
                    <th className="table-header">Total Deductions</th>
                    <th className="table-header">Total Net</th>
                    <th className="table-header">Processed By</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollSummary.runs.map((r) => (
                    <tr key={r.id} className="table-row">
                      <td className="table-cell font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>{r.month_name} {r.year}</td>
                      <td className="table-cell">{r.total_employees}</td>
                      <td className="table-cell">₹{parseFloat(r.total_gross || 0).toLocaleString()}</td>
                      <td className="table-cell tabular-nums" style={{ color: "var(--badge-red-text)" }}>-₹{parseFloat(r.total_deductions || 0).toLocaleString()}</td>
                      <td className="table-cell tabular-nums font-bold" style={{ color: "var(--badge-green-text)" }}>₹{parseFloat(r.total_net || 0).toLocaleString()}</td>
                      <td className="table-cell" style={{ color: "var(--text-muted)" }}>{r.processed_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Sub-tab: Salary Structure */}
      {payrollSubTab === "salary-structure" && (
        <div className="max-w-2xl">
          <div className="section-card">
            <div className="section-header">
              <div>
                <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Salary Component Structure</h2>
                <p className="text-xs text-slate-500 mt-1">Configure how gross salary is split into components (Basic, HRA, etc.)</p>
              </div>
              {!canEdit ? null : !editingComponents ? (
                <Button size="sm" variant="outline" onClick={() => { setComponentsForm(salaryComponents.map(c => ({ ...c }))); setEditingComponents(true); }}
                  className="gap-1.5 h-9 rounded-xl border-[#0020F8] text-[#0020F8] hover:bg-[#0020F8] hover:text-white">
                  <PencilSimple className="h-3.5 w-3.5" /> Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="h-9 rounded-xl" onClick={() => setEditingComponents(false)}>Cancel</Button>
                  <Button size="sm" onClick={handleSaveSalaryComponents} className="h-9 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]">Save</Button>
                </div>
              )}
            </div>
            <div>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Component</th>
                  <th className="table-header">Percentage (%)</th>
                  <th className="table-header">Type</th>
                </tr>
              </thead>
              <tbody>
                {(editingComponents ? componentsForm : salaryComponents).map((comp, idx) => (
                  <tr key={idx} className="table-row">
                    <td className="table-cell font-semibold" style={{ color: "var(--text-primary)" }}>{comp.name}</td>
                    <td className="table-cell">
                      {editingComponents && !comp.is_remainder ? (
                        <Input type="number" value={comp.percentage} min="0" max="100" step="0.5"
                          className="w-24 h-9 rounded-lg text-sm"
                          onChange={e => { const v = parseFloat(e.target.value) || 0; setComponentsForm(prev => prev.map((c, i) => i === idx ? { ...c, percentage: v } : c)); }} />
                      ) : (
                        <span className={comp.is_remainder ? "text-slate-400 italic" : ""}>
                          {comp.is_remainder ? "Remainder" : `${comp.percentage}%`}
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={`chip ${comp.is_remainder ? "tone-amber" : "tone-blue"}`}>
                        {comp.is_remainder ? "Remainder" : "Fixed %"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
              <p className="text-xs text-slate-500">
                Total fixed: {(editingComponents ? componentsForm : salaryComponents).filter(c => !c.is_remainder).reduce((s, c) => s + (c.percentage || 0), 0).toFixed(1)}% — 
                Remainder component fills the rest of gross salary.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Sub-tab: Deductions */}
      {payrollSubTab === "deductions" && (
        <>
          <div className="section-card">
            <div className="section-header">
              <div>
                <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Employee Deductions (PF, ESI, TDS, etc.)</h2>
                <p className="text-xs text-slate-500 mt-1">Click "Manage" to add or remove custom deductions per employee</p>
              </div>
            </div>
            <div>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Employee</th>
                  <th className="table-header">Department</th>
                  <th className="table-header">Basic Salary</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.filter(e => e.role !== "admin").length === 0 ? (
                  <tr>
                    <td colSpan="4">
                      <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                        <span className="stat-icon tone-blue"><Users className="h-5 w-5" weight="duotone" /></span>
                        <p className="text-sm font-semibold text-slate-900">No employees found</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  employees.filter(e => e.role !== "admin").map((emp) => (
                    <tr key={emp.id} className="table-row">
                      <td className="table-cell">
                        <div className="flex items-center gap-3">
                          <Avatar url={emp.avatar_url} name={emp.name} />
                          <div>
                            <p className="font-semibold text-slate-900 text-sm">{emp.name}</p>
                            <p className="text-xs text-slate-400 font-mono">{emp.employee_code || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell" style={{ color: "var(--text-muted)" }}>{emp.department || "—"}</td>
                      <td className="table-cell font-semibold tabular-nums whitespace-nowrap" style={{ color: "var(--text-primary)" }}>₹{(emp.basic_salary || 0).toLocaleString()}</td>
                      <td className="table-cell">
                        <Button
                          data-testid={`manage-deductions-${emp.id}`}
                          size="sm"
                          variant="outline"
                          onClick={() => handleLoadDeductions(emp)}
                          className="gap-1.5 h-8 rounded-lg border-[#0020F8] text-[#0020F8] hover:bg-[#0020F8] hover:text-white"
                        >
                          <PencilSimple className="h-3.5 w-3.5" />
                          Manage
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>

          {/* Deduction Management Dialog */}
          <Dialog open={deductionDialogOpen} onOpenChange={setDeductionDialogOpen}>
            <DialogContent className="max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="font-['Outfit'] flex items-center gap-2">
                  <span className="stat-icon tone-blue" style={{ width: 34, height: 34, borderRadius: 10 }}><CurrencyDollar className="h-[18px] w-[18px]" weight="duotone" /></span>
                  Deductions — {selectedDeductionEmp?.name}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                {/* Existing Deductions */}
                {selectedEmpDeductions.length > 0 ? (
                  <div className="space-y-1.5">
                    {selectedEmpDeductions.map((ded) => (
                      <div key={ded.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border" style={{ background: "var(--surface-elevated)", borderColor: "var(--border-color)" }}>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{ded.deduction_name}</p>
                          <p className="text-xs text-slate-500">
                            {ded.is_percentage ? `${ded.percentage}% of salary` : `₹${parseFloat(ded.amount || 0).toLocaleString()}`}
                            {!ded.is_active && <span className="chip tone-amber ml-2">Inactive</span>}
                          </p>
                        </div>
                        {canDelete && (
                        <Button
                          data-testid={`delete-deduction-${ded.id}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDeduction(ded.id)}
                          className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[color:var(--badge-red-text)] hover:bg-[var(--badge-red-bg)]"
                        >
                          <TrashSimple className="h-4 w-4" />
                        </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-400 text-center py-4 rounded-xl border border-dashed border-slate-200">No custom deductions set</p>
                )}

                {/* Add New Deduction */}
                {canEdit && (
                <div className="border-t border-slate-100 pt-4 space-y-3">
                  <p className="text-sm font-semibold text-slate-900">Add Deduction</p>
                  <Input className="rounded-xl h-11"
                    data-testid="deduction-name-input"
                    placeholder="e.g. PF, ESI, TDS"
                    value={deductionForm.deduction_name}
                    onChange={(e) => setDeductionForm({ ...deductionForm, deduction_name: e.target.value })}
                  />
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={deductionForm.is_percentage}
                        onChange={(e) => setDeductionForm({ ...deductionForm, is_percentage: e.target.checked })}
                        className="h-4 w-4 rounded accent-[#0020F8]"
                      />
                      Percentage-based
                    </label>
                  </div>
                  {deductionForm.is_percentage ? (
                    <Input className="rounded-xl h-11"
                      data-testid="deduction-percentage-input"
                      type="number"
                      placeholder="Percentage (e.g. 12)"
                      value={deductionForm.percentage}
                      onChange={(e) => setDeductionForm({ ...deductionForm, percentage: parseFloat(e.target.value) })}
                    />
                  ) : (
                    <Input className="rounded-xl h-11"
                      data-testid="deduction-amount-input"
                      type="number"
                      placeholder="Fixed amount (₹)"
                      value={deductionForm.amount}
                      onChange={(e) => setDeductionForm({ ...deductionForm, amount: parseFloat(e.target.value) })}
                    />
                  )}
                  <Button
                    data-testid="add-deduction-btn"
                    onClick={handleAddDeduction}
                    className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Deduction
                  </Button>
                </div>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Sub-tab: Process Payroll */}
      {payrollSubTab === "process" && canEdit && (
        <>
          <div className="max-w-xl">
            <div className="section-card p-6">
              <h2 className="text-base font-bold text-slate-900 font-['Outfit'] mb-1">Bulk Process Payroll</h2>
              <p className="text-sm text-slate-500 mb-5">Generate payslips for all eligible employees (salary &gt; 0). Existing payslips for the selected period will be skipped.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600">Month</Label>
                  <Select
                    value={bulkMonth.toString()}
                    onValueChange={(v) => setBulkMonth(parseInt(v))}
                  >
                    <SelectTrigger data-testid="bulk-month-select" className="rounded-xl h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((m) => (
                        <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-600">Year</Label>
                  <Input className="rounded-xl h-11"
                    data-testid="bulk-year-input"
                    type="number"
                    value={bulkYear}
                    onChange={(e) => setBulkYear(parseInt(e.target.value))}
                  />
                </div>
              </div>
              <Button
                data-testid="process-payroll-btn"
                onClick={handleBulkProcess}
                disabled={bulkProcessing}
                className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2"
              >
                {bulkProcessing ? (
                  <ClockClockwise className="h-4 w-4 animate-spin" />
                ) : (
                  <CurrencyDollar className="h-4 w-4" weight="bold" />
                )}
                {bulkProcessing ? "Processing..." : "Process Payroll"}
              </Button>
            </div>

            <div className="mt-4 rounded-2xl p-4 border" style={{ background: "var(--brand-primary-light)", borderColor: "color-mix(in srgb, var(--brand-primary) 18%, transparent)" }}>
              <p className="text-sm text-slate-900 font-semibold mb-1.5">How it works</p>
              <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
                <li>Generates payslips for all employees with a salary set</li>
                <li>Automatically applies custom deductions (PF, ESI, etc.)</li>
                <li>Calculates LOP and half-day deductions from approved leaves</li>
                <li>Skips employees who already have a payslip for the period</li>
                <li>Emails each new payslip to the employee as a PDF</li>
              </ul>
            </div>
          </div>
        </>
      )}

      {/* Sub-tab: Payslips */}
      {payrollSubTab === "payslips" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            {/* Filters */}
            <Select value={payslipFilterEmp || "all"} onValueChange={v => setPayslipFilterEmp(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44 h-10 rounded-xl text-sm" data-testid="payslip-filter-emp">
                <SelectValue placeholder="All Employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {[...new Map(payslips.map(p => [p.employee_id, p])).values()].map(p => (
                  <SelectItem key={p.employee_id} value={p.employee_id}>{p.employee_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={(payslipFilterMonth || "all").toString()} onValueChange={v => setPayslipFilterMonth(v === "all" ? 0 : parseInt(v))}>
              <SelectTrigger className="w-36 h-10 rounded-xl text-sm" data-testid="payslip-filter-month">
                <SelectValue placeholder="All Months" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                {months.map(m => <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="number" placeholder="Year" value={payslipFilterYear || ""} onChange={e => setPayslipFilterYear(parseInt(e.target.value) || 0)}
              className="w-24 h-10 rounded-xl text-sm" data-testid="payslip-filter-year" />
            {(payslipFilterEmp || payslipFilterMonth || payslipFilterYear) && (
              <Button size="sm" variant="ghost" className="h-10 rounded-xl text-slate-500" onClick={() => { setPayslipFilterEmp(""); setPayslipFilterMonth(0); setPayslipFilterYear(0); }}>
                Clear
              </Button>
            )}
            {canEdit && (
            <div className="ml-auto">
              <Dialog open={generatePayslipOpen} onOpenChange={setGeneratePayslipOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="generate-payslip-btn" className="bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2 rounded-xl h-10 px-4">
                    <Receipt className="h-4 w-4" weight="bold" />
                    Generate Payslip
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="font-['Outfit']">Generate Payslip</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-slate-500 -mt-2">Select employee and pay period to generate payslip.</p>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Employee</Label>
                      <Select
                        value={payslipForm.employee_id}
                        onValueChange={(value) => setPayslipForm({ ...payslipForm, employee_id: value })}
                      >
                        <SelectTrigger data-testid="payslip-employee-select" className="rounded-xl h-11">
                          <SelectValue placeholder="Select employee" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.filter(e => e.role !== "admin" && e.basic_salary > 0).map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.name} - ₹{emp.basic_salary?.toLocaleString()}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-slate-400">Only employees with salary set are shown</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-600">Month</Label>
                        <Select
                          value={payslipForm.month.toString()}
                          onValueChange={(value) => setPayslipForm({ ...payslipForm, month: parseInt(value) })}
                        >
                          <SelectTrigger data-testid="payslip-month-select" className="rounded-xl h-11">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {months.map((m) => (
                              <SelectItem key={m.value} value={m.value.toString()}>{m.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold text-slate-600">Year</Label>
                        <Input className="rounded-xl h-11"
                          data-testid="payslip-year-input"
                          type="number"
                          value={payslipForm.year}
                          onChange={(e) => setPayslipForm({ ...payslipForm, year: parseInt(e.target.value) })}
                        />
                      </div>
                    </div>
                    <Button
                      data-testid="submit-generate-payslip"
                      onClick={handleGeneratePayslip}
                      disabled={loading}
                      className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]"
                    >
                      Generate Payslip
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
            )}
          </div>

          <div className="section-card">
            <div className="section-header">
              <div>
                <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Payslips</h2>
                <p className="text-xs text-slate-500 mt-0.5">{payslips.length} generated</p>
              </div>
            </div>
            <div>
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Employee</th>
                  <th className="table-header">Pay Period</th>
                  <th className="table-header">Basic Salary</th>
                  <th className="table-header">Deductions</th>
                  <th className="table-header">Net Pay</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {payslips.filter(ps =>
                  (!payslipFilterEmp || ps.employee_id === payslipFilterEmp) &&
                  (!payslipFilterMonth || ps.month === payslipFilterMonth) &&
                  (!payslipFilterYear || ps.year === payslipFilterYear)
                ).length === 0 ? (
                  <tr>
                    <td colSpan="6">
                      <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                        <span className="stat-icon tone-blue"><Receipt className="h-5 w-5" weight="duotone" /></span>
                        <p className="text-sm font-semibold text-slate-900">No payslips {payslips.length > 0 ? "match filters" : "generated yet"}</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  payslips.filter(ps =>
                    (!payslipFilterEmp || ps.employee_id === payslipFilterEmp) &&
                    (!payslipFilterMonth || ps.month === payslipFilterMonth) &&
                    (!payslipFilterYear || ps.year === payslipFilterYear)
                  ).map((ps) => (
                    <tr key={ps.id} className="table-row">
                      <td className="table-cell">
                        <p className="font-semibold text-slate-900 text-sm">{ps.employee_name}</p>
                        <p className="text-xs text-slate-400">{ps.employee_email}</p>
                      </td>
                      <td className="table-cell font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>{ps.month_name} {ps.year}</td>
                      <td className="table-cell tabular-nums whitespace-nowrap">₹{ps.basic_salary?.toLocaleString()}</td>
                      <td className="table-cell tabular-nums whitespace-nowrap" style={{ color: "var(--badge-red-text)" }}>-₹{ps.total_deductions?.toLocaleString()}</td>
                      <td className="table-cell tabular-nums whitespace-nowrap font-bold" style={{ color: "var(--badge-green-text)" }}>₹{ps.net_pay?.toLocaleString()}</td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5">
                          <Button
                            data-testid={`download-payslip-${ps.id}`}
                            size="sm"
                            onClick={() => handleDownloadPayslip(ps.id)}
                            className="h-8 rounded-lg bg-[#0020F8] hover:bg-[#0019C4] text-white gap-1.5"
                          >
                            <DownloadSimple className="h-4 w-4" />
                            PDF
                          </Button>
                          {canEdit && (
                          <Button
                            data-testid={`email-payslip-${ps.id}`}
                            size="sm"
                            variant="outline"
                            onClick={() => handleEmailPayslip(ps.id, ps.employee_name)}
                            className="h-8 rounded-lg gap-1.5 text-slate-600 hover:border-[#0020F8] hover:text-[#0020F8]"
                            title="Email payslip to employee again"
                          >
                            <Bell className="h-3.5 w-3.5" />
                            Email
                          </Button>
                          )}
                          {canDelete && (
                          <Button
                            data-testid={`delete-payslip-${ps.id}`}
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeletePayslip(ps.id)}
                            title="Delete payslip"
                            className="h-8 w-8 p-0 rounded-lg text-slate-400 hover:text-[color:var(--badge-red-text)] hover:bg-[var(--badge-red-bg)]"
                          >
                            <Trash className="h-4 w-4" />
                          </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
