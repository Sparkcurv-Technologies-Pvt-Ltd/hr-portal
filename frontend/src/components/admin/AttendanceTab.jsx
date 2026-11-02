import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { DownloadSimple, FileXls, MapPin, GearSix, NavigationArrow, ClockCounterClockwise } from "@phosphor-icons/react";
import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import L from "leaflet";
import { saveBlobAsFile } from "@/lib/api";
import { formatHours } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import "leaflet/dist/leaflet.css";

// Fix default Leaflet icon
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

export function AttendanceTab({
  api, attendance, employees, isAdmin, loading, setLoading, locationData, setLocationData,
  officeSettings, setOfficeSettings, officeForm, setOfficeForm, attendanceView, setAttendanceView,
  locationDate, setLocationDate, exportForm, setExportForm, detectingLocation,
  setDetectingLocation
}) {
  const { can } = usePermissions();
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const [officeDialogOpen, setOfficeDialogOpen] = useState(false);

  const handleSaveOfficeSettings = async () => {
    // Sanitize: replace NaN with last valid value before sending
    const payload = {
      ...officeForm,
      latitude: isNaN(officeForm.latitude) ? 8.1815 : officeForm.latitude,
      longitude: isNaN(officeForm.longitude) ? 77.4294 : officeForm.longitude,
      radius_km: isNaN(officeForm.radius_km) ? 0.5 : officeForm.radius_km,
      geofence_bypass: Boolean(officeForm.geofence_bypass),
    };
    try {
      await api.put("/admin/office-settings", payload);
      toast.success("Office location settings saved!");
      setOfficeSettings({ ...payload, name: payload.office_name });
      setOfficeDialogOpen(false);
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to save office settings");
    }
  };

  const handleAutoDetectLocation = () => {
    if (!navigator.geolocation) {
      toast.error("Geolocation is not supported by your browser");
      return;
    }
    setDetectingLocation(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        setOfficeForm(prev => ({ ...prev, latitude: lat, longitude: lng }));
        // Try reverse geocode for address
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`, {
            headers: { "User-Agent": "SparkCurv-HR-Portal/1.0" }
          });
          const data = await res.json();
          if (data.display_name) {
            setOfficeForm(prev => ({ ...prev, latitude: lat, longitude: lng, address: data.display_name }));
          }
        } catch { /* ignore geocode errors */ }
        toast.success(`Location detected: ${lat}, ${lng}`);
        setDetectingLocation(false);
      },
      (err) => {
        setDetectingLocation(false);
        if (err.code === 1) toast.error("Location permission denied. Please allow access in your browser.");
        else toast.error("Could not detect location. Please enter coordinates manually.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const fetchLocationData = async (date) => {
    try {
      const res = await api.get(`/admin/attendance/locations?date=${date}`);
      setLocationData(res.data);
    } catch { setLocationData([]); }
  };

  const handleExportAttendance = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        start_date: exportForm.start_date,
        end_date: exportForm.end_date
      });
      if (exportForm.employee_id) {
        params.append("employee_id", exportForm.employee_id);
      }

      const response = await api.get(`/reports/attendance/export?${params.toString()}`, {
        responseType: 'blob'
      });
      
      saveBlobAsFile(response.data, `attendance_report_${exportForm.start_date}_to_${exportForm.end_date}.xlsx`);
      
      toast.success("Attendance report exported!");
      setExportDialogOpen(false);
    } catch (error) {
      toast.error("Failed to export attendance report");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="font-bold text-slate-900 font-['Outfit'] tracking-tight">Attendance Records</h1>
          <p className="text-slate-500 mt-1 text-sm">View employee attendance with location tracking</p>
        </div>
        <div className="flex items-center gap-2">
          {can("attendance", "edit") && (
            <Dialog open={officeDialogOpen} onOpenChange={setOfficeDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="office-settings-btn" variant="outline" className="gap-2 rounded-xl h-10 px-4">
                  <GearSix className="h-4 w-4" />
                  Office Location
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg rounded-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="font-['Outfit']">Office Geofence Settings</DialogTitle>
                </DialogHeader>
                <p className="text-sm text-slate-500 -mt-2">Set office coordinates and allowed radius for login.</p>
                <div className="space-y-4 pt-4">
                  {/* Auto Detect Location */}
                  <button
                    data-testid="auto-detect-location-btn"
                    onClick={handleAutoDetectLocation}
                    disabled={detectingLocation}
                    className="w-full h-11 flex items-center justify-center gap-2 px-4 rounded-xl border-2 border-dashed border-[#0020F8] text-[#0020F8] font-semibold text-sm hover:bg-[var(--brand-primary-light)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <NavigationArrow className={`h-4 w-4 ${detectingLocation ? 'animate-spin' : ''}`} weight="fill" />
                    {detectingLocation ? "Detecting your location…" : "Auto Detect My Current Location"}
                  </button>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Office Name</Label>
                    <Input data-testid="office-name-input" className="rounded-xl h-11" value={officeForm.office_name} onChange={(e) => setOfficeForm({ ...officeForm, office_name: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Address</Label>
                    <Input data-testid="office-address-input" className="rounded-xl h-11" placeholder="Full address" value={officeForm.address || ""} onChange={(e) => setOfficeForm({ ...officeForm, address: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Latitude</Label>
                      <Input data-testid="office-lat-input" className="rounded-xl h-11" type="number" step="0.0001" value={officeForm.latitude} onChange={(e) => { const v = parseFloat(e.target.value); setOfficeForm({ ...officeForm, latitude: isNaN(v) ? officeForm.latitude : v }); }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold text-slate-600">Longitude</Label>
                      <Input data-testid="office-lng-input" className="rounded-xl h-11" type="number" step="0.0001" value={officeForm.longitude} onChange={(e) => { const v = parseFloat(e.target.value); setOfficeForm({ ...officeForm, longitude: isNaN(v) ? officeForm.longitude : v }); }} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Allowed Radius (km)</Label>
                    <Input data-testid="office-radius-input" className="rounded-xl h-11" type="number" step="0.1" value={officeForm.radius_km} onChange={(e) => { const v = parseFloat(e.target.value); setOfficeForm({ ...officeForm, radius_km: isNaN(v) ? officeForm.radius_km : v }); }} />
                    <p className="text-xs text-slate-400">{((officeForm.radius_km || 0) * 1000).toFixed(0)} meters — employees must be within this range to log in</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border" style={{ background: "var(--badge-amber-bg)", borderColor: "var(--badge-amber-border)" }}>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Bypass Geofence</p>
                      <p className="text-xs text-[color:var(--badge-amber-text)]">Allow login from any location (disables GPS check)</p>
                    </div>
                    <button
                      data-testid="geofence-bypass-toggle"
                      onClick={() => setOfficeForm({ ...officeForm, geofence_bypass: !officeForm.geofence_bypass })}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${officeForm.geofence_bypass ? 'bg-amber-500' : 'bg-slate-300'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${officeForm.geofence_bypass ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                  </div>
                  <Button data-testid="save-office-btn" onClick={handleSaveOfficeSettings} className="w-full h-11 bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl">
                    Save Office Location
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="export-attendance-btn" className="bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2 rounded-xl h-10 px-4">
                <FileXls className="h-4 w-4" weight="bold" />
                Export to Excel
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-2xl">
              <DialogHeader>
                <DialogTitle className="font-['Outfit']">Export Attendance Report</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-slate-500 -mt-2">Select date range and employee to export.</p>
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">Start Date</Label>
                    <Input data-testid="export-start-date" className="rounded-xl h-11" type="date" value={exportForm.start_date} onChange={(e) => setExportForm({ ...exportForm, start_date: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-slate-600">End Date</Label>
                    <Input data-testid="export-end-date" className="rounded-xl h-11" type="date" value={exportForm.end_date} onChange={(e) => setExportForm({ ...exportForm, end_date: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Employee (optional)</Label>
                  <Select value={exportForm.employee_id || "all"} onValueChange={(value) => setExportForm({ ...exportForm, employee_id: value === "all" ? "" : value })}>
                    <SelectTrigger data-testid="export-employee-select" className="rounded-xl h-11"><SelectValue placeholder="All employees" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All employees</SelectItem>
                      {employees.filter(e => e.role !== "admin").map((emp) => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button data-testid="download-export-btn" onClick={handleExportAttendance} disabled={loading} className="w-full h-11 bg-[#0020F8] text-white hover:bg-[#0019C4] gap-2 rounded-xl">
                  <DownloadSimple className="h-4 w-4" />
                  Download Excel Report
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* View Toggle */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="inline-flex gap-1 p-1 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-sm)" }}>
          <button
            data-testid="attendance-table-view"
            onClick={() => setAttendanceView("table")}
            className={`px-4 h-9 text-sm font-semibold rounded-lg transition-all ${attendanceView === "table" ? "bg-[#0020F8] text-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
          >
            Table View
          </button>
          <button
            data-testid="attendance-map-view"
            onClick={() => { setAttendanceView("map"); fetchLocationData(locationDate); }}
            className={`px-4 h-9 text-sm font-semibold rounded-lg transition-all ${attendanceView === "map" ? "bg-[#0020F8] text-white shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
          >
            Map View
          </button>
        </div>
        {attendanceView === "map" && (
          <Input
            data-testid="location-date-picker"
            type="date"
            value={locationDate}
            onChange={(e) => { setLocationDate(e.target.value); fetchLocationData(e.target.value); }}
            className="w-44 rounded-xl h-11"
          />
        )}
      </div>

      {/* Table View */}
      {attendanceView === "table" && (
        <div className="section-card">
          <div className="section-header">
            <div>
              <h2 className="text-base font-bold font-['Outfit'] text-slate-900">Recent attendance</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {attendance.length > 50 ? `Showing the latest 50 of ${attendance.length} records` : `${attendance.length} record${attendance.length === 1 ? "" : "s"}`}
              </p>
            </div>
          </div>
          <div>
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">Employee</th>
                <th className="table-header">Date</th>
                <th className="table-header">Login</th>
                <th className="table-header">Logout</th>
                <th className="table-header">Location</th>
                <th className="table-header">Hours</th>
                <th className="table-header">Status</th>
              </tr>
            </thead>
            <tbody>
              {attendance.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] lg:max-w-[calc(100vw-21rem)] flex flex-col items-center justify-center text-center py-14 px-6 gap-3">
                      <span className="stat-icon tone-blue"><ClockCounterClockwise className="h-5 w-5" weight="duotone" /></span>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">No attendance records</p>
                        <p className="text-xs text-slate-500 mt-1">Clock-ins will show up here as employees start their day.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                attendance.slice(0, 50).map((rec, idx) => (
                  <tr key={idx} className="table-row">
                    <td className="table-cell font-semibold" style={{ color: "var(--text-primary)" }}>{rec.user_name}</td>
                    <td className="table-cell whitespace-nowrap">{format(new Date(rec.date), "MMM d, yyyy")}</td>
                    <td className="table-cell whitespace-nowrap font-medium" style={{ color: "var(--text-secondary)" }}>{format(new Date(rec.clock_in), "h:mm a")}</td>
                    <td className="table-cell whitespace-nowrap font-medium" style={{ color: "var(--text-secondary)" }}>
                      {rec.clock_out ? format(new Date(rec.clock_out), "h:mm a") : "—"}
                    </td>
                    <td className="table-cell">
                      {rec.clock_in_address ? (
                        <div className="max-w-[200px]">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 text-[#0020F8] flex-shrink-0" weight="fill" />
                            <span className="text-xs text-slate-600 truncate" title={rec.clock_in_address}>
                              {rec.clock_in_address.split(",").slice(0, 3).join(",")}
                            </span>
                          </div>
                          {rec.location_type && (
                            <span className={`chip mt-1 ${rec.location_type === "Office" ? "tone-blue" : "tone-violet"}`} style={{ fontSize: 10.5, padding: "1px 8px" }}>{rec.location_type}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No location</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <span className={`whitespace-nowrap ${rec.working_hours && rec.working_hours < 8 ? "text-[color:var(--badge-red-text)] font-semibold" : "font-semibold text-slate-900"}`}>
                        {rec.working_hours ? formatHours(rec.working_hours) : "—"}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-1.5">
                        {rec.is_emergency_clockout ? (
                          <span
                            data-testid={`emergency-badge-${rec.user_id}-${rec.date}`}
                            className="badge-rejected"
                            title={rec.emergency_reason || "Emergency logout"}
                          >
                            Emergency
                          </span>
                        ) : rec.is_short_day ? (
                          <span className="badge-rejected">Short Day</span>
                        ) : rec.clock_out ? (
                          <span className="badge-approved">Completed</span>
                        ) : (
                          <span className="badge-pending">Active</span>
                        )}
                      </div>
                      {rec.is_emergency_clockout && rec.emergency_reason && (
                        <p className="text-[10px] text-slate-400 mt-1 max-w-[180px] truncate" title={rec.emergency_reason}>"{rec.emergency_reason}"</p>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Map View */}
      {attendanceView === "map" && (
        <div className="section-card">
          <div className="section-header">
            <div className="flex items-center gap-3 min-w-0">
              <span className="stat-icon tone-blue" style={{ width: 36, height: 36, borderRadius: 11 }}><NavigationArrow className="h-4 w-4" weight="fill" /></span>
              <div className="min-w-0">
                <h2 className="text-base font-bold font-['Outfit'] text-slate-900">Employee locations</h2>
                <p className="text-xs text-slate-500 mt-0.5">{format(new Date(locationDate + "T00:00:00"), "EEEE, MMM d, yyyy")}</p>
              </div>
            </div>
            <span className="chip tone-blue">{locationData.length} records with location</span>
          </div>
          <div style={{ height: "min(500px, 65vh)", width: "100%" }} data-testid="attendance-map">
            <MapContainer
              key={`${officeSettings.latitude}-${officeSettings.longitude}`}
              center={[officeSettings.latitude, officeSettings.longitude]}
              zoom={14}
              style={{ height: "100%", width: "100%" }}
              scrollWheelZoom={true}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {/* Office geofence circle */}
              <Circle
                center={[officeSettings.latitude, officeSettings.longitude]}
                radius={officeSettings.radius_km * 1000}
                pathOptions={{ color: "#0020F8", fillColor: "#0020F8", fillOpacity: 0.08, weight: 2, dashArray: "5 5" }}
              />
              <Marker position={[officeSettings.latitude, officeSettings.longitude]}>
                <Popup>
                  <strong>{officeSettings.name || officeSettings.office_name || "Office"}</strong><br />
                  {officeSettings.address && <span className="text-xs text-slate-500">{officeSettings.address}<br /></span>}
                  <span className="text-xs">Geofence: {(officeSettings.radius_km * 1000).toFixed(0)}m radius</span>
                </Popup>
              </Marker>
              {/* Employee clock-in markers */}
              {locationData.map((rec) => rec.clock_in_lat && (
                <Marker key={`in-${rec.id}`} position={[rec.clock_in_lat, rec.clock_in_lng]}>
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <strong>{rec.user_name}</strong> ({rec.employee_code})<br />
                      <span style={{ fontSize: 11 }}>Login: {format(new Date(rec.clock_in), "h:mm a")}</span><br />
                      {rec.clock_out && <><span style={{ fontSize: 11 }}>Logout: {format(new Date(rec.clock_out), "h:mm a")}</span><br /></>}
                      <span style={{ fontSize: 11, color: "#666" }}>{rec.clock_in_address?.split(",").slice(0, 3).join(",")}</span><br />
                      {rec.location_type && <span style={{ fontSize: 10, background: rec.location_type === "Office" ? "#e3f2fd" : "#f3e5f5", padding: "2px 6px", borderRadius: 8 }}>{rec.location_type}</span>}
                    </div>
                  </Popup>
                </Marker>
              ))}
              {/* Clock-out markers */}
              {locationData.filter(r => r.clock_out_lat).map((rec) => (
                <Marker key={`out-${rec.id}`} position={[rec.clock_out_lat, rec.clock_out_lng]}>
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <strong>{rec.user_name}</strong> — Logout<br />
                      <span style={{ fontSize: 11 }}>{format(new Date(rec.clock_out), "h:mm a")}</span><br />
                      <span style={{ fontSize: 11, color: "#666" }}>{rec.clock_out_address?.split(",").slice(0, 3).join(",")}</span>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>
          {/* Location legend */}
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-medium text-slate-500">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full border-2 border-[#0020F8] bg-[#0020F8]/10"></div>
              Office Geofence
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-blue-600" weight="fill" />
              Login
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-red-500" weight="fill" />
              Logout
            </div>
          </div>
        </div>
      )}
    </>
  );
}
