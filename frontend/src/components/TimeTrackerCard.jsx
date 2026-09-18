import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Clock, Coffee, SignOut, Warning, Laptop, MapPin, WifiNone,
  Timer, PlayCircle, StopCircle, Pause, Play, FirstAidKit
} from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const formatHours = (decimalHours) => {
  if (!decimalHours) return "—";
  const hours = Math.floor(decimalHours);
  const minutes = Math.round((decimalHours - hours) * 60);
  return `${hours}h ${minutes}m`;
};

// Reusable Clock In/Out + Break + Pause(travel) + Flexible Timer widget, used by Employee and Manager dashboards
export function TimeTrackerCard({ user, api }) {
  const [attendanceStatus, setAttendanceStatus] = useState({ clocked_in: false, on_break: false, on_pause: false, attendance: null });
  const [myShift, setMyShift] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [breakElapsedTime, setBreakElapsedTime] = useState(0);
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
    if (attendanceStatus.clocked_in && attendanceStatus.attendance?.clock_in && !attendanceStatus.on_break && !attendanceStatus.on_pause) {
      interval = setInterval(() => {
        const clockIn = new Date(attendanceStatus.attendance.clock_in);
        const breakMinutes = attendanceStatus.attendance?.total_break_minutes || 0;
        const pauseMinutes = attendanceStatus.attendance?.total_pause_minutes || 0;
        const elapsed = Math.floor((Date.now() - clockIn.getTime()) / 1000) - (breakMinutes * 60) - (pauseMinutes * 60);
        setElapsedTime(Math.max(0, elapsed));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [attendanceStatus]);

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
      toast.success(gpsDisabled ? "Clocked in (GPS tracking off)" : attendanceStatus.has_wfh_today ? "Clocked in (WFH)" : "Clocked in successfully!");
      fetchStatus();
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
      toast.success(`Clocked out successfully! (${formatHours(workingHours)} worked)`);
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to clock out");
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
      toast.success(`Emergency clock-out recorded (${formatHours(workingHours)} worked). Your manager has been notified.`);
      setShowEmergencyDialog(false);
      setEmergencyReason("");
      fetchStatus();
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
      fetchStatus();
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
      fetchStatus();
    } catch (error) {
      toast.error(error.response?.data?.detail || error.message || "Failed to end break");
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
  const onBreak = attendanceStatus.on_break;
  const onPause = attendanceStatus.on_pause;

  return (
    <div data-testid="time-tracker-card" className="bg-white border border-slate-200 rounded-xl p-6" style={{ boxShadow: '0 1px 4px rgba(15,23,42,0.04)' }}>
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
          onPause ? 'text-[#0E7490]' : isShortDay && !onBreak ? 'text-[#FF2E00]' : 'text-gray-900'
        }`}>
          {onPause ? formatTime(pauseElapsedTime) : onBreak ? formatTime(breakElapsedTime) : formatTime(elapsedTime)}
        </div>
        <p className="text-sm text-gray-500 uppercase tracking-wider">
          {onPause ? "Paused (Travel/Away)" : onBreak ? "Break Duration" : attendanceStatus.clocked_in ? "Working Time" : "Not Clocked In"}
        </p>
        {attendanceStatus.clocked_in && !onBreak && !onPause && (
          <p data-testid="min-hours-status" className={`text-xs mt-1 ${currentWorkingHours >= requiredHours ? 'text-[#00C853]' : 'text-[#FF2E00]'}`}>
            {currentWorkingHours >= requiredHours ? `Minimum ${formatHours(requiredHours)} reached` : `Need ${formatHours(requiredHours - currentWorkingHours)} more for minimum`}
          </p>
        )}
        {permissionMinutesToday > 0 && attendanceStatus.clocked_in && !onBreak && !onPause && (
          <p data-testid="permission-adjustment-note" className="text-xs mt-1 text-[#0E7490]">
            {permissionMinutesToday}min approved permission today — required workday reduced to {formatHours(requiredHours)}
          </p>
        )}
        {attendanceStatus.is_half_day_today && attendanceStatus.clocked_in && !onBreak && !onPause && (
          <p data-testid="half-day-adjustment-note" className="text-xs mt-1 text-[#0E7490]">
            Approved half-day leave today — required workday reduced to {formatHours(requiredHours)}
          </p>
        )}
        {onPause && (
          <p className="text-xs mt-1 text-[#0E7490]">Paused time is excluded from your 8h requirement</p>
        )}
      </div>

      {/* Progress Bar for 8.5 hours */}
      {attendanceStatus.clocked_in && !onBreak && !onPause && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Progress</span>
            <span>{Math.min(100, (currentWorkingHours / 8.5 * 100)).toFixed(0)}% of 8:30</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full transition-all ${
                currentWorkingHours >= requiredHours ? 'bg-[#00C853]' : 'bg-[#FFC107]'
              }`}
              style={{ width: `${Math.min(100, currentWorkingHours / 8.5 * 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0h</span>
            <span className="text-[#FF2E00]">{formatHours(requiredHours)} min</span>
            <span>8:30</span>
          </div>

        </div>
      )}

      {/* Action Buttons */}
      <div className="space-y-3">
        {!attendanceStatus.clocked_in ? (
          <div className="space-y-2">
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
              data-testid="manager-clock-in-btn"
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
            <div className="grid grid-cols-2 gap-2">
              {!onBreak ? (
                <button
                  data-testid="manager-start-break-btn"
                  onClick={handleStartBreak}
                  disabled={loading || onPause || (attendanceStatus.remaining_break_minutes || 0) <= 0}
                  className={`btn-break ${loading || onPause || (attendanceStatus.remaining_break_minutes || 0) <= 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Coffee className="inline h-4 w-4 mr-1" weight="bold" />
                  {(attendanceStatus.remaining_break_minutes || 0) <= 0
                    ? "Break Limit Reached"
                    : `Break (${attendanceStatus.remaining_break_minutes || 40}m left)`}
                </button>
              ) : (
                <button
                  data-testid="manager-end-break-btn"
                  onClick={handleEndBreak}
                  disabled={loading}
                  className="btn-break"
                >
                  <Coffee className="inline h-4 w-4 mr-1" weight="bold" />
                  End Break
                </button>
              )}
              {!onPause ? (
                <button
                  data-testid="pause-btn"
                  onClick={handleStartPause}
                  disabled={loading || onBreak}
                  className={`btn-pause ${loading || onBreak ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Pause className="inline h-4 w-4 mr-1" weight="bold" />
                  Pause
                </button>
              ) : (
                <button
                  data-testid="resume-btn"
                  onClick={handleEndPause}
                  disabled={loading}
                  className="btn-pause"
                >
                  <Play className="inline h-4 w-4 mr-1" weight="bold" />
                  Resume
                </button>
              )}
            </div>
            <button
              data-testid="manager-clock-out-btn"
              onClick={handleClockOut}
              disabled={loading || onBreak || onPause}
              className={`btn-clock-out ${loading || onBreak || onPause ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={onBreak ? "End your break first" : onPause ? "Resume first" : ""}
            >
              <SignOut className="inline h-5 w-5 mr-2" weight="bold" />
              Clock Out
            </button>
            {!onBreak && !onPause && currentWorkingHours < requiredHours && (
              <button
                data-testid="emergency-clockout-link"
                onClick={() => setShowEmergencyDialog(true)}
                disabled={loading}
                className="w-full text-center text-xs font-semibold text-red-500 hover:text-red-600 mt-1 flex items-center justify-center gap-1"
              >
                <FirstAidKit className="h-3.5 w-3.5" weight="bold" />
                Emergency Clock-Out
              </button>
            )}
          </>
        )}
      </div>

      {/* Emergency Clock-Out Dialog */}
      <Dialog open={showEmergencyDialog} onOpenChange={(open) => { setShowEmergencyDialog(open); if (!open) setEmergencyReason(""); }}>
        <DialogContent data-testid="emergency-clockout-dialog" className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <FirstAidKit className="h-5 w-5" weight="fill" />
              Emergency Clock-Out
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              You've worked {formatHours(currentWorkingHours)} of the required {formatHours(requiredHours)}. Emergency clock-out bypasses this requirement — your manager will be notified immediately and this won't affect your leave balance.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="emergency-reason-input">Reason for emergency <span className="text-red-500">*</span></Label>
              <Textarea
                id="emergency-reason-input"
                data-testid="emergency-reason-input"
                placeholder="e.g. Family emergency, need to leave immediately"
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                rows={3}
              />
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button
                data-testid="emergency-clockout-cancel-btn"
                variant="outline"
                onClick={() => setShowEmergencyDialog(false)}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button
                data-testid="emergency-clockout-confirm-btn"
                onClick={handleEmergencyClockOut}
                disabled={loading}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Confirm Emergency Clock-Out
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Today's Summary */}
      {attendanceStatus.attendance && (
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-slate-400 text-xs font-medium mb-1">Clock In</p>
              <p className="font-bold text-slate-900">
                {new Date(attendanceStatus.attendance.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {attendanceStatus.attendance.clock_out && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-slate-400 text-xs font-medium mb-1">Clock Out</p>
                <p className="font-bold text-slate-900">
                  {new Date(attendanceStatus.attendance.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            )}
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-slate-400 text-xs font-medium mb-1">Break Time</p>
              <p className={`font-bold ${(attendanceStatus.attendance.total_break_minutes || 0) >= 40 ? 'text-red-500' : 'text-slate-900'}`}>
                {attendanceStatus.attendance.total_break_minutes || 0} / 40 min
              </p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-slate-400 text-xs font-medium mb-1">Paused Time</p>
              <p className="font-bold text-slate-900">
                {attendanceStatus.attendance.total_pause_minutes || 0} min
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Flexible Timer (only when admin enabled) */}
      {user?.timer_access_enabled && (
        <div data-testid="manager-flexible-timer-section" className="mt-5 pt-5 border-t border-slate-100">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex items-center justify-center w-7 h-7 bg-violet-50 rounded-lg">
              <Timer className="h-4 w-4 text-violet-600" weight="duotone" />
            </div>
            <span className="text-sm font-bold text-slate-800">Flexible Timer</span>
            <span className="ml-auto text-xs text-slate-400 font-mono">
              {formatTime(timerStatus.total_seconds + (timerStatus.is_running ? liveElapsed : 0))} / 8h 00m
            </span>
          </div>

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

          {timerStatus.is_running && (
            <div className="flex items-center justify-center gap-2 mb-3 py-2 bg-violet-50 rounded-xl">
              <span className="text-2xl font-mono font-extrabold text-violet-700 tracking-widest">
                {formatTime(liveElapsed)}
              </span>
              <span className="text-xs text-violet-400 self-end mb-0.5 animate-pulse">running</span>
            </div>
          )}

          <button
            data-testid="manager-flexible-timer-btn"
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
  );
}
