import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

interface TrackingLink {
  id: string;
  campaign_name: string | null;
  url: string;
  clicks: number;
  subscribers: number;
  spenders: number;
  revenue: number;
  revenue_per_click: number;
  revenue_per_subscriber: number;
  conversion_rate: number;
  calculated_at: string | null;
  created_at: string;
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
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Account</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Campaign Name</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Clicks</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Subs</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Spenders</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">Revenue</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">EPC</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground text-right">RPS</TableHead>
            <TableHead className="text-xs uppercase tracking-wider text-muted-foreground">Calculated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {links.map((link) => (
            <TableRow key={link.id} className="hover:bg-secondary/30 transition-colors">
              <TableCell className="text-muted-foreground">{(link as any).accounts?.username ? `@${(link as any).accounts.username}` : (link as any).accounts?.display_name || "—"}</TableCell>
              <TableCell className="font-medium">{link.campaign_name || "—"}</TableCell>
              <TableCell className="text-right font-mono">{link.clicks.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{link.subscribers.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono">{link.spenders.toLocaleString()}</TableCell>
              <TableCell className="text-right font-mono text-primary">${link.revenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
              <TableCell className="text-right font-mono">${link.revenue_per_click.toFixed(2)}</TableCell>
              <TableCell className="text-right font-mono">${link.revenue_per_subscriber.toFixed(2)}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {link.calculated_at ? format(new Date(link.calculated_at), "MMM d, HH:mm") : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
