import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  TrendUp, TrendDown, Wallet, Plus, Paperclip, PencilSimple, TrashSimple, Tag, Receipt, FileXls
} from "@phosphor-icons/react";

const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const emptyForm = { entry_date: format(new Date(), "yyyy-MM-dd"), type: "expense", category: "", amount: "", description: "", receipt: null };

export function IncomeExpenseTab({ api }) {
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

  return (
    <div data-testid="finance-tab">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 font-['Outfit'] tracking-tight">Income & Expense</h1>
          <p className="text-slate-500 mt-1 text-sm">Track company income and expenses (Admin only)</p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            data-testid="finance-month-filter"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-40"
          />
          <Button data-testid="export-finance-excel-btn" variant="outline" onClick={handleExportExcel}>
            <FileXls className="h-4 w-4 mr-1.5" /> Export Excel
          </Button>
          <Button data-testid="add-finance-category-btn" variant="outline" onClick={() => setCategoryDialogOpen(true)}>
            <Tag className="h-4 w-4 mr-1.5" /> Category
          </Button>
          <Button data-testid="add-finance-entry-btn" onClick={openAddDialog} className="bg-[#002FA7] text-white hover:bg-[#001F70]">
            <Plus className="h-4 w-4 mr-1.5" /> Add Entry
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center justify-center w-8 h-8 bg-emerald-50 rounded-lg">
              <TrendUp className="h-4 w-4 text-emerald-600" weight="bold" />
            </div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Income</p>
          </div>
          <p data-testid="total-income-value" className="text-2xl font-bold text-emerald-600">{fmtMoney(summary.total_income)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center justify-center w-8 h-8 bg-red-50 rounded-lg">
              <TrendDown className="h-4 w-4 text-red-500" weight="bold" />
            </div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Expense</p>
          </div>
          <p data-testid="total-expense-value" className="text-2xl font-bold text-red-500">{fmtMoney(summary.total_expense)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex items-center justify-center w-8 h-8 bg-blue-50 rounded-lg">
              <Wallet className="h-4 w-4 text-[#002FA7]" weight="bold" />
            </div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Net Balance</p>
          </div>
          <p data-testid="net-balance-value" className={`text-2xl font-bold ${summary.net_balance >= 0 ? 'text-[#002FA7]' : 'text-red-500'}`}>{fmtMoney(summary.net_balance)}</p>
        </div>
      </div>

      {/* Entries Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Type</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Category</th>
              <th className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Description</th>
              <th className="text-right px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Amount</th>
              <th className="text-center px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Receipt</th>
              <th className="text-center px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-slate-400 text-sm">No entries for this month</td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.id} data-testid={`finance-entry-row-${entry.id}`} className="hover:bg-slate-50">
                <td className="px-5 py-3 text-slate-700">{format(new Date(entry.entry_date), "MMM d, yyyy")}</td>
                <td className="px-5 py-3">
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${entry.type === "income" ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-500"}`}>
                    {entry.type === "income" ? "Income" : "Expense"}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-700">{entry.category}</td>
                <td className="px-5 py-3 text-slate-500 max-w-[220px] truncate">{entry.description || "—"}</td>
                <td className={`px-5 py-3 text-right font-bold ${entry.type === "income" ? "text-emerald-600" : "text-red-500"}`}>
                  {entry.type === "income" ? "+" : "-"}{fmtMoney(entry.amount)}
                </td>
                <td className="px-5 py-3 text-center">
                  {entry.receipt_url ? (
                    <a
                      data-testid={`finance-receipt-link-${entry.id}`}
                      href={`${api.defaults.baseURL}${entry.receipt_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center justify-center text-[#002FA7] hover:opacity-70"
                    >
                      <Receipt className="h-4 w-4" weight="duotone" />
                    </a>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center justify-center gap-2">
                    <button data-testid={`edit-finance-entry-${entry.id}`} onClick={() => openEditDialog(entry)} className="text-slate-400 hover:text-[#002FA7]">
                      <PencilSimple className="h-4 w-4" />
                    </button>
                    <button data-testid={`delete-finance-entry-${entry.id}`} onClick={() => handleDelete(entry.id)} className="text-slate-400 hover:text-red-500">
                      <TrashSimple className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Entry Dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">{editingId ? "Edit Entry" : "Add Income / Expense Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v, category: "" })}>
                  <SelectTrigger data-testid="finance-type-select"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="income">Income</SelectItem>
                    <SelectItem value="expense">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input data-testid="finance-date-input" type="date" value={form.entry_date} onChange={(e) => setForm({ ...form, entry_date: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger data-testid="finance-category-select"><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {filteredCategories.map((c) => (
                    <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Amount (₹)</Label>
              <Input data-testid="finance-amount-input" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea data-testid="finance-description-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[70px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Receipt / Bill (optional)</Label>
              <Input data-testid="finance-receipt-input" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setForm({ ...form, receipt: e.target.files?.[0] || null })} />
            </div>
            <Button data-testid="save-finance-entry-btn" onClick={handleSubmit} disabled={loading} className="w-full bg-[#002FA7] text-white hover:bg-[#001F70]">
              {editingId ? "Save Changes" : "Add Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Category Dialog */}
      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-['Outfit']">Add Custom Category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input data-testid="new-category-name-input" value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} placeholder="e.g. Insurance" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={newCategory.type} onValueChange={(v) => setNewCategory({ ...newCategory, type: v })}>
                <SelectTrigger data-testid="new-category-type-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="income">Income</SelectItem>
                  <SelectItem value="expense">Expense</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button data-testid="save-new-category-btn" onClick={handleAddCategory} className="w-full bg-[#002FA7] text-white hover:bg-[#001F70]">
              Add Category
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
