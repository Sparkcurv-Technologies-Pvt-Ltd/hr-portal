import { useState } from "react";
import { toast } from "sonner";

// State + handlers for the admin "Edit Leave Balance" dialog (opened from the Employees table).
export function useLeaveBalanceEditor(api, fetchData, setLoading) {
  const [leaveBalanceOpen, setLeaveBalanceOpen] = useState(false);
  const [leaveBalanceForm, setLeaveBalanceForm] = useState({ casual_leave: null, sick_leave: null, loss_of_pay: 0, permission_hours: 2, wfh_limit: null });
  const [leaveBalanceEmp, setLeaveBalanceEmp] = useState(null);

  const openLeaveBalanceModal = (emp) => {
    setLeaveBalanceEmp(emp);
    setLeaveBalanceForm({
      casual_leave: emp.casual_leave ?? null,
      sick_leave: emp.sick_leave ?? null,
      loss_of_pay: emp.loss_of_pay ?? 0,
      permission_hours: emp.permission_hours ?? 2,
      wfh_limit: emp.wfh_limit ?? null
    });
    setLeaveBalanceOpen(true);
  };

  const handleSaveLeaveBalance = async () => {
    if (!leaveBalanceEmp) return;
    setLoading(true);
    try {
      await api.put(`/admin/employees/${leaveBalanceEmp.id}/leave-balance`, leaveBalanceForm);
      toast.success("Leave balance updated!");
      setLeaveBalanceOpen(false);
      fetchData();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update");
    } finally {
      setLoading(false);
    }
  };

  return {
    leaveBalanceOpen, setLeaveBalanceOpen, leaveBalanceForm, setLeaveBalanceForm, leaveBalanceEmp,
    openLeaveBalanceModal, handleSaveLeaveBalance,
  };
}
