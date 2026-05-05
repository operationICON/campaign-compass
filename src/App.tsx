import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const LoginPage                  = lazy(() => import("./pages/LoginPage"));
const DashboardPage              = lazy(() => import("./pages/DashboardPage"));
const AccountsPage               = lazy(() => import("./pages/AccountsPage"));
const CampaignsPage              = lazy(() => import("./pages/CampaignsPage"));
const AuditPage                  = lazy(() => import("./pages/AuditPage"));
const CalculationsPage           = lazy(() => import("./pages/CalculationsPage"));
const ChartsPage                 = lazy(() => import("./pages/ChartsPage"));
const AlertsPage                 = lazy(() => import("./pages/AlertsPage"));
const SettingsPage               = lazy(() => import("./pages/SettingsPage"));
const LogsPage                   = lazy(() => import("./pages/LogsPage"));
const DebugPage                  = lazy(() => import("./pages/DebugPage"));
const TrafficSourcesPage         = lazy(() => import("./pages/TrafficSourcesPage"));
const MarketerDrilldownPage      = lazy(() => import("./pages/MarketerDrilldownPage"));
const MarketerModelCampaignsPage = lazy(() => import("./pages/MarketerModelCampaignsPage"));
const CrossPollPage              = lazy(() => import("./pages/CrossPollPage"));
const FansPage                   = lazy(() => import("./pages/FansPage"));
const CampaignAnalyticsPage      = lazy(() => import("./pages/CampaignAnalyticsPage"));
const NotFound                   = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000,      // data stays fresh 3 min — no refetch on every focus
      refetchOnWindowFocus: false,    // stop refetching every time user switches tabs
      retry: 1,
    },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={
            <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#09090b" }}>
              <div style={{ width:28, height:28, border:"2px solid #27272a", borderTopColor:"#a855f7", borderRadius:"50%", animation:"spin 0.7s linear infinite" }} />
            </div>
          }>
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
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
