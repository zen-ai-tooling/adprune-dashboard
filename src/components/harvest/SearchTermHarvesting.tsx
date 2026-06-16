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
  ChevronRight,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { WorkflowStepBreadcrumb } from "@/components/shared/WorkflowStepBreadcrumb";
import { CompletionView } from "@/components/shared/CompletionView";
import {
  parseSearchTermReport,
  parseReferenceBulkFile,
  buildHarvestBulkWorkbook,
  downloadWorkbook,
  type HarvestRow,
  type HarvestExportSummary,
} from "@/lib/ui/searchTermHarvest";
import type { BulkIdIndex } from "@/lib/amazonBulkIdIndex";

// ── Local-only reducer (no global state touched) ──
type Action =
  | { type: "load"; rows: HarvestRow[]; fileName: string }
  | { type: "toggle-select"; id: string }
  | { type: "select-many"; ids: string[]; value: boolean }
  | { type: "dismiss"; id: string }
  | { type: "harvest"; ids: string[] }
  | { type: "rollback"; ids: string[] }
  | { type: "restore"; id: string }
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
    case "restore":
      return {
        ...state,
        rows: state.rows.map((r) => (r.id === action.id ? { ...r, dismissed: false } : r)),
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

const fmtUSD = (n: number) => `$${n.toFixed(2)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

const PARSE_MESSAGES = [
  "Reading search term report…",
  "Detecting headers & metrics…",
  "Classifying ASINs vs keywords…",
  "Auto-mapping destination campaigns…",
];

export const SearchTermHarvesting: React.FC = () => {
  const { toast } = useToast();
  const stInputRef = useRef<HTMLInputElement>(null);
  const bulkInputRef = useRef<HTMLInputElement>(null);
  const [state, dispatch] = useReducer(reducer, { rows: [], selected: new Set<string>(), fileName: "" });
  const [isParsing, setIsParsing] = useState(false);
  const [parseStep, setParseStep] = useState(0);
  const [minOrders, setMinOrders] = useState<number>(2);
  const [maxAcos, setMaxAcos] = useState<number>(35);
  const [defaultBid, setDefaultBid] = useState<number>(0.75);
  const [maxBid, setMaxBid] = useState<number>(2.25);
  const [query, setQuery] = useState("");
  const [bulkIdIndex, setBulkIdIndex] = useState<BulkIdIndex | null>(null);
  const [bulkFileName, setBulkFileName] = useState<string>("");
  const [hasExported, setHasExported] = useState(false);
  const [sortField, setSortField] = useState<"clicks" | "spend" | "orders" | "sales" | "acos">("orders");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const PAGE_SIZE = 50;
  const [completion, setCompletion] = useState<{
    fileName: string;
    summary: HarvestExportSummary;
    onDownload: () => void;
  } | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  // Keep maxBid in sync with defaultBid * 3 unless user has manually adjusted.
  const userTouchedMaxBidRef = useRef(false);
  React.useEffect(() => {
    if (!userTouchedMaxBidRef.current) setMaxBid(Number((defaultBid * 3).toFixed(2)));
  }, [defaultBid]);

  // Unique SP campaign names for destination autocomplete — Exact campaigns first.
  const destinationOptions = useMemo(() => {
    if (!bulkIdIndex) return [];
    const all = bulkIdIndex.listCampaignNames("SP");
    return [...all].sort((a, b) => {
      const aExact = /exact/i.test(a) ? 0 : 1;
      const bExact = /exact/i.test(b) ? 0 : 1;
      return aExact - bExact || a.localeCompare(b);
    });
  }, [bulkIdIndex]);

  const handleStFile = async (file: File) => {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      toast({ title: "Invalid file type", description: "Use .xlsx, .xls, or .csv", variant: "destructive" });
      return;
    }
    setIsParsing(true);
    setParseStep(0);
    const tick = setInterval(() => setParseStep((p) => Math.min(p + 1, PARSE_MESSAGES.length - 1)), 350);
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
      clearInterval(tick);
      setIsParsing(false);
    }
  };

  const handleBulkFile = async (file: File) => {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      toast({ title: "Invalid file type", description: "Reference bulk must be .xlsx", variant: "destructive" });
      return;
    }
    try {
      const idx = await parseReferenceBulkFile(file);
      setBulkIdIndex(idx);
      setBulkFileName(file.name);
      toast({ title: "Reference bulk loaded", description: "Campaign & Ad Group IDs will be resolved on export." });
    } catch (e: any) {
      toast({ title: "Bulk parse failed", description: e.message ?? "Unknown error", variant: "destructive" });
    }
  };

  // Aggregation: count how many source campaigns each cleanedTerm appears in
  const sourceCountByTerm = useMemo(() => {
    const m = new Map<string, Set<string>>();
    state.rows.forEach((r) => {
      if (r.dismissed) return;
      if (!m.has(r.cleanedTerm)) m.set(r.cleanedTerm, new Set());
      m.get(r.cleanedTerm)!.add(r.campaignName);
    });
    return m;
  }, [state.rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = state.rows.filter((r) => {
      if (r.dismissed) return false;
      if (r.orders < minOrders) return false;
      if (r.acos > maxAcos / 100 && r.orders > 0) return false;
      if (q && !r.cleanedTerm.includes(q) && !r.campaignName.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = (a[sortField] as number) ?? 0;
      const bv = (b[sortField] as number) ?? 0;
      return (av - bv) * dir;
    });
  }, [state.rows, minOrders, maxAcos, query, sortField, sortDir]);

  // Pagination — reset to page 0 whenever filters change. Also clear selection so that
  // rows that scroll out of the filtered view cannot be bulk-harvested invisibly.
  React.useEffect(() => {
    setPage(0);
    setSelectAllFiltered(false);
    dispatch({ type: "select-many", ids: [...state.selected], value: false });
    // Intentionally omit state.selected from deps — including it would cause an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minOrders, maxAcos, query, sortField, sortDir, state.rows.length]);

  const dismissedRows = useMemo(() => state.rows.filter((r) => r.dismissed), [state.rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filtered.length);
  const pagedRows = filtered.slice(pageStart, pageEnd);
  const showPagination = filtered.length > PAGE_SIZE;

  const toggleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  // Merge-aware: same term across multiple sources is fine. No blocking; we'll generate 1 exact + many negatives.
  const handleHarvest = (ids: string[]) => {
    if (!ids.length) return;
    const invalid = ids.filter((id) => {
      const r = state.rows.find((x) => x.id === id);
      return !r || !r.destinationCampaign.trim() || !r.cleanedTerm;
    });
    if (invalid.length) {
      toast({
        title: "Harvest rolled back",
        description: `${invalid.length} row(s) missing destination or term. No staging applied.`,
        variant: "destructive",
      });
      return;
    }
    dispatch({ type: "harvest", ids });
    const emptyAdGroup = ids.filter((id) => {
      const r = state.rows.find((x) => x.id === id);
      return r && !r.adGroupName.trim();
    }).length;
    let desc = "Exact target + negative exact queued.";
    if (emptyAdGroup > 0) {
      desc += ` (${emptyAdGroup} row(s) have no Ad Group — negatives will be campaign-wide)`;
    }
    toast({
      title: ids.length === 1 ? "Harvest staged" : `${ids.length} harvests staged`,
      description: desc,
    });
  };

  const handleExport = () => {
    const harvested = state.rows.filter((r) => r.harvested && !r.dismissed);
    if (!harvested.length) {
      toast({ title: "Nothing to export", description: "Harvest some terms first", variant: "destructive" });
      return;
    }
    const emptyDest = harvested.filter((r) => !r.destinationCampaign.trim());
    if (emptyDest.length) {
      toast({
        title: "Missing destinations",
        description: `${emptyDest.length} harvested term(s) have no destination campaign. Fill them in before exporting.`,
        variant: "destructive",
      });
      return;
    }
    const { workbook, summary, warnings } = buildHarvestBulkWorkbook({
      rows: harvested,
      defaultBid,
      maxBid,
      bulkIdIndex: bulkIdIndex ?? undefined,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    const fileName = `Harvest_Bulk_60d_${stamp}.xlsx`;
    const doDownload = () => downloadWorkbook(workbook, fileName);
    doDownload();
    warnings.forEach((w) =>
      toast({ title: "Heads up", description: w, variant: w.includes("not found") ? "destructive" : undefined }),
    );
    setHasExported(true);
    setCompletion({ fileName, summary, onDownload: doDownload });
  };

  const harvestedCount = state.rows.filter((r) => r.harvested && !r.dismissed).length;
  const allPagedSelected = pagedRows.length > 0 && pagedRows.every((r) => state.selected.has(r.id));
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => state.selected.has(r.id));

  const handleReset = () => {
    if (harvestedCount > 0 || state.rows.length > 0) {
      const confirmed = window.confirm(
        `Reset will clear ${state.rows.length} loaded terms and ${harvestedCount} staged harvests. Continue?`,
      );
      if (!confirmed) return;
    }
    dispatch({ type: "reset" });
    setShowDismissed(false);
    setHasExported(false);
  };

  // Completion view
  if (completion) {
    const { summary } = completion;
    return (
      <CompletionView
        fileName={completion.fileName}
        impactHeadline={`${summary.exactRows} proven search term${summary.exactRows === 1 ? "" : "s"} promoted to exact match`}
        impactSubtitle={`Harvested ${summary.exactRows} exact target${summary.exactRows === 1 ? "" : "s"} and ${summary.negativeRows} negative${summary.negativeRows === 1 ? "" : "s"} across ${summary.campaignsAffected} campaign${summary.campaignsAffected === 1 ? "" : "s"}.`}
        summary={[
          { label: "Exact targets", value: String(summary.exactRows) },
          { label: "Negatives created", value: String(summary.negativeRows) },
          { label: "Campaigns affected", value: String(summary.campaignsAffected) },
          { label: "Duplicates removed", value: String(summary.duplicateExactsRemoved) },
        ]}
        breakdown={[
          { label: "Exact targets", count: summary.exactRows, color: "#10B981" },
          { label: "Negatives", count: summary.negativeRows, color: "#6366F1" },
        ]}
        onDownload={completion.onDownload}
        onStartNew={() => {
          setCompletion(null);
          dispatch({ type: "reset" });
          setBulkIdIndex(null);
          setBulkFileName("");
          setHasExported(false);
        }}
      />
    );
  }

  // ── Step header (always visible) ──
  const stepperState =
    state.rows.length === 0
      ? [
          { label: "Upload reports", status: "active" as const },
          { label: "Review & select terms", status: "pending" as const },
          { label: "Export bulk file", status: "pending" as const },
        ]
      : harvestedCount === 0
        ? [
            { label: "Upload reports", status: "complete" as const },
            { label: "Review & select terms", status: "active" as const },
            { label: "Export bulk file", status: "pending" as const },
          ]
        : hasExported
          ? [
              { label: "Upload reports", status: "complete" as const },
              { label: "Review & select terms", status: "complete" as const },
              { label: "Export bulk file", status: "complete" as const },
            ]
          : [
              { label: "Upload reports", status: "complete" as const },
              { label: "Review & select terms", status: "complete" as const },
              { label: "Export bulk file", status: "active" as const },
            ];

  const TopHeader = (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-1.5 text-[12px] text-[#6B7280] flex-wrap">
        <span>AdPrune</span>
        <ChevronRight className="w-3 h-3 opacity-50" />
        <span>Modules</span>
        <ChevronRight className="w-3 h-3 opacity-50" />
        <span className="text-foreground font-medium">Search Term Harvesting</span>
      </div>
      <div className="surface-card px-4 py-3">
        <WorkflowStepBreadcrumb steps={stepperState} />
      </div>
    </div>
  );

  // ── Upload view ──
  if (!state.rows.length) {
    return (
      <div className="w-full space-y-4">
        {TopHeader}
        <div className="surface-card p-6 max-w-2xl mx-auto">
          <h2 className="text-[20px] font-semibold text-foreground tracking-tight">Search Term Harvesting</h2>
          <p className="text-[13px] text-[#6B7280] mt-1.5">
            Find proven search-term converters, stage them as exact-match targets in your destination campaigns, and
            auto-block them in the source to prevent cannibalization.
          </p>

          <div className="mt-4 flex items-start gap-2 rounded-lg bg-[#EFF6FF] border border-[#BFDBFE] p-3 text-[12.5px] text-[#1E40AF]">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Export your SP Search Term Report from Amazon with a 60-day date range</strong> for best results
              (enough signal, aligns with 14-day attribution).
            </span>
          </div>

          {/* File 1 */}
          <div
            className="mt-5 rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 cursor-pointer btn-press"
            style={{ borderColor: "#D1D5DB", background: "#FAFBFC" }}
            onClick={() => stInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) handleStFile(f);
            }}
          >
            {isParsing ? (
              <>
                <Loader2 className="w-8 h-8 text-[#A855F7] animate-spin" />
                <p className="text-[13px] font-medium text-[#374151] mt-3">{PARSE_MESSAGES[parseStep]}</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-[#9CA3AF]" strokeWidth={1.6} />
                <p className="text-[14px] font-medium text-[#374151] mt-3">
                  1. Drop SP Search Term Report or click to browse
                </p>
                <p className="text-[12px] text-[#9CA3AF] mt-1">.xlsx, .xls, .csv up to 20MB</p>
              </>
            )}
            <input
              ref={stInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleStFile(f);
              }}
            />
          </div>

          {/* File 2 — optional */}
          <div
            className="mt-3 rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-6 cursor-pointer btn-press"
            style={{ borderColor: "#E5E7EB", background: "#FAFBFC" }}
            onClick={() => bulkInputRef.current?.click()}
          >
            <FileText className="w-6 h-6 text-[#9CA3AF]" strokeWidth={1.6} />
            <p className="text-[13px] font-medium text-[#374151] mt-2">
              2. (Optional) Drop 30-day Bulk Operations export
            </p>
            <p className="text-[11.5px] text-[#9CA3AF] mt-1">
              {bulkFileName ? `✓ ${bulkFileName}` : "Resolves Campaign IDs & Ad Group IDs for direct upload."}
            </p>
            <input
              ref={bulkInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleBulkFile(f);
              }}
            />
          </div>

          <div className="mt-5 rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] p-3.5 text-[12px] text-[#374151] flex gap-2">
            <FileText className="w-4 h-4 text-[#6B7280] flex-shrink-0 mt-0.5" strokeWidth={1.8} />
            <div>
              <strong className="text-[#111827]">Expected columns:</strong> Campaign Name, Ad Group Name, Advertised
              ASIN, Customer Search Term, Clicks, Spend, Orders, Sales, ACoS.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Results view ──
  return (
    <div className="w-full space-y-4">
      {TopHeader}

      {/* Control bar */}
      <div className="surface-card p-4">
        <div className="flex items-end gap-4 flex-wrap">
          <div className="flex flex-col">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">
              Min Orders
            </label>
            <Input
              type="number"
              value={minOrders}
              onChange={(e) => setMinOrders(Number(e.target.value) || 0)}
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

          <div className="flex flex-col">
            <label
              className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5"
              title="Hard cap on per-keyword bid. Defaults to 3× Default Bid."
            >
              Max Bid ($)
            </label>
            <Input
              type="number"
              step="0.05"
              value={maxBid}
              onChange={(e) => {
                userTouchedMaxBidRef.current = true;
                setMaxBid(Number(e.target.value) || 0);
              }}
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

          <div className="flex flex-col">
            <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280] mb-1.5">
              Reference Bulk
            </label>
            <button
              onClick={() => bulkInputRef.current?.click()}
              className="h-9 px-3 rounded-md text-[12px] font-medium border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] btn-press inline-flex items-center gap-1.5"
            >
              <FileText className="w-3.5 h-3.5" />
              {bulkIdIndex ? "✓ Loaded" : "Attach .xlsx"}
            </button>
            <input
              ref={bulkInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleBulkFile(f);
              }}
            />
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-[#F3F4F6] flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4 text-[12.5px] text-[#374151]">
            <span>
              <strong className="text-[#111827] font-mono-nums">{filtered.length.toLocaleString()}</strong> qualified
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
              onClick={handleReset}
              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md text-[12.5px] font-medium text-[#6B7280] hover:text-[#111827] btn-press"
            >
              Reset
            </button>
          </div>
        </div>
        {dismissedRows.length > 0 && (
          <div className="mt-2 text-[11.5px] text-[#9CA3AF]">
            {dismissedRows.length} dismissed —{" "}
            <button
              onClick={() => setShowDismissed((s) => !s)}
              className="text-[#0071E3] hover:underline font-medium"
            >
              {showDismissed ? "Hide" : "Show"}
            </button>
          </div>
        )}
      </div>

      {destinationOptions.length > 0 && (
        <datalist id="harvest-destination-campaigns">
          {destinationOptions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}

      {/* Table */}
      <div className="surface-card overflow-hidden border border-[#E5E7EB] rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "36px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "280px" }} />
              <col style={{ width: "70px" }} />
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
                    checked={allPagedSelected}
                    onCheckedChange={(v) => {
                      dispatch({ type: "select-many", ids: pagedRows.map((r) => r.id), value: !!v });
                      if (!v) setSelectAllFiltered(false);
                    }}
                  />
                </th>
                {(
                  [
                    { label: "Source", field: null },
                    { label: "ASIN", field: null },
                    { label: "Search Term", field: null },
                    { label: "Clicks", field: "clicks" as const },
                    { label: "Spend", field: "spend" as const },
                    { label: "Orders", field: "orders" as const },
                    { label: "Sales", field: "sales" as const },
                    { label: "ACoS", field: "acos" as const },
                    { label: "Destination", field: null },
                    { label: "Actions", field: null },
                  ]
                ).map((col) => {
                  const isActive = col.field && sortField === col.field;
                  const arrow = !col.field ? null : isActive ? (sortDir === "asc" ? "▲" : "▼") : "▾";
                  return (
                    <th
                      key={col.label}
                      onClick={col.field ? () => toggleSort(col.field!) : undefined}
                      className={`px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.06em] ${
                        col.field ? "cursor-pointer select-none group" : ""
                      }`}
                      style={{ color: isActive ? "#0071E3" : "#6B7280" }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {col.field && (
                          <span
                            className={`text-[9px] ${
                              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60"
                            }`}
                          >
                            {arrow}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-[13px] text-[#9CA3AF]">
                    No terms match the current thresholds. Loosen Min Orders or Max ACoS.
                  </td>
                </tr>
              )}
              {pagedRows.map((r, i) => {
                const isSelected = state.selected.has(r.id);
                const otherSources = (sourceCountByTerm.get(r.cleanedTerm)?.size ?? 1) - 1;
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
                      <div className="flex items-center gap-1.5 flex-wrap">
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
                        {otherSources > 0 && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: "#F3E8FF", color: "#6B21A8" }}
                            title="Same search term seen from multiple source campaigns. One exact target + a negative per source will be staged."
                          >
                            +{otherSources} src
                          </span>
                        )}
                        {r.matchType.toLowerCase() === "exact" && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                            style={{ background: "#FFEDD5", color: "#9A3412" }}
                            title="This term already came from an Exact match keyword. Harvesting may create a duplicate."
                          >
                            Already Exact
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
                        list={destinationOptions.length ? "harvest-destination-campaigns" : undefined}
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
        {allPagedSelected && filtered.length > pagedRows.length && (
          <div className="px-4 py-2 text-[12.5px] text-[#374151] bg-[#EFF6FF] border-t border-[#BFDBFE] flex items-center justify-center gap-2">
            {selectAllFiltered ? (
              <>
                <span>
                  All <strong className="font-mono-nums">{filtered.length.toLocaleString()}</strong> filtered terms
                  selected.
                </span>
                <button
                  onClick={() => {
                    setSelectAllFiltered(false);
                    dispatch({ type: "select-many", ids: filtered.map((r) => r.id), value: false });
                  }}
                  className="text-[#0071E3] hover:underline font-medium"
                >
                  Clear selection
                </button>
              </>
            ) : (
              <>
                <span>
                  All <strong className="font-mono-nums">{pagedRows.length}</strong> terms on this page are selected.
                </span>
                <button
                  onClick={() => {
                    setSelectAllFiltered(true);
                    dispatch({ type: "select-many", ids: filtered.map((r) => r.id), value: true });
                  }}
                  className="text-[#0071E3] hover:underline font-medium"
                >
                  Select all {filtered.length.toLocaleString()} filtered terms
                </button>
              </>
            )}
          </div>
        )}
        {showPagination && (
          <div className="px-4 py-2.5 border-t border-[#E5E7EB] bg-[#FAFBFC] flex items-center justify-between text-[12.5px] text-[#6B7280]">
            <span>
              Showing <strong className="text-[#111827] font-mono-nums">{pageStart + 1}</strong>–
              <strong className="text-[#111827] font-mono-nums">{pageEnd}</strong> of{" "}
              <strong className="text-[#111827] font-mono-nums">{filtered.length.toLocaleString()}</strong> terms
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="h-7 px-2.5 rounded-md border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] btn-press disabled:opacity-40 disabled:cursor-not-allowed text-[12px] font-medium"
              >
                Previous
              </button>
              <span className="font-mono-nums text-[12px] text-[#6B7280]">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="h-7 px-2.5 rounded-md border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] btn-press disabled:opacity-40 disabled:cursor-not-allowed text-[12px] font-medium"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
