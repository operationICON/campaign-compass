import { useState } from "react";
import { Copy, Save, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

export interface ApiResponse {
  id: string;
  timestamp: Date;
  url: string;
  status: number;
  status_text: string;
  response_time_ms: number;
  credits_used: number | null;
  credits_balance: number | null;
  body: any;
  error?: string;
}

interface ResponseDisplayProps {
  response: ApiResponse | null;
  loading?: boolean;
}

export function ResponseDisplay({ response, loading }: ResponseDisplayProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (loading) {
    return (
      <div className="mt-4 bg-[#1a1f36] rounded-lg p-6 text-center">
        <div className="animate-spin h-5 w-5 border-2 border-[#0891b2] border-t-transparent rounded-full mx-auto" />
        <p className="text-[#94a3b8] text-xs mt-2">Calling API…</p>
      </div>
    );
  }

  if (!response) return null;

  const isSuccess = response.status >= 200 && response.status < 300;
  const jsonStr = JSON.stringify(response.body, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonStr);
    toast.success("Response copied");
  };

  const handleSave = () => {
    const saved = JSON.parse(localStorage.getItem("debug_saved_responses") || "[]");
    saved.unshift({
      ...response,
      timestamp: response.timestamp.toISOString(),
      saved_at: new Date().toISOString(),
    });
    if (saved.length > 50) saved.length = 50;
    localStorage.setItem("debug_saved_responses", JSON.stringify(saved));
    toast.success("Response saved to browser");
  };

  return (
    <div className="mt-4 bg-[#1a1f36] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {isSuccess ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <XCircle className="h-4 w-4 text-red-400" />
          )}
          <span className="text-white font-mono text-sm font-semibold">
            {response.status} {response.status_text}
          </span>
          <span className="text-[#64748b] text-xs font-mono">
            {response.response_time_ms}ms
          </span>
          {response.credits_used !== null && (
            <span className="text-[#0891b2] text-xs font-mono">
              {response.credits_used} credits
            </span>
          )}
          {response.credits_balance !== null && (
            <span className="text-[#64748b] text-xs font-mono">
              (bal: {response.credits_balance.toLocaleString()})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="text-[#94a3b8] hover:text-white p-1" title="Copy">
            <Copy className="h-3.5 w-3.5" />
          </button>
          <button onClick={handleSave} className="text-[#94a3b8] hover:text-white p-1" title="Save">
            <Save className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setCollapsed(!collapsed)} className="text-[#94a3b8] hover:text-white p-1">
            {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {/* URL */}
      <div className="px-4 py-2 border-b border-white/5">
        <p className="text-[10px] text-[#64748b] font-mono break-all">{response.url}</p>
      </div>
      {/* Body */}
      {!collapsed && (
        <pre className="text-xs font-mono whitespace-pre-wrap break-all p-4 max-h-[500px] overflow-auto text-[#e2e8f0]">
          {jsonStr}
        </pre>
      )}
    </div>
  );
}
