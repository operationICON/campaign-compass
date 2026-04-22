import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Upload, FileText, CheckCircle2, XCircle, ArrowRight, Loader2 } from "lucide-react";
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
  campaign_name: string;
  account_username: string;
  campaign_url: string;
  source_tag: string;
  spend_type: string;
  cost_value: string;
  action: string;
  matchedId?: string;
  status: "found" | "not_found" | "will_update" | "will_delete" | "no_change";
};

export function BulkEditCsvModal({ open, onClose, onComplete, trackingLinks, accounts }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ deleted: number; updated: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    setStep(1);
    setRows([]);
    setResult(null);
    onClose();
  };

  const downloadTemplate = () => {
    const usernameMap: Record<string, string> = {};
    accounts.forEach((a: any) => { usernameMap[a.id] = a.username || a.display_name; });

    const sorted = [...trackingLinks]
      .filter((l: any) => !l.deleted_at)
      .sort((a: any, b: any) => {
        const au = usernameMap[a.account_id] || "";
        const bu = usernameMap[b.account_id] || "";
        if (au !== bu) return au.localeCompare(bu);
        return (b.subscribers || 0) - (a.subscribers || 0);
      });

    const header = "campaign_name,account_username,campaign_url,source_tag,spend_type,cost_value,action";
    const csvRows = sorted.map((l: any) => {
      const esc = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
      return [
        esc(l.campaign_name || ""),
        esc(usernameMap[l.account_id] || ""),
        esc(l.url || ""),
        esc(l.source_tag || ""),
        esc(l.cost_type || ""),
        l.cost_value || "",
        "keep",
      ].join(",");
    });

    const blob = new Blob([header + "\n" + csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "campaign_bulk_edit.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) { toast.error("CSV has no data rows"); return; }

      const usernameMap: Record<string, string> = {};
      accounts.forEach((a: any) => { usernameMap[a.username || a.display_name] = a.id; });

      const parsed: ParsedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^,]*),?/g)?.map((c) => c.replace(/,?$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) || [];
        const [campaign_name = "", account_username = "", campaign_url = "", source_tag = "", spend_type = "", cost_value = "", action = "keep"] = cols;

        const match = trackingLinks.find(
          (l: any) => l.campaign_name === campaign_name && (usernameMap[account_username] === l.account_id)
        );

        let status: ParsedRow["status"] = "not_found";
        if (match) {
          if (action.toLowerCase() === "delete") status = "will_delete";
          else if (action.toLowerCase() === "update") status = "will_update";
          else status = "no_change";
        }

        parsed.push({ campaign_name, account_username, campaign_url, source_tag, spend_type, cost_value, action: action.toLowerCase(), matchedId: match?.id, status });
      }

      setRows(parsed);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const applyChanges = async () => {
    setImporting(true);
    let deleted = 0, updated = 0, skipped = 0, errors = 0;

    for (const row of rows) {
      if (!row.matchedId) { skipped++; continue; }
      if (row.action === "keep") continue;

      try {
        if (row.action === "delete") {
          await updateTrackingLink(row.matchedId, { deleted_at: new Date().toISOString() });
          deleted++;
        } else if (row.action === "update") {
          const updates: any = {};
          if (row.source_tag) { updates.source_tag = row.source_tag; updates.manually_tagged = true; }
          if (row.spend_type) updates.cost_type = row.spend_type;
          if (row.cost_value) updates.cost_value = Number(row.cost_value);
          if (Object.keys(updates).length > 0) {
            await updateTrackingLink(row.matchedId, updates);
            updated++;
          }
        }
      } catch { errors++; }
    }


    setResult({ deleted, updated, skipped });
    setStep(3);
    setImporting(false);
  };

  const changeCounts = {
    found: rows.filter((r) => r.matchedId).length,
    toDelete: rows.filter((r) => r.status === "will_delete").length,
    toUpdate: rows.filter((r) => r.status === "will_update").length,
    notFound: rows.filter((r) => !r.matchedId).length,
  };
  const totalChanges = changeCounts.toDelete + changeCounts.toUpdate;

  const statusBadge = (s: ParsedRow["status"]) => {
    const map = {
      found: { bg: "bg-success/10 text-success", label: "Found" },
      not_found: { bg: "bg-destructive/10 text-destructive", label: "Not found" },
      will_update: { bg: "bg-info/10 text-info", label: "Will update" },
      will_delete: { bg: "bg-destructive/10 text-destructive", label: "Will delete" },
      no_change: { bg: "bg-muted text-muted-foreground", label: "No change" },
    };
    const m = map[s];
    return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${m.bg}`}>{m.label}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Bulk Edit Campaigns</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-4 text-sm space-y-1.5 text-muted-foreground">
              <p>1. Download the template — it contains all your current campaigns</p>
              <p>2. Review each row in Excel or Google Sheets</p>
              <p>3. Set <code className="bg-background px-1 rounded text-foreground">action = delete</code> for campaigns you want to remove</p>
              <p>4. Set <code className="bg-background px-1 rounded text-foreground">action = update</code> and fill in source_tag or spend fields to update</p>
              <p>5. Leave <code className="bg-background px-1 rounded text-foreground">action = keep</code> for no changes</p>
              <p>6. Save as CSV and upload below</p>
            </div>
            <Button onClick={downloadTemplate} className="w-full" variant="outline">
              <Download className="h-4 w-4 mr-2" /> Download Campaign Template
            </Button>
            <div className="border-t pt-4">
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload your edited CSV</p>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="max-h-[400px] overflow-y-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium">Campaign</th>
                    <th className="text-left p-2 font-medium">Model</th>
                    <th className="text-left p-2 font-medium">Action</th>
                    <th className="text-left p-2 font-medium">Source Tag</th>
                    <th className="text-left p-2 font-medium">Spend</th>
                    <th className="text-left p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 max-w-[180px] truncate">{r.campaign_name}</td>
                      <td className="p-2">{r.account_username}</td>
                      <td className="p-2">{r.action}</td>
                      <td className="p-2">{r.source_tag || "—"}</td>
                      <td className="p-2">{r.cost_value ? `${r.spend_type} $${r.cost_value}` : "—"}</td>
                      <td className="p-2">{statusBadge(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-4 gap-2 text-xs text-center">
              <div className="bg-muted rounded-lg p-2"><span className="font-bold text-foreground">{changeCounts.found}</span><br />Found</div>
              <div className="bg-destructive/5 rounded-lg p-2"><span className="font-bold text-destructive">{changeCounts.toDelete}</span><br />Will delete</div>
              <div className="bg-info/5 rounded-lg p-2"><span className="font-bold text-info">{changeCounts.toUpdate}</span><br />Will update</div>
              <div className="bg-muted rounded-lg p-2"><span className="font-bold text-muted-foreground">{changeCounts.notFound}</span><br />Not found</div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep(1); setRows([]); }}>Back</Button>
              {totalChanges > 0 && (
                <Button onClick={applyChanges} disabled={importing}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                  Apply {totalChanges} changes
                </Button>
              )}
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="text-center space-y-4 py-4">
            <CheckCircle2 className="h-12 w-12 mx-auto text-success" />
            <h3 className="font-semibold text-lg">Import complete</h3>
            <div className="space-y-1 text-sm">
              <p>Deleted: <span className="font-bold text-destructive">{result.deleted}</span> campaigns</p>
              <p>Updated: <span className="font-bold text-primary">{result.updated}</span> campaigns</p>
              <p>Skipped: <span className="font-bold text-muted-foreground">{result.skipped}</span> not found</p>
            </div>
            <Button onClick={() => { handleClose(); onComplete(); }}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
