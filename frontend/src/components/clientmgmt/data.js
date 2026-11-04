import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { apiError } from "./constants";

// Loads a list from the API and reloads when the filters change. Returns [rows (null while loading), reload].
export function useList(api, url, params) {
  const [rows, setRows] = useState(null);
  const key = JSON.stringify(params || {});
  const load = useCallback(async () => {
    try { const { data } = await api.get(url, { params }); setRows(data); } catch (e) { toast.error(apiError(e, "Couldn't load")); setRows([]); }
  }, [api, url, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return [rows, load];
}

// Can this person change a row? Managers anything; Sales-role people only rows they own; viewers nothing.
export const canEditRow = (level, user, ownerId) => level === "mgr" || (level === "sales" && ownerId === user.id);
