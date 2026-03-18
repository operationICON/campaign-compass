import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface FilterBarProps {
  accounts: { id: string; display_name: string }[];
  campaigns: { id: string; name: string; traffic_source: string | null; country: string | null }[];
  filters: {
    account_id: string;
    campaign_id: string;
    traffic_source: string;
    country: string;
    date_from: string;
    date_to: string;
  };
  onFilterChange: (key: string, value: string) => void;
  onSync: () => void;
  isSyncing: boolean;
}

export function FilterBar({ accounts, campaigns, filters, onFilterChange, onSync, isSyncing }: FilterBarProps) {
  const trafficSources = [...new Set(campaigns.map(c => c.traffic_source).filter(Boolean))] as string[];
  const countries = [...new Set(campaigns.map(c => c.country).filter(Boolean))] as string[];

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select value={filters.account_id} onValueChange={(v) => onFilterChange("account_id", v)}>
        <SelectTrigger className="w-[180px] bg-card border-border">
          <SelectValue placeholder="All Accounts" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Accounts</SelectItem>
          {accounts.map(a => (
            <SelectItem key={a.id} value={a.id}>{a.display_name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.campaign_id} onValueChange={(v) => onFilterChange("campaign_id", v)}>
        <SelectTrigger className="w-[180px] bg-card border-border">
          <SelectValue placeholder="All Campaigns" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Campaigns</SelectItem>
          {campaigns.map(c => (
            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.traffic_source} onValueChange={(v) => onFilterChange("traffic_source", v)}>
        <SelectTrigger className="w-[160px] bg-card border-border">
          <SelectValue placeholder="All Sources" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          {trafficSources.map(s => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.country} onValueChange={(v) => onFilterChange("country", v)}>
        <SelectTrigger className="w-[140px] bg-card border-border">
          <SelectValue placeholder="All Countries" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Countries</SelectItem>
          {countries.map(c => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={filters.date_from}
        onChange={(e) => onFilterChange("date_from", e.target.value)}
        className="w-[150px] bg-card border-border"
        placeholder="From"
      />
      <Input
        type="date"
        value={filters.date_to}
        onChange={(e) => onFilterChange("date_to", e.target.value)}
        className="w-[150px] bg-card border-border"
        placeholder="To"
      />

      <Button onClick={onSync} disabled={isSyncing} className="ml-auto">
        <RefreshCw className={`h-4 w-4 mr-2 ${isSyncing ? "animate-spin" : ""}`} />
        {isSyncing ? "Syncing..." : "Sync Now"}
      </Button>
    </div>
  );
}
