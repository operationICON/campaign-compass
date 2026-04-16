import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardPage from "./pages/DashboardPage";
import AccountsPage from "./pages/AccountsPage";
import CampaignsPage from "./pages/CampaignsPage";
import AuditPage from "./pages/AuditPage";
import CalculationsPage from "./pages/CalculationsPage";
import ChartsPage from "./pages/ChartsPage";
import AlertsPage from "./pages/AlertsPage";
import SettingsPage from "./pages/SettingsPage";
import LogsPage from "./pages/LogsPage";
import DebugPage from "./pages/DebugPage";
import TrafficSourcesPage from "./pages/TrafficSourcesPage";
import MarketerDrilldownPage from "./pages/MarketerDrilldownPage";
import CrossPollPage from "./pages/CrossPollPage";
import FansPage from "./pages/FansPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/campaigns" element={<CampaignsPage />} />
          <Route path="/audit" element={<AuditPage />} />
          <Route path="/calculations" element={<CalculationsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/charts" element={<ChartsPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/debug" element={<DebugPage />} />
          <Route path="/traffic-sources" element={<TrafficSourcesPage />} />
          <Route path="/sources/onlytraffic/:marketer/:offer_id" element={<MarketerDrilldownPage />} />
          <Route path="/cross-poll" element={<CrossPollPage />} />
          <Route path="/fans" element={<FansPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
