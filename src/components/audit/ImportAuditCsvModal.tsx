import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Upload, CheckCircle2, ArrowRight, Loader2 } from "lucide-react";
import { updateTrackingLink } from "@/lib/api";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  trackingLinks: any[];
  accounts: any[];
}

type ParsedRow = {
  action: string;
  campaign_name: string;
  account_username: string;
  campaign_id: string;
  matchedId?: string;
  status: string;
};

export function ImportAuditCsvModal({ open, onClose, onComplete, trackingLinks, accounts }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ kept: number; deleted: number; spend: number; review: number; notFound: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClose = () => { setRows([]); setResult(null); onClose(); };

  const usernameToId = () => {
    const map: Record<string, string> = {};
    accounts.forEach((a: any) => { if (a.username) map[a.username] = a.id; map[a.display_name] = a.id; });
    return map;
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) { toast.error("CSV has no data rows"); return; }

      const uMap = usernameToId();
      const parsed: ParsedRow[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^,]*),?/g)?.map((c) =>
          c.replace(/,?$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')
        ) || [];

        const action = (cols[0] || "keep").toLowerCase().trim();
        const campaign_name = cols[1] || "";
        const account_username = cols[2] || "";
        // campaign_id is the last column (index 23)
        const campaign_id = cols[23] || "";

        // Match by campaign_id first, then fallback to name + account
        let match = campaign_id
          ? trackingLinks.find((l: any) => l.id === campaign_id)
          : null;

        if (!match) {
          const accId = uMap[account_username];
          match = trackingLinks.find((l: any) =>
            l.campaign_name === campaign_name && l.account_id === accId
          );
        }

        let status = "not_found";
        if (match) {
          if (action === "delete") status = "will_delete";
          else if (action === "add_spend") status = "will_flag_spend";
          else if (action === "review") status = "will_flag_review";
          else status = "keep";
        }

        parsed.push({ action, campaign_name, account_username, campaign_id, matchedId: match?.id, status });
      }
      setRows(parsed);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    setImporting(true);
    let kept = 0, deleted = 0, spend = 0, review = 0, notFound = 0;

    for (const row of rows) {
      if (!row.matchedId) { notFound++; continue; }

      try {
        if (row.action === "delete") {
          await updateTrackingLink(row.matchedId, { deleted_at: new Date().toISOString() });
          deleted++;
        } else if (row.action === "add_spend") {
          await updateTrackingLink(row.matchedId, { needs_spend: true });
          spend++;
        } else if (row.action === "review") {
          await updateTrackingLink(row.matchedId, { review_flag: true });
          review++;
        } else {
          kept++;
        }
      } catch {
        notFound++;
      }
    }


    setResult({ kept, deleted, spend, review, notFound });
    setImporting(false);
  };

  const counts = {
    toDelete: rows.filter((r) => r.status === "will_delete").length,
    toSpend: rows.filter((r) => r.status === "will_flag_spend").length,
    toReview: rows.filter((r) => r.status === "will_flag_review").length,
    keep: rows.filter((r) => r.status === "keep").length,
    notFound: rows.filter((r) => r.status === "not_found").length,
  };
  const totalActions = counts.toDelete + counts.toSpend + counts.toReview;

  const statusBadge = (s: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      keep: { cls: "bg-muted text-muted-foreground", label: "Keep" },
      not_found: { cls: "bg-destructive/10 text-destructive", label: "Not found" },
      will_delete: { cls: "bg-destructive/10 text-destructive", label: "Will delete" },
      will_flag_spend: { cls: "bg-warning/10 text-warning", label: "Flag spend" },
      will_flag_review: { cls: "bg-info/10 text-primary", label: "Flag review" },
    };
    const m = map[s] || { cls: "bg-muted text-muted-foreground", label: s };
    return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Import Audit CSV</DialogTitle>
        </DialogHeader>

        {!result && rows.length === 0 && (
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-4 text-sm text-muted-foreground space-y-1">
              <p>Upload the CSV you exported from the Audit page.</p>
              <p>Only the <code className="bg-background px-1 rounded text-foreground">action</code> column is processed:</p>
              <p><strong>keep</strong> → no change</p>
              <p><strong>delete</strong> → soft delete campaign</p>
              <p><strong>add_spend</strong> → flag for spend entry</p>
              <p><strong>review</strong> → flag for review</p>
            </div>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            >
              <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Click to upload your edited CSV</p>
            </div>
          </div>
        )}

        {!result && rows.length > 0 && (
          <div className="space-y-4">
            <div className="max-h-[350px] overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium">Campaign</th>
                    <th className="text-left p-2 font-medium">Model</th>
                    <th className="text-left p-2 font-medium">Action</th>
                    <th className="text-left p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 max-w-[200px] truncate">{r.campaign_name}</td>
                      <td className="p-2">{r.account_username}</td>
                      <td className="p-2 font-mono">{r.action}</td>
                      <td className="p-2">{statusBadge(r.status)}</td>
                    </tr>
                  ))}
                  {rows.length > 100 && <tr><td colSpan={4} className="p-2 text-center text-muted-foreground">...and {rows.length - 100} more</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-5 gap-2 text-xs text-center">
              <div className="bg-muted rounded-lg p-2"><span className="font-bold">{counts.keep}</span><br />Keep</div>
              <div className="bg-destructive/5 rounded-lg p-2"><span className="font-bold text-destructive">{counts.toDelete}</span><br />Delete</div>
              <div className="bg-warning/5 rounded-lg p-2"><span className="font-bold text-warning">{counts.toSpend}</span><br />Add Spend</div>
              <div className="bg-primary/5 rounded-lg p-2"><span className="font-bold text-primary">{counts.toReview}</span><br />Review</div>
              <div className="bg-muted rounded-lg p-2"><span className="font-bold text-muted-foreground">{counts.notFound}</span><br />Not Found</div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setRows([])}>Back</Button>
              <Button onClick={doImport} disabled={importing || (totalActions === 0 && counts.keep === 0)}>
                {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                Apply {rows.filter(r => r.matchedId).length} changes
              </Button>
            </div>
          </div>
        )}

        {result && (
          <div className="text-center space-y-4 py-4">
            <CheckCircle2 className="h-12 w-12 mx-auto text-primary" />
            <h3 className="font-semibold text-lg">Import complete</h3>
            <div className="space-y-1 text-sm">
              <p>Kept: <span className="font-bold">{result.kept}</span></p>
              <p>Deleted: <span className="font-bold text-destructive">{result.deleted}</span></p>
              <p>Flagged for spend: <span className="font-bold text-warning">{result.spend}</span></p>
              <p>Flagged for review: <span className="font-bold text-primary">{result.review}</span></p>
              <p>Not found: <span className="font-bold text-muted-foreground">{result.notFound}</span> (skipped)</p>
            </div>
            <Button onClick={() => { handleClose(); onComplete(); }}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
