import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { X } from "lucide-react";
import { ModelAvatar } from "@/components/ModelAvatar";

interface TrackingLinkPanelProps {
  open: boolean;
  onClose: () => void;
  editLink?: any; // existing link to edit, null = create mode
  accounts: any[];
}

function extractExternalId(url: string): string {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? match[1] : "";
}

export function TrackingLinkPanel({ open, onClose, editLink, accounts }: TrackingLinkPanelProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editLink;

  const [url, setUrl] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [accountId, setAccountId] = useState("");
  const [trafficSourceId, setTrafficSourceId] = useState("");
  const [category, setCategory] = useState<"Manual" | "OnlyTraffic">("Manual");
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

  // Populate form when editing
  useEffect(() => {
    if (editLink) {
      setUrl(editLink.url || "");
      setCampaignName(editLink.campaign_name || "");
      setAccountId(editLink.account_id || "");
      setTrafficSourceId(editLink.traffic_source_id || "");
      setCpc(editLink.cost_type === "CPC" && editLink.cost_value ? String(editLink.cost_value) : "");
      setCpl(editLink.cost_type === "CPL" && editLink.cost_value ? String(editLink.cost_value) : "");
      setTotalSpend(editLink.cost_type === "FIXED" && editLink.cost_value ? String(editLink.cost_value) : "");
      setCategory("Manual");
    } else {
      setUrl("");
      setCampaignName("");
      setAccountId(accounts.length > 0 ? accounts[0].id : "");
      setTrafficSourceId("");
      setCategory("Manual");
      setCpc("");
      setCpl("");
      setTotalSpend("");
    }
  }, [editLink, open, accounts]);

  const externalId = useMemo(() => extractExternalId(url), [url]);

  const handleSave = async () => {
    if (!url.trim() || !campaignName.trim() || !accountId) {
      toast.error("URL, Campaign Name, and Model are required");
      return;
    }
    setSaving(true);
    try {
      // Determine cost
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
        // Need a campaign — find or create
        let campaignId: string;
        const { data: existingCampaign } = await supabase
          .from("campaigns")
          .select("id")
          .eq("account_id", accountId)
          .eq("name", campaignName.trim())
          .maybeSingle();

        if (existingCampaign) {
          campaignId = existingCampaign.id;
        } else {
          const { data: newCampaign, error: campErr } = await supabase
            .from("campaigns")
            .insert({ account_id: accountId, name: campaignName.trim(), status: "active" })
            .select("id")
            .single();
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

  return (
    <div style={{ flex: "0 0 38%" }}>
      <div className="bg-white border px-5 py-4 space-y-4" style={{ borderColor: "#e8edf2", borderRadius: "16px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
        <div className="flex items-center justify-between">
          <p style={{ fontSize: "13px", fontWeight: 700, color: "#1a2332" }}>
            {isEdit ? "Edit Tracking Link" : "New Tracking Link"}
          </p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* URL */}
        <div>
          <label style={labelStyle}>Tracking Link URL</label>
          <input type="text" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://onlyfans.com/..."
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
            style={inputStyle} />
          {externalId && (
            <p className="mt-1" style={{ fontSize: "10px", color: "#0891b2" }}>
              Extracted ID: {externalId}
            </p>
          )}
        </div>

        {/* Campaign Name */}
        <div>
          <label style={labelStyle}>Campaign Name</label>
          <input type="text" value={campaignName} onChange={(e) => setCampaignName(e.target.value)}
            placeholder="Campaign name..."
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
            style={inputStyle} />
        </div>

        {/* Model */}
        <div>
          <label style={labelStyle}>Model</label>
          <div className="relative mt-1">
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full px-3 py-2 bg-white border text-sm outline-none appearance-none cursor-pointer"
              style={inputStyle}
            >
              <option value="">Select model...</option>
              {accounts.map((a: any) => (
                <option key={a.id} value={a.id}>{a.display_name}</option>
              ))}
            </select>
          </div>
          {accountId && (() => {
            const acc = accounts.find((a: any) => a.id === accountId);
            if (!acc) return null;
            return (
              <div className="flex items-center gap-2 mt-1.5">
                <ModelAvatar avatarUrl={acc.avatar_thumb_url} name={acc.display_name} size={24} />
                <span style={{ fontSize: "12px", color: "#1a2332" }}>{acc.display_name}</span>
              </div>
            );
          })()}
        </div>

        {/* Traffic Source */}
        <div>
          <label style={labelStyle}>Traffic Source</label>
          <select
            value={trafficSourceId}
            onChange={(e) => setTrafficSourceId(e.target.value)}
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1 appearance-none cursor-pointer"
            style={inputStyle}
          >
            <option value="">Select source...</option>
            {trafficSources.map((s: any) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {/* Category */}
        <div>
          <label style={labelStyle}>Category</label>
          <div className="flex gap-2 mt-1">
            {(["OnlyTraffic", "Manual"] as const).map(cat => (
              <button key={cat} onClick={() => setCategory(cat)}
                className="flex-1 px-3 py-1.5 text-xs font-bold transition-colors"
                style={{ borderRadius: "8px", background: category === cat ? "#0891b2" : "#f1f5f9", color: category === cat ? "white" : "#64748b" }}>
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* CPC / CPL */}
        <div>
          <label style={labelStyle}>CPC / CPL</label>
          <div className="flex gap-2 mt-1">
            <input type="number" value={cpc} onChange={(e) => setCpc(e.target.value)}
              placeholder="CPC"
              className="flex-1 px-3 py-2 bg-white border text-sm outline-none"
              style={inputStyle} />
            <input type="number" value={cpl} onChange={(e) => setCpl(e.target.value)}
              placeholder="CPL"
              className="flex-1 px-3 py-2 bg-white border text-sm outline-none"
              style={inputStyle} />
          </div>
        </div>

        {/* Total Spend */}
        <div>
          <label style={labelStyle}>Total Spend</label>
          <input type="number" value={totalSpend} onChange={(e) => setTotalSpend(e.target.value)}
            placeholder="Total spend..."
            className="w-full px-3 py-2 bg-white border text-sm outline-none mt-1"
            style={inputStyle} />
        </div>

        {/* Save */}
        <button onClick={handleSave} disabled={!url.trim() || !campaignName.trim() || !accountId || saving}
          className="w-full py-2 text-sm font-bold text-white disabled:opacity-50"
          style={{ background: "#0891b2", borderRadius: "8px" }}>
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Save"}
        </button>
      </div>
    </div>
  );
}
