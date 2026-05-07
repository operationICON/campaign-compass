import { useState } from "react";
import { format } from "date-fns";
import { Loader2, AlertTriangle } from "lucide-react";

const API_BASE = "https://app.onlyfansapi.com/api";

interface Account {
  id: string;
  display_name: string;
  username: string | null;
  onlyfans_account_id: string;
}

interface EndpointLibraryProps {
  accounts: Account[];
  onCall: (url: string) => Promise<void>;
  loading: boolean;
}

function AccountSelect({ accounts, value, onChange }: { accounts: Account[]; value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-md border border-input bg-background px-3 text-xs font-mono w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {accounts.map((a) => (
        <option key={a.id} value={a.onlyfans_account_id}>
          @{a.username ?? a.display_name} — {a.onlyfans_account_id.slice(0, 20)}…
        </option>
      ))}
    </select>
  );
}

function EndpointButton({ label, onClick, loading, variant = "default", warning }: {
  label: string; onClick: () => void; loading: boolean; variant?: "default" | "warning"; warning?: string;
}) {
  return (
    <div>
      <button
        onClick={onClick}
        disabled={loading}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-colors disabled:opacity-50 border ${
          variant === "warning"
            ? "border-amber-400/50 text-amber-600 hover:bg-amber-50"
            : "border-[#0891b2]/30 text-[#0891b2] hover:bg-[#0891b2] hover:text-white"
        }`}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
        {label}
      </button>
      {warning && (
        <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> {warning}
        </p>
      )}
    </div>
  );
}

export function EndpointLibrary({ accounts, onCall, loading }: EndpointLibraryProps) {
  const now = new Date();
  const [acct1, setAcct1] = useState(accounts[0]?.onlyfans_account_id ?? "");
  const [acct2, setAcct2] = useState(accounts[0]?.onlyfans_account_id ?? "");
  const [acct3, setAcct3] = useState(accounts[0]?.onlyfans_account_id ?? "");
  const [acct4, setAcct4] = useState(accounts[0]?.onlyfans_account_id ?? "");
  const [tlId, setTlId] = useState("2876566");
  const [fanId, setFanId] = useState("");
  const [dateStart, setDateStart] = useState(format(new Date(now.getFullYear(), now.getMonth(), 1), "yyyy-MM-dd"));
  const [dateEnd, setDateEnd] = useState(format(now, "yyyy-MM-dd"));

  return (
    <div className="space-y-6">
      {/* Group 1 — Tracking Links */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold text-foreground">Tracking Links</h3>
        <div className="max-w-sm">
          <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Account</label>
          <AccountSelect accounts={accounts} value={acct1} onChange={setAcct1} />
        </div>
        <div className="flex flex-wrap gap-3">
          <EndpointButton label="List Tracking Links" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct1}/tracking-links?limit=10`)} />
          <EndpointButton label="List Stored (0 Credits)" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct1}/stored/tracking-links?limit=10`)} />
          <EndpointButton label="Force Sync (synchronous)" loading={loading} variant="warning"
            warning="Uses more credits — use selectively"
            onClick={() => onCall(`${API_BASE}/${acct1}/tracking-links?synchronous=true&limit=5`)} />
        </div>
      </div>

      {/* Group 2 — Tracking Link Deep Dive */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold text-foreground">Tracking Link Deep Dive</h3>
        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Account</label>
            <AccountSelect accounts={accounts} value={acct2} onChange={setAcct2} />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Tracking Link ID</label>
            <input type="text" value={tlId} onChange={(e) => setTlId(e.target.value)}
              placeholder="e.g. 2876566"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-md">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">date_start</label>
            <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">date_end</label>
            <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <EndpointButton label="Get Stats (Date Range)" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct2}/tracking-links/${tlId}/stats?date_start=${dateStart}&date_end=${dateEnd}`)} />
          <EndpointButton label="Get Cohort ARPS (LTV)" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct2}/tracking-links/${tlId}/cohort-arps?acquisition_start=${dateStart}&acquisition_end=${dateEnd}`)} />
          <EndpointButton label="Get Subscribers" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct2}/tracking-links/${tlId}/subscribers`)} />
          <EndpointButton label="Get Spenders" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct2}/tracking-links/${tlId}/spenders`)} />
        </div>
      </div>

      {/* Group 3 — Fan Deep Dive */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold text-foreground">Fan Deep Dive</h3>
        <div className="grid grid-cols-2 gap-4 max-w-2xl">
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Account</label>
            <AccountSelect accounts={accounts} value={acct3} onChange={setAcct3} />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Fan ID</label>
            <input type="text" value={fanId} onChange={(e) => setFanId(e.target.value)}
              placeholder="Enter fan ID"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground" />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <EndpointButton label="Get Subscription History" loading={loading || !fanId}
            onClick={() => onCall(`${API_BASE}/${acct3}/fans/${fanId}/subscriptions-history`)} />
          <EndpointButton label="Get Fan Transactions" loading={loading || !fanId}
            onClick={() => onCall(`${API_BASE}/${acct3}/transactions?fan_id=${fanId}`)} />
        </div>
      </div>

      {/* Group 4 — Accounts */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-[13px] font-bold text-foreground">Accounts</h3>
        <div className="max-w-sm">
          <label className="block text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Account</label>
          <AccountSelect accounts={accounts} value={acct4} onChange={setAcct4} />
        </div>
        <div className="flex flex-wrap gap-3">
          <EndpointButton label="List All Accounts" loading={loading}
            onClick={() => onCall(`${API_BASE}/accounts`)} />
          <EndpointButton label="Get Earnings (This Year)" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct4}/statistics/statements/earnings?start_date=2026-01-01+00:00:00&end_date=${format(now, "yyyy-MM-dd")}+23:59:59&type=total`)} />
          <EndpointButton label="Get Earnings (Full History)" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct4}/statistics/statements/earnings?start_date=2018-01-01+00:00:00&end_date=${format(now, "yyyy-MM-dd")}+23:59:59&type=total`)} />
          <EndpointButton label="Get Analytics Total" loading={loading}
            onClick={() => onCall(`${API_BASE}/${acct4}/analytics/financial/transactions/by-type`)} />
        </div>
      </div>
    </div>
  );
}
