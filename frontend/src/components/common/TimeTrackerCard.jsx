import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Clock, SignOut, Warning, Laptop, MapPin, WifiNone,
  Timer, PlayCircle, StopCircle, Pause, Play, FirstAidKit, SignIn, CheckCircle
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatHours } from "@/lib/format";

// Reusable Login/Logout + Pause(travel) + Flexible Timer widget, used by Employee and Manager dashboards
export function TimeTrackerCard({ user, api }) {
  const [attendanceStatus, setAttendanceStatus] = useState({ clocked_in: false, on_pause: false, attendance: null });
  const [myShift, setMyShift] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [pauseElapsedTime, setPauseElapsedTime] = useState(0);
  const [gpsStatus, setGpsStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [timerStatus, setTimerStatus] = useState({ is_running: false, total_seconds: 0, live_seconds: 0, sessions: [], target_seconds: 28800 });
  const [liveElapsed, setLiveElapsed] = useState(0);
  const [showEmergencyDialog, setShowEmergencyDialog] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const timerIntervalRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, shiftRes] = await Promise.all([
        api.get("/attendance/status"),
        api.get("/attendance/my-shift").catch(() => ({ data: null }))
      ]);
      setAttendanceStatus(statusRes.data);
      setMyShift(shiftRes.data);
    } catch (error) {
      console.error("Error fetching attendance status:", error);
    }
  }, [api]);

  const fetchTimerStatus = useCallback(async () => {
    try {
      const res = await api.get("/attendance/timer/today");
      setTimerStatus(res.data);
      if (res.data.is_running) setLiveElapsed(res.data.live_seconds || 0);
    } catch {
      // Timer endpoint not available or access not granted - ignore silently
    }
  }, [api]);

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

  useEffect(() => {
    fetchStatus();
    if (user?.gps_tracking_enabled !== false) {
      checkGPSStatus();
    }
    if (user?.timer_access_enabled) {
      fetchTimerStatus();
    }
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus]);

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

  useEffect(() => {
    let interval;
    if (attendanceStatus.clocked_in && attendanceStatus.attendance?.clock_in && !attendanceStatus.on_pause) {
      interval = setInterval(() => {
        const clockIn = new Date(attendanceStatus.attendance.clock_in);
        const pauseMinutes = attendanceStatus.attendance?.total_pause_minutes || 0;
        const elapsed = Math.floor((Date.now() - clockIn.getTime()) / 1000) - (pauseMinutes * 60);
        setElapsedTime(Math.max(0, elapsed));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [attendanceStatus]);


  useEffect(() => {
    let interval;
    if (attendanceStatus.on_pause && attendanceStatus.attendance?.pauses) {
      const currentPause = attendanceStatus.attendance.pauses.find(p => !p.end);
      if (currentPause) {
        interval = setInterval(() => {
          const pauseStart = new Date(currentPause.start);
          const elapsed = Math.floor((Date.now() - pauseStart.getTime()) / 1000);
          setPauseElapsedTime(elapsed);
        }, 1000);
      }
    } else {
      setPauseElapsedTime(0);
    }
    return () => clearInterval(interval);
  }, [attendanceStatus]);

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

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
      const gpsDisabled = user?.gps_tracking_enabled === false;
      if (!gpsDisabled) {
        try {
          location = await getLocation();
        } catch (gpsErr) {
          if (!attendanceStatus.has_wfh_today) throw gpsErr;
        }
      }
      await api.post("/attendance/clock-in", location || {});
      toast.success(gpsDisabled ? "Logged in (GPS tracking off)" : attendanceStatus.has_wfh_today ? "Logged in (WFH)" : "Logged in successfully!");
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to log in");
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
      toast.success(`Logged out successfully! (${formatHours(workingHours)} worked)`);
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to log out");
    } finally {
      setLoading(false);
    }
  };

  const handleEmergencyClockOut = async () => {
    if (emergencyReason.trim().length < 5) {
      toast.error("Please describe the emergency (at least 5 characters)");
      return;
    }
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
      const response = await api.post("/attendance/clock-out", { ...(location || {}), emergency_reason: emergencyReason.trim() });
      const workingHours = response.data?.working_hours || 0;
      toast.success(`Emergency logout recorded (${formatHours(workingHours)} worked). Your manager has been notified.`);
      setShowEmergencyDialog(false);
      setEmergencyReason("");
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to log out");
    } finally {
      setLoading(false);
    }
  };

  const handleStartPause = async () => {
    setLoading(true);
    try {
      await api.post("/attendance/pause/start", {});
      toast.success("Paused — time won't count toward your 8h workday");
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to pause");
    } finally {
      setLoading(false);
    }
  };

  const handleEndPause = async () => {
    setLoading(true);
    try {
      await api.post("/attendance/pause/end", {});
      toast.success("Resumed working");
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to resume");
    } finally {
      setLoading(false);
    }
  };

  const currentWorkingHours = elapsedTime / 3600;
  const requiredHours = attendanceStatus.effective_required_hours ?? 8;
  const permissionMinutesToday = attendanceStatus.permission_minutes_today || 0;
  const isShortDay = currentWorkingHours < requiredHours && attendanceStatus.clocked_in;
  const onPause = attendanceStatus.on_pause;
  // Logged in and out already today (one Login + one Logout per day)
  const dayComplete = !attendanceStatus.clocked_in && !!attendanceStatus.attendance?.clock_out;
  // Admin can switch the 8-hour Logout rule off per employee
  const fullDayRequired = attendanceStatus.full_day_required !== false;

  const progressPct = Math.min(100, (currentWorkingHours / requiredHours) * 100);
  const reachedMinimum = currentWorkingHours >= requiredHours;
  const flexTotalSeconds = timerStatus.total_seconds + (timerStatus.is_running ? liveElapsed : 0);

  // Status pill + accent for the big timer
  const status = onPause
    ? { tone: "tone-teal", label: "Paused", pulse: false }
    : attendanceStatus.clocked_in
      ? { tone: "tone-green", label: "Logged in", pulse: true }
      : dayComplete
        ? { tone: "tone-blue", label: "Logged out", pulse: false }
        : { tone: "", label: "Not logged in", pulse: false };
  const timerColor = onPause ? "var(--tone)" : "var(--text-primary)";

  const fmtClock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const att = attendanceStatus.attendance;
  const summaryTiles = att ? [
    { key: "login", label: "Login", value: fmtClock(att.clock_in), icon: SignIn, tone: "tone-blue" },
    { key: "logout", label: "Logout", value: att.clock_out ? fmtClock(att.clock_out) : "—", icon: SignOut, tone: "tone-violet" },
    { key: "paused", label: "Paused", value: `${att.total_pause_minutes || 0} min`, icon: Pause, tone: "tone-teal" },
  ] : [];

  return (
    <div
      data-testid="time-tracker-card"
      className="relative p-5 sm:p-6"
      style={{ background: 'var(--surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-md)' }}
    >
      {/* Header: title, shift, live status */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="stat-icon tone-blue">
            <Clock className="h-5 w-5" weight="duotone" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold font-['Outfit'] leading-tight" style={{ color: 'var(--text-primary)' }}>Time Tracker</h2>
            {myShift && myShift.is_set ? (
              <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Shift {myShift.start_time} – {myShift.end_time}
              </p>
            ) : (
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Today's workday</p>
            )}
          </div>
        </div>
        <span data-testid="tracker-status-pill" className={`chip ${status.tone} flex-shrink-0`} style={{ padding: '5px 11px' }}>
          <span
            className={`w-1.5 h-1.5 rounded-full ${status.pulse ? 'animate-pulse-dot' : ''}`}
            style={{ background: status.tone ? 'var(--tone)' : 'var(--text-subtle)' }}
          />
          {status.label}
        </span>
      </div>

      {/* Timer Display */}
      <div
        className={`rounded-2xl px-4 py-6 text-center mb-5 ${status.tone}`}
        style={{
          background: onPause ? 'var(--tone-bg)' : 'var(--surface-elevated)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: onPause ? 'var(--tone)' : 'var(--text-muted)' }}>
          {onPause ? "Paused (Travel/Away)" : attendanceStatus.clocked_in ? "Logged In Time" : dayComplete ? "Worked Today" : "Not Logged In"}
        </p>
        <div
          className="font-['JetBrains_Mono'] font-medium text-[44px] sm:text-[54px] leading-none tracking-tight mt-3 tabular-nums"
          style={{ color: timerColor }}
        >
          {onPause ? formatTime(pauseElapsedTime) : dayComplete ? formatTime(Math.round((attendanceStatus.attendance.working_hours || 0) * 3600)) : formatTime(elapsedTime)}
        </div>
        {attendanceStatus.clocked_in && !onPause && (
          <p data-testid="min-hours-status" className="text-xs font-semibold mt-3" style={{ color: reachedMinimum ? 'var(--status-success)' : 'var(--status-error)' }}>
            {reachedMinimum
              ? `Minimum ${formatHours(requiredHours)} reached`
              : fullDayRequired
                ? `Need ${formatHours(requiredHours - currentWorkingHours)} more for minimum`
                : `${formatHours(requiredHours - currentWorkingHours)} to reach ${formatHours(requiredHours)} — you can log out any time`}
          </p>
        )}
        {permissionMinutesToday > 0 && attendanceStatus.clocked_in && !onPause && (
          <p data-testid="permission-adjustment-note" className="text-xs mt-1.5 tone-teal" style={{ color: 'var(--tone)' }}>
            {permissionMinutesToday}min approved permission today — required workday reduced to {formatHours(requiredHours)}
          </p>
        )}
        {attendanceStatus.is_half_day_today && attendanceStatus.clocked_in && !onPause && (
          <p data-testid="half-day-adjustment-note" className="text-xs mt-1.5 tone-teal" style={{ color: 'var(--tone)' }}>
            Approved half-day leave today — required workday reduced to {formatHours(requiredHours)}
          </p>
        )}
        {onPause && (
          <p className="text-xs mt-3" style={{ color: 'var(--tone)' }}>Paused time is excluded from your 8h day</p>
        )}
        {!attendanceStatus.clocked_in && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>{attendanceStatus.attendance?.clock_out ? "Logged out for today" : "Log in to start today's timer"}</p>
        )}
      </div>

      {/* Progress toward the required day */}
      {attendanceStatus.clocked_in && !onPause && (
        <div className="mb-5">
          <div className="flex items-baseline justify-between text-xs mb-2">
            <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Progress</span>
            <span style={{ color: 'var(--text-muted)' }}>
              <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{progressPct.toFixed(0)}%</span> of {formatHours(requiredHours)}
            </span>
          </div>
          <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--brand-primary-light)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPct}%`,
                background: isShortDay ? 'var(--brand-gradient)' : 'var(--status-success)',
              }}
            />
          </div>
          <div className="flex justify-between gap-2 text-[11px] mt-1.5" style={{ color: 'var(--text-subtle)' }}>
            <span>0h</span>
            <span className="text-center">Login → Logout</span>
            <span>{formatHours(requiredHours)}</span>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        {dayComplete ? (
          // One Login and one Logout per day: today's attendance is done
          <div
            data-testid="day-complete-panel"
            className="flex items-start gap-3 rounded-2xl px-4 py-3.5 tone-green"
            style={{ background: 'var(--tone-bg)' }}
          >
            <CheckCircle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--tone)' }} weight="fill" />
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Today's attendance is complete</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                You logged out at {new Date(attendanceStatus.attendance.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. You can log in again tomorrow.
              </p>
            </div>
          </div>
        ) : !attendanceStatus.clocked_in ? (
          <div className="space-y-2.5">
            {gpsStatus && !gpsStatus.has_wfh_today && !gpsStatus.geofence_bypass && user?.gps_tracking_enabled !== false && (
              <div
                data-testid="gps-status-panel"
                className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${gpsStatus.within ? 'tone-green' : 'tone-red'}`}
                style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}
              >
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
              <div
                data-testid="gps-disabled-badge"
                className="flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2 text-center"
                style={{ background: 'var(--surface-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
              >
                <WifiNone className="h-3.5 w-3.5 flex-shrink-0" weight="bold" />
                GPS tracking disabled by admin — Login allowed from anywhere
              </div>
            )}
            {gpsStatus?.geofence_bypass && user?.gps_tracking_enabled !== false && (
              <div className="tone-amber flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}>
                <Warning className="h-3.5 w-3.5 flex-shrink-0" weight="bold" />
                Geofence bypass enabled — Login allowed from any location
              </div>
            )}
            {attendanceStatus.has_wfh_today && (
              <div className="tone-green flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl px-3 py-2" style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}>
                <Laptop className="h-3.5 w-3.5 flex-shrink-0" weight="bold" />
                WFH Approved — GPS not required
              </div>
            )}
            <button
              data-testid="manager-clock-in-btn"
              onClick={handleClockIn}
              disabled={loading}
              className={`btn-clock-in ${loading ? 'opacity-60 cursor-wait' : ''}`}
            >
              <SignIn className="h-5 w-5" weight="bold" />
              {attendanceStatus.has_wfh_today ? "Login (WFH)" : "Login"}
            </button>
          </div>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-1">
              {!onPause ? (
                <button
                  data-testid="pause-btn"
                  onClick={handleStartPause}
                  disabled={loading}
                  className={`btn-pause ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Pause className="h-4 w-4" weight="bold" />
                  Pause
                </button>
              ) : (
                <button
                  data-testid="resume-btn"
                  onClick={handleEndPause}
                  disabled={loading}
                  className="btn-pause"
                >
                  <Play className="h-4 w-4" weight="bold" />
                  Resume
                </button>
              )}
            </div>
            <button
              data-testid="manager-clock-out-btn"
              onClick={handleClockOut}
              disabled={loading || onPause}
              className={`btn-clock-out ${loading || onPause ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={onPause ? "Resume first" : ""}
            >
              <SignOut className="h-5 w-5" weight="bold" />
              Logout
            </button>
            {!onPause && fullDayRequired && currentWorkingHours < requiredHours && (
              <button
                data-testid="emergency-clockout-link"
                onClick={() => setShowEmergencyDialog(true)}
                disabled={loading}
                className="w-full text-center text-xs font-semibold mt-1 py-1 flex items-center justify-center gap-1 hover:underline"
                style={{ color: 'var(--status-error)' }}
              >
                <FirstAidKit className="h-3.5 w-3.5" weight="bold" />
                Emergency Logout
              </button>
            )}
          </>
        )}
      </div>

      {/* Emergency Logout Dialog */}
      <Dialog open={showEmergencyDialog} onOpenChange={(open) => { setShowEmergencyDialog(open); if (!open) setEmergencyReason(""); }}>
        <DialogContent data-testid="emergency-clockout-dialog" className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 font-['Outfit']">
              <span className="stat-icon tone-red" style={{ width: 36, height: 36, borderRadius: 11 }}>
                <FirstAidKit className="h-5 w-5" weight="fill" />
              </span>
              Emergency Logout
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              You've worked {formatHours(currentWorkingHours)} of the required {formatHours(requiredHours)}. Emergency logout bypasses this requirement — your manager will be notified immediately and this won't affect your leave balance.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="emergency-reason-input" className="text-sm font-semibold">Reason for emergency <span className="text-red-500">*</span></Label>
              <Textarea
                id="emergency-reason-input"
                data-testid="emergency-reason-input"
                placeholder="e.g. Family emergency, need to leave immediately"
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                rows={3}
                className="rounded-xl"
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1">
              <Button
                data-testid="emergency-clockout-cancel-btn"
                variant="outline"
                onClick={() => setShowEmergencyDialog(false)}
                disabled={loading}
                className="h-11 rounded-xl"
              >
                Cancel
              </Button>
              <Button
                data-testid="emergency-clockout-confirm-btn"
                onClick={handleEmergencyClockOut}
                disabled={loading}
                className="h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold"
              >
                Confirm Emergency Logout
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Today's Summary */}
      {att && (
        <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="grid grid-cols-2 gap-2.5">
            {summaryTiles.map(({ key, label, value, icon: Icon, tone, alert }) => (
              <div
                key={key}
                data-testid={`tracker-summary-${key}`}
                className={`flex items-center gap-2.5 rounded-xl p-3 ${tone}`}
                style={{ background: 'var(--surface-elevated)', border: '1px solid var(--border-subtle)' }}
              >
                <span className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0" style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}>
                  <Icon className="h-4 w-4" weight="duotone" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</p>
                  <p className="text-sm font-bold truncate" style={{ color: alert ? 'var(--status-error)' : 'var(--text-primary)' }}>{value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flexible Timer (only when admin enabled) */}
      {user?.timer_access_enabled && (
        <div data-testid="manager-flexible-timer-section" className="mt-5 pt-5 tone-violet" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg" style={{ background: 'var(--tone-bg)', color: 'var(--tone)' }}>
              <Timer className="h-4 w-4" weight="duotone" />
            </span>
            <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Flexible Timer</span>
            <span className="ml-auto text-xs font-['JetBrains_Mono']" style={{ color: 'var(--text-muted)' }}>
              {formatTime(flexTotalSeconds)} / 8h 00m
            </span>
          </div>

          <div className="mb-3">
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--tone-bg)' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (flexTotalSeconds / 28800) * 100)}%`,
                  background: flexTotalSeconds >= 28800 ? 'var(--status-success)' : 'var(--tone)'
                }}
              />
            </div>
          </div>

          {timerStatus.is_running && (
            <div className="flex items-center justify-center gap-2 mb-3 py-2.5 rounded-xl" style={{ background: 'var(--tone-bg)' }}>
              <span className="text-2xl font-['JetBrains_Mono'] font-medium tracking-wider" style={{ color: 'var(--tone)' }}>
                {formatTime(liveElapsed)}
              </span>
              <span className="text-xs self-end mb-0.5 animate-pulse" style={{ color: 'var(--tone)' }}>running</span>
            </div>
          )}

          <button
            data-testid="manager-flexible-timer-btn"
            onClick={timerStatus.is_running ? handleTimerStop : handleTimerStart}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-95 text-white ${
              timerStatus.is_running ? 'bg-red-500 hover:bg-red-600' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {timerStatus.is_running
              ? <><StopCircle className="h-5 w-5" weight="fill" /> Stop Timer</>
              : <><PlayCircle className="h-5 w-5" weight="fill" /> Start Timer</>
            }
          </button>

          {timerStatus.sessions?.length > 0 && (
            <div className="mt-2 flex items-center justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{timerStatus.sessions.length} session(s) today</span>
              <span className="font-['JetBrains_Mono'] font-medium" style={{ color: 'var(--text-secondary)' }}>
                {formatTime(flexTotalSeconds)} total
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
