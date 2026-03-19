import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { TrackingTable } from "@/components/dashboard/TrackingTable";
import { AdSpendDialog } from "@/components/dashboard/AdSpendDialog";
import { fetchAccounts, fetchCampaigns, fetchTrackingLinks, fetchAdSpend, fetchTransactions, triggerSync } from "@/lib/supabase-helpers";
import { toast } from "sonner";
import { format } from "date-fns";
import { Clock } from "lucide-react";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({
    account_id: "all",
    campaign_id: "all",
    traffic_source: "all",
    country: "all",
    date_from: "",
    date_to: "",
  });

  const { data: accounts = [] } = useQuery({ queryKey: ["accounts"], queryFn: fetchAccounts });
  const { data: campaigns = [] } = useQuery({ queryKey: ["campaigns"], queryFn: fetchCampaigns });

  const queryFilters = useMemo(() => ({
    account_id: filters.account_id !== "all" ? filters.account_id : undefined,
    campaign_id: filters.campaign_id !== "all" ? filters.campaign_id : undefined,
    date_from: filters.date_from || undefined,
    date_to: filters.date_to || undefined,
  }), [filters]);

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links", queryFilters],
    queryFn: () => fetchTrackingLinks(queryFilters),
  });

  const { data: adSpendData = [] } = useQuery({
    queryKey: ["ad_spend", queryFilters],
    queryFn: () => fetchAdSpend(queryFilters),
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ["transactions", queryFilters],
    queryFn: () => fetchTransactions(queryFilters),
  });

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(filters.account_id !== "all" ? filters.account_id : undefined),
    onSuccess: (data) => {
      const results = data?.results ?? [];
      const errors = results.filter((r: any) => r.status === 'error');
      if (errors.length > 0) {
        toast.warning(`Sync completed with ${errors.length} error(s). Check Sync Logs.`);
      } else {
        toast.success(`Sync completed — ${results.length} account(s) processed`);
      }
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["ad_spend"] });
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (err: any) => toast.error(`Sync failed: ${err.message}`),
  });

  // Apply client-side filters for traffic_source and country
  const filteredLinks = useMemo(() => {
    return links.filter((link: any) => {
      if (filters.traffic_source !== "all" && link.campaigns?.traffic_source !== filters.traffic_source) return false;
      if (filters.country !== "all" && link.campaigns?.country !== filters.country) return false;
      return true;
    });
  }, [links, filters.traffic_source, filters.country]);

  // KPIs from tracking links
  const linkRevenue = filteredLinks.reduce((s: number, l: any) => s + Number(l.revenue), 0);
  const totalClicks = filteredLinks.reduce((s: number, l: any) => s + l.clicks, 0);
  const totalSubscribers = filteredLinks.reduce((s: number, l: any) => s + l.subscribers, 0);
  const totalAdSpend = adSpendData.reduce((s: number, a: any) => s + Number(a.amount), 0);
  
  // Total revenue from all transactions (gross)
  const totalRevenue = transactions.reduce((s: number, t: any) => s + Number(t.revenue ?? 0), 0);
  
  const epc = totalClicks > 0 ? linkRevenue / totalClicks : 0;
  const conversionRate = totalClicks > 0 ? (totalSubscribers / totalClicks) * 100 : 0;
  const profit = totalRevenue - totalAdSpend;
  const roi = totalAdSpend > 0 ? (profit / totalAdSpend) * 100 : 0;

  // Last synced time from accounts
  const lastSynced = useMemo(() => {
    const syncTimes = accounts
      .map((a: any) => a.last_synced_at)
      .filter(Boolean)
      .sort()
      .reverse();
    return syncTimes[0] ?? null;
  }, [accounts]);

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Campaign Dashboard</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-muted-foreground">Track performance across all accounts</p>
              {lastSynced && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  <Clock className="h-3 w-3" />
                  Last synced: {format(new Date(lastSynced), "MMM d, HH:mm")}
                </span>
              )}
            </div>
          </div>
          <AdSpendDialog campaigns={campaigns} onAdded={() => queryClient.invalidateQueries({ queryKey: ["ad_spend"] })} />
        </div>

        <KpiCards
          totalRevenue={totalRevenue}
          totalClicks={totalClicks}
          totalSubscribers={totalSubscribers}
          epc={epc}
          conversionRate={conversionRate}
          profit={profit}
          roi={roi}
        />

        <FilterBar
          accounts={accounts}
          campaigns={campaigns}
          filters={filters}
          onFilterChange={handleFilterChange}
          onSync={() => syncMutation.mutate()}
          isSyncing={syncMutation.isPending}
        />

        <TrackingTable links={filteredLinks} isLoading={linksLoading} />
      </div>
    </DashboardLayout>
  );
}
