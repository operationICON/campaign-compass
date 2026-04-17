import { useState, useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  show: boolean;
}

const SESSION_KEY = "dashboard_date_accuracy_banner_dismissed";

/**
 * Amber warning banner shown on Dashboard when a date filter is active.
 * Dismissable per session via sessionStorage.
 */
export function DateAccuracyBanner({ show }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(SESSION_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Reset dismissal when switching back to All Time, so it reappears next time.
  useEffect(() => {
    if (!show) {
      setDismissed(false);
      try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    }
  }, [show]);

  if (!show || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(SESSION_KEY, "1"); } catch {}
  };

  return (
    <div
      className="flex items-start gap-2 w-full rounded-md px-3 py-2"
      style={{
        background: "hsl(38 92% 50% / 0.12)",
        border: "1px solid hsl(38 92% 50% / 0.35)",
        color: "hsl(38 92% 60%)",
        fontSize: 12,
      }}
    >
      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
      <span className="flex-1 leading-snug">
        Date filtered metrics are being improved. Subs/Day and Revenue figures for date ranges may be inaccurate until the next sync. All Time figures are fully accurate.
      </span>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
