import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useList } from "../data";
import { apiError } from "../constants";

// Rows for one sheet (filtered by the BDR picked in the toolbar) plus a save helper that reports errors and reloads.
export function useSheet(api, url, bdr, refreshKey, extra) {
  const params = useMemo(() => ({ ...(bdr ? { owner_id: bdr } : {}), ...(extra || {}), _r: refreshKey }), [bdr, refreshKey, extra]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [rows, load] = useList(api, url, params);
  const run = useCallback(async (fn, ok) => {
    try { const r = await fn(); if (ok) toast.success(ok); await load(); return r ?? true; }
    catch (e) { toast.error(apiError(e, "That didn't save")); await load(); return false; }
  }, [load]);
  return { rows: rows || [], loading: rows === null, load, run };
}
