import React, { useState, useMemo, useCallback, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Upload, FileUp, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { differenceInDays } from "date-fns";

interface CsvCostImportModalProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  trackingLinks: any[];
}

type CostType = "CPC" | "CPL" | "FIXED";

interface ParsedRow {
  campaign_name: string;
  account_username: string;
  cost_type: string;
  cost_value: string;
  matchedLink: any | null;
  valid: boolean;
  error?: string;
}

function calcMetrics(
  costType: CostType, costValue: number,
  clicks: number, subscribers: number, revenue: number, createdAt: string
) {
  const days = Math.max(1, differenceInDays(new Date(), new Date(createdAt)));
  let cost_total = 0;
  if (costType === "CPC") cost_total = costValue * clicks;
  else if (costType === "CPL") cost_total = costValue * subscribers;
  else cost_total = costValue;

  const cvr = clicks > 0 ? (subscribers / clicks) * 100 : 0;
  const cpc_real = clicks > 0 ? cost_total / clicks : 0;
  const cpl_real = subscribers > 0 ? cost_total / subscribers : 0;
  const arpu = subscribers > 0 ? revenue / subscribers : 0;
  const profit = revenue - cost_total;
  const roi = cost_total > 0 ? (profit / cost_total) * 100 : 0;

  let status = "NO_DATA";
  if (cost_total > 0) {
    if (roi >= 100) status = "SCALE";
    else if (roi >= 0) status = "WATCH";
    else if (roi >= -50) status = "LOW";
    else status = "KILL";
  }
  if (clicks > 0 && cost_total > 0) {
    const daysSinceActivity = differenceInDays(new Date(), new Date(createdAt));
    if (daysSinceActivity > 3 && clicks === 0) status = "DEAD";
  }

  return { cost_total, cvr, cpc_real, cpl_real, arpu, profit, roi, status };
}

const TEMPLATE_CSV = `campaign_name,account_username,cost_type,cost_value
OnlyFinder 5.0,jessie_ca_xo,CPC,0.50
Instagram Funnel,miakitty.ts,CPL,2.00
Telegram Promo,zoey.skyy,FIXED,150`;

