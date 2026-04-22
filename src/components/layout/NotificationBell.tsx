import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getNotifications, getUnreadCount, markNotificationsRead } from "@/lib/api";
import { Bell, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const ICON_MAP: Record<string, { icon: typeof Bell; color: string }> = {
  sync_failed: { icon: XCircle, color: "text-destructive" },
  sync_success: { icon: CheckCircle, color: "text-primary" },
  dead_campaign: { icon: AlertTriangle, color: "text-warning" },
};

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: notifications = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    refetchInterval: 30000,
  });

  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["notifications_unread_count"],
    queryFn: async () => { const r = await getUnreadCount(); return r.count; },
    refetchInterval: 30000,
  });

  // Poll sync_logs for realtime-like updates
  useEffect(() => {
    const id = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["sync_logs"] });
    }, 15000);
    return () => clearInterval(id);
  }, [queryClient]);

  async function markAllRead() {
    await markNotificationsRead();
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications_unread_count"] });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-lg hover:bg-secondary transition-colors">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-destructive text-destructive-foreground text-[9px] font-bold px-1 py-0.5 rounded-full min-w-[16px] text-center leading-none">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold text-foreground">Notifications</span>
          {unreadCount > 0 && (
            <button onClick={markAllRead} className="text-xs text-primary hover:underline">
              Mark all as read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No notifications</div>
          ) : (
            (notifications as any[]).map((n: any) => {
              const config = ICON_MAP[n.type] || { icon: Bell, color: "text-muted-foreground" };
              const Icon = config.icon;
              return (
                <div key={n.id} className={`flex gap-3 px-4 py-3 border-b border-border last:border-0 ${!n.read ? "bg-secondary/30" : ""}`}>
                  <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-relaxed">{n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                      {format(new Date(n.created_at), "MMM d, HH:mm")}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
