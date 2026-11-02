import { useState, useEffect } from "react";

// Admin/manager pending-items feed (leave, WFH, CR, permission), polled every 30 seconds.
// Also raises a browser notification when the pending total grows.
const canNotify = typeof window !== "undefined" && "Notification" in window;

export function useNotifications(api) {
  const [notifications, setNotifications] = useState({ total: 0, items: [] });

  useEffect(() => {
    const fetchNotifications = async () => {
      try {
        const res = await api.get("/admin/notifications");
        setNotifications(res.data);
        // Browser notification for new pending items
        if (res.data.total > 0 && canNotify && Notification.permission === "granted") {
          // Only show if there's a new increase (basic check)
          const prevTotal = parseInt(sessionStorage.getItem("notif_total") || "0");
          if (res.data.total > prevTotal) {
            new Notification("Sparkcurv HR Portal", {
              body: res.data.items.map(i => i.label).join(", "),
              icon: "/favicon.ico"
            });
          }
          sessionStorage.setItem("notif_total", res.data.total.toString());
        }
      } catch {}
    };
    // Request notification permission
    if (canNotify && Notification.permission === "default") {
      Notification.requestPermission();
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
    // Runs once on mount (the original dashboard effect intentionally had no deps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return notifications;
}