export function CsvCostImportModal({ open, onClose, onComplete, trackingLinks }: CsvCostImportModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const matchedCount = useMemo(() => parsedRows.filter(r => r.matchedLink).length, [parsedRows]);
  const unmatchedCount = useMemo(() => parsedRows.filter(r => !r.matchedLink).length, [parsedRows]);

  const resetState = useCallback(() => {
    setStep(1);
    setParsedRows([]);
    setImporting(false);
    setProgress(0);
    setResult(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cost_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseCSV = useCallback((text: string) => {
    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      toast.error("CSV must have a header row and at least one data row");
      return;
    }

    const header = lines[0].toLowerCase().replace(/\r/g, "");
    const expectedCols = ["campaign_name", "account_username", "cost_type", "cost_value"];
    const cols = header.split(",").map(c => c.trim());
    const missingCols = expectedCols.filter(c => !cols.includes(c));
    if (missingCols.length > 0) {
      toast.error(`Missing columns: ${missingCols.join(", ")}`);
      return;
    }

    const idxMap = {
      campaign_name: cols.indexOf("campaign_name"),
      account_username: cols.indexOf("account_username"),
      cost_type: cols.indexOf("cost_type"),
      cost_value: cols.indexOf("cost_value"),
    };

    const rows: ParsedRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].replace(/\r/g, "").trim();
      if (!line) continue;
      const parts = line.split(",").map(p => p.trim());

      const campaign_name = parts[idxMap.campaign_name] || "";
      const account_username = (parts[idxMap.account_username] || "").replace("@", "").toLowerCase();
      const cost_type = (parts[idxMap.cost_type] || "").toUpperCase();
      const cost_value = parts[idxMap.cost_value] || "";

      const validTypes: string[] = ["CPC", "CPL", "FIXED"];
      const numVal = parseFloat(cost_value);
      let error: string | undefined;
      if (!campaign_name) error = "Missing campaign name";
      else if (!account_username) error = "Missing account";
      else if (!validTypes.includes(cost_type)) error = `Invalid cost_type: ${cost_type}`;
      else if (isNaN(numVal) || numVal < 0) error = `Invalid cost_value: ${cost_value}`;

      const matchedLink = trackingLinks.find((l: any) => {
        const linkCampaign = (l.campaign_name || "").toLowerCase().trim();
        const linkUsername = (l.accounts?.username || "").toLowerCase().trim();
        return linkCampaign === campaign_name.toLowerCase().trim() && linkUsername === account_username;
      });

      rows.push({
        campaign_name,
        account_username,
        cost_type,
        cost_value,
        matchedLink: error ? null : matchedLink || null,
        valid: !error,
        error: error || (!matchedLink ? "No matching campaign found" : undefined),
      });
    }

    setParsedRows(rows);
    setStep(2);
  }, [trackingLinks]);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a .csv file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) parseCSV(text);
    };
    reader.readAsText(file);
  }, [parseCSV]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleImport = async () => {
    const toImport = parsedRows.filter(r => r.matchedLink);
    if (toImport.length === 0) return;

    setImporting(true);
    setStep(3);
    setProgress(0);

    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < toImport.length; i++) {
      const row = toImport[i];
      const link = row.matchedLink;
      const costType = row.cost_type as CostType;
      const costValue = parseFloat(row.cost_value);

      const metrics = calcMetrics(
        costType, costValue,
        link.clicks || 0, link.subscribers || 0,
        Number(link.revenue || 0), link.created_at
      );

      const { error } = await supabase
        .from("tracking_links")
        .update({
          cost_type: costType,
          cost_value: costValue,
          cost_total: metrics.cost_total,
          cvr: metrics.cvr,
          cpc_real: metrics.cpc_real,
          cpl_real: metrics.cpl_real,
          arpu: metrics.arpu,
          profit: metrics.profit,
          roi: metrics.roi,
          status: metrics.status,
          calculated_at: new Date().toISOString(),
        })
        .eq("id", link.id);

      if (error) {
        console.error(`Failed to update ${row.campaign_name}:`, error);
        skipped++;
      } else {
        imported++;
      }

      setProgress(Math.round(((i + 1) / toImport.length) * 100));
    }

    setResult({ imported, skipped: skipped + unmatchedCount });
    setImporting(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-2xl bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground">
            {step === 1 && "Import Costs — Download Template"}
            {step === 2 && "Import Costs — Review Data"}
            {step === 3 && (result ? "Import Complete" : "Importing...")}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-6 py-2">
            <div className="bg-card-elevated border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Download className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Step 1: Download the template</p>
                  <p className="text-xs text-muted-foreground">Pre-filled with example data</p>
                </div>
              </div>
              <Button onClick={downloadTemplate} className="w-full">
                <Download className="h-4 w-4 mr-2" />
                Download CSV Template
              </Button>
            </div>

            <div className="bg-card-elevated border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-info/10 flex items-center justify-center">
                  <Upload className="h-5 w-5 text-info" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Step 2: Upload your CSV</p>
                  <p className="text-xs text-muted-foreground">Fill in costs, then upload here</p>
                </div>
              </div>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all ${
                  dragOver ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                }`}
              >
                <FileUp className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-foreground font-medium">Drop CSV here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">.csv files only</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </div>
            </div>

            <div className="text-xs text-muted-foreground space-y-1 px-1">
              <p>• <strong>cost_type</strong> must be <code className="text-primary">CPC</code>, <code className="text-primary">CPL</code>, or <code className="text-primary">FIXED</code></p>
              <p>• <strong>cost_value</strong> is the number only (no $ sign)</p>
              <p>• Rows are matched by <strong>campaign_name + account_username</strong></p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <span className="font-bold text-primary">{matchedCount}</span> of{" "}
                <span className="font-bold text-foreground">{parsedRows.length}</span> rows matched
              </p>
              {unmatchedCount > 0 && (
                <p className="text-xs text-destructive">{unmatchedCount} rows won't be imported</p>
              )}
            </div>

            <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card-elevated">
                  <tr className="border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Campaign</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Account</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Type</th>
                    <th className="text-right px-3 py-2 text-xs font-medium text-muted-foreground">Value</th>
                    <th className="text-center px-3 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row, i) => (
                    <tr key={i} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 text-foreground truncate max-w-[160px]">{row.campaign_name}</td>
                      <td className="px-3 py-2 text-muted-foreground text-xs">@{row.account_username}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-secondary text-foreground">{row.cost_type}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-foreground">{row.cost_value}</td>
                      <td className="px-3 py-2 text-center">
                        {row.matchedLink ? (
                          <span className="inline-flex items-center gap-1 text-xs text-primary">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Found
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-destructive">
                            <XCircle className="h-3.5 w-3.5" /> {row.error || "Not found"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setParsedRows([]); setStep(1); }}>
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={matchedCount === 0}
              >
                Import {matchedCount} matched row{matchedCount !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 py-4">
            {importing ? (
              <div className="space-y-4 text-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
                <p className="text-sm text-foreground font-medium">Importing costs...</p>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground">{progress}% complete</p>
              </div>
            ) : result ? (
              <div className="space-y-4 text-center">
                <CheckCircle2 className="h-12 w-12 text-primary mx-auto" />
                <div>
                  <p className="text-foreground font-medium">
                    Successfully imported <span className="text-primary font-bold">{result.imported}</span> cost{result.imported !== 1 ? "s" : ""}.
                  </p>
                  {result.skipped > 0 && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {result.skipped} row{result.skipped !== 1 ? "s" : ""} skipped (not found).
                    </p>
                  )}
                </div>
                <Button onClick={() => { handleClose(); onComplete(); }} className="w-full">
                  Done — Refresh Data
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
