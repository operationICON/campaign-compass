import { Card, CardContent } from "@/components/ui/card";
import { DollarSign, MousePointerClick, Users, TrendingUp, Percent, PiggyBank, BarChart3 } from "lucide-react";

interface KpiCardsProps {
  totalRevenue: number;
  totalClicks: number;
  totalSubscribers: number;
  epc: number;
  conversionRate: number;
  profit: number;
  roi: number;
}

const kpiConfig = [
  { key: "totalRevenue", label: "Total Revenue", icon: DollarSign, format: "currency" },
  { key: "totalClicks", label: "Total Clicks", icon: MousePointerClick, format: "number" },
  { key: "totalSubscribers", label: "Total Subscribers", icon: Users, format: "number" },
  { key: "epc", label: "EPC", icon: TrendingUp, format: "currency" },
  { key: "conversionRate", label: "Conversion Rate", icon: Percent, format: "percent" },
  { key: "profit", label: "Profit", icon: PiggyBank, format: "currency" },
  { key: "roi", label: "ROI", icon: BarChart3, format: "percent" },
] as const;

function formatValue(value: number, format: string) {
  if (format === "currency") return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (format === "percent") return `${value.toFixed(1)}%`;
  return value.toLocaleString();
}

export function KpiCards(props: KpiCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
      {kpiConfig.map(({ key, label, icon: Icon, format }) => {
        const value = props[key];
        const isPositive = key === "profit" || key === "roi" ? value > 0 : true;
        return (
          <Card key={key} className="border-border bg-card hover:glow-green transition-shadow duration-300">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="h-4 w-4 text-primary" />
                <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
              </div>
              <p className={`text-xl font-bold font-mono ${key === "profit" || key === "roi" ? (isPositive ? "text-primary" : "text-destructive") : "text-foreground"}`}>
                {formatValue(value, format)}
              </p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
