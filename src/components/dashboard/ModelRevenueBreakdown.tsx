import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";

interface TxBreakdown {
  messages: number;
  tips: number;
  subscriptions: number;
  posts: number;
}

interface Props {
  accounts: any[];
  allLinks: any[];
  txTypeTotalsByAccount: Record<string, TxBreakdown>;
  revMultiplier: number;
}

const fmtC = (v: number) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const pctOf = (v: number, total: number) =>
  total > 0 ? `${((v / total) * 100).toFixed(0)}%` : null;

export function ModelRevenueBreakdown({ accounts, allLinks, txTypeTotalsByAccount, revMultiplier }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const rows = useMemo(() => {
    return accounts
      .map((acc: any) => {
        // Type breakdown — prefer ltv_ columns (LTV sync), fall back to transactions
        const accMsg  = Number(acc.ltv_messages      || 0);
        const accTips = Number(acc.ltv_tips          || 0);
        const accSubs = Number(acc.ltv_subscriptions || 0);
        const accPost = Number(acc.ltv_posts         || 0);
        const hasLtv  = Number(acc.ltv_total || 0) > 0;

        const tx = txTypeTotalsByAccount[acc.id];
        const messages      = hasLtv ? accMsg  : (tx?.messages      ?? 0);
        const tips          = hasLtv ? accTips : (tx?.tips          ?? 0);
        const subscriptions = hasLtv ? accSubs : (tx?.subscriptions ?? 0);
        const posts         = hasLtv ? accPost : (tx?.posts         ?? 0);

        // Total revenue from tracking links
        const ltvTotal = allLinks
          .filter((l: any) => l.account_id === acc.id)
          .reduce((s: number, l: any) => s + Number(l.revenue || 0), 0);

        if (ltvTotal <= 0) return null;

        const campRev = ltvTotal;

        const hasBreakdown = messages > 0 || tips > 0 || subscriptions > 0 || posts > 0;

        return {
          acc, ltvTotal, campRev,
          messages, tips, subscriptions, posts, hasBreakdown,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.ltvTotal - a.ltvTotal);
  }, [accounts, allLinks, txTypeTotalsByAccount]);

  const totals = useMemo(() =>
    rows.reduce(
      (s, r) => ({
        ltvTotal:      s.ltvTotal      + r.ltvTotal,
        messages:      s.messages      + r.messages,
        tips:          s.tips          + r.tips,
        subscriptions: s.subscriptions + r.subscriptions,
        posts:         s.posts         + r.posts,
      }),
      { ltvTotal: 0, messages: 0, tips: 0, subscriptions: 0, posts: 0 }
    ),
    [rows]
  );

  const anyBreakdown = rows.some(r => r.hasBreakdown);

  if (rows.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-2xl overflow-hidden">
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
                  Total Revenue
                </th>
                <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Via Campaigns
                </th>
                {anyBreakdown && (
                  <>
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
                  </>
                )}
                {!anyBreakdown && (
                  <th className="text-right px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
                    Breakdown
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ acc, ltvTotal, campRev, messages, tips, subscriptions, posts, hasBreakdown }) => (
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
                          <p className="text-[10px] text-muted-foreground">
                            @{acc.username.replace("@", "")}
                          </p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold text-foreground tabular-nums">
                    {fmtC(ltvTotal * revMultiplier)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                    {campRev > 0 ? fmtC(campRev * revMultiplier) : "—"}
                  </td>
                  {anyBreakdown && (
                    <>
                      <TypeCell value={messages} total={ltvTotal} multiplier={revMultiplier} colorClass="text-primary" />
                      <TypeCell value={tips} total={ltvTotal} multiplier={revMultiplier} colorClass="text-[hsl(38_92%_50%)]" />
                      <TypeCell value={subscriptions} total={ltvTotal} multiplier={revMultiplier} colorClass="text-purple-400" />
                      <TypeCell value={posts} total={ltvTotal} multiplier={revMultiplier} colorClass="text-blue-400" />
                    </>
                  )}
                  {!anyBreakdown && (
                    <td className="px-4 py-2.5 text-right text-[10px] text-muted-foreground/40 italic">
                      Run LTV sync
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-secondary/30">
                <td className="px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-foreground tabular-nums">
                  {fmtC(totals.ltvTotal * revMultiplier)}
                </td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-muted-foreground tabular-nums">
                  {fmtC(rows.reduce((s, r) => s + r.campRev, 0) * revMultiplier)}
                </td>
                {anyBreakdown && (
                  <>
                    <FooterCell value={totals.messages} total={totals.ltvTotal} multiplier={revMultiplier} colorClass="text-primary" />
                    <FooterCell value={totals.tips} total={totals.ltvTotal} multiplier={revMultiplier} colorClass="text-[hsl(38_92%_50%)]" />
                    <FooterCell value={totals.subscriptions} total={totals.ltvTotal} multiplier={revMultiplier} colorClass="text-purple-400" />
                    <FooterCell value={totals.posts} total={totals.ltvTotal} multiplier={revMultiplier} colorClass="text-blue-400" />
                  </>
                )}
                {!anyBreakdown && <td />}
              </tr>
            </tfoot>
          </table>

          {!anyBreakdown && (
            <p className="px-4 py-2 text-[10px] text-muted-foreground/50 border-t border-border">
              Type breakdown (Messages / PPV, Tips, Subscriptions, Posts) requires the LTV sync to be run from Sync Center.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TypeCell({
  value, total, multiplier, colorClass,
}: {
  value: number; total: number; multiplier: number; colorClass: string;
}) {
  if (value <= 0) {
    return <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted-foreground/30">—</td>;
  }
  return (
    <td className="px-4 py-2.5 text-right tabular-nums">
      <span className={`font-mono font-semibold ${colorClass}`}>
        {fmtC(value * multiplier)}
      </span>
      {pctOf(value, total) && (
        <span className="text-[10px] text-muted-foreground ml-1.5">{pctOf(value, total)}</span>
      )}
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
      {value > 0 && pctOf(value, total) && (
        <span className="text-[10px] text-muted-foreground ml-1.5">{pctOf(value, total)}</span>
      )}
    </td>
  );
}
