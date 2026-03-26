import { useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Upload, CheckCircle2, ArrowRight, Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  trackingLinks: any[];
  accounts: any[];
}

type ParsedRow = {
  campaign_name: string;
  campaign_url: string;
  account_username: string;
  source_tag: string;
  spend_type: string;
  cost_value: string;
  notes: string;
  accountId?: string;
  status: "new" | "exists" | "invalid";
};

export function ImportCsvModal({ open, onClose, onComplete, trackingLinks, accounts }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ added: number; skipped: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleClose = () => { setStep(1); setRows([]); setResult(null); onClose(); };

  const downloadTemplate = () => {
    const header = "campaign_name,campaign_url,account_username,source_tag,spend_type,cost_value,notes";
    const example = '"My Campaign","https://onlyfans.com/...","username","Reddit","CPC","0.50","Notes here"';
    const blob = new Blob([header + "\n" + example], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "new_campaigns_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length < 2) return;

      const usernameToId: Record<string, string> = {};
      accounts.forEach((a: any) => { if (a.username) usernameToId[a.username] = a.id; usernameToId[a.display_name] = a.id; });

      const existingUrls = new Set(trackingLinks.map((l: any) => l.url));

      const parsed: ParsedRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].match(/(".*?"|[^,]*),?/g)?.map((c) => c.replace(/,?$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')) || [];
        const [campaign_name = "", campaign_url = "", account_username = "", source_tag = "", spend_type = "", cost_value = "", notes = ""] = cols;

        const accountId = usernameToId[account_username];
        let status: ParsedRow["status"] = "new";
        if (!campaign_name || !account_username || !accountId) status = "invalid";
        else if (campaign_url && existingUrls.has(campaign_url)) status = "exists";

        parsed.push({ campaign_name, campaign_url, account_username, source_tag, spend_type, cost_value, notes, accountId, status });
      }
      setRows(parsed);
      setStep(2);
    };
    reader.readAsText(file);
  };

  const doImport = async () => {
    setImporting(true);
    let added = 0, skipped = 0, errors = 0;
    const newRows = rows.filter((r) => r.status === "new");

    for (const row of newRows) {
      try {
        // We need a campaign_id — find or create one
        const { data: campaigns } = await supabase.from("campaigns").select("id").eq("account_id", row.accountId!).eq("name", row.campaign_name).limit(1);
        let campaignId = campaigns?.[0]?.id;
        if (!campaignId) {
          const { data: newCamp } = await supabase.from("campaigns").insert({ account_id: row.accountId!, name: row.campaign_name }).select("id").single();
          campaignId = newCamp?.id;
        }
        if (!campaignId) { errors++; continue; }

        const insert: any = {
          campaign_id: campaignId,
          account_id: row.accountId,
          campaign_name: row.campaign_name,
          url: row.campaign_url || `pending-${Date.now()}-${added}`,
          clicks: 0, subscribers: 0, revenue: 0, spenders: 0,
          conversion_rate: 0, revenue_per_click: 0, revenue_per_subscriber: 0,
        };
        if (row.source_tag) { insert.source_tag = row.source_tag; insert.manually_tagged = true; }
        if (row.spend_type) insert.cost_type = row.spend_type;
        if (row.cost_value) insert.cost_value = Number(row.cost_value);

        await supabase.from("tracking_links").insert(insert);
        added++;
      } catch { errors++; }
    }

    skipped = rows.filter((r) => r.status === "exists").length + rows.filter((r) => r.status === "invalid").length;

    await supabase.from("bulk_import_logs").insert({ imported_by: "manual", total_rows: rows.length, created: added, errors } as any);

    setResult({ added, skipped, errors });
    setStep(3);
    setImporting(false);
  };

  const newCount = rows.filter((r) => r.status === "new").length;

  const statusBadge = (s: ParsedRow["status"]) => {
    const map = {
      new: { cls: "bg-success/10 text-success", label: "New — will be added" },
      exists: { cls: "bg-warning/10 text-warning", label: "Already exists" },
      invalid: { cls: "bg-destructive/10 text-destructive", label: "Invalid" },
    };
    const m = map[s];
    return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Import New Campaigns</DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <div className="bg-muted rounded-lg p-4 text-sm text-muted-foreground">
              Use this template to add tracking links that exist in OnlyFans but are not yet in the system.
              The next sync will automatically match and update their click and subscriber data.
            </div>
            <Button onClick={downloadTemplate} variant="outline" className="w-full">
              <Download className="h-4 w-4 mr-2" /> Download New Links Template
            </Button>
            <div className="border-t pt-4">
              <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && parseFile(e.target.files[0])} />
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
              >
                <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Click to upload your CSV</p>
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
                    <th className="text-left p-2 font-medium">URL</th>
                    <th className="text-left p-2 font-medium">Source</th>
                    <th className="text-left p-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2 max-w-[150px] truncate">{r.campaign_name}</td>
                      <td className="p-2">{r.account_username}</td>
                      <td className="p-2 max-w-[120px] truncate">{r.campaign_url || "—"}</td>
                      <td className="p-2">{r.source_tag || "—"}</td>
                      <td className="p-2">{statusBadge(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep(1); setRows([]); }}>Back</Button>
              {newCount > 0 && (
                <Button onClick={doImport} disabled={importing}>
                  {importing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
                  Add {newCount} new campaigns
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
              <p>Added: <span className="font-bold text-success">{result.added}</span> new campaigns</p>
              <p>Skipped: <span className="font-bold text-muted-foreground">{result.skipped}</span> already exist or invalid</p>
              {result.errors > 0 && <p>Errors: <span className="font-bold text-destructive">{result.errors}</span></p>}
            </div>
            <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              New campaigns will sync their click and subscriber data on the next sync run.
            </div>
            <Button onClick={() => { handleClose(); onComplete(); }}>Done</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
