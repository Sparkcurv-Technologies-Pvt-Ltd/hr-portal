import { useState, useEffect } from "react";

// Last-4-weeks attendance heatmap for the admin overview, fetched once on mount.
export function useAttendanceHeatmap(api) {
  const [heatmapData, setHeatmapData] = useState({ dates: [], employees: [] });

  useEffect(() => {
    const fetchHeatmap = async () => {
      try {
        const res = await api.get("/admin/attendance/heatmap?weeks=4");
        setHeatmapData(res.data);
      } catch {}
    };
    fetchHeatmap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return heatmapData;
}
