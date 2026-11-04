import { useState, useEffect, useCallback, useRef } from "react";
import { canDo } from "@/lib/permissions";

// Loads everything the admin/manager dashboard displays and refreshes it every 60 seconds.
// `fetchData` is returned so tabs can refetch after a mutation.
// `locationDate` is the date picked on the attendance map, so refreshes keep showing that day.
export function useAdminDashboardData(api, user, locationDate) {
  // Read inside fetchData without making it a dependency (changing the date shouldn't refetch everything)
  const locationDateRef = useRef(locationDate);
  locationDateRef.current = locationDate;
  // Last office settings received, so the poll only resets the edit form when the server copy changes
  const lastOfficeSettingsRef = useRef(null);

  const [analytics, setAnalytics] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [managers, setManagers] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [permissionRequests, setPermissionRequests] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [payslips, setPayslips] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [wfhRequests, setWfhRequests] = useState([]);
  const [payrollSummary, setPayrollSummary] = useState(null);
  const [changeRequests, setChangeRequests] = useState([]);
  const [locationData, setLocationData] = useState([]);
  const [officeSettings, setOfficeSettings] = useState({ latitude: 8.1815, longitude: 77.4294, radius_km: 0.5, office_name: "Main Headquarters (Nagercoil)", address: "64/3, Thompson St, Palace Rd, Nagercoil, Tamil Nadu 629001", geofence_bypass: false });
  const [officeForm, setOfficeForm] = useState({ latitude: 8.1815, longitude: 77.4294, radius_km: 0.5, office_name: "Main Headquarters (Nagercoil)", address: "64/3, Thompson St, Palace Rd, Nagercoil, Tamil Nadu 629001", geofence_bypass: false });
  // Org chart
  const [orgNodes, setOrgNodes] = useState([]);
  const [orgLevels, setOrgLevels] = useState([]);

  // Role permissions

  // Salary components (configurable)
  const [salaryComponents, setSalaryComponents] = useState([]);
  const [componentsForm, setComponentsForm] = useState([]);

  const fetchData = useCallback(async () => {
    const can = (module) => canDo(user, module, "view");
    // Each request fails on its own: a failed request keeps the data already on screen (KEEP),
    // and a module the user isn't allowed to view gets its empty value without calling the API.
    const KEEP = Symbol("keep");
    const get = (url, empty, allowed = true) =>
      allowed ? api.get(url).then(r => r.data).catch(() => KEEP) : Promise.resolve(empty);
    const apply = (value, setter) => { if (value !== KEEP) setter(value); };
    try {
      const [
        analyticsData, employeesData, leaveData, attendanceData, permissionData, holidaysData,
        policiesData, wfhData, payrollSummaryData, crData, oSettings, locations, payslipsData,
      ] = await Promise.all([
        get("/admin/analytics", null),
        get("/admin/employees", []),
        get("/admin/leave-requests", [], can("leaves")),
        get("/admin/attendance", [], can("attendance")),
        get("/admin/permissions", [], can("permissions")),
        get("/holidays/list", []),
        get("/policy/list", []),
        get("/admin/wfh-requests", [], can("wfh")),
        get("/admin/payroll/summary", null, can("payroll")),
        get("/admin/change-requests", [], can("change-requests")),
        get("/admin/office-settings", { latitude: 8.1815, longitude: 77.4294, radius_km: 0.5, name: "Main Headquarters (Nagercoil)", address: "64/3, Thompson St, Palace Rd, Nagercoil, Tamil Nadu 629001" }, can("attendance")),
        get(`/admin/attendance/locations?date=${locationDateRef.current || new Date().toISOString().split("T")[0]}`, [], can("attendance")),
        get("/admin/payslips", null, can("payroll")),
      ]);
      apply(analyticsData, setAnalytics);
      apply(employeesData, setEmployees);
      apply(leaveData, setLeaveRequests);
      apply(attendanceData, setAttendance);
      apply(permissionData, setPermissionRequests);
      apply(holidaysData, setHolidays);
      apply(policiesData, setPolicies);
      apply(wfhData, setWfhRequests);
      apply(payrollSummaryData, setPayrollSummary);
      apply(crData, setChangeRequests);
      if (oSettings !== KEEP) {
        setOfficeSettings(oSettings);
        const oSettingsKey = JSON.stringify(oSettings);
        if (oSettingsKey !== lastOfficeSettingsRef.current) {
          lastOfficeSettingsRef.current = oSettingsKey;
          setOfficeForm({ latitude: oSettings.latitude, longitude: oSettings.longitude, radius_km: oSettings.radius_km, office_name: oSettings.name || "Main Headquarters (Nagercoil)", address: oSettings.address || "", geofence_bypass: oSettings.geofence_bypass || false });
        }
      }
      apply(locations, setLocationData);
      if (payslipsData && payslipsData !== KEEP) setPayslips(payslipsData);
      if (can("org-chart")) {
        api.get("/admin/org-chart").then(r => setOrgNodes(r.data)).catch(() => {});
        api.get("/org-levels").then(r => setOrgLevels(r.data || [])).catch(() => {});
      }
      if (can("payroll")) {
        api.get("/admin/salary-components").then(r => setSalaryComponents(r.data || [])).catch(() => {});
      }
      // Fetch managers list for reporting manager dropdown
      if (employeesData !== KEEP) {
        setManagers((employeesData || []).filter(e => ["manager", "admin"].includes(e.role)));
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }, [api, user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh all data every 60 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return {
    analytics, employees, setEmployees, managers, leaveRequests, permissionRequests, attendance,
    payslips, holidays, policies, wfhRequests, payrollSummary, changeRequests,
    locationData, setLocationData, officeSettings, setOfficeSettings, officeForm, setOfficeForm,
    orgNodes, setOrgNodes, orgLevels, setOrgLevels,
    salaryComponents, setSalaryComponents, componentsForm, setComponentsForm,
    fetchData,
  };
}
