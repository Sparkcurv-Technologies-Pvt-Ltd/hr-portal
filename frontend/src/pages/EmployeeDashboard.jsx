import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Calendar } from "../components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { toast } from "sonner";
import { format } from "date-fns";
import { 
  SignOut, Clock, Coffee, CalendarBlank, TreePalm, Heartbeat, 
  Briefcase, House, ClockCounterClockwise, CalendarCheck,
  CaretDown, Hourglass, Warning, Timer, ChartBar, Receipt, DownloadSimple,
  CalendarStar, CurrencyCircleDollar, Scroll, Laptop, Trash, CurrencyDollar,
  GitPullRequest, Plus, Sun, Moon, TreeStructure, MapPin, WifiNone,
  PlayCircle, StopCircle, CheckCircle
} from "@phosphor-icons/react";
import { OrgTreeView } from "../components/OrgTreeNode";

// Convert decimal hours (e.g., 8.57) to "Xh Ym" format
const formatHours = (decimalHours) => {
  if (!decimalHours) return "—";
  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);
  return `${hours}h ${minutes}m`;
};

const API_BASE = process.env.REACT_APP_BACKEND_URL || "";
const getAvatarUrl = (url) => {
  if (!url || url === "") return null;
  if (url.startsWith("http")) return url;
  return `${API_BASE}${url}`;
};

const getInitials = (name) => {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
};

const Avatar = ({ url, name, size = "h-10 w-10", textSize = "text-sm" }) => {
  const src = getAvatarUrl(url);
  if (src) {
    return <img src={src} alt={name} className={`${size} rounded-full object-cover`} />;
  }
  return (
    <div className={`${size} rounded-full bg-[#002FA7] text-white flex items-center justify-center font-bold ${textSize}`}>
      {getInitials(name)}
    </div>
  );
};

