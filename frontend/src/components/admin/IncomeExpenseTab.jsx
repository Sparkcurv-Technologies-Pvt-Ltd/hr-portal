import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  TrendUp, TrendDown, Wallet, Plus, Paperclip, PencilSimple, TrashSimple, Tag, Receipt, FileXls
} from "@phosphor-icons/react";
import { usePermissions } from "@/hooks/usePermissions";

const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const emptyForm = { entry_date: format(new Date(), "yyyy-MM-dd"), type: "expense", category: "", amount: "", description: "", receipt: null };

export function IncomeExpenseTab({ api }) {
  const { can } = usePermissions();
  const canEdit = can("finance", "edit");
  const canDelete = can("finance", "delete");
  const showActions = canEdit || canDelete;
  const [month, setMonth] = useState(format(new Date(), "yyyy-MM"));
  const [entries, setEntries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [summary, setSummary] = useState({ total_income: 0, total_expense: 0, net_balance: 0 });
  const [loading, setLoading] = useState(false);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: "", type: "expense" });

  const fetchAll = useCallback(async () => {
    try {
      const [catRes, entriesRes, summaryRes] = await Promise.all([
        api.get("/finance/categories"),
        api.get(`/finance/entries?month=${month}`),
        api.get(`/finance/summary?month=${month}`)
      ]);
      setCategories(catRes.data || []);
      setEntries(entriesRes.data || []);
      setSummary(summaryRes.data || { total_income: 0, total_expense: 0, net_balance: 0 });
    } catch (error) {
      toast.error("Failed to load finance data");
    }
  }, [api, month]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openAddDialog = () => {
    setEditingId(null);
    setForm(emptyForm);
    setEntryDialogOpen(true);
  };

  const openEditDialog = (entry) => {
    setEditingId(entry.id);
    setForm({ entry_date: entry.entry_date, type: entry.type, category: entry.category, amount: String(entry.amount), description: entry.description || "", receipt: null });
    setEntryDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.entry_date || !form.category || !form.amount) {
      toast.error("Date, category and amount are required");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("entry_date", form.entry_date);
      fd.append("type", form.type);
      fd.append("category", form.category);
      fd.append("amount", form.amount);
      fd.append("description", form.description || "");
      if (form.receipt) fd.append("receipt", form.receipt);

      if (editingId) {
        await api.put(`/finance/entries/${editingId}`, fd);
        toast.success("Entry updated");
      } else {
        await api.post("/finance/entries", fd);
        toast.success("Entry added");
      }
      setEntryDialogOpen(false);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to save entry");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this entry?")) return;
    try {
      await api.delete(`/finance/entries/${id}`);
      toast.success("Entry deleted");
      fetchAll();
    } catch (error) {
      toast.error("Failed to delete entry");
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.name.trim()) {
      toast.error("Category name is required");
      return;
    }
    try {
      await api.post("/finance/categories", newCategory);
      toast.success("Category added");
      setNewCategory({ name: "", type: "expense" });
      setCategoryDialogOpen(false);
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to add category");
    }
  };

  const filteredCategories = categories.filter((c) => c.type === form.type);
  const incomeCount = entries.filter((e) => e.type === "income").length;
  const expenseCount = entries.length - incomeCount;
  const monthLabel = month ? format(new Date(`${month}-01T00:00:00`), "MMMM yyyy") : "";

  const handleExportExcel = async () => {
    try {
      const response = await api.get(`/finance/export?month=${month}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `income_expense_${month}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Excel sheet downloaded!");
    } catch (error) {
      toast.error("Failed to export Excel sheet");
    }
  };

  const tableHead = "table-header";

  return (
    <div data-testid="finance-tab">
      <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Income &amp; Expense</h1>
          <p className="text-slate-500 mt-1 text-sm">Track company income and expenses (Admin only)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            data-testid="finance-month-filter"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40 h-10 rounded-xl"
          />
          <Button data-testid="export-finance-excel-btn" variant="outline" onClick={handleExportExcel} className="h-10 rounded-xl">
            <FileXls className="h-4 w-4 mr-1.5" /> Export Excel
          </Button>
          {canEdit && (
            <>
              <Button data-testid="add-finance-category-btn" variant="outline" onClick={() => setCategoryDialogOpen(true)} className="h-10 rounded-xl">
                <Tag className="h-4 w-4 mr-1.5" /> Category
              </Button>
              <Button data-testid="add-finance-entry-btn" onClick={openAddDialog} className="h-10 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]">
                <Plus className="h-4 w-4 mr-1.5" weight="bold" /> Add Entry
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5 mb-6">
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Income</span>
            <span className="stat-icon tone-green"><TrendUp className="h-5 w-5" weight="bold" /></span>
          </div>
          <div>
            <p data-testid="total-income-value" className="stat-value">{fmtMoney(summary.total_income)}</p>
            <p className="stat-sub mt-1">{incomeCount} income entr{incomeCount === 1 ? "y" : "ies"}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Total Expense</span>
            <span className="stat-icon tone-red"><TrendDown className="h-5 w-5" weight="bold" /></span>
          </div>
          <div>
            <p data-testid="total-expense-value" className="stat-value">{fmtMoney(summary.total_expense)}</p>
            <p className="stat-sub mt-1">{expenseCount} expense entr{expenseCount === 1 ? "y" : "ies"}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-top">
            <span className="stat-label">Net Balance</span>
            <span className={`stat-icon ${summary.net_balance >= 0 ? "tone-blue" : "tone-red"}`}><Wallet className="h-5 w-5" weight="bold" /></span>
          </div>
          <div>
            <p data-testid="net-balance-value" className="stat-value" style={summary.net_balance < 0 ? { color: "var(--badge-red-text)" } : undefined}>{fmtMoney(summary.net_balance)}</p>
            <p className="stat-sub mt-1">{summary.net_balance >= 0 ? "Surplus" : "Deficit"} for {monthLabel}</p>
          </div>
        </div>
      </div>

      {/* Entries Table */}
      <div className="section-card">
        <div className="section-header">
          <div>
            <h2 className="text-base font-bold font-['Outfit'] text-slate-900">Entries</h2>
            <p className="text-xs text-slate-500 mt-0.5">{monthLabel} · {entries.length} entr{entries.length === 1 ? "y" : "ies"}</p>
          </div>
        </div>
        <div>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={tableHead}>Date</th>
              <th className={tableHead}>Type</th>
              <th className={tableHead}>Category</th>
              <th className={tableHead}>Description</th>
              <th className={tableHead} style={{ textAlign: "right" }}>Amount</th>
              <th className={tableHead} style={{ textAlign: "center" }}>Receipt</th>
              {showActions && <th className={tableHead} style={{ textAlign: "right" }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td colSpan={showActions ? 7 : 6}>
                  <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                    <span className="stat-icon tone-blue"><Receipt className="h-5 w-5" weight="duotone" /></span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">No entries for this month</p>
                      <p className="text-xs text-slate-500 mt-1">{canEdit ? "Use Add Entry to record income or an expense." : "Entries added for this month will show up here."}</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : entries.map((entry) => (
              <tr key={entry.id} data-testid={`finance-entry-row-${entry.id}`} className="table-row">
                <td className="table-cell whitespace-nowrap font-medium" style={{ color: "var(--text-secondary)" }}>{format(new Date(entry.entry_date), "MMM d, yyyy")}</td>
                <td className="table-cell">
                  <span className={entry.type === "income" ? "badge-approved" : "badge-rejected"}>
                    {entry.type === "income" ? "Income" : "Expense"}
                  </span>
                </td>
                <td className="table-cell"><span className="chip">{entry.category}</span></td>
                <td className="table-cell max-w-[220px] truncate" style={{ color: "var(--text-muted)" }}>{entry.description || "—"}</td>
                <td className="table-cell text-right font-bold whitespace-nowrap tabular-nums" style={{ color: entry.type === "income" ? "var(--badge-green-text)" : "var(--badge-red-text)" }}>
                  {entry.type === "income" ? "+" : "-"}{fmtMoney(entry.amount)}
                </td>
                <td className="table-cell text-center">
                  {entry.receipt_url ? (
                    <a
                      data-testid={`finance-receipt-link-${entry.id}`}
                      href={`${api.defaults.baseURL}${entry.receipt_url}`}
                      target="_blank"
                      rel="noreferrer"
                      title="View receipt"
                      className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-[#0020F8] hover:bg-[var(--brand-primary-light)]"
                    >
                      <Receipt className="h-4 w-4" weight="duotone" />
                    </a>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                {showActions && (
                <td className="table-cell">
                  <div className="flex items-center justify-end gap-1">
                    {canEdit && (
                    <button data-testid={`edit-finance-entry-${entry.id}`} onClick={() => openEditDialog(entry)} title="Edit entry" className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:text-[#0020F8] hover:bg-[var(--brand-primary-light)] transition-colors">
                      <PencilSimple className="h-4 w-4" />
                    </button>
                    )}
                    {canDelete && (
                    <button data-testid={`delete-finance-entry-${entry.id}`} onClick={() => handleDelete(entry.id)} title="Delete entry" className="inline-flex items-center justify-center h-8 w-8 rounded-lg text-slate-400 hover:text-[color:var(--badge-red-text)] hover:bg-[var(--badge-red-bg)] transition-colors">
                      <TrashSimple className="h-4 w-4" />
                    </button>
                    )}
                  </div>
                </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {/* Add/Edit Entry Dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">{editingId ? "Edit Entry" : "Add Income / Expense Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, category: "" })}>
                  <SelectTrigger data-testid="finance-type-select" className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-600">Date</Label>
                <Input data-testid="finance-date-input" className="rounded-xl h-11" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="finance-category-select" className="rounded-xl h-11"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {filteredCategories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Amount (₹)</Label>
              <Input data-testid="finance-amount-input" className="rounded-xl h-11" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Description</Label>
              <Textarea data-testid="finance-description-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[80px] rounded-xl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Receipt / Bill (optional)</Label>
              <Input data-testid="finance-receipt-input" className="rounded-xl h-11 pt-2.5" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setForm({ ...form, receipt: e.target.files?.[0] || null })} />
            </div>
            <Button data-testid="save-finance-entry-btn" onClick={handleSubmit} disabled={loading} className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]">
              {editingId ? "Save Changes" : "Add Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Add Custom Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Name</Label>
              <Input data-testid="new-category-name-input" className="rounded-xl h-11" value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} placeholder="e.g. Insurance" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-slate-600">Type</Label>
              <Select value={newCategory.type} onValueChange={(v) => setNewCategory({ ...newCategory, type: v })}>
                <SelectTrigger data-testid="new-category-type-select" className="rounded-xl h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="save-new-category-btn" onClick={handleAddCategory} className="w-full h-11 rounded-xl bg-[#0020F8] text-white hover:bg-[#0019C4]">
              Add Category
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
