import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchTrackingLinks } from "@/lib/supabase-helpers";

interface AgencyTotals {
  totalLtv: number;
  totalSpend: number;
  totalProfit: number;
  avgProfitPerSub: number | null;
  hasSpend: boolean;
  paidSubscribers: number;
}

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

    const totalLtv = filtered.reduce((sum: number, l: any) => sum + Number(l.ltv || l.revenue || 0), 0);
    const totalSpend = filtered.reduce((sum: number, l: any) => {
      const cost = Number(l.cost_total || 0);
      return sum + (cost > 0 ? cost : 0);
    }, 0);
    const totalProfit = totalLtv - totalSpend;
    const paidSubscribers = filtered.reduce((sum: number, l: any) => {
      return Number(l.cost_total || 0) > 0 ? sum + (l.subscribers || 0) : sum;
    }, 0);
    const avgProfitPerSub = totalSpend > 0 && paidSubscribers > 0 ? totalProfit / paidSubscribers : null;
    const hasSpend = totalSpend > 0;

    return { totalLtv, totalSpend, totalProfit, avgProfitPerSub, hasSpend, paidSubscribers };
  }, [links, options?.accountIds]);

  return { ...totals, isLoading };
}
