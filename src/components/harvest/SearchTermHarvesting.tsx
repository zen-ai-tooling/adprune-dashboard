import React, { useMemo, useReducer, useRef, useState } from "react";
import {
  Upload,
  Download,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  X,
  Search,
  Loader2,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  parseSearchTermReport,
  buildHarvestBulkWorkbook,
  downloadWorkbook,
  guessDestinationCampaign,
  type HarvestRow,
  type LookbackPreset,
} from "@/lib/ui/searchTermHarvest";

// ── Local-only reducer (no global state touched) ──
type Action =
  | { type: "load"; rows: HarvestRow[]; fileName: string }
  | { type: "toggle-select"; id: string }
  | { type: "select-many"; ids: string[]; value: boolean }
  | { type: "dismiss"; id: string }
  | { type: "harvest"; ids: string[] }
  | { type: "rollback"; ids: string[] }
  | { type: "set-destination"; id: string; value: string }
  | { type: "reset" };

interface State {
  rows: HarvestRow[];
  selected: Set<string>;
  fileName: string;
}

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "load":
      return { rows: action.rows, selected: new Set(), fileName: action.fileName };
    case "toggle-select": {
      const next = new Set(state.selected);
      next.has(action.id) ? next.delete(action.id) : next.add(action.id);
      return { ...state, selected: next };
    }
    case "select-many": {
      const next = new Set(state.selected);
      action.ids.forEach((id) => (action.value ? next.add(id) : next.delete(id)));
      return { ...state, selected: next };
    }
    case "dismiss":
      return {
        ...state,
        rows: state.rows.map((r) => (r.id === action.id ? { ...r, dismissed: true } : r)),
        selected: new Set([...state.selected].filter((id) => id !== action.id)),
      };
    case "harvest":
      return {
        ...state,
        rows: state.rows.map((r) => (action.ids.includes(r.id) ? { ...r, harvested: true } : r)),
        selected: new Set(),
      };
    case "rollback":
      return {
        ...state,
        rows: state.rows.map((r) => (action.ids.includes(r.id) ? { ...r, harvested: false } : r)),
      };
    case "set-destination":
      return {
        ...state,
        rows: state.rows.map((r) => (r.id === action.id ? { ...r, destinationCampaign: action.value } : r)),
      };
    case "reset":
      return { rows: [], selected: new Set(), fileName: "" };
    default:
      return state;
  }
};

const LOOKBACK_OPTIONS: { id: LookbackPreset; label: string; help: string }[] = [
  { id: "30d", label: "Last 30 days", help: "Recent signal, ignores attribution lag" },
  { id: "60d", label: "Last 60 days (recommended)", help: "Best balance: enough signal, fits 14d attribution" },
  { id: "90d", label: "Last 90 days", help: "Conservative — only mature converters" },
  { id: "custom", label: "Custom (file is pre-filtered)", help: "Use as uploaded" },
];

