import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the Set of tracking_links.id values where deleted_at IS NULL.
 *
 * Used everywhere we aggregate auxiliary tables (daily_metrics, daily_snapshots,
 * tracking_link_ltv, etc.) to ensure deleted tracking links are excluded from
 * revenue / spend / subscriber / click totals.
 *
 * Cached under a stable key so it's shared across the app.
 */
export function useActiveLinkIdSet() {
  const { data: ids = [], isLoading } = useQuery({
    queryKey: ["active_tracking_link_ids"],
    queryFn: async () => {
      const all: string[] = [];
      let from = 0;
      const size = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("tracking_links")
          .select("id")
          .is("deleted_at", null)
          .range(from, from + size - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) all.push(String(r.id).toLowerCase());
        if (data.length < size) break;
        from += size;
      }
      return all;
    },
    staleTime: 60_000,
  });

  const set = useMemo(() => new Set(ids), [ids]);
  return { activeLinkIds: set, isLoading };
}

/**
 * Filters any array of rows that have a `tracking_link_id` field, keeping
 * only those whose tracking link is NOT deleted (i.e. present in `activeLinkIds`).
 *
 * Rows with no `tracking_link_id` are excluded (they cannot be safely attributed).
 */
export function filterByActiveLinks<T extends { tracking_link_id?: string | null }>(
  rows: T[],
  activeLinkIds: Set<string>
): T[] {
  if (activeLinkIds.size === 0) return rows; // not loaded yet — pass through
  return rows.filter(r => {
    const id = r.tracking_link_id ? String(r.tracking_link_id).toLowerCase() : "";
    return id && activeLinkIds.has(id);
  });
}
