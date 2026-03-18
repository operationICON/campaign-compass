import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

interface TrackingLink {
  id: string;
  url: string;
  clicks: number;
  subscribers: number;
  spenders: number;
  revenue: number;
  revenue_per_click: number;
  revenue_per_subscriber: number;
  calculated_at: string | null;
  created_at: string;
  campaigns: { name: string; traffic_source: string | null; country: string | null } | null;
  accounts: { display_name: string } | null;
}

interface TrackingTableProps {
  links: TrackingLink[];
  isLoading: boolean;
}

export function TrackingTable({ links, isLoading }: TrackingTableProps) {
  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading tracking data...</div>;
  }

  if (!links.length) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No tracking links found. Add accounts and run a sync to get started.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-secondary/50 hover:bg-secondary/50">
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Campaign</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Account</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Clicks</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Subs</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Spenders</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Revenue</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">RPC</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">RPS</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Calculated</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((link) => (
            <TableRow key={link.id} className="hover:bg-secondary/30 transition-colors">
              <TableCell className="font-medium">{link.campaigns?.name || "—"}</TableCell>
              <TableCell className="text-muted-foreground">{link.accounts?.display_name || "—"}</TableCell>
              <TableCell className="text-right font-mono">{link.clicks.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{link.subscribers.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{link.spenders.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono text-primary">${link.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${link.revenue_per_click.toFixed(4)}</TableCell>
              <TableCell className="text-right font-mono">${link.revenue_per_subscriber.toFixed(4)}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {link.calculated_at ? format(new Date(link.calculated_at), "MMM d, HH:mm") : "—"}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {format(new Date(link.created_at), "MMM d, yyyy")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
