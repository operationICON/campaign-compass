import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";
import { isActiveAccount } from "@/lib/calc-helpers";

interface TxBreakdown {
  messages: number;
  tips: number;
  subscriptions: number;
  posts: number;
}

interface Props {
  accounts: any[];
  txTypeTotalsByAccount: Record<string, TxBreakdown>;
  revMultiplier: number;
}

const fmtC = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const fmtPct = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(0)}%` : "—";

export function ModelRevenueBreakdown({ accounts, txTypeTotalsByAccount, revMultiplier }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const rows = useMemo(() => {
    return accounts
      .filter(isActiveAccount)
      .map((acc: any) => {
        // Prefer ltv_ columns (from LTV sync) if populated; fall back to transaction aggregates
        const accMsg = Number(acc.ltv_messages || 0);
        const accTips = Number(acc.ltv_tips || 0);
        const accSubs = Number(acc.ltv_subscriptions || 0);
        const accPosts = Number(acc.ltv_posts || 0);
        const hasLtvBreakdown = accMsg > 0 || accTips > 0 || accSubs > 0 || accPosts > 0;

        const tx = txTypeTotalsByAccount[acc.id];
        const messages    = hasLtvBreakdown ? accMsg  : (tx?.messages    ?? 0);
        const tips        = hasLtvBreakdown ? accTips : (tx?.tips        ?? 0);
        const subscriptions = hasLtvBreakdown ? accSubs : (tx?.subscriptions ?? 0);
        const posts       = hasLtvBreakdown ? accPosts : (tx?.posts       ?? 0);
        const total = messages + tips + subscriptions + posts;

        return { acc, messages, tips, subscriptions, posts, total };
      })
      .filter(r => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [accounts, txTypeTotalsByAccount]);

  const totals = useMemo(() =>
    rows.reduce(
      (s, r) => ({
        messages:      s.messages      + r.messages,
        tips:          s.tips          + r.tips,
        subscriptions: s.subscriptions + r.subscriptions,
        posts:         s.posts         + r.posts,
        total:         s.total         + r.total,
      }),
      { messages: 0, tips: 0, subscriptions: 0, posts: 0, total: 0 }
    ),
    [rows]
  );

  if (rows.length === 0) return null;

  const COL_COLORS = {
    messages:      "text-primary",
    tips:          "text-[hsl(38_92%_50%)]",
    subscriptions: "text-purple-400",
    posts:         "text-blue-400",
  };

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-secondary/30 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Revenue Breakdown by Model
          </span>
          <span className="text-[10px] text-muted-foreground/60 font-normal">
            Messages · Tips · Subscriptions · Posts
          </span>
        </div>
        {collapsed
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronUp   className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="text-left px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground w-[180px]">
                  Model
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Total
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Messages / PPV
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[hsl(38_92%_50%)]">
                  Tips
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                  Subscriptions
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-blue-400">
                  Posts
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ acc, messages, tips, subscriptions, posts, total }) => (
                <tr key={acc.id} className="border-b border-border/50 hover:bg-secondary/10">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <ModelAvatar
                        avatarUrl={acc.avatar_thumb_url || acc.avatar_url || null}
                        name={acc.display_name || acc.username || "?"}
                        size={24}
                      />
                      <div>
                        <p className="font-medium text-foreground truncate max-w-[130px]">
                          {acc.display_name || acc.username || "—"}
                        </p>
                        {acc.username && (
                          <p className="text-[10px] text-muted-foreground">@{acc.username.replace("@", "")}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">
                    {fmtC(total * revMultiplier)}
                  </td>
                  <CellVal value={messages} total={total} multiplier={revMultiplier} colorClass={COL_COLORS.messages} />
                  <CellVal value={tips} total={total} multiplier={revMultiplier} colorClass={COL_COLORS.tips} />
                  <CellVal value={subscriptions} total={total} multiplier={revMultiplier} colorClass={COL_COLORS.subscriptions} />
                  <CellVal value={posts} total={total} multiplier={revMultiplier} colorClass={COL_COLORS.posts} />
                </tr>
              ))}
            </tbody>

            {/* Totals row */}
            <tfoot>
              <tr className="border-t border-border bg-secondary/30">
                <td className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-foreground tabular-nums">
                  {fmtC(totals.total * revMultiplier)}
                </td>
                <FooterCell value={totals.messages} total={totals.total} multiplier={revMultiplier} colorClass={COL_COLORS.messages} />
                <FooterCell value={totals.tips} total={totals.total} multiplier={revMultiplier} colorClass={COL_COLORS.tips} />
                <FooterCell value={totals.subscriptions} total={totals.total} multiplier={revMultiplier} colorClass={COL_COLORS.subscriptions} />
                <FooterCell value={totals.posts} total={totals.total} multiplier={revMultiplier} colorClass={COL_COLORS.posts} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function CellVal({
  value, total, multiplier, colorClass,
}: {
  value: number; total: number; multiplier: number; colorClass: string;
}) {
  if (value <= 0) {
    return (
      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground/40">—</td>
    );
  }
  return (
    <td className="px-4 py-2.5 text-right tabular-nums">
      <span className={`font-mono font-semibold ${colorClass}`}>
        {fmtC(value * multiplier)}
      </span>
      <span className="text-[10px] text-muted-foreground ml-1.5">{fmtPct(value, total)}</span>
    </td>
  );
}

function FooterCell({
  value, total, multiplier, colorClass,
}: {
  value: number; total: number; multiplier: number; colorClass: string;
}) {
  return (
    <td className="px-4 py-2.5 text-right tabular-nums">
      <span className={`font-mono font-bold ${colorClass}`}>
        {value > 0 ? fmtC(value * multiplier) : "—"}
      </span>
      {value > 0 && (
        <span className="text-[10px] text-muted-foreground ml-1.5">{fmtPct(value, total)}</span>
      )}
    </td>
  );
}
