import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X, ChevronUp } from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";

interface TrackingLinkPanelProps {
  open: boolean;
  onClose: () => void;
  editLink?: any;
  accounts: any[];
}

const USERNAME_MAP: Record<string, string> = {
  jessie_ca_xo: "jessie_ca_xo",
  aylin_bigts: "aylin_bigts",
  "zoey.skyy": "zoey.skyy",
  "miakitty.ts": "miakitty.ts",
  ella_cherryy: "ella_cherryy",
};

function extractFromUrl(url: string) {
  const externalIdMatch = url.match(/\/(\d+)\/?$/);
  const externalId = externalIdMatch ? externalIdMatch[1] : "";

  // Try to detect model username from URL path segments
  let detectedUsername: string | null = null;
  const lower = url.toLowerCase();
  for (const uname of Object.keys(USERNAME_MAP)) {
    if (lower.includes(`/${uname}/`) || lower.includes(`/${uname}?`) || lower.endsWith(`/${uname}`)) {
      detectedUsername = USERNAME_MAP[uname];
      break;
    }
  }

  // Extract campaign name from URL slug (last path segment before the ID)
  let campaignSlug = "";
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/").filter(Boolean);
    // Typically: /username/trackingId or similar
    if (parts.length >= 1) {
      // Use the last non-numeric segment as a hint
      const nonNumeric = parts.filter(p => !/^\d+$/.test(p));
      if (nonNumeric.length > 0) {
        campaignSlug = nonNumeric[nonNumeric.length - 1].replace(/[-_]/g, " ");
      }
    }
  } catch {}

  return { externalId, detectedUsername, campaignSlug };
}

