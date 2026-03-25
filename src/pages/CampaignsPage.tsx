import { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import TrackingLinksTab from "@/components/campaigns/TrackingLinksTab";
import ExpensesTab from "@/components/campaigns/ExpensesTab";
import MediaBuyersTab from "@/components/campaigns/MediaBuyersTab";

const TAB_KEY = "campaigns_active_tab";

const SUBTITLES: Record<string, string> = {
  tracking: "All tracking links and performance data",
  expenses: "Spend, profit and cost per campaign",
  media: "Performance by traffic source",
};

export default function CampaignsPage() {
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem(TAB_KEY) || "tracking"; } catch { return "tracking"; }
  });

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, activeTab); } catch {}
  }, [activeTab]);

  return (
    <DashboardLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-1">{SUBTITLES[activeTab]}</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="bg-transparent border-b border-border rounded-none h-auto p-0 gap-0">
            {[
              { value: "tracking", label: "Tracking Links" },
              { value: "expenses", label: "Expenses" },
              { value: "media", label: "Media Buyers" },
            ].map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="rounded-none border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none transition-colors"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="tracking" className="mt-5">
            <TrackingLinksTab />
          </TabsContent>
          <TabsContent value="expenses" className="mt-5">
            <ExpensesTab />
          </TabsContent>
          <TabsContent value="media" className="mt-5">
            <MediaBuyersTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
