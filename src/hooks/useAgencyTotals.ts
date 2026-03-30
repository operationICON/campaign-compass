import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTrackingLinks } from "@/lib/supabase-helpers";
import { calcAgencyTotals, type AgencyTotals } from "@/lib/calc-helpers";

interface UseAgencyTotalsOptions {
  accountIds?: string[] | null;
}

export function useAgencyTotals(options?: UseAgencyTotalsOptions): AgencyTotals & { isLoading: boolean } {
  const { data: links = [], isLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: () => fetchTrackingLinks(),
  });

  const totals = useMemo(() => {
    let filtered = links;
    if (options?.accountIds && options.accountIds.length > 0) {
      const idSet = new Set(options.accountIds);
      filtered = filtered.filter((l: any) => idSet.has(l.account_id));
    }

    return calcAgencyTotals(filtered);
  }, [links, options?.accountIds]);

  return { ...totals, isLoading };
}