const fmtUSD = (n: number) => `$${n.toFixed(2)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

export const SearchTermHarvesting: React.FC = () => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, dispatch] = useReducer(reducer, { rows: [], selected: new Set<string>(), fileName: "" });
  const [isParsing, setIsParsing] = useState(false);
  const [lookback, setLookback] = useState<LookbackPreset>("60d");
  const [minSales, setMinSales] = useState<number>(1);
  const [maxAcos, setMaxAcos] = useState<number>(35);
  const [defaultBid, setDefaultBid] = useState<number>(0.75);
  const [query, setQuery] = useState("");

  const handleFile = async (file: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast({ title: "Invalid file type", description: "Use .xlsx, .xls, or .csv", variant: "destructive" });
      return;
    }
    setIsParsing(true);
    try {
      const { rows, totalRowsRead } = await parseSearchTermReport(file);
      dispatch({ type: "load", rows, fileName: file.name });
      toast({
        title: "Report parsed",
        description: `${rows.length.toLocaleString()} terms loaded from ${totalRowsRead.toLocaleString()} rows`,
      });
    } catch (e: any) {
      toast({ title: "Parse failed", description: e.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsParsing(false);
    }
  };

  // Filter pipeline
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.rows.filter((r) => {
      if (r.dismissed) return false;
      if (r.sales < minSales) return false;
      if (r.acos > maxAcos / 100 && r.orders > 0) return false;
      if (r.orders === 0 && minSales > 0) return false;
      if (q && !r.cleanedTerm.includes(q) && !r.campaignName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.rows, minSales, maxAcos, query]);

  const lookbackLabel = LOOKBACK_OPTIONS.find((o) => o.id === lookback)?.label ?? lookback;

  // Conflict pre-flight: same cleanedTerm targeted from >1 source campaign to same destination
  const detectConflicts = (ids: string[]): string[] => {
    const map = new Map<string, Set<string>>();
    ids.forEach((id) => {
      const r = state.rows.find((x) => x.id === id);
      if (!r) return;
      const key = `${r.cleanedTerm}||${r.destinationCampaign}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(r.campaignName);
    });
    const conflicts: string[] = [];
    map.forEach((srcs, key) => {
      if (srcs.size > 1) conflicts.push(key.split("||")[0]);
    });
    return conflicts;
  };

  const handleHarvest = (ids: string[]) => {
    if (!ids.length) return;
    // Step 1 stage exact creation; Step 2 stage negative — simulate atomic with rollback on any invalid row
    const invalid = ids.filter((id) => {
      const r = state.rows.find((x) => x.id === id);
      return !r || !r.destinationCampaign.trim() || !r.cleanedTerm;
    });
    if (invalid.length) {
      toast({
        title: "Harvest rolled back",
        description: `Step 2 failed for ${invalid.length} row(s) — missing destination or term. No staging applied.`,
        variant: "destructive",
      });
      return;
    }
    const conflicts = detectConflicts(ids);
    if (conflicts.length) {
      toast({
        title: "Bulk pre-flight blocked",
        description: `${conflicts.length} term(s) target the same destination from multiple source campaigns: ${conflicts.slice(0, 2).join(", ")}${conflicts.length > 2 ? "…" : ""}`,
        variant: "destructive",
      });
      return;
    }
    dispatch({ type: "harvest", ids });
    toast({
      title: ids.length === 1 ? "Harvest staged" : `${ids.length} harvests staged`,
      description: "Exact target + negative exact queued atomically",
    });
  };

  const handleExport = () => {
    const harvested = state.rows.filter((r) => r.harvested && !r.dismissed);
    if (!harvested.length) {
      toast({ title: "Nothing to export", description: "Harvest some terms first", variant: "destructive" });
      return;
    }
    const wb = buildHarvestBulkWorkbook({ rows: harvested, defaultBid, lookbackLabel });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadWorkbook(wb, `Harvest_Bulk_${stamp}.xlsx`);
    toast({ title: "Bulk file downloaded", description: `${harvested.length} harvests × 2 rows each` });
  };

  const harvestedCount = state.rows.filter((r) => r.harvested && !r.dismissed).length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => state.selected.has(r.id));

  // ── Render ──

  if (!state.rows.length) {
    return (
      <div className="w-full pt-4">
        <div className="surface-card p-6 max-w-2xl mx-auto">
          <h2 className="text-[20px] font-semibold text-foreground tracking-tight">Search Term Harvesting</h2>
          <p className="text-[13px] text-[#6B7280] mt-1.5">
            Upload your SP Search Term Report (.xlsx). We'll find proven converters, stage them as exact-match
            targets in your destination campaigns, and auto-block them in the source to prevent cannibalization.
          </p>

          <div
            className="mt-5 rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-10 cursor-pointer btn-press"
            style={{ borderColor: "#D1D5DB", background: "#FAFBFC" }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
          >
            {isParsing ? (
              <Loader2 className="w-8 h-8 text-[#9CA3AF] animate-spin" />
            ) : (
              <Upload className="w-8 h-8 text-[#9CA3AF]" strokeWidth={1.6} />
            )}
            <p className="text-[14px] font-medium text-[#374151] mt-3">
              {isParsing ? "Parsing report…" : "Drop SP Search Term Report or click to browse"}
            </p>
            <p className="text-[12px] text-[#9CA3AF] mt-1">.xlsx, .xls, .csv up to 20MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </div>

          <div className="mt-5 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3.5 text-[12px] text-[#374151] flex gap-2">
            <FileText className="w-4 h-4 text-[#6B7280] flex-shrink-0 mt-0.5" strokeWidth={1.8} />
            <div>
              <strong className="text-[#111827]">Tip:</strong> Export an SP Search Term report from Amazon Ads
              Console with a 60-day window. The tool expects columns: Campaign Name, Ad Group Name, Advertised ASIN,
              Customer Search Term, Clicks, Spend, Orders, Sales, ACoS.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 pt-2">
      {/* Control bar */}
      <div className="surface-card p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex flex-col">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">
              Lookback Window
            </label>
            <select
              value={lookback}
              onChange={(e) => setLookback(e.target.value as LookbackPreset)}
              className="h-9 px-3 text-[13px] rounded-md border border-[#E5E7EB] bg-white text-[#111827] outline-none focus:ring-2 focus:ring-primary"
            >
              {LOOKBACK_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-[#9CA3AF] mt-1">
              {LOOKBACK_OPTIONS.find((o) => o.id === lookback)?.help}
            </span>
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">
              Min Sales ($)
            </label>
            <Input
              type="number"
              value={minSales}
              onChange={(e) => setMinSales(Number(e.target.value) || 0)}
              className="w-28 font-mono-nums"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">
              Max ACoS (%)
            </label>
            <Input
              type="number"
              value={maxAcos}
              onChange={(e) => setMaxAcos(Number(e.target.value) || 0)}
              className="w-28 font-mono-nums"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">
              Default Bid ($)
            </label>
            <Input
              type="number"
              step="0.05"
              value={defaultBid}
              onChange={(e) => setDefaultBid(Number(e.target.value) || 0.5)}
              className="w-28 font-mono-nums"
            />
          </div>

          <div className="flex flex-col flex-1 min-w-[200px]">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">
              Search
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter terms or campaigns…"
                className="pl-8"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 text-[12.5px] text-[#374151]">
            <span>
              <strong className="text-[#111827] font-mono-nums">{filtered.length.toLocaleString()}</strong> qualified
              terms
            </span>
            <span className="text-[#D1D5DB]">·</span>
            <span>
              <strong className="text-[#111827] font-mono-nums">{state.selected.size}</strong> selected
            </span>
            <span className="text-[#D1D5DB]">·</span>
            <span>
              <strong className="text-[#10B981] font-mono-nums">{harvestedCount}</strong> staged
            </span>
            <span className="text-[#D1D5DB]">·</span>
            <span className="text-[#9CA3AF] truncate max-w-[200px]" title={state.fileName}>
              {state.fileName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleHarvest([...state.selected])}
              disabled={!state.selected.size}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold text-white btn-press disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#A855F7" }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Bulk Harvest Selected
            </button>
            <button
              onClick={handleExport}
              disabled={!harvestedCount}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold text-white btn-press disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#10B981" }}
            >
              <Download className="w-3.5 h-3.5" />
              Export Bulk File ({harvestedCount})
            </button>
            <button
              onClick={() => dispatch({ type: "reset" })}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[12.5px] font-medium text-[#6B7280] hover:text-[#111827] btn-press"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "36px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "260px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "70px" }} />
              <col style={{ width: "80px" }} />
              <col style={{ width: "70px" }} />
              <col style={{ width: "200px" }} />
              <col style={{ width: "150px" }} />
            </colgroup>
            <thead style={{ background: "#F9FAFB" }}>
              <tr className="border-b border-[#E5E7EB]">
                <th className="px-3 py-2.5 text-left">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={(v) =>
                      dispatch({ type: "select-many", ids: filtered.map((r) => r.id), value: !!v })
                    }
                  />
                </th>
                {[
                  "Source",
                  "ASIN",
                  "Search Term",
                  "Clicks",
                  "Spend",
                  "Orders",
                  "Sales",
                  "ACoS",
                  "Destination",
                  "Actions",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6B7280]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-[13px] text-[#9CA3AF]">
                    No terms match the current thresholds. Loosen Min Sales or Max ACoS.
                  </td>
                </tr>
              )}
              {filtered.map((r, i) => {
                const isSelected = state.selected.has(r.id);
                return (
                  <tr
                    key={r.id}
                    className="border-b border-[#F3F4F6] hover:bg-[#FAFBFC]"
                    style={{ background: r.harvested ? "#F0FDF4" : isSelected ? "#EFF6FF" : i % 2 ? "#FAFBFC" : "#FFF" }}
                  >
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => dispatch({ type: "toggle-select", id: r.id })}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-[12.5px] font-medium text-[#111827] truncate" title={r.campaignName}>
                        {r.campaignName}
                      </div>
                      <div className="text-[11px] text-[#9CA3AF] truncate" title={r.adGroupName}>
                        {r.adGroupName}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono-nums text-[12px] text-[#374151] truncate">
                      {r.advertisedASIN}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                          style={{
                            background: r.termKind === "ASIN" ? "#FEF3C7" : "#DBEAFE",
                            color: r.termKind === "ASIN" ? "#92400E" : "#1E40AF",
                          }}
                        >
                          {r.termKind === "ASIN" ? "PAT" : "KW"}
                        </span>
                        <span className="truncate text-[12.5px] text-[#111827]" title={r.cleanedTerm}>
                          {r.cleanedTerm}
                        </span>
                        {r.lengthWarning && (
                          <span title="Review length for negative match (>10 words or 80 chars)">
                            <AlertTriangle className="w-3.5 h-3.5 text-[#F59E0B] flex-shrink-0" strokeWidth={2} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono-nums text-[12px] text-[#374151]">{r.clicks}</td>
                    <td className="px-3 py-2.5 font-mono-nums text-[12px] text-[#374151]">{fmtUSD(r.spend)}</td>
                    <td className="px-3 py-2.5 font-mono-nums text-[12px] text-[#374151]">{r.orders}</td>
                    <td className="px-3 py-2.5 font-mono-nums text-[12px] text-[#111827] font-semibold">
                      {fmtUSD(r.sales)}
                    </td>
                    <td className="px-3 py-2.5 font-mono-nums text-[12px]">
                      <span style={{ color: r.acos > 0.5 ? "#DC2626" : r.acos > 0.35 ? "#F59E0B" : "#10B981" }}>
                        {r.orders > 0 ? fmtPct(r.acos) : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <Input
                        value={r.destinationCampaign}
                        onChange={(e) => dispatch({ type: "set-destination", id: r.id, value: e.target.value })}
                        className="h-7 text-[12px] font-mono-nums"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        {r.harvested ? (
                          <button
                            onClick={() => dispatch({ type: "rollback", ids: [r.id] })}
                            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] font-medium text-[#10B981] hover:bg-[#10B981]/10 btn-press"
                          >
                            <CheckCircle2 className="w-3 h-3" /> Staged
                          </button>
                        ) : (
                          <button
                            onClick={() => handleHarvest([r.id])}
                            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[11.5px] font-semibold text-white btn-press"
                            style={{ background: "#A855F7" }}
                          >
                            <Sparkles className="w-3 h-3" /> Harvest
                          </button>
                        )}
                        <button
                          onClick={() => dispatch({ type: "dismiss", id: r.id })}
                          title="Dismiss"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEE2E2] btn-press"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
