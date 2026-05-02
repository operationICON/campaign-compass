import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
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
import MarketerModelCampaignsPage from "./pages/MarketerModelCampaignsPage";
import CrossPollPage from "./pages/CrossPollPage";
import FansPage from "./pages/FansPage";
import CampaignAnalyticsPage from "./pages/CampaignAnalyticsPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Accessible to all authenticated users */}
            <Route path="/campaigns" element={<ProtectedRoute><CampaignsPage /></ProtectedRoute>} />
            {/* Admin-only routes */}
            <Route path="/" element={<ProtectedRoute adminOnly><DashboardPage /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute adminOnly><AuditPage /></ProtectedRoute>} />
            <Route path="/calculations" element={<ProtectedRoute adminOnly><CalculationsPage /></ProtectedRoute>} />
            <Route path="/accounts" element={<ProtectedRoute adminOnly><AccountsPage /></ProtectedRoute>} />
            <Route path="/charts" element={<ProtectedRoute adminOnly><ChartsPage /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute adminOnly><AlertsPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute adminOnly><SettingsPage /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute adminOnly><LogsPage /></ProtectedRoute>} />
            <Route path="/debug" element={<ProtectedRoute adminOnly><DebugPage /></ProtectedRoute>} />
            <Route path="/traffic-sources" element={<ProtectedRoute adminOnly><TrafficSourcesPage /></ProtectedRoute>} />
            <Route path="/sources/onlytraffic/:marketer/:offer_id" element={<ProtectedRoute adminOnly><MarketerDrilldownPage /></ProtectedRoute>} />
            <Route path="/sources/onlytraffic/:marketer/:offer_id/:model_username" element={<ProtectedRoute adminOnly><MarketerModelCampaignsPage /></ProtectedRoute>} />
            <Route path="/cross-poll" element={<ProtectedRoute adminOnly><CrossPollPage /></ProtectedRoute>} />
            <Route path="/fans" element={<ProtectedRoute adminOnly><FansPage /></ProtectedRoute>} />
            <Route path="/campaign-analytics" element={<ProtectedRoute adminOnly><CampaignAnalyticsPage /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