export function TrackingLinkPanel({ open, onClose, editLink, accounts }: TrackingLinkPanelProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editLink;

  const [url, setUrl] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [trafficSourceId, setTrafficSourceId] = useState("");
  const [cpc, setCpc] = useState("");
  const [cpl, setCpl] = useState("");
  const [totalSpend, setTotalSpend] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: trafficSources = [] } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("traffic_sources").select("*").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  useEffect(() => {
    if (editLink) {
      setUrl(editLink.url || "");
      setCampaignName(editLink.campaign_name || "");
      setAccountId(editLink.account_id || "");
      setTrafficSourceId(editLink.traffic_source_id || "");
      setCpc(editLink.cost_type === "CPC" && editLink.cost_value ? String(editLink.cost_value) : "");
      setCpl(editLink.cost_type === "CPL" && editLink.cost_value ? String(editLink.cost_value) : "");
      setTotalSpend(editLink.cost_type === "FIXED" && editLink.cost_value ? String(editLink.cost_value) : "");
    } else {
      setUrl("");
      setCampaignName("");
      setAccountId("");
      setTrafficSourceId("");
      setCpc("");
      setCpl("");
      setTotalSpend("");
    }
  }, [editLink, open]);

  // Auto-populate from URL
  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    if (!isEdit && newUrl.includes("onlyfans.com")) {
      const { externalId, detectedUsername, campaignSlug } = extractFromUrl(newUrl);
      
      // Auto-detect model
      if (detectedUsername && accounts.length > 0) {
        const matchedAccount = accounts.find((a: any) =>
          a.username?.toLowerCase() === detectedUsername.toLowerCase()
        );
        if (matchedAccount) setAccountId(matchedAccount.id);
      }

      // Auto-fill campaign name if empty
      if (!campaignName && campaignSlug) {
        setCampaignName(campaignSlug);
      }
    }
  };

  const externalId = useMemo(() => {
    const match = url.match(/\/(\d+)\/?$/);
    return match ? match[1] : "";
  }, [url]);

  const handleSave = async () => {
    if (!url.trim() || !campaignName.trim() || !accountId) {
      toast.error("URL, Campaign Name, and Model are required");
      return;
    }
    setSaving(true);
    try {
      let costType: string | null = null;
      let costValue = 0;
      let costTotal = 0;
      if (cpl && parseFloat(cpl) > 0) {
        costType = "CPL";
        costValue = parseFloat(cpl);
      } else if (cpc && parseFloat(cpc) > 0) {
        costType = "CPC";
        costValue = parseFloat(cpc);
      } else if (totalSpend && parseFloat(totalSpend) > 0) {
        costType = "FIXED";
        costValue = parseFloat(totalSpend);
        costTotal = costValue;
      }

      const sourceName = trafficSources.find((s: any) => s.id === trafficSourceId)?.name || null;

      if (isEdit) {
        const { error } = await supabase.from("tracking_links").update({
          url: url.trim(),
          campaign_name: campaignName.trim(),
          account_id: accountId,
          traffic_source_id: trafficSourceId || null,
          source_tag: sourceName,
          cost_type: costType,
          cost_value: costValue,
          cost_total: costTotal,
          external_tracking_link_id: externalId || null,
        } as any).eq("id", editLink.id);
        if (error) throw error;
        toast.success("Tracking link updated");
      } else {
        let campaignId: string;
        const { data: existingCampaign } = await supabase
          .from("campaigns").select("id")
          .eq("account_id", accountId).eq("name", campaignName.trim())
          .maybeSingle();

        if (existingCampaign) {
          campaignId = existingCampaign.id;
        } else {
          const { data: newCampaign, error: campErr } = await supabase
            .from("campaigns")
            .insert({ account_id: accountId, name: campaignName.trim(), status: "active" })
            .select("id").single();
          if (campErr) throw campErr;
          campaignId = newCampaign.id;
        }

        const { error } = await supabase.from("tracking_links").insert({
          url: url.trim(),
          campaign_name: campaignName.trim(),
          campaign_id: campaignId,
          account_id: accountId,
          traffic_source_id: trafficSourceId || null,
          source_tag: sourceName,
          status: "ACTIVE",
          cost_type: costType,
          cost_value: costValue,
          cost_total: costTotal,
          external_tracking_link_id: externalId || null,
        });
        if (error) throw error;
        toast.success("Tracking link created");
      }

      queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
      onClose();
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const labelStyle = { fontSize: "11px", color: "#64748b", fontWeight: 600 as const, textTransform: "uppercase" as const, letterSpacing: "0.04em" };
  const inputStyle = { borderColor: "#e8edf2", borderRadius: "8px", color: "#1a2332", fontSize: "13px" };
  const selectedAccount = accounts.find((a: any) => a.id === accountId);

  return (
    <div className="bg-white border px-5 py-4 space-y-3" style={{ borderColor: "#e8edf2", borderRadius: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
      <div className="flex items-center justify-between">
        <p style={{ fontSize: "13px", fontWeight: 700, color: "#1a2332" }}>
          {isEdit ? "Edit Tracking Link" : "New Tracking Link"}
        </p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-secondary">
          <ChevronUp className="h-4 w-4" />
        </button>
      </div>

      {/* Row 1: URL (full width) */}
      <div>
        <label style={labelStyle}>Tracking Link URL</label>
        <input type="text" value={url} onChange={(e) => handleUrlChange(e.target.value)}
          placeholder="https://onlyfans.com/..."
          className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
          style={inputStyle} />
        {externalId && (
          <p className="mt-0.5" style={{ fontSize: "10px", color: "#0891b2" }}>
            ID: {externalId}
          </p>
        )}
      </div>

      {/* Row 2: Campaign Name | Model | Traffic Source | CPC | CPL | Total Spend */}
      <div className="grid grid-cols-6 gap-3">
        <div>
          <label style={labelStyle}>Campaign Name</label>
          <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Campaign name..."
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
            style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Model</label>
          <div className="flex items-center gap-2 mt-1">
            {selectedAccount && (
              <ModelAvatar avatarUrl={selectedAccount.avatar_thumb_url} name={selectedAccount.display_name} size={24} className="shrink-0" />
            )}
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 bg-white border text-sm outline-none appearance-none cursor-pointer"
              style={inputStyle}>
              <option value="">Select...</option>
              {accounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.display_name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label style={labelStyle}>Traffic Source</label>
          <select value={trafficSourceId} onChange={(e) => setTrafficSourceId(e.target.value)}
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1 appearance-none cursor-pointer"
            style={inputStyle}>
            <option value="">Select source...</option>
            {trafficSources.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label style={labelStyle}>CPC</label>
          <input type="number" value={cpc} onChange={(e) => setCpc(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
            style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>CPL</label>
          <input type="number" value={cpl} onChange={(e) => setCpl(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
            style={inputStyle} />
        </div>

        <div>
          <label style={labelStyle}>Total Spend</label>
          <input type="number" value={totalSpend} onChange={(e) => setTotalSpend(e.target.value)}
            placeholder="0.00"
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
            style={inputStyle} />
        </div>
      </div>

      {/* Save */}
      <button onClick={handleSave} disabled={!url.trim() || !campaignName.trim() || !accountId || saving}
        className="w-full py-2.5 text-sm font-bold text-white disabled:opacity-50 transition-colors hover:opacity-90"
        style={{ background: "#0891b2", borderRadius: "8px" }}>
        {saving ? "Saving..." : isEdit ? "Save Changes" : "Save"}
      </button>
    </div>
  );
}