export default function EmployeeDashboard() {
  const { user, logout, api } = useAuth();
  const { dark, toggle: toggleTheme } = useTheme();
  const [rolePermissions, setRolePermissions] = useState({});
  const [orgNodes, setOrgNodes] = useState([]);
  const [orgLevels, setOrgLevels] = useState([]);
  const [attendanceStatus, setAttendanceStatus] = useState({ clocked_in: false, on_break: false, attendance: null });
  const [leaveBalance, setLeaveBalance] = useState({ casual: 0, sick: 0, loss_of_pay: 0 });
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [attendanceHistory, setAttendanceHistory] = useState([]);
  const [permissionBalance, setPermissionBalance] = useState({ remaining_minutes: 120, used_minutes: 0 });
  const [permissionRequests, setPermissionRequests] = useState([]);
  const [workingSummary, setWorkingSummary] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [myShift, setMyShift] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [wfhBalance, setWfhBalance] = useState({ limit: null, used: 0, remaining: null });
  const [wfhRequests, setWfhRequests] = useState([]);
  const [wfhDialogOpen, setWfhDialogOpen] = useState(false);
  const [wfhForm, setWfhForm] = useState({ date: null, reason: "" });
  const [monthlyLeaveUsage, setMonthlyLeaveUsage] = useState({ monthly_limit: 1.5, used: 0, remaining: 1.5 });
  const [salaryStructure, setSalaryStructure] = useState(null);
  const [myCRs, setMyCRs] = useState([]);
  const [crDialogOpen, setCrDialogOpen] = useState(false);
  const [crForm, setCrForm] = useState({ title: "", description: "", cr_type: "General", priority: "medium", requested_value: "", manager_id: "" });
  const [crTypes, setCrTypes] = useState([]);
  const [crManagers, setCrManagers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [breakElapsedTime, setBreakElapsedTime] = useState(0);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [gpsStatus, setGpsStatus] = useState(null); // null | { within: bool, distance_km, office_name, your_lat, your_lng, geofence_bypass, has_wfh_today }
  const [timerStatus, setTimerStatus] = useState({ is_running: false, total_seconds: 0, live_seconds: 0, sessions: [], target_seconds: 28800 });
  const [liveElapsed, setLiveElapsed] = useState(0);
  const timerIntervalRef = useRef(null);

  const [leaveForm, setLeaveForm] = useState({
    leave_type: "casual",
    start_date: null,
    end_date: null,
    reason: "",
    is_half_day: false
  });

  const [permissionForm, setPermissionForm] = useState({
    duration_minutes: 60,
    reason: "",
    date: format(new Date(), "yyyy-MM-dd")
  });

  const fetchData = useCallback(async () => {
    try {
      const [statusRes, balanceRes, requestsRes, historyRes, permBalRes, permReqRes, summaryRes, payslipsRes, shiftRes, holidaysRes, policiesRes, wfhBalRes, wfhReqRes, monthlyUsageRes, salaryRes, crRes, crTypesRes, rolePermRes] = await Promise.all([
        api.get("/attendance/status"),
        api.get("/leave/balance"),
        api.get("/leave/my-requests"),
        api.get("/attendance/history"),
        api.get("/permission/balance"),
        api.get("/permission/my-requests"),
        api.get("/attendance/working-hours-summary"),
        api.get("/payslip/my-payslips"),
        api.get("/attendance/my-shift"),
        api.get("/holidays/list"),
        api.get("/policy/list"),
        api.get("/wfh/balance"),
        api.get("/wfh/my-requests"),
        api.get("/leave/monthly-usage"),
        api.get("/payslip/my-salary-structure"),
        api.get("/cr/my-requests"),
        api.get("/cr/types"),
        api.get("/my-permissions").catch(() => ({ data: { permissions: {} } }))
      ]);
      setAttendanceStatus(statusRes.data);
      setLeaveBalance(balanceRes.data);
      setLeaveRequests(requestsRes.data);
      setAttendanceHistory(historyRes.data);
      setPermissionBalance(permBalRes.data);
      setPermissionRequests(permReqRes.data);
      setWorkingSummary(summaryRes.data);
      setPayslips(payslipsRes.data);
      setMyShift(shiftRes.data);
      setHolidays(holidaysRes.data);
      setPolicies(policiesRes.data);
      setWfhBalance(wfhBalRes.data);
      setWfhRequests(wfhReqRes.data);
      setMonthlyLeaveUsage(monthlyUsageRes.data);
      setSalaryStructure(salaryRes.data);
      setMyCRs(crRes.data);
      setCrTypes(crTypesRes.data);
      setRolePermissions(rolePermRes.data?.permissions || {});
      // Fetch org chart & levels (non-critical)
      api.get("/admin/org-chart").then(r => setOrgNodes(r.data || [])).catch(() => {});
      api.get("/org-levels").then(r => setOrgLevels(r.data || [])).catch(() => {});
      // Fetch managers list for CR submission
      api.get("/cr/managers").then(r => setCrManagers(r.data || [])).catch(() => {});
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
    // Auto check GPS status when dashboard loads (skip if GPS tracking disabled for this employee)
    if (!attendanceStatus.clocked_in && user?.gps_tracking_enabled !== false) {
      checkGPSStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchData]);

  // Auto-refresh all data every 60 seconds
  useEffect(() => {
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Live interval: tick every second when timer is running
  useEffect(() => {
    if (timerStatus.is_running) {
      timerIntervalRef.current = setInterval(() => {
        setLiveElapsed(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(timerIntervalRef.current);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [timerStatus.is_running]);

  // Timer for work duration
  useEffect(() => {
    let interval;
    if (attendanceStatus.clocked_in && attendanceStatus.attendance?.clock_in && !attendanceStatus.on_break) {
      interval = setInterval(() => {
        const clockIn = new Date(attendanceStatus.attendance.clock_in);
        const breakMinutes = attendanceStatus.attendance?.total_break_minutes || 0;
        const elapsed = Math.floor((Date.now() - clockIn.getTime()) / 1000) - (breakMinutes * 60);
        setElapsedTime(Math.max(0, elapsed));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [attendanceStatus]);

  // Timer for break duration
  useEffect(() => {
    let interval;
    if (attendanceStatus.on_break && attendanceStatus.attendance?.breaks) {
      const currentBreak = attendanceStatus.attendance.breaks.find(b => !b.end);
      if (currentBreak) {
        interval = setInterval(() => {
          const breakStart = new Date(currentBreak.start);
          const elapsed = Math.floor((Date.now() - breakStart.getTime()) / 1000);
          setBreakElapsedTime(elapsed);
        }, 1000);
      }
    } else {
      setBreakElapsedTime(0);
    }
    return () => clearInterval(interval);
  }, [attendanceStatus]);

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getLocation = () => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation is not supported by your browser"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
        (err) => {
          if (err.code === 1) reject(new Error("Location permission denied. Please enable GPS to continue."));
          else if (err.code === 2) reject(new Error("Location unavailable. Please check your GPS settings."));
          else reject(new Error("Location request timed out. Please try again."));
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  };

  const checkGPSStatus = async () => {
    try {
      const loc = await getLocation();
      const res = await api.post("/attendance/check-location", loc);
      setGpsStatus({ within: res.data.within_geofence, distance_km: res.data.distance_km, office_name: res.data.office_name, your_lat: res.data.your_lat, your_lng: res.data.your_lng, geofence_bypass: res.data.geofence_bypass, has_wfh_today: res.data.has_wfh_today, radius_km: res.data.radius_km });
    } catch {
      setGpsStatus(null);
    }
  };

  const fetchTimerStatus = useCallback(async () => {
    try {
      const res = await api.get("/attendance/timer/today");
      const data = res.data;
      setTimerStatus(data);
      if (data.is_running) {
        setLiveElapsed(data.live_seconds || 0);
      }
    } catch {
      // Timer endpoint not available or access not granted - ignore silently
    }
  }, [api]);

  const handleTimerStart = async () => {
    try {
      await api.post("/attendance/timer/start");
      await fetchTimerStatus();
      toast.success("Timer started");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to start timer");
    }
  };

  const handleTimerStop = async () => {
    try {
      await api.post("/attendance/timer/stop");
      await fetchTimerStatus();
      toast.success("Timer stopped");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to stop timer");
    }
  };

  const handleClockIn = async () => {
    setLoading(true);
    try {
      let location = null;
      // gps_tracking_enabled: true = ON (default), false = OFF (disabled by admin)
      const gpsDisabled = user?.gps_tracking_enabled === false;
      if (!gpsDisabled) {
        try {
          location = await getLocation();
        } catch (gpsErr) {
          if (!attendanceStatus.has_wfh_today) throw gpsErr;
        }
      }
      await api.post("/attendance/clock-in", location || {});
      toast.success(gpsDisabled ? "Clocked in (GPS tracking off)" : attendanceStatus.has_wfh_today ? "Clocked in (WFH)" : "Clocked in successfully!");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to clock in");
    } finally {
      setLoading(false);
    }
  };

  const handleClockOut = async () => {
    setLoading(true);
    try {
      let location = null;
      const gpsDisabled = user?.gps_tracking_enabled === false;
      if (!gpsDisabled) {
        try {
          location = await getLocation();
        } catch (gpsErr) {
          if (!attendanceStatus.has_wfh_today) throw gpsErr;
        }
      }
      const response = await api.post("/attendance/clock-out", location || {});
      const workingHours = response.data?.working_hours || 0;
      if (workingHours < 8) {
        toast.warning(`Clocked out with ${formatHours(workingHours)} (less than 8h required)`);
      } else {
        toast.success("Clocked out successfully!");
      }
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to clock out");
    } finally {
      setLoading(false);
    }
  };

  const handleStartBreak = async () => {
    setLoading(true);
    try {
      const gpsDisabled = user?.gps_tracking_enabled === false;
      let location = null;
      if (!gpsDisabled) {
        location = await getLocation();
      }
      await api.post("/attendance/break/start", location || {});
      toast.success("Break started!");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to start break");
    } finally {
      setLoading(false);
    }
  };

  const handleEndBreak = async () => {
    setLoading(true);
    try {
      const gpsDisabled = user?.gps_tracking_enabled === false;
      let location = null;
      if (!gpsDisabled) {
        location = await getLocation();
      }
      await api.post("/attendance/break/end", location || {});
      toast.success("Break ended!");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to end break");
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveRequest = async () => {
    if (!leaveForm.start_date || !leaveForm.reason) {
      toast.error("Please fill in all fields");
      return;
    }
    if (!leaveForm.is_half_day && !leaveForm.end_date) {
      toast.error("Please select an end date");
      return;
    }

    setLoading(true);
    try {
      await api.post("/leave/request", {
        leave_type: leaveForm.leave_type,
        start_date: format(leaveForm.start_date, "yyyy-MM-dd"),
        end_date: format(leaveForm.is_half_day ? leaveForm.start_date : leaveForm.end_date, "yyyy-MM-dd"),
        reason: leaveForm.reason,
        is_half_day: leaveForm.is_half_day
      });
      toast.success("Leave request submitted!");
      setLeaveDialogOpen(false);
      setLeaveForm({ leave_type: "casual", start_date: null, end_date: null, reason: "", is_half_day: false });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit leave request");
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionRequest = async () => {
    if (!permissionForm.reason || !permissionForm.date) {
      toast.error("Please fill in all fields");
      return;
    }

    setLoading(true);
    try {
      await api.post("/permission/request", permissionForm);
      toast.success("Permission request submitted!");
      setPermissionDialogOpen(false);
      setPermissionForm({ duration_minutes: 60, reason: "", date: format(new Date(), "yyyy-MM-dd") });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit permission request");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelLeave = async (leaveId) => {
    try {
      await api.delete(`/leave/${leaveId}`);
      toast.success("Leave request cancelled");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to cancel leave request");
    }
  };

  const handleCancelPermission = async (permissionId) => {
    try {
      await api.delete(`/permission/${permissionId}`);
      toast.success("Permission request cancelled");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to cancel permission request");
    }
  };

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

  const handleDownloadPayslip = async (payslipId) => {
    try {
      const response = await api.get(`/payslip/download/${payslipId}`, {
        responseType: 'blob'
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `payslip_${payslipId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Payslip downloaded!");
    } catch (error) {
      toast.error("Failed to download payslip");
    }
  };

  const CR_AUTO_APPLY_TYPES = ["Salary Revision", "Leave Adjustment", "Shift Change"];

  const handleSubmitCR = async () => {
    if (!crForm.title || !crForm.description) {
      toast.error("Title and description are required");
      return;
    }
    if (!crForm.manager_id) {
      toast.error("Please select a reporting manager");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        title: crForm.title,
        description: crForm.description,
        cr_type: crForm.cr_type,
        priority: crForm.priority,
        assigned_manager_id: parseInt(crForm.manager_id),
        metadata: crForm.requested_value ? { requested_value: crForm.requested_value } : null
      };
      const res = await api.post("/cr/create", payload);
      toast.success(`Change request ${res.data.cr_number} submitted!`);
      setCrDialogOpen(false);
      setCrForm({ title: "", description: "", cr_type: "General", priority: "medium", requested_value: "", manager_id: "" });
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to submit CR");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCR = async (crId) => {
    try {
      await api.delete(`/cr/${crId}`);
      toast.success("CR deleted");
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to delete CR");
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case "approved":
        return <span className="badge-approved">Approved</span>;
      case "rejected":
        return <span className="badge-rejected">Rejected</span>;
      default:
        return <span className="badge-pending">Pending</span>;
    }
  };

  // Calculate current working hours
  const currentWorkingHours = elapsedTime / 3600;
  const isShortDay = currentWorkingHours < 8 && attendanceStatus.clocked_in;

  // Role-based tab visibility: if no permissions set, show all; if set and key=false, hide
  const canView = (key) => {
    if (Object.keys(rolePermissions).length === 0) return true;
    if (rolePermissions[key] === undefined) return true;
    return rolePermissions[key] === true;
  };

  return (
    <div className="min-h-screen transition-colors duration-200" style={{ background: 'var(--bg-page)' }}>
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 w-64 h-screen flex flex-col transition-colors duration-200" style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--sidebar-border)', boxShadow: '4px 0 24px rgba(15,23,42,0.04)' }}>
        {/* Logo */}
        <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3">
            <img
              src="/sparkcurv-logo.png"
              alt="Sparkcurv"
              style={{ width: 38, height: 38, objectFit: 'contain', flexShrink: 0 }}
            />
            <span className="text-xl font-bold text-slate-900 font-['Outfit']">Sparkcurv</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <button
            onClick={() => setActiveTab("dashboard")}
            className={activeTab === "dashboard" ? "nav-item-active w-full" : "nav-item w-full"}
          >
            <House style={{ width: 18, height: 18 }} weight="duotone" />
            <span>Dashboard</span>
          </button>
          {canView("payslips") && (
            <button
              onClick={() => setActiveTab("payslips")}
              className={activeTab === "payslips" ? "nav-item-active w-full" : "nav-item w-full"}
            >
              <Receipt style={{ width: 18, height: 18 }} weight="duotone" />
              <span>Payslips</span>
            </button>
          )}
          {canView("salary") && (
            <button
              data-testid="salary-tab"
              onClick={() => setActiveTab("salary")}
              className={activeTab === "salary" ? "nav-item-active w-full" : "nav-item w-full"}
            >
              <CurrencyDollar style={{ width: 18, height: 18 }} weight="duotone" />
              <span>My Salary</span>
            </button>
          )}
          {canView("change-requests") && (
            <button
              data-testid="cr-tab"
              onClick={() => setActiveTab("change-requests")}
              className={activeTab === "change-requests" ? "nav-item-active w-full" : "nav-item w-full"}
            >
              <GitPullRequest style={{ width: 18, height: 18 }} weight="duotone" />
              <span>Change Requests</span>
            </button>
          )}
          {canView("summary") && (
            <button
              onClick={() => setActiveTab("summary")}
              className={activeTab === "summary" ? "nav-item-active w-full" : "nav-item w-full"}
            >
              <ChartBar style={{ width: 18, height: 18 }} weight="duotone" />
              <span>Work Summary</span>
            </button>
          )}
          {canView("wfh") && (
            <button
              data-testid="wfh-tab"
              onClick={() => setActiveTab("wfh")}
              className={activeTab === "wfh" ? "nav-item-active w-full" : "nav-item w-full"}
            >
              <Laptop style={{ width: 18, height: 18 }} weight="duotone" />
              <span>Work From Home</span>
            </button>
          )}
          {canView("holidays") && (
            <button
              data-testid="holidays-tab"
              onClick={() => setActiveTab("holidays")}
              className={activeTab === "holidays" ? "nav-item-active w-full" : "nav-item w-full"}
            >
              <CalendarStar style={{ width: 18, height: 18 }} weight="duotone" />
              <span>Holidays</span>
            </button>
          )}
          {canView("policy") && (
            <button
              data-testid="policy-tab"
              onClick={() => setActiveTab("policy")}
              className={activeTab === "policy" ? "nav-item-active w-full" : "nav-item w-full"}
            >
              <Scroll style={{ width: 18, height: 18 }} weight="duotone" />
              <span>Company Policy</span>
            </button>
          )}
          <button
            data-testid="org-tree-tab"
            onClick={() => setActiveTab("org-tree")}
            className={activeTab === "org-tree" ? "nav-item-active w-full" : "nav-item w-full"}
          >
            <TreeStructure style={{ width: 18, height: 18 }} weight="duotone" />
            <span>Worker Tree</span>
          </button>
        </nav>

        {/* User Info */}
        <div className="p-4" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3 mb-3 px-1">
            <Avatar url={user?.avatar_url} name={user?.name} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{user?.name}</p>
              <p className="text-xs text-slate-400 truncate">{user?.department}</p>
              {user?.employee_code && (
                <p className="text-[10px] font-mono font-bold text-[#002FA7] truncate tracking-wide">{user.employee_code}</p>
              )}
            </div>
            {/* Theme Toggle */}
            <button
              data-testid="theme-toggle-emp"
              onClick={toggleTheme}
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="flex items-center justify-center w-8 h-8 rounded-lg transition-all flex-shrink-0"
              style={{
                background: dark ? 'rgba(79,121,232,0.15)' : '#F1F5F9',
                color: dark ? '#93C5FD' : '#64748B'
              }}
            >
              {dark
                ? <Sun style={{ width: 15, height: 15 }} weight="fill" />
                : <Moon style={{ width: 15, height: 15 }} weight="duotone" />
              }
            </button>
          </div>
          <Button
            data-testid="logout-btn"
            onClick={logout}
            variant="outline"
            className="w-full justify-start gap-2 text-slate-500 hover:text-slate-900 border-slate-200 hover:bg-slate-50 rounded-xl text-sm font-medium h-9"
          >
            <SignOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 p-8">
        {activeTab === "dashboard" && (
          <>
            {/* Header */}
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-slate-900 font-['Outfit'] tracking-tight">
                Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening'}, {user?.name?.split(' ')[0]}
              </h1>
              <p className="text-slate-500 mt-1 text-sm">{format(new Date(), "EEEE, MMMM d, yyyy")}</p>
            </div>

            {/* Working Hours Alert */}
            {workingSummary && workingSummary.short_days_count > 0 && (
              <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                <div className="flex items-center justify-center w-8 h-8 bg-amber-100 rounded-lg flex-shrink-0">
                  <Warning className="h-4 w-4 text-amber-600" weight="duotone" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">
                    You have {workingSummary.short_days_count} short working day(s) this month
                  </p>
                  <p className="text-sm text-slate-600">
                    {workingSummary.short_days_count >= 3 
                      ? `${Math.floor(workingSummary.short_days_count / 3) * 0.5} half-day(s) have been deducted from your casual leave.`
                      : `${3 - (workingSummary.short_days_count % 3)} more short day(s) will result in 0.5 day leave deduction.`
                    }
                  </p>
                </div>
              </div>
            )}

            {/* Grid Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Clock Widget - Large */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-50 rounded-lg">
                      <Clock className="h-4 w-4 text-[#002FA7]" weight="duotone" />
                    </div>
                    <h2 className="text-base font-bold text-slate-900 font-['Outfit']">Time Tracker</h2>
                  </div>
                  {myShift && myShift.is_set && (
                    <span className="text-xs px-2.5 py-1 bg-blue-50 text-[#002FA7] rounded-full font-semibold border border-blue-100">
                      {myShift.start_time} – {myShift.end_time}
                    </span>
                  )}
                </div>

                {/* Timer Display */}
                <div className="text-center mb-6">
                  <div className={`text-5xl font-bold font-['JetBrains_Mono'] mb-2 ${
                    isShortDay && !attendanceStatus.on_break ? 'text-[#FF2E00]' : 'text-gray-900'
                  }`}>
                    {attendanceStatus.on_break ? formatTime(breakElapsedTime) : formatTime(elapsedTime)}
                  </div>
                  <p className="text-sm text-gray-500 uppercase tracking-wider">
                    {attendanceStatus.on_break ? "Break Duration" : attendanceStatus.clocked_in ? "Working Time" : "Not Clocked In"}
                  </p>
                  {attendanceStatus.clocked_in && !attendanceStatus.on_break && (
                    <p className={`text-xs mt-1 ${currentWorkingHours >= 8 ? 'text-[#00C853]' : 'text-[#FF2E00]'}`}>
                      {currentWorkingHours >= 8 ? "Minimum 8h reached" : `Need ${formatHours(8 - currentWorkingHours)} more for minimum`}
                    </p>
                  )}
                </div>

                {/* Progress Bar for 8.5 hours */}
                {attendanceStatus.clocked_in && !attendanceStatus.on_break && (
                  <div className="mb-6">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Progress</span>
                      <span>{Math.min(100, (currentWorkingHours / 8.5 * 100)).toFixed(0)}% of 8:30</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className={`h-2 rounded-full transition-all ${
                          currentWorkingHours >= 8 ? 'bg-[#00C853]' : 'bg-[#FFC107]'
                        }`}
                        style={{ width: `${Math.min(100, currentWorkingHours / 8.5 * 100)}%` }}
                      ></div>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 mt-1">
                      <span>0h</span>
                      <span className="text-[#FF2E00]">8h min</span>
                      <span>8:30</span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="space-y-3">
                  {!attendanceStatus.clocked_in ? (
                    <div className="space-y-2">
                      {/* GPS Status Panel */}
                      {gpsStatus && !gpsStatus.has_wfh_today && !gpsStatus.geofence_bypass && user?.gps_tracking_enabled !== false && (
                        <div data-testid="gps-status-panel" className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs border ${gpsStatus.within ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                          <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" weight="bold" />
                          <div>
                            {gpsStatus.within
                              ? <span className="font-semibold">Within office range ({gpsStatus.distance_km} km from {gpsStatus.office_name})</span>
                              : <><span className="font-semibold">{gpsStatus.distance_km} km from {gpsStatus.office_name}</span><br /><span className="opacity-80">Max allowed: {gpsStatus.radius_km} km. Ask admin to approve WFH or adjust geofence.</span></>
                            }
                          </div>
                        </div>
                      )}
                      {(user?.gps_tracking_enabled === false) && (
                        <div data-testid="gps-disabled-badge" className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-1.5">
                          <WifiNone className="h-3.5 w-3.5" weight="bold" />
                          GPS tracking disabled by admin — Clock-in allowed from anywhere
                        </div>
                      )}
                      {gpsStatus?.geofence_bypass && user?.gps_tracking_enabled !== false && (
                        <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
                          <Warning className="h-3.5 w-3.5" weight="bold" />
                          Geofence bypass enabled — Clock-in allowed from any location
                        </div>
                      )}
                      {attendanceStatus.has_wfh_today && (
                        <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                          <Laptop className="h-3.5 w-3.5" weight="bold" />
                          WFH Approved — GPS not required
                        </div>
                      )}
                      <button
                        data-testid="clock-in-btn"
                        onClick={handleClockIn}
                        disabled={loading}
                        className="btn-clock-in"
                      >
                        <Clock className="inline h-5 w-5 mr-2" weight="bold" />
                        {attendanceStatus.has_wfh_today ? "Clock In (WFH)" : "Clock In"}
                      </button>
                    </div>
                  ) : (
                    <>
                      {!attendanceStatus.on_break ? (
                        <button
                          data-testid="start-break-btn"
                          onClick={handleStartBreak}
                          disabled={loading || (attendanceStatus.remaining_break_minutes || 0) <= 0}
                          className={`btn-break ${(attendanceStatus.remaining_break_minutes || 0) <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <Coffee className="inline h-5 w-5 mr-2" weight="bold" />
                          {(attendanceStatus.remaining_break_minutes || 0) <= 0 
                            ? "Break Limit Reached" 
                            : `Start Break (${attendanceStatus.remaining_break_minutes || 40} min left)`}
                        </button>
                      ) : (
                        <button
                          data-testid="end-break-btn"
                          onClick={handleEndBreak}
                          disabled={loading}
                          className="btn-break"
                        >
                          <Coffee className="inline h-5 w-5 mr-2" weight="bold" />
                          End Break
                        </button>
                      )}
                      <button
                        data-testid="clock-out-btn"
                        onClick={handleClockOut}
                        disabled={loading}
                        className="btn-clock-out"
                      >
                        <SignOut className="inline h-5 w-5 mr-2" weight="bold" />
                        Clock Out
                      </button>
                    </>
                  )}
                </div>

                {/* Today's Summary */}
                {attendanceStatus.attendance && (
                  <div className="mt-6 pt-5 border-t border-slate-100">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-slate-400 text-xs font-medium mb-1">Clock In</p>
                        <p className="font-bold text-slate-900">
                          {format(new Date(attendanceStatus.attendance.clock_in), "h:mm a")}
                        </p>
                      </div>
                      {attendanceStatus.attendance.clock_out && (
                        <div className="bg-slate-50 rounded-xl p-3">
                          <p className="text-slate-400 text-xs font-medium mb-1">Clock Out</p>
                          <p className="font-bold text-slate-900">
                            {format(new Date(attendanceStatus.attendance.clock_out), "h:mm a")}
                          </p>
                        </div>
                      )}
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-slate-400 text-xs font-medium mb-1">Break Time</p>
                        <p className={`font-bold ${(attendanceStatus.attendance.total_break_minutes || 0) >= 40 ? 'text-red-500' : 'text-slate-900'}`}>
                          {attendanceStatus.attendance.total_break_minutes || 0} / 40 min
                        </p>
                      </div>
                    </div>
                  </div>
                )}

              {/* ── Flexible Timer (merged into Time Tracker, only when admin enabled) ── */}
              {user?.timer_access_enabled && (
                <div data-testid="flexible-timer-section" className="mt-5 pt-5 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center justify-center w-7 h-7 bg-violet-50 rounded-lg">
                      <Timer className="h-4 w-4 text-violet-600" weight="duotone" />
                    </div>
                    <span className="text-sm font-bold text-slate-800">Flexible Timer</span>
                    <span className="ml-auto text-xs text-slate-400 font-mono">
                      {formatTime(timerStatus.total_seconds + (timerStatus.is_running ? liveElapsed : 0))} / 8h 00m
                    </span>
                  </div>

                  {/* 8h progress bar */}
                  <div className="mb-3">
                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, ((timerStatus.total_seconds + (timerStatus.is_running ? liveElapsed : 0)) / 28800) * 100)}%`,
                          background: (timerStatus.total_seconds + (timerStatus.is_running ? liveElapsed : 0)) >= 28800 ? '#10b981' : '#7c3aed'
                        }}
                      />
                    </div>
                  </div>

                  {/* Live session display */}
                  {timerStatus.is_running && (
                    <div className="flex items-center justify-center gap-2 mb-3 py-2 bg-violet-50 rounded-xl">
                      <span className="text-2xl font-mono font-extrabold text-violet-700 tracking-widest">
                        {formatTime(liveElapsed)}
                      </span>
                      <span className="text-xs text-violet-400 self-end mb-0.5 animate-pulse">running</span>
                    </div>
                  )}

                  {/* Start / Stop button */}
                  <button
                    data-testid="flexible-timer-btn"
                    onClick={timerStatus.is_running ? handleTimerStop : handleTimerStart}
                    className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-95 ${
                      timerStatus.is_running ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-violet-600 hover:bg-violet-700 text-white'
                    }`}
                  >
                    {timerStatus.is_running
                      ? <><StopCircle className="h-5 w-5" weight="fill" /> Stop Timer</>
                      : <><PlayCircle className="h-5 w-5" weight="fill" /> Start Timer</>
                    }
                  </button>

                  {/* Session count */}
                  {timerStatus.sessions?.length > 0 && (
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                      <span>{timerStatus.sessions.length} session(s) today</span>
                      <span className="font-mono font-semibold text-slate-600">
                        {formatTime(timerStatus.total_seconds + (timerStatus.is_running ? liveElapsed : 0))} total
                      </span>
                    </div>
                  )}
                </div>
              )}
              </div>

              {/* Leave & Permission Balance Cards */}
              <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="metric-card">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-50 rounded-lg">
                      <TreePalm className="h-4 w-4 text-[#002FA7]" weight="duotone" />
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Casual Leave</span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{leaveBalance.casual ?? <span className="text-base text-slate-400">Not set</span>}</p>
                  <p className="text-xs text-slate-400 mt-1">{leaveBalance.casual !== null && leaveBalance.casual !== undefined ? "days remaining" : "contact admin"}</p>
                </div>

                <div className="metric-card">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center justify-center w-8 h-8 bg-blue-50 rounded-lg">
                      <Heartbeat className="h-4 w-4 text-[#002FA7]" weight="duotone" />
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Sick Leave</span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{leaveBalance.sick ?? <span className="text-base text-slate-400">Not set</span>}</p>
                  <p className="text-xs text-slate-400 mt-1">{leaveBalance.sick !== null && leaveBalance.sick !== undefined ? "days remaining" : "contact admin"}</p>
                </div>

                {/* Permission Hours Card */}
                <div className="metric-card" style={{ borderLeftColor: '#D97706' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center justify-center w-8 h-8 bg-amber-50 rounded-lg">
                      <Hourglass className="h-4 w-4 text-amber-600" weight="duotone" />
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Permission Hours</span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{(permissionBalance.remaining_minutes / 60).toFixed(1)}h</p>
                  <p className="text-xs text-slate-400 mt-1">of 2 hours remaining</p>
                  <p className="text-xs text-slate-300 mt-0.5">Max 1 hour per use</p>
                </div>

                {/* Loss of Pay Card */}
                <div className="metric-card" style={{ borderLeftColor: '#DC2626' }}>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex items-center justify-center w-8 h-8 bg-red-50 rounded-lg">
                      <CurrencyCircleDollar className="h-4 w-4 text-red-500" weight="duotone" />
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Loss of Pay</span>
                  </div>
                  <p className="text-3xl font-bold text-slate-900">{leaveBalance.loss_of_pay || 0}</p>
                  <p className="text-xs text-slate-400 mt-1">days taken</p>
                </div>

                {/* Request Buttons */}
                <div className="sm:col-span-1">
                  <Dialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
                    <DialogTrigger asChild>
                      <Button 
                        data-testid="request-leave-btn"
                        className="w-full h-12 bg-[#002FA7] text-white hover:bg-[#002482] rounded-xl font-semibold shadow-sm"
                      >
                        <CalendarBlank className="h-4 w-4 mr-2" weight="duotone" />
                        Request Leave
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle className="font-['Outfit']">Request Leave</DialogTitle>
                      </DialogHeader>
                      <p className="text-sm text-gray-500 -mt-2">Fill in the details below to submit a leave request.</p>
                      <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-sm text-amber-700">
                        Monthly limit: <strong>1.5 days</strong> | Used: <strong>{monthlyLeaveUsage.used}</strong> | Remaining: <strong>{monthlyLeaveUsage.remaining}</strong>
                      </div>
                      <div className="space-y-4 pt-2">
                        <div className="space-y-2">
                          <Label>Leave Type</Label>
                          <Select
                            value={leaveForm.leave_type}
                            onValueChange={(value) => setLeaveForm({ ...leaveForm, leave_type: value })}
                          >
                            <SelectTrigger data-testid="leave-type-select" className="h-10">
                              <SelectValue placeholder="Select leave type" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="casual">Casual Leave ({leaveBalance.casual ?? "not set"} left)</SelectItem>
                              <SelectItem value="sick">Sick Leave ({leaveBalance.sick ?? "not set"} left)</SelectItem>
                              <SelectItem value="loss_of_pay">Loss of Pay</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex items-center gap-3">
                          <input
                            data-testid="half-day-checkbox"
                            type="checkbox"
                            id="halfDay"
                            checked={leaveForm.is_half_day}
                            onChange={(e) => setLeaveForm({ ...leaveForm, is_half_day: e.target.checked, end_date: e.target.checked ? leaveForm.start_date : leaveForm.end_date })}
                            className="h-4 w-4 rounded border-gray-300 text-[#002FA7] focus:ring-[#002FA7]"
                          />
                          <label htmlFor="halfDay" className="text-sm font-medium text-gray-700">Half Day Leave (0.5 day)</label>
                        </div>

                        <div className={`grid ${leaveForm.is_half_day ? "grid-cols-1" : "grid-cols-2"} gap-4`}>
                          <div className="space-y-2">
                            <Label>{leaveForm.is_half_day ? "Date" : "Start Date"}</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  data-testid="leave-start-date-btn"
                                  variant="outline"
                                  className="w-full justify-start text-left font-normal h-10"
                                >
                                  {leaveForm.start_date ? format(leaveForm.start_date, "MMM d, yyyy") : "Select date"}
                                  <CaretDown className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={leaveForm.start_date}
                                  onSelect={(date) => setLeaveForm({ ...leaveForm, start_date: date })}
                                  disabled={(date) => date < new Date()}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>

                          {!leaveForm.is_half_day && (
                          <div className="space-y-2">
                            <Label>End Date</Label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  data-testid="leave-end-date-btn"
                                  variant="outline"
                                  className="w-full justify-start text-left font-normal h-10"
                                >
                                  {leaveForm.end_date ? format(leaveForm.end_date, "MMM d, yyyy") : "Select date"}
                                  <CaretDown className="ml-auto h-4 w-4 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                  mode="single"
                                  selected={leaveForm.end_date}
                                  onSelect={(date) => setLeaveForm({ ...leaveForm, end_date: date })}
                                  disabled={(date) => date < (leaveForm.start_date || new Date())}
                                />
                              </PopoverContent>
                            </Popover>
                          </div>
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label>Reason</Label>
                          <Textarea
                            data-testid="leave-reason-input"
                            placeholder="Enter the reason for leave..."
                            value={leaveForm.reason}
                            onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                            rows={3}
                          />
                        </div>

                        <Button
                          data-testid="submit-leave-request-btn"
                          onClick={handleLeaveRequest}
                          disabled={loading}
                          className="w-full bg-[#002FA7] text-white hover:bg-[#001F70]"
                        >
                          Submit Request
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>

                {/* Permission Request Button */}
                <div className="sm:col-span-1">
                  <Dialog open={permissionDialogOpen} onOpenChange={setPermissionDialogOpen}>
                    <DialogTrigger asChild>
                      <Button 
                        data-testid="request-permission-btn"
                        variant="outline"
                        className="w-full h-12 border-amber-300 text-slate-900 hover:bg-amber-50 rounded-xl font-semibold"
                      >
                        <Hourglass className="h-4 w-4 mr-2 text-amber-600" weight="duotone" />
                        Request Permission
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle className="font-['Outfit']">Request Permission</DialogTitle>
                      </DialogHeader>
                      <p className="text-sm text-gray-500 -mt-2">
                        You have {permissionBalance.remaining_minutes} minutes remaining this month. Max 1 hour per request.
                      </p>
                      <div className="space-y-4 pt-4">
                        <div className="space-y-2">
                          <Label>Duration</Label>
                          <Select
                            value={permissionForm.duration_minutes.toString()}
                            onValueChange={(value) => setPermissionForm({ ...permissionForm, duration_minutes: parseInt(value) })}
                          >
                            <SelectTrigger data-testid="permission-duration-select" className="h-10">
                              <SelectValue placeholder="Select duration" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="30">30 minutes</SelectItem>
                              <SelectItem value="60">1 hour</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <Label>Date</Label>
                          <Input
                            data-testid="permission-date-input"
                            type="date"
                            value={permissionForm.date}
                            onChange={(e) => setPermissionForm({ ...permissionForm, date: e.target.value })}
                            min={format(new Date(), "yyyy-MM-dd")}
                            className="h-10"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Reason</Label>
                          <Textarea
                            data-testid="permission-reason-input"
                            placeholder="Enter the reason for permission..."
                            value={permissionForm.reason}
                            onChange={(e) => setPermissionForm({ ...permissionForm, reason: e.target.value })}
                            rows={3}
                          />
                        </div>

                        <Button
                          data-testid="submit-permission-request-btn"
                          onClick={handlePermissionRequest}
                          disabled={loading || permissionBalance.remaining_minutes < permissionForm.duration_minutes}
                          className="w-full bg-[#FFC107] text-black hover:bg-[#E6AE06]"
                        >
                          Submit Request
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>

              {/* Leave Requests */}
              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                  <div className="flex items-center justify-center w-7 h-7 bg-blue-50 rounded-lg">
                    <CalendarCheck className="h-4 w-4 text-[#002FA7]" weight="duotone" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900 font-['Outfit']">Leave Requests</h2>
                </div>
                <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                  {leaveRequests.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      No leave requests yet
                    </div>
                  ) : (
                    leaveRequests.slice(0, 5).map((request) => (
                      <div key={request.id} className="p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900 text-sm capitalize">
                              {request.leave_type} Leave
                              {request.is_half_day && <span className="ml-2 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full border border-blue-100">Half Day</span>}
                            </p>
                            <p className="text-xs text-slate-500 mt-0.5">
                              {request.is_half_day
                                ? format(new Date(request.start_date), "MMM d, yyyy")
                                : `${format(new Date(request.start_date), "MMM d")} - ${format(new Date(request.end_date), "MMM d, yyyy")}`
                              }
                              {" "}({request.days} {request.days === 1 ? "day" : "days"})
                            </p>
                            <p className="text-xs text-slate-400 mt-1">{request.reason}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {getStatusBadge(request.status)}
                            {request.status === "pending" && (
                              <Button
                                data-testid={`cancel-leave-${request.id}`}
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCancelLeave(request.id)}
                                className="text-red-500 hover:text-red-700 text-xs h-7 px-2"
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Permission Requests */}
              <div className="lg:col-span-6 bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                  <div className="flex items-center justify-center w-7 h-7 bg-amber-50 rounded-lg">
                    <Timer className="h-4 w-4 text-amber-600" weight="duotone" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900 font-['Outfit']">Permission Requests</h2>
                </div>
                <div className="divide-y divide-slate-100 max-h-[300px] overflow-y-auto">
                  {permissionRequests.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-sm">
                      No permission requests yet
                    </div>
                  ) : (
                    permissionRequests.slice(0, 5).map((perm) => (
                      <div key={perm.id} className="p-4 hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900 text-sm">{perm.duration_minutes} minutes</p>
                            <p className="text-xs text-slate-500 mt-0.5">{format(new Date(perm.date), "MMM d, yyyy")}</p>
                            <p className="text-xs text-slate-400 mt-1">{perm.reason}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {getStatusBadge(perm.status)}
                            {perm.status === "pending" && (
                              <Button
                                data-testid={`cancel-permission-${perm.id}`}
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCancelPermission(perm.id)}
                                className="text-red-500 hover:text-red-700 text-xs h-7 px-2"
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Attendance History */}
              <div className="lg:col-span-12 bg-white border border-slate-200 rounded-xl overflow-hidden" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
                <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                  <div className="flex items-center justify-center w-7 h-7 bg-blue-50 rounded-lg">
                    <ClockCounterClockwise className="h-4 w-4 text-[#002FA7]" weight="duotone" />
                  </div>
                  <h2 className="text-sm font-bold text-slate-900 font-['Outfit']">Attendance History</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr>
                        <th className="table-header">Date</th>
                        <th className="table-header">Clock In</th>
                        <th className="table-header">Clock Out</th>
                        <th className="table-header">Break</th>
                        <th className="table-header">Working Hours</th>
                        <th className="table-header">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendanceHistory.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="text-center py-8 text-slate-400 text-sm">No attendance records yet</td>
                        </tr>
                      ) : (
                        attendanceHistory.slice(0, 10).map((record, idx) => (
                          <tr key={idx} className="table-row">
                            <td className="table-cell font-semibold">{format(new Date(record.date), "MMM d, yyyy")}</td>
                            <td className="table-cell">{format(new Date(record.clock_in), "h:mm a")}</td>
                            <td className="table-cell">{record.clock_out ? format(new Date(record.clock_out), "h:mm a") : "—"}</td>
                            <td className="table-cell">{record.total_break_minutes || 0} min</td>
                            <td className="table-cell">
                              <span className={record.working_hours && record.working_hours < 8 ? "text-red-500 font-semibold" : "font-medium"}>
                                {record.working_hours ? formatHours(record.working_hours) : "—"}
                              </span>
                            </td>
                            <td className="table-cell">
                              {record.is_short_day ? (
                                <span className="badge-rejected">Short Day</span>
                              ) : record.clock_out ? (
                                <span className="badge-approved">Complete</span>
                              ) : (
                                <span className="badge-pending">Active</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Work Summary Tab */}
        {activeTab === "summary" && workingSummary && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Work Summary</h1>
              <p className="text-gray-500 mt-1">Your monthly working hours overview</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="metric-card">
                <div className="flex items-center gap-2 mb-3">
                  <CalendarCheck className="h-5 w-5 text-[#002FA7]" weight="duotone" />
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Working Days</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{workingSummary.total_working_days}</p>
                <p className="text-sm text-gray-500">this month</p>
              </div>

              <div className="metric-card" style={{ borderLeftColor: '#00C853' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="h-5 w-5 text-[#00C853]" weight="duotone" />
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Total Hours</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{formatHours(workingSummary.total_working_hours)}</p>
                <p className="text-sm text-gray-500">avg {workingSummary.average_hours_per_day}h/day</p>
              </div>

              <div className="metric-card" style={{ borderLeftColor: '#FF2E00' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Warning className="h-5 w-5 text-[#FF2E00]" weight="duotone" />
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Short Days</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{workingSummary.short_days_count}</p>
                <p className="text-sm text-gray-500">less than 7h 30m</p>
              </div>

              <div className="metric-card" style={{ borderLeftColor: '#FFC107' }}>
                <div className="flex items-center gap-2 mb-3">
                  <Hourglass className="h-5 w-5 text-[#FFC107]" weight="duotone" />
                  <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Half Days Deducted</span>
                </div>
                <p className="text-3xl font-bold text-gray-900">{workingSummary.half_days_deducted}</p>
                <p className="text-sm text-gray-500">from casual leave</p>
              </div>
            </div>

            {/* Policy Info */}
            <div className="bg-white border border-gray-200 rounded-sm p-6">
              <h2 className="text-lg font-bold text-gray-900 font-['Outfit'] mb-4">Working Hours Policy</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">Daily Requirements</h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#002FA7]"></div>
                      Total working hours: <strong>{workingSummary.total_hours_per_day} hours</strong> (8:30)
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#FF2E00]"></div>
                      Minimum required: <strong>{workingSummary.required_hours_per_day} hours</strong>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#FFC107]"></div>
                      Less than 7h 30m = <strong>Short Day</strong>
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">Short Day Policy</h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#FF2E00]"></div>
                      {workingSummary.short_days_for_half_leave} short days in a month = <strong>0.5 day leave deduction</strong>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#FFC107]"></div>
                      Deducted automatically from casual leave
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">Permission Hours</h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#FFC107]"></div>
                      Monthly allowance: <strong>2 hours</strong>
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#FFC107]"></div>
                      Max per use: <strong>1 hour</strong> (use twice per month)
                    </li>
                  </ul>
                </div>
                <div>
                  <h3 className="font-medium text-gray-900 mb-2">Break Time</h3>
                  <ul className="space-y-2 text-sm text-gray-600">
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#002FA7]"></div>
                      Daily break allowance: <strong>40 minutes</strong> (Lunch & break)
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#FFC107]"></div>
                      Can be taken in multiple breaks
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Payslips Tab */}
        {activeTab === "payslips" && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">My Payslips</h1>
              <p className="text-gray-500 mt-1">View and download your salary slips</p>
            </div>

            <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
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
                      <td colSpan="6" className="text-center py-8 text-gray-500">
                        No payslips available yet
                      </td>
                    </tr>
                  ) : (
                    payslips.map((ps) => (
                      <tr key={ps.id} className="table-row">
                        <td className="table-cell font-medium">{ps.month_name} {ps.year}</td>
                        <td className="table-cell">₹{ps.basic_salary?.toLocaleString()}</td>
                        <td className="table-cell text-[#FF2E00]">-₹{ps.total_deductions?.toLocaleString()}</td>
                        <td className="table-cell font-bold text-[#00C853]">₹{ps.net_pay?.toLocaleString()}</td>
                        <td className="table-cell text-sm text-gray-500">
                          {format(new Date(ps.created_at), "MMM d, yyyy")}
                        </td>
                        <td className="table-cell">
                          <Button
                            data-testid={`download-payslip-${ps.id}`}
                            size="sm"
                            onClick={() => handleDownloadPayslip(ps.id)}
                            className="bg-[#002FA7] hover:bg-[#001F70] text-white gap-2"
                          >
                            <DownloadSimple className="h-4 w-4" />
                            PDF
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Payslip Details */}
            {payslips.length > 0 && (
              <div className="mt-6 bg-white border border-gray-200 rounded-sm p-6">
                <h2 className="text-lg font-bold text-gray-900 font-['Outfit'] mb-4">Latest Payslip Summary</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="p-4 bg-gray-50 rounded-sm">
                    <p className="text-sm text-gray-500 mb-1">Basic Salary</p>
                    <p className="text-2xl font-bold text-gray-900">₹{payslips[0]?.basic_salary?.toLocaleString()}</p>
                  </div>
                  <div className="p-4 bg-[#FFEBE6] rounded-sm">
                    <p className="text-sm text-gray-500 mb-1">Total Deductions</p>
                    <p className="text-2xl font-bold text-[#FF2E00]">-₹{payslips[0]?.total_deductions?.toLocaleString()}</p>
                    {payslips[0]?.deduction_details?.length > 0 && (
                      <ul className="mt-2 text-xs text-gray-500">
                        {payslips[0].deduction_details.map((d, i) => (
                          <li key={i}>{d.description}: ₹{d.amount}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="p-4 bg-[#E6FFEE] rounded-sm">
                    <p className="text-sm text-gray-500 mb-1">Net Pay</p>
                    <p className="text-2xl font-bold text-[#00C853]">₹{payslips[0]?.net_pay?.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Salary Structure Tab */}
        {activeTab === "salary" && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">My Salary</h1>
              <p className="text-gray-500 mt-1">View your salary structure and deductions</p>
            </div>

            {salaryStructure ? (
              <div className="space-y-6">
                {/* Gross Salary Card */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-base font-semibold text-gray-900 font-['Outfit']">Salary Overview</h2>
                    <span className="text-xs px-3 py-1 rounded-full bg-blue-50 text-[#002FA7] font-medium">Monthly</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-4 bg-gray-50 rounded-lg">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Gross Salary</p>
                      <p className="text-2xl font-bold text-gray-900 mt-1" data-testid="emp-gross-salary">
                        ₹{salaryStructure.gross_salary?.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-4 bg-[#FFEBE6] rounded-lg">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total Deductions</p>
                      <p className="text-2xl font-bold text-[#FF2E00] mt-1" data-testid="emp-total-deductions">
                        -₹{salaryStructure.total_deductions?.toLocaleString()}
                      </p>
                    </div>
                    <div className="p-4 bg-[#E6FFEE] rounded-lg">
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Net Salary</p>
                      <p className="text-2xl font-bold text-[#00C853] mt-1" data-testid="emp-net-salary">
                        ₹{salaryStructure.net_salary?.toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Earnings Breakdown */}
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h2 className="text-base font-semibold text-gray-900 font-['Outfit']">Earnings Breakdown</h2>
                  </div>
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
                      <tr className="border-t-2 border-gray-200">
                        <td className="table-cell font-bold text-gray-900">Total Earnings</td>
                        <td className="table-cell">100%</td>
                        <td className="table-cell text-right font-bold text-gray-900">₹{salaryStructure.gross_salary?.toLocaleString()}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Deductions */}
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-5 py-4 border-b border-gray-100">
                    <h2 className="text-base font-semibold text-gray-900 font-['Outfit']">Deductions</h2>
                  </div>
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
                            <td className="table-cell text-right font-medium text-[#FF2E00]">-₹{d.amount?.toLocaleString()}</td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-gray-200">
                          <td className="table-cell font-bold text-gray-900" colSpan="2">Total Deductions</td>
                          <td className="table-cell text-right font-bold text-[#FF2E00]">-₹{salaryStructure.total_deductions?.toLocaleString()}</td>
                        </tr>
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center py-8 text-gray-400">
                      <p className="text-sm">No custom deductions applied</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-400">
                <CurrencyDollar className="h-12 w-12 mx-auto mb-3" weight="duotone" />
                <p className="font-medium">Salary not configured yet</p>
                <p className="text-sm mt-1">Contact your admin to set up your salary structure</p>
              </div>
            )}
          </>
        )}

        {/* Change Requests Tab */}
        {activeTab === "change-requests" && (
          <>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Change Requests</h1>
                <p className="text-gray-500 mt-1">Submit and track your work/installation requests</p>
              </div>
              <Dialog open={crDialogOpen} onOpenChange={setCrDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="new-cr-btn" className="bg-[#002FA7] text-white hover:bg-[#001F70] gap-2">
                    <Plus className="h-4 w-4" weight="bold" />
                    New Request
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="font-['Outfit']">New Change Request</DialogTitle>
                  </DialogHeader>
                  <p className="text-sm text-gray-500 -mt-2">Submit a new work or installation request for approval.</p>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        data-testid="cr-title-input"
                        placeholder="e.g. Install software, Fix desk lamp"
                        value={crForm.title}
                        onChange={(e) => setCrForm({ ...crForm, title: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Description</Label>
                      <Textarea
                        data-testid="cr-description-input"
                        placeholder="Describe the request in detail..."
                        value={crForm.description}
                        onChange={(e) => setCrForm({ ...crForm, description: e.target.value })}
                        className="min-h-[100px]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Reporting Manager <span className="text-red-500">*</span></Label>
                      <Select
                        value={crForm.manager_id}
                        onValueChange={(v) => setCrForm({ ...crForm, manager_id: v })}
                      >
                        <SelectTrigger data-testid="cr-manager-select">
                          <SelectValue placeholder="Select who should approve this request" />
                        </SelectTrigger>
                        <SelectContent>
                          {crManagers.length === 0 && (
                            <SelectItem value="" disabled>No managers available</SelectItem>
                          )}
                          {crManagers.map((m) => (
                            <SelectItem key={m.id} value={m.id}>
                              <div className="flex flex-col">
                                <span className="font-medium">{m.name}</span>
                                <span className="text-xs text-slate-400">
                                  {m.role === "devops_manager" ? "DevOps Manager" : m.role.charAt(0).toUpperCase() + m.role.slice(1)}
                                  {m.department ? ` · ${m.department}` : ""}
                                </span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select value={crForm.cr_type} onValueChange={(v) => setCrForm({ ...crForm, cr_type: v, requested_value: "" })}>
                          <SelectTrigger data-testid="cr-type-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {crTypes.map((t) => (
                              <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Priority</Label>
                        <Select value={crForm.priority} onValueChange={(v) => setCrForm({ ...crForm, priority: v })}>
                          <SelectTrigger data-testid="cr-priority-select">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="medium">Medium</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {CR_AUTO_APPLY_TYPES.includes(crForm.cr_type) && (
                      <div className="space-y-2">
                        <Label>
                          {crForm.cr_type === "Salary Revision" && "Requested Salary (₹)"}
                          {crForm.cr_type === "Leave Adjustment" && "Requested Casual Leave Days"}
                          {crForm.cr_type === "Shift Change" && "Requested Shift (HH:MM-HH:MM)"}
                        </Label>
                        <Input
                          data-testid="cr-requested-value-input"
                          type={crForm.cr_type === "Shift Change" ? "text" : "number"}
                          min="0"
                          placeholder={
                            crForm.cr_type === "Salary Revision" ? "e.g. 50000" :
                            crForm.cr_type === "Leave Adjustment" ? "e.g. 15" :
                            "e.g. 09:30-17:30"
                          }
                          value={crForm.requested_value}
                          onChange={(e) => setCrForm({ ...crForm, requested_value: e.target.value })}
                        />
                      </div>
                    )}
                    <Button
                      data-testid="submit-cr-btn"
                      onClick={handleSubmitCR}
                      disabled={loading}
                      className="w-full bg-[#002FA7] text-white hover:bg-[#001F70]"
                    >
                      Submit Request
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Title</th>
                    <th className="table-header">Type</th>
                    <th className="table-header">Priority</th>
                    <th className="table-header">Manager</th>
                    <th className="table-header">Admin</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Created</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {myCRs.length === 0 ? (
                    <tr>
                      <td colSpan="8" className="text-center py-8 text-gray-500">
                        No change requests submitted yet
                      </td>
                    </tr>
                  ) : (
                    myCRs.map((cr) => (
                      <tr key={cr.id} className="table-row">
                        <td className="table-cell">
                          <p className="font-medium text-gray-900 text-sm">{cr.title}</p>
                          <p className="text-xs text-gray-500 line-clamp-1">{cr.description}</p>
                          {cr.cr_number && <p className="text-xs text-[#002FA7] font-mono mt-0.5">{cr.cr_number}</p>}
                          {cr.assigned_manager_name && (
                            <p className="text-xs text-slate-400 mt-0.5">Manager: {cr.assigned_manager_name}</p>
                          )}
                        </td>
                        <td className="table-cell">
                          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">{cr.cr_type}</span>
                        </td>
                        <td className="table-cell">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            cr.priority === "high" ? "bg-red-50 text-red-600" :
                            cr.priority === "low" ? "bg-green-50 text-green-600" :
                            "bg-yellow-50 text-yellow-600"
                          }`}>{cr.priority}</span>
                        </td>
                        <td className="table-cell">
                          <span className={`text-xs font-medium ${
                            cr.manager_approval === "approved" ? "text-[#00C853]" :
                            cr.manager_approval === "rejected" ? "text-[#FF2E00]" :
                            "text-gray-400"
                          }`}>
                            {cr.manager_approval === "approved" ? "Approved" :
                             cr.manager_approval === "rejected" ? "Rejected" : "Pending"}
                          </span>
                        </td>
                        <td className="table-cell">
                          <span className={`text-xs font-medium ${
                            cr.admin_approval === "approved" ? "text-[#00C853]" :
                            cr.admin_approval === "rejected" ? "text-[#FF2E00]" :
                            "text-gray-400"
                          }`}>
                            {cr.admin_approval === "approved" ? "Approved" :
                             cr.admin_approval === "rejected" ? "Rejected" : "Pending"}
                          </span>
                        </td>
                        <td className="table-cell">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                            cr.status === "approved" ? "bg-green-50 text-[#00C853]" :
                            cr.status === "rejected" ? "bg-red-50 text-[#FF2E00]" :
                            cr.status === "manager_approved" ? "bg-blue-50 text-blue-600" :
                            "bg-orange-50 text-orange-500"
                          }`}>
                            {cr.status === "manager_approved" ? "Awaiting Admin" : cr.status}
                          </span>
                        </td>
                        <td className="table-cell text-xs text-gray-500">
                          {cr.created_at ? format(new Date(cr.created_at), "MMM d, yyyy") : "—"}
                        </td>
                        <td className="table-cell">
                          {cr.status === "pending" && (
                            <Button
                              data-testid={`delete-cr-${cr.id}`}
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteCR(cr.id)}
                              className="text-gray-400 hover:text-red-500 h-8 w-8 p-0"
                            >
                              <Trash className="h-4 w-4" />
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
        )}

        {/* WFH Tab */}
        {activeTab === "wfh" && (
          <>
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Work From Home</h1>
                <p className="text-gray-500 mt-1">Request and track your WFH days</p>
              </div>
              <Dialog open={wfhDialogOpen} onOpenChange={setWfhDialogOpen}>
                <DialogTrigger asChild>
                  <Button data-testid="request-wfh-btn" className="bg-[#002FA7] text-white hover:bg-[#001F70]">
                    <Laptop className="h-4 w-4 mr-2" /> Request WFH
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Request Work From Home</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className="w-full justify-start text-left font-normal" data-testid="wfh-date-picker">
                            <CalendarBlank className="mr-2 h-4 w-4" />
                            {wfhForm.date ? format(wfhForm.date, "PPP") : "Select date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={wfhForm.date} onSelect={(date) => setWfhForm({ ...wfhForm, date })} />
                        </PopoverContent>
                      </Popover>
                    </div>
                    <div className="space-y-2">
                      <Label>Reason</Label>
                      <Textarea
                        data-testid="wfh-reason"
                        value={wfhForm.reason}
                        onChange={(e) => setWfhForm({ ...wfhForm, reason: e.target.value })}
                        placeholder="Why do you need to work from home?"
                      />
                    </div>
                    <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">
                      {wfhBalance.limit === null
                        ? <span>WFH limit <strong>not set</strong> — contact admin</span>
                        : <span>Monthly WFH Balance: <strong>{wfhBalance.remaining}</strong> of {wfhBalance.limit} days remaining</span>
                      }
                    </div>
                    <Button
                      data-testid="submit-wfh-btn"
                      onClick={handleRequestWfh}
                      disabled={loading}
                      className="w-full bg-[#002FA7] text-white hover:bg-[#001F70]"
                    >
                      Submit Request
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>

            {/* WFH Balance Card */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div className="bg-white border border-gray-200 rounded-sm p-4">
                <p className="text-xs text-gray-500 mb-1">Monthly Limit</p>
                <p className="text-2xl font-bold text-gray-900">{wfhBalance.limit ?? <span className="text-base text-gray-400">Not set</span>}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-sm p-4">
                <p className="text-xs text-gray-500 mb-1">Used</p>
                <p className="text-2xl font-bold text-[#002FA7]">{wfhBalance.used}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-sm p-4">
                <p className="text-xs text-gray-500 mb-1">Remaining</p>
                <p className="text-2xl font-bold text-[#00C853]">{wfhBalance.remaining ?? <span className="text-base text-gray-400">—</span>}</p>
              </div>
            </div>

            {/* WFH Requests Table */}
            <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Reason</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Reviewed By</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {wfhRequests.length === 0 ? (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">No WFH requests yet</td></tr>
                  ) : (
                    wfhRequests.map((req) => (
                      <tr key={req.id} data-testid={`wfh-request-${req.id}`} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-3 px-4 text-sm font-medium text-gray-900">{req.date}</td>
                        <td className="py-3 px-4 text-sm text-gray-600 max-w-[250px] truncate">{req.reason}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            req.status === "approved" ? "bg-green-100 text-green-700" :
                            req.status === "rejected" ? "bg-red-100 text-red-700" :
                            "bg-yellow-100 text-yellow-700"
                          }`}>
                            {req.status}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-600">{req.reviewed_by || "-"}</td>
                        <td className="py-3 px-4 text-right">
                          {req.status === "pending" && (
                            <Button
                              data-testid={`cancel-wfh-${req.id}`}
                              size="sm"
                              variant="outline"
                              onClick={() => handleCancelWfh(req.id)}
                              className="text-red-600 hover:text-red-700 h-8"
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
        )}

        {/* Company Policy Tab */}
        {activeTab === "policy" && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Company Policy</h1>
              <p className="text-gray-500 mt-1">Read and understand our company guidelines</p>
            </div>

            {policies.length === 0 ? (
              <div className="bg-white border border-gray-200 rounded-sm p-12 text-center">
                <Scroll className="h-12 w-12 text-gray-300 mx-auto mb-4" weight="duotone" />
                <p className="text-gray-500">No company policies have been added yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {policies.map((policy) => (
                  <div key={policy.id} data-testid={`policy-card-${policy.id}`} className="bg-white border border-gray-200 rounded-sm p-6">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-[#E5ECFF] flex items-center justify-center flex-shrink-0">
                        <Scroll className="h-5 w-5 text-[#002FA7]" weight="duotone" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 font-['Outfit']">{policy.title}</h3>
                        <span className="text-xs font-medium text-[#002FA7] bg-[#E5ECFF] px-2 py-0.5 rounded-full">{policy.category}</span>
                      </div>
                    </div>
                    <div className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed pl-[52px]">
                      {policy.content}
                    </div>
                    {policy.updated_at && (
                      <p className="text-xs text-gray-400 mt-3 pl-[52px]">
                        Last updated: {format(new Date(policy.updated_at), "MMM d, yyyy")}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Holidays Tab */}
        {activeTab === "holidays" && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Holiday List 2026</h1>
              <p className="text-gray-500 mt-1">Public holidays and weekly offs</p>
            </div>

            {/* Weekend Info */}
            <div className="bg-[#E5ECFF] border border-[#002FA7]/20 rounded-sm p-4 mb-6">
              <div className="flex items-center gap-2">
                <CalendarStar className="h-5 w-5 text-[#002FA7]" weight="duotone" />
                <p className="text-sm font-medium text-[#002FA7]">
                  Saturday & Sunday are weekly holidays
                </p>
              </div>
            </div>

            {/* Holidays Table */}
            <div className="bg-white border border-gray-200 rounded-sm overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="table-header">#</th>
                    <th className="table-header">Date</th>
                    <th className="table-header">Day</th>
                    <th className="table-header">Festival</th>
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((holiday, index) => {
                    const holidayDate = new Date(holiday.date + "T00:00:00");
                    const isPast = holidayDate < new Date(new Date().toDateString());
                    return (
                      <tr key={index} className={`border-b border-gray-100 ${isPast ? "opacity-50" : ""}`}>
                        <td className="table-cell text-gray-500">{index + 1}</td>
                        <td className="table-cell font-medium">
                          {format(holidayDate, "dd MMM yyyy")}
                        </td>
                        <td className="table-cell">{holiday.day}</td>
                        <td className="table-cell">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-[#002FA7]"></span>
                            {holiday.festival}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-sm text-gray-500">
              Total public holidays: <strong>{holidays.length}</strong>
            </div>
          </>
        )}
        {activeTab === "org-tree" && (
          <>
            <div className="mb-8">
              <h1 className="text-3xl font-bold text-gray-900 font-['Outfit'] tracking-tight">Worker Tree</h1>
              <p className="text-gray-500 mt-1 text-sm">Your company's organizational hierarchy</p>
            </div>

            {orgNodes.length === 0 ? (
              <div className="text-center py-20 text-slate-400">
                <TreeStructure className="h-14 w-14 mx-auto mb-3" weight="duotone" />
                <p className="font-semibold text-slate-600">Org chart not set up yet</p>
                <p className="text-sm mt-1">Contact your admin to build the worker tree</p>
              </div>
            ) : (
              <OrgTreeView nodes={orgNodes} levelLabels={orgLevels} />
            )}
          </>
        )}
      </main>
    </div>
  );
}
