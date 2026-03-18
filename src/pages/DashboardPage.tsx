import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { KpiCards } from "@/components/dashboard/KpiCards";
import { FilterBar } from "@/components/dashboard/FilterBar";
import { TrackingTable } from "@/components/dashboard/TrackingTable";
import { AdSpendDialog } from "@/components/dashboard/AdSpendDialog";
import { fetchAccounts, fetchCampaigns, fetchTrackingLinks, fetchAdSpend, triggerSync } from "@/lib/supabase-helpers";
import { toast } from "sonner";

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

  const syncMutation = useMutation({
    mutationFn: () => triggerSync(filters.account_id !== "all" ? filters.account_id : undefined),
    onSuccess: () => {
      toast.success("Sync completed");
      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
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

  // Compute KPIs
  const totalRevenue = filteredLinks.reduce((s: number, l: any) => s + Number(l.revenue), 0);
  const totalClicks = filteredLinks.reduce((s: number, l: any) => s + l.clicks, 0);
  const totalSubscribers = filteredLinks.reduce((s: number, l: any) => s + l.subscribers, 0);
  const totalAdSpend = adSpendData.reduce((s: number, a: any) => s + Number(a.amount), 0);
  const epc = totalClicks > 0 ? totalRevenue / totalClicks : 0;
  const conversionRate = totalClicks > 0 ? (totalSubscribers / totalClicks) * 100 : 0;
  const profit = totalRevenue - totalAdSpend;
  const roi = totalAdSpend > 0 ? (profit / totalAdSpend) * 100 : 0;

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Campaign Dashboard</h1>
            <p className="text-sm text-muted-foreground">Track performance across all accounts</p>
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
