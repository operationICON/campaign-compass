import React, { useState, useMemo, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { BulkActionToolbar } from "@/components/BulkActionToolbar";
import { TagBadge } from "@/components/TagBadge";
import { AccountFilterDropdown } from "@/components/AccountFilterDropdown";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Search, Plus, ChevronLeft, ChevronRight, Trash2, Edit2, X, Tag,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";

const fmtC = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TrafficSourcesPage() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const perPage = 25;

  // Create source form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<"Direct" | "OnlyTraffic">("Direct");
  const [newKeywords, setNewKeywords] = useState("");

  // Edit source
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<"Direct" | "OnlyTraffic">("Direct");
  const [editKeywords, setEditKeywords] = useState("");

  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ["traffic_sources"],
    queryFn: async () => {
      const { data, error } = await supabase.from("traffic_sources").select("*").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: links = [], isLoading: linksLoading } = useQuery({
    queryKey: ["tracking_links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tracking_links")
        .select("*, accounts(display_name, username, avatar_thumb_url)")
        .is("deleted_at", null)
        .order("revenue", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("accounts").select("*").order("display_name");
      return data || [];
    },
  });

  // Compute campaign counts per source
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    links.forEach((l: any) => {
      const tag = l.source_tag || "Untagged";
      counts[tag] = (counts[tag] || 0) + 1;
    });
    return counts;
  }, [links]);

  // Filter links by selected source
  const filteredLinks = useMemo(() => {
    let result = links;
    if (selectedSource === "untagged") {
      result = result.filter((l: any) => !l.source_tag);
    } else if (selectedSource) {
      result = result.filter((l: any) => l.source_tag === selectedSource);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((l: any) =>
        (l.campaign_name || "").toLowerCase().includes(q) ||
        (l.url || "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [links, selectedSource, searchQuery]);

  const totalPages = Math.ceil(filteredLinks.length / perPage);
  const safePage = Math.min(page, Math.max(1, totalPages));
  const paginated = filteredLinks.slice((safePage - 1) * perPage, safePage * perPage);

  const toggleSelectRow = useCallback((id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedRows.size === paginated.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(paginated.map((l: any) => l.id)));
    }
  }, [paginated, selectedRows]);

  const handleCreateSource = async () => {
    if (!newName.trim()) return;
    try {
      const keywords = newKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      const { error } = await supabase.from("traffic_sources").insert({
        name: newName.trim(),
        category: newCategory,
        keywords,
        color: newCategory === "OnlyTraffic" ? "#7c3aed" : "#0891b2",
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
      toast.success("Source created");
      setShowCreate(false);
      setNewName("");
      setNewKeywords("");
    } catch (err: any) {
      toast.error(err.message || "Failed to create source");
    }
  };

  const handleEditSource = async (id: string) => {
    try {
      const keywords = editKeywords.split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
      const { error } = await supabase.from("traffic_sources").update({
        name: editName.trim(),
        category: editCategory,
        keywords,
        color: editCategory === "OnlyTraffic" ? "#7c3aed" : "#0891b2",
      }).eq("id", id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
      toast.success("Source updated");
      setEditingId(null);
    } catch (err: any) {
      toast.error("Failed to update source");
    }
  };

  const handleDeleteSource = async (id: string) => {
    try {
      const { error } = await supabase.from("traffic_sources").delete().eq("id", id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
      toast.success("Source deleted");
    } catch (err: any) {
      toast.error("Failed to delete source");
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Traffic Sources</h1>
            <p className="text-sm text-muted-foreground">Manage traffic sources and view campaigns per source</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> New Source
          </button>
        </div>

        {/* Create source form */}
        {showCreate && (
          <div className="bg-card border border-border rounded-xl p-4 space-y-3 animate-fade-in">
            <p className="text-sm font-semibold text-foreground">Create Traffic Source</p>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Source name..."
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" autoFocus />
            <div className="flex gap-2">
              {(["Direct", "OnlyTraffic"] as const).map(cat => (
                <button key={cat} onClick={() => setNewCategory(cat)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${newCategory === cat ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}>
                  {cat}
                </button>
              ))}
            </div>
            <input type="text" value={newKeywords} onChange={(e) => setNewKeywords(e.target.value)} placeholder="Keywords (comma separated)..."
              className="w-full px-3 py-2 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" />
            <div className="flex gap-2">
              <button onClick={handleCreateSource} disabled={!newName.trim()} className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">Create</button>
              <button onClick={() => { setShowCreate(false); setNewName(""); setNewKeywords(""); }} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground">Cancel</button>
            </div>
          </div>
        )}

        {/* Sources grid + campaign list */}
        <div className="flex gap-4">
          {/* Sources sidebar */}
          <div className="w-64 shrink-0 space-y-1">
            <button
              onClick={() => { setSelectedSource(null); setPage(1); setSelectedRows(new Set()); }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${!selectedSource ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-secondary"}`}
            >
              <span>All Sources</span>
              <span className="text-xs text-muted-foreground">{links.length}</span>
            </button>
            <button
              onClick={() => { setSelectedSource("untagged"); setPage(1); setSelectedRows(new Set()); }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${selectedSource === "untagged" ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-secondary"}`}
            >
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground" />
                <span>Untagged</span>
              </div>
              <span className="text-xs text-muted-foreground">{sourceCounts["Untagged"] || 0}</span>
            </button>
            {sources.map((s: any) => (
              <div key={s.id} className="group relative">
                {editingId === s.id ? (
                  <div className="bg-card border border-border rounded-lg p-2 space-y-1.5">
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground outline-none" autoFocus />
                    <div className="flex gap-1">
                      {(["Direct", "OnlyTraffic"] as const).map(cat => (
                        <button key={cat} onClick={() => setEditCategory(cat)}
                          className={`flex-1 px-1 py-0.5 rounded text-[10px] font-bold ${editCategory === cat ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"}`}>{cat}</button>
                      ))}
                    </div>
                    <input type="text" value={editKeywords} onChange={(e) => setEditKeywords(e.target.value)} placeholder="Keywords..."
                      className="w-full px-2 py-1 bg-secondary border border-border rounded text-xs text-foreground outline-none" />
                    <div className="flex gap-1">
                      <button onClick={() => handleEditSource(s.id)} className="flex-1 py-1 rounded bg-primary text-primary-foreground text-[10px] font-bold">Save</button>
                      <button onClick={() => setEditingId(null)} className="px-2 py-1 text-[10px] text-muted-foreground">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setSelectedSource(s.name); setPage(1); setSelectedRows(new Set()); }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${selectedSource === s.name ? "bg-primary/10 text-primary font-semibold" : "text-foreground hover:bg-secondary"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#0891b2" }} />
                      <span className="truncate">{s.name}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">{s.category}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">{sourceCounts[s.name] || 0}</span>
                      <div className="hidden group-hover:flex items-center gap-0.5 ml-1">
                        <button onClick={(e) => { e.stopPropagation(); setEditingId(s.id); setEditName(s.name); setEditCategory(s.category); setEditKeywords((s.keywords || []).join(", ")); }}
                          className="p-0.5 rounded hover:bg-secondary"><Edit2 className="h-3 w-3 text-muted-foreground" /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteSource(s.id); }}
                          className="p-0.5 rounded hover:bg-destructive/10"><Trash2 className="h-3 w-3 text-destructive" /></button>
                      </div>
                    </div>
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Campaign list */}
          <div className="flex-1 min-w-0">
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              {/* Search bar */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
                <div className="relative flex-1 max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input type="text" placeholder="Search campaigns..." value={searchQuery} onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                    className="w-full pl-9 pr-3 py-1.5 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary" />
                </div>
                <span className="text-xs text-muted-foreground">{filteredLinks.length} campaigns</span>
              </div>

              {/* Bulk toolbar */}
              <BulkActionToolbar
                selectedIds={selectedRows}
                onClear={() => setSelectedRows(new Set())}
                totalFiltered={filteredLinks.length}
                onSelectAll={() => setSelectedRows(new Set(filteredLinks.map((l: any) => l.id)))}
                actions={["assign_source", "remove_source", "delete"]}
                onComplete={() => {
                  queryClient.invalidateQueries({ queryKey: ["tracking_links"] });
                  queryClient.invalidateQueries({ queryKey: ["traffic_sources"] });
                }}
              />

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 z-10 bg-secondary">
                    <tr className="border-b border-border">
                      <th className="w-8" style={{ padding: "8px 12px" }}>
                        <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleSelectAll} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                      </th>
                      <th className="text-left" style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Campaign</th>
                      <th className="text-left" style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Model</th>
                      <th className="text-left" style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Source</th>
                      <th className="text-right" style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Clicks</th>
                      <th className="text-right" style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Subs</th>
                      <th className="text-right" style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>Revenue</th>
                      <th className="text-right" style={{ padding: "8px 12px", fontSize: "11px", fontWeight: 600, textTransform: "uppercase" }}>LTV</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((link: any) => {
                      const username = link.accounts?.username || link.accounts?.display_name || "—";
                      return (
                        <tr key={link.id} className="border-b border-border/50 hover:bg-secondary/30 transition-colors" style={{ height: "42px" }}>
                          <td style={{ padding: "8px 12px" }}>
                            <input type="checkbox" checked={selectedRows.has(link.id)} onChange={() => toggleSelectRow(link.id)} className="h-3.5 w-3.5 rounded border-border cursor-pointer" />
                          </td>
                          <td style={{ padding: "8px 12px", maxWidth: "200px" }}>
                            <p className="font-bold text-foreground truncate" style={{ fontSize: "12px" }}>{link.campaign_name || "—"}</p>
                            <p className="truncate text-muted-foreground" style={{ fontSize: "10px" }}>{link.url}</p>
                          </td>
                          <td style={{ padding: "8px 12px", fontSize: "11px" }}>
                            <span className="text-muted-foreground">@{username}</span>
                          </td>
                          <td style={{ padding: "8px 12px" }}>
                            <TagBadge tagName={link.source_tag} size="sm" />
                          </td>
                          <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                            {(link.clicks || 0).toLocaleString()}
                          </td>
                          <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                            {(link.subscribers || 0).toLocaleString()}
                          </td>
                          <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                            {fmtC(Number(link.revenue || 0))}
                          </td>
                          <td className="text-right font-mono" style={{ padding: "8px 12px", fontSize: "12px" }}>
                            {Number(link.ltv || 0) > 0 ? (
                              <span className="text-primary">{fmtC(Number(link.ltv))}</span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {paginated.length === 0 && (
                      <tr>
                        <td colSpan={8} className="text-center py-8 text-sm text-muted-foreground">
                          {searchQuery ? "No campaigns match your search" : selectedSource ? "No campaigns with this source" : "No campaigns found"}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                  <span className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30">
                      <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                    </button>
                    <button onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="p-1.5 rounded hover:bg-secondary disabled:opacity-30">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
