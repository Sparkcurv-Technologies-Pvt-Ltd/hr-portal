import { useState, useEffect, useCallback } from "react";

// Loads everything the employee dashboard displays and refreshes it every 60 seconds.
// `fetchData` is returned so tabs can refetch after a mutation.
export function useEmployeeDashboardData(api) {
  const [orgNodes, setOrgNodes] = useState([]);
  const [orgLevels, setOrgLevels] = useState([]);
  const [leaveBalance, setLeaveBalance] = useState({ casual: 0, sick: 0, loss_of_pay: 0 });
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [permissionBalance, setPermissionBalance] = useState({ remaining_minutes: 120, used_minutes: 0 });
  const [permissionRequests, setPermissionRequests] = useState([]);
  const [workingSummary, setWorkingSummary] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [wfhBalance, setWfhBalance] = useState({ limit: null, used: 0, remaining: null });
  const [wfhRequests, setWfhRequests] = useState([]);
  const [monthlyLeaveUsage, setMonthlyLeaveUsage] = useState({ monthly_limit: 1.5, used: 0, remaining: 1.5 });
  const [salaryStructure, setSalaryStructure] = useState(null);
  const [myCRs, setMyCRs] = useState([]);
  const [crTypes, setCrTypes] = useState([]);
  const [myManager, setMyManager] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const [balanceRes, requestsRes, historyRes, permBalRes, permReqRes, summaryRes, payslipsRes, holidaysRes, policiesRes, wfhBalRes, wfhReqRes, monthlyUsageRes, salaryRes, crRes, crTypesRes] = await Promise.all([
        api.get("/leave/balance"),
        api.get("/leave/my-requests"),
        api.get("/attendance/history"),
        api.get("/permission/balance"),
        api.get("/permission/my-requests"),
        api.get("/attendance/working-hours-summary"),
        api.get("/payslip/my-payslips"),
        api.get("/holidays/list"),
        api.get("/policy/list"),
        api.get("/wfh/balance"),
        api.get("/wfh/my-requests"),
        api.get("/leave/monthly-usage"),
        api.get("/payslip/my-salary-structure"),
        api.get("/cr/my-requests"),
        api.get("/cr/types")
      ]);
      setLeaveBalance(balanceRes.data);
      setLeaveRequests(requestsRes.data);
      setAttendanceHistory(historyRes.data);
      setPermissionBalance(permBalRes.data);
      setPermissionRequests(permReqRes.data);
      setWorkingSummary(summaryRes.data);
      setPayslips(payslipsRes.data);
      setHolidays(holidaysRes.data);
      setPolicies(policiesRes.data);
      setWfhBalance(wfhBalRes.data);
      setWfhRequests(wfhReqRes.data);
      setMonthlyLeaveUsage(monthlyUsageRes.data);
      setSalaryStructure(salaryRes.data);
      setMyCRs(crRes.data);
      setCrTypes(crTypesRes.data);
      // Fetch org chart & levels (non-critical)
      api.get("/admin/org-chart").then(r => setOrgNodes(r.data || [])).catch(() => {});
      api.get("/org-levels").then(r => setOrgLevels(r.data || [])).catch(() => {});
      // Fetch reporting manager for CR submission (CRs are always routed to them)
      api.get("/cr/my-manager").then(r => setMyManager(r.data || { has_manager: false })).catch(() => {});
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]);

  // Auto-refresh all data every 60 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    orgNodes, orgLevels, leaveBalance, leaveRequests, attendanceHistory,
    permissionBalance, permissionRequests, workingSummary, payslips, holidays, policies,
    wfhBalance, wfhRequests, monthlyLeaveUsage, salaryStructure, myCRs, crTypes, myManager,
    fetchData,
  };
}
