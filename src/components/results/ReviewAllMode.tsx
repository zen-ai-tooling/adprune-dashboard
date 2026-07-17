import { useMemo, useState, useRef, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CheckCircle2,
  MoreHorizontal,
  Info,
  HelpCircle,
  Sparkles,
  Loader2,
  Download,
  RotateCcw,
  X,
  ArrowRight,
  Plus,
  Check,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { SortHeader, useSortable } from "@/components/shared/SortHeader";
import { suggestB1Row } from "@/lib/ui/bleeder1Suggestion";
import { confirmBulkOverride } from "@/lib/decisionSession";
import { DecisionSelect, decisionRowClass } from "@/components/shared/DecisionSelect";
import { useHistory } from "@/context/HistoryContext";

interface NormalizedRow {
  sheet: string;
  campaign: string;
  ad_group: string;
  entity: string;
  keyword_text: string;
  product_targeting: string;
  customer_search_term: string;
  match_type: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  ctr: string;
  cvr: string;
  acos: string;
  roas: string;
  state: string;
  campaign_state: string;
  sku: string;
  asin: string;
  [key: string]: any;
}

interface ReviewAllModeProps {
  rowsBySheet: Record<string, NormalizedRow[]>;
  decisions: Record<string, string>;
  setDecision: (key: string, value: string) => void;
  setDecisions: (next: Record<string, string>) => void;
  onGenerate: () => void;
  onDownloadLegacy: () => void;
  isGenerating: boolean;
  generateDone: boolean;
  decisionsMade: number;
  totalRows: number;
  shortTabLabel: (s: string) => string;
  getDecisionOptions: (sheet: string) => string[];
}

const SUGGESTION_PILL_CLASS = {
  pause: { bg: "rgba(239, 68, 68, 0.10)", color: "#B91C1C", label: "Pause" },
  cut_bid: { bg: "rgba(245, 158, 11, 0.10)", color: "#B45309", label: "Cut Bid" },
  review: { bg: "rgba(245, 158, 11, 0.10)", color: "#B45309", label: "Review" },
  monitor: { bg: "rgba(245, 158, 11, 0.06)", color: "#92400E", label: "Monitor" },
  keep: { bg: "#F3F4F6", color: "#374151", label: "None" },
} as const;

const DECISION_PILL = (decision: string): { bg: string; color: string; label: string } | null => {
  if (!decision) return null;
  if (decision === "Pause") return { bg: "#EF4444", color: "#FFFFFF", label: "Pause" };
  if (decision.startsWith("Cut")) return { bg: "#F59E0B", color: "#FFFFFF", label: "Cut Bid" };
  if (decision === "Keep") return { bg: "#059669", color: "#FFFFFF", label: "Keep" };
  if (decision.startsWith("Negat"))
    return { bg: "#6366F1", color: "#FFFFFF", label: decision.includes("Phrase") ? "Negative (P)" : "Negative" };
  return { bg: "#9CA3AF", color: "#FFFFFF", label: decision };
};

const parseAcosNum = (s: string): number => {
  if (!s) return -1;
  const n = parseFloat(String(s).replace("%", ""));
  return Number.isFinite(n) ? n : -1;
};

export const ReviewAllMode = ({
  rowsBySheet,
  decisions,
  setDecision,
  setDecisions,
  onGenerate,
  onDownloadLegacy,
  isGenerating,
  generateDone,
  decisionsMade,
  totalRows,
  shortTabLabel,
  getDecisionOptions,
}: ReviewAllModeProps) => {
  // ── Tab metadata ── ordered by spend at risk DESC
  const sheetMeta = useMemo(() => {
    return Object.entries(rowsBySheet)
      .map(([sheet, rows]) => {
        const spendAtRisk = rows.reduce((s, r) => s + (r.spend || 0), 0);
        let undecided = 0;
        rows.forEach((_, idx) => {
          if (!decisions[`${sheet}-ROWINDEX-${idx}`]) undecided++;
        });
        return { sheet, count: rows.length, spendAtRisk, undecided };
      })
      .sort((a, b) => b.spendAtRisk - a.spendAtRisk);
  }, [rowsBySheet, decisions]);

  const { entries } = useHistory();
  const repeatEntities = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach((e) => {
      ((e as any).bleeders ?? []).forEach((b: string) => {
        counts[b] = (counts[b] ?? 0) + 1;
      });
    });
    return new Set(Object.keys(counts).filter((k) => counts[k] >= 2));
  }, [entries]);

  const [activeSheet, setActiveSheet] = useState<string>(sheetMeta[0]?.sheet || "");
  useEffect(() => {
    if (!activeSheet && sheetMeta.length > 0) setActiveSheet(sheetMeta[0].sheet);
  }, [sheetMeta, activeSheet]);

  const currentSheet = activeSheet || sheetMeta[0]?.sheet || "";
  const currentRows = rowsBySheet[currentSheet] || [];
  const decisionOptions = getDecisionOptions(currentSheet);
  const isSearchTermSheet = /search term/i.test(currentSheet);

  // ── Sort ──
  type SortKey = "campaign" | "ad_group" | "entity" | "clicks" | "spend" | "sales" | "acos";
  const { sortKey, sortDir, toggle: toggleSort } = useSortable<SortKey>("spend", "desc");

  const sortedIndices = useMemo(() => {
    const idx = currentRows.map((_, i) => i);
    idx.sort((a, b) => {
      const ra = currentRows[a];
      const rb = currentRows[b];
      let va: any;
      let vb: any;
      if (sortKey === "acos") {
        va = parseAcosNum(ra.acos);
        vb = parseAcosNum(rb.acos);
      } else if (sortKey === "clicks" || sortKey === "spend" || sortKey === "sales") {
        va = ra[sortKey] ?? 0;
        vb = rb[sortKey] ?? 0;
      } else {
        va = String(ra[sortKey] ?? "").toLowerCase();
        vb = String(rb[sortKey] ?? "").toLowerCase();
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return idx;
  }, [currentRows, sortKey, sortDir]);

  // ── Bulk action UI state ──
  const [pauseConfirm, setPauseConfirm] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    if (moreOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [moreOpen]);

  // ── Optional/toggleable columns (Ad Group is no longer default) ──
  type OptionalCol = "ad_group";
  const [optionalCols, setOptionalCols] = useState<Set<OptionalCol>>(new Set());
  const [colPickerOpen, setColPickerOpen] = useState(false);
  const [cutBidPcts, setCutBidPcts] = useState<Record<string, number>>({});
  const colPickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) setColPickerOpen(false);
    };
    if (colPickerOpen) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [colPickerOpen]);
  const toggleOptionalCol = (c: OptionalCol) => {
    setOptionalCols((prev) => {
      const n = new Set(prev);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  };
  const showAdGroup = optionalCols.has("ad_group");

  // ── Apply all AI suggestions for current sheet ──
  const applyAISuggestions = () => {
    const next = { ...decisions };
    currentRows.forEach((r, idx) => {
      const sug = suggestB1Row({
        clicks: r.clicks ?? 0,
        spend: r.spend ?? 0,
        sales: r.sales ?? 0,
        orders: r.orders ?? 0,
        acos: parseAcosNum(r.acos),
      });
      const key = `${currentSheet}-ROWINDEX-${idx}`;
      // For search term sheets: pause/cut_bid/monitor all map to Negate (Exact)
      // since that's the only valid action to take on a search term
      if (isSearchTermSheet) {
        if (sug.kind === "pause" || sug.kind === "cut_bid" || sug.kind === "monitor") {
          if (decisionOptions.includes("Negate (Exact)")) next[key] = "Negate (Exact)";
        } else if (sug.kind === "keep") {
          if (decisionOptions.includes("Keep")) next[key] = "Keep";
        }
      } else {
        if (sug.kind === "pause") {
          if (decisionOptions.includes("Pause")) next[key] = "Pause";
        } else if (sug.kind === "cut_bid") {
          if (decisionOptions.includes("Cut Bid 50%")) next[key] = "Cut Bid 50%";
        } else if (sug.kind === "keep") {
          if (decisionOptions.includes("Keep")) next[key] = "Keep";
        }
        // monitor: leave undecided
      }
    });
    setDecisions(next);
  };

  const setAllInSheet = (value: string) => {
    const next = { ...decisions };
    currentRows.forEach((_, idx) => {
      next[`${currentSheet}-ROWINDEX-${idx}`] = value;
    });
    setDecisions(next);
  };

  const confirmPauseAll = () => {
    setAllInSheet(decisionOptions.includes("Pause") ? "Pause" : "Negate (Exact)");
    setPauseConfirm(false);
  };

  // ── Focus filter (above table) ──
  type FocusFilter = "all" | "pause" | "review" | "decided" | "highspend";
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");

  // Compute filter counts + spend quartiles for current sheet
  const focusMeta = useMemo(() => {
    const spends = currentRows
      .map((r) => r.spend || 0)
      .slice()
      .sort((a, b) => a - b);
    const q75 = spends.length ? spends[Math.floor(spends.length * 0.75)] : 0;
    let pause = 0,
      review = 0,
      decided = 0,
      highspend = 0;
    currentRows.forEach((r, idx) => {
      const sug = suggestB1Row({
        clicks: r.clicks ?? 0,
        spend: r.spend ?? 0,
        sales: r.sales ?? 0,
        orders: r.orders ?? 0,
        acos: parseAcosNum(r.acos),
      });
      const displayKind =
        isSearchTermSheet && (sug.kind === "cut_bid" || sug.kind === "monitor" || sug.kind === "pause")
          ? "pause"
          : sug.kind;
      if (displayKind === "pause") pause++;
      else if (displayKind === "cut_bid" || displayKind === "monitor") review++;
      if (decisions[`${currentSheet}-ROWINDEX-${idx}`]) decided++;
      if ((r.spend || 0) >= q75 && q75 > 0) highspend++;
    });
    return { all: currentRows.length, pause, review, decided, highspend, q75 };
  }, [currentRows, decisions, currentSheet]);

  const passesFilter = (rowIdx: number): boolean => {
    if (focusFilter === "all") return true;
    const r = currentRows[rowIdx];
    const dec = decisions[`${currentSheet}-ROWINDEX-${rowIdx}`];
    if (focusFilter === "decided") return !!dec;
    if (focusFilter === "highspend") return (r.spend || 0) >= focusMeta.q75 && focusMeta.q75 > 0;

    const sug = suggestB1Row({
      clicks: r.clicks ?? 0,
      spend: r.spend ?? 0,
      sales: r.sales ?? 0,
      orders: r.orders ?? 0,
      acos: parseAcosNum(r.acos), // ← add acos
    });

    // Apply search term remapping — same logic as focusMeta
    const effectiveKind =
      isSearchTermSheet && (sug.kind === "cut_bid" || sug.kind === "monitor" || sug.kind === "pause")
        ? "pause"
        : sug.kind;

    if (focusFilter === "pause") return effectiveKind === "pause";
    // 'review' maps to cut_bid and monitor (non-search-term sheets only)
    if (focusFilter === "review") return effectiveKind === "cut_bid" || effectiveKind === "monitor";
    return true;
  };

  // Spend quartiles for heat-map left border
  const spendBands = useMemo(() => {
    const spends = currentRows
      .map((r) => r.spend || 0)
      .slice()
      .sort((a, b) => a - b);
    if (!spends.length) return { top: Infinity, bottom: 0 };
    return {
      top: spends[Math.floor(spends.length * 0.75)],
      bottom: spends[Math.floor(spends.length * 0.25)],
    };
  }, [currentRows]);
  const spendBandColor = (spend: number, hasDecision: boolean): string => {
    if (hasDecision) return "#E5E7EB";
    if (spend >= spendBands.top) return "#EF4444";
    if (spend >= spendBands.bottom) return "#F59E0B";
    return "#E5E7EB";
  };

  // ── Command palette ──
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) return;
      if (e.key === "/") {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (e.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  const allDone = decisionsMade >= totalRows && totalRows > 0;
  const anyDecided = decisionsMade > 0;

  const paletteCommands = [
    {
      id: "pause-tab",
      label: `Pause all in ${shortTabLabel(currentSheet)}`,
      run: () => {
        if (confirm("Pause every row in this tab?")) confirmPauseAll();
      },
    },
    { id: "apply-ai", label: "Apply AI suggestions for current tab", run: () => applyAISuggestions() },
    { id: "show-undecided", label: "Show only undecided", run: () => setFocusFilter("all") },
    {
      id: "mark-keep",
      label: "Mark all as Keep",
      run: () => decisionOptions.includes("Keep") && setAllInSheet("Keep"),
    },
    { id: "export-csv", label: "Export decisions as CSV", run: () => onDownloadLegacy() },
  ];
  const filteredCommands = paletteCommands.filter((c) => c.label.toLowerCase().includes(paletteQuery.toLowerCase()));

  return (
    <>
      <div className="space-y-3">
        {/* Generate button moved into the summary bar (AnalysisResults). */}

        {/* ─── Tab bar ─── */}
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {sheetMeta.map(({ sheet, count, spendAtRisk, undecided }) => {
            const isActive = sheet === currentSheet;
            const hasUnresolved = undecided > 0;
            return (
              <button
                key={sheet}
                onClick={() => setActiveSheet(sheet)}
                className={`relative flex flex-col items-start gap-0.5 px-4 py-2.5 rounded-t-lg border transition-all min-w-[140px] btn-press ${
                  isActive
                    ? "bg-card border-border border-b-card -mb-px"
                    : "bg-[#F9FAFB] border-transparent hover:bg-[#F3F4F6]"
                }`}
              >
                <div className="flex items-center gap-2 w-full">
                  <span
                    className={`text-[13px] ${isActive ? "font-semibold text-foreground" : "font-medium text-[hsl(var(--text-secondary))]"}`}
                  >
                    {shortTabLabel(sheet)}
                  </span>
                  <span
                    className="ml-auto inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full text-[10.5px] font-mono-nums font-semibold text-white"
                    style={{ background: isActive ? "#0D9488" : "#9CA3AF" }}
                  >
                    {count}
                  </span>
                  {hasUnresolved && (
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: "#F59E0B" }}
                      aria-label="Unresolved decisions"
                    />
                  )}
                </div>
                <span className="text-[11px] text-[hsl(var(--text-tertiary))] font-mono-nums">
                  ${Math.round(spendAtRisk).toLocaleString()} at risk
                </span>
              </button>
            );
          })}
        </div>

        {/* ─── Focus filter pills with tab-scoped label ─── */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-medium" style={{ color: "#9CA3AF" }}>
            {shortTabLabel(currentSheet)}:
          </span>
          {(
            [
              { id: "all", label: "All", icon: "", count: focusMeta.all },
              { id: "pause", label: "Pause candidates", icon: "🔴", count: focusMeta.pause },
              { id: "review", label: "Needs review", icon: "🟡", count: focusMeta.review },
              { id: "decided", label: "Decided", icon: "✓", count: focusMeta.decided },
              { id: "highspend", label: "High spend", icon: "💰", count: focusMeta.highspend },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setFocusFilter(f.id as FocusFilter)}
              className={`focus-pill ${focusFilter === f.id ? "is-active" : ""}`}
            >
              {f.icon && <span aria-hidden>{f.icon}</span>}
              {f.label}
              <span className="count">· {f.count}</span>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#F9FAFB] border-b border-border flex-wrap">
            {pauseConfirm ? (
              <div className="flex items-center gap-3 w-full">
                <span className="text-[13px] font-medium text-foreground">
                  Pause all {currentRows.length} targets? This cannot be undone in this tool.
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={confirmPauseAll}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold text-white btn-press"
                    style={{ background: "#EF4444" }}
                  >
                    Confirm Pause
                  </button>
                  <button
                    onClick={() => setPauseConfirm(false)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium border border-border bg-card hover:bg-secondary btn-press"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={applyAISuggestions}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold text-white btn-press"
                    style={{ background: "#0D9488" }}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Apply recommendations
                  </button>
                  {decisionOptions.includes("Cut Bid 50%") && (
                    <button
                      onClick={() => setAllInSheet("Cut Bid 50%")}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold text-white btn-press"
                      style={{ background: "#F59E0B" }}
                    >
                      Select all → Cut Bid
                    </button>
                  )}
                  {/* "Select all → Pause" removed (too dangerous as one-click). Available in command palette (/). */}
                  {decisionOptions.includes("Keep") && (
                    <button
                      onClick={() => setAllInSheet("Keep")}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium border border-border bg-card text-foreground hover:bg-secondary btn-press"
                    >
                      Select all → Keep
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5 relative" ref={moreRef}>
                  <button
                    onClick={() => {
                      const next = { ...decisions };
                      currentRows.forEach((_, idx) => {
                        delete next[`${currentSheet}-ROWINDEX-${idx}`];
                      });
                      setDecisions(next);
                    }}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[12px] font-medium btn-press transition-opacity"
                    style={{ color: "#EF4444", opacity: 0.7 }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
                  >
                    <X className="w-3 h-3" /> Clear sheet
                  </button>
                  <button
                    onClick={() => setMoreOpen((o) => !o)}
                    className="inline-flex items-center h-8 px-2 text-[12px] hover:underline btn-press"
                    aria-label="More options"
                    title="More options"
                    style={{ color: "#9CA3AF" }}
                  >
                    More options
                  </button>
                  {moreOpen && (
                    <div className="absolute right-0 top-9 min-w-[260px] rounded-lg border border-border bg-popover shadow-pop p-1 z-30 animate-scale-in">
                      <button
                        onClick={() => {
                          onDownloadLegacy();
                          setMoreOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-foreground hover:bg-secondary rounded-md text-left"
                      >
                        <Download className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" />
                        Export decisions as CSV
                      </button>
                      <button
                        onClick={() => {
                          if (confirm("Reset all decisions across every sheet?")) setDecisions({});
                          setMoreOpen(false);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-foreground hover:bg-secondary rounded-md text-left"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))]" />
                        Reset all decisions
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ─── Contextual amber callout for Search Terms ─── */}
          {isSearchTermSheet && (
            <div
              className="px-4 py-2.5 border-b flex items-start gap-2"
              style={{ background: "#FFFBEB", borderBottomColor: "#FDE68A", borderLeft: "3px solid #F59E0B" }}
            >
              <Info className="w-4 h-4 mt-px flex-shrink-0" style={{ color: "#F59E0B" }} />
              <p className="text-[12.5px]" style={{ color: "#92400E" }}>
                <strong>Pause</strong> on search terms auto-converts to <strong>Negate (Exact)</strong> when generating
                the Amazon file.
              </p>
            </div>
          )}

          {/* ─── Table ─── enforced widths · Decision sticky right · Ad Group toggleable ─── */}
          <div className="review-table-scroll w-full max-h-[60vh] overflow-auto">
            <Table className="w-full review-table" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 240 }} />
                <col style={{ width: 160 }} />
                {showAdGroup && <col style={{ width: 160 }} />}
                <col style={{ width: 70 }} />
                <col style={{ width: 70 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 140 }} />
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-b border-border">
                  <TableHead style={{ width: 240, letterSpacing: "0.06em" }}>
                    <SortHeader active={sortKey === "campaign"} dir={sortDir} onClick={() => toggleSort("campaign")}>
                      Campaign
                    </SortHeader>
                  </TableHead>
                  <TableHead style={{ width: 160, letterSpacing: "0.06em" }}>
                    <SortHeader active={sortKey === "entity"} dir={sortDir} onClick={() => toggleSort("entity")}>
                      Entity
                    </SortHeader>
                  </TableHead>
                  {showAdGroup && (
                    <TableHead style={{ width: 160, letterSpacing: "0.06em" }}>
                      <span className="inline-flex items-center gap-1">
                        <SortHeader
                          active={sortKey === "ad_group"}
                          dir={sortDir}
                          onClick={() => toggleSort("ad_group")}
                        >
                          Ad Group
                        </SortHeader>
                        <button
                          type="button"
                          onClick={() => toggleOptionalCol("ad_group")}
                          className="text-[hsl(var(--text-tertiary))] hover:text-foreground"
                          aria-label="Hide Ad Group column"
                          title="Hide Ad Group"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    </TableHead>
                  )}
                  <TableHead style={{ width: 70, letterSpacing: "0.06em" }}>Match</TableHead>
                  <TableHead className="text-right" style={{ width: 70, letterSpacing: "0.06em" }}>
                    <SortHeader
                      active={sortKey === "clicks"}
                      dir={sortDir}
                      onClick={() => toggleSort("clicks")}
                      align="right"
                    >
                      Clicks
                    </SortHeader>
                  </TableHead>
                  <TableHead className="text-right" style={{ width: 90, letterSpacing: "0.06em" }}>
                    <SortHeader
                      active={sortKey === "spend"}
                      dir={sortDir}
                      onClick={() => toggleSort("spend")}
                      align="right"
                    >
                      Spend
                    </SortHeader>
                  </TableHead>
                  <TableHead className="text-right" style={{ width: 80, letterSpacing: "0.06em" }}>
                    <SortHeader
                      active={sortKey === "sales"}
                      dir={sortDir}
                      onClick={() => toggleSort("sales")}
                      align="right"
                    >
                      Sales
                    </SortHeader>
                  </TableHead>
                  <TableHead className="text-right" style={{ width: 80, letterSpacing: "0.06em" }}>
                    <SortHeader
                      active={sortKey === "acos"}
                      dir={sortDir}
                      onClick={() => toggleSort("acos")}
                      align="right"
                    >
                      ACoS
                    </SortHeader>
                  </TableHead>
                  <TableHead style={{ width: 100, letterSpacing: "0.06em" }}>
                    <span className="inline-flex items-center gap-1">
                      Suggestion
                      <TooltipProvider delayDuration={150}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="text-[hsl(var(--text-tertiary))] hover:text-foreground"
                              aria-label="Suggestion legend"
                            >
                              <HelpCircle className="w-3 h-3" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[280px] text-[12px] leading-relaxed">
                            <div className="space-y-1.5">
                              <div>
                                <strong>Pause</strong>: ACoS ≥ 100% or 30+ clicks with zero conversions
                              </div>
                              <div>
                                <strong>Cut Bid</strong>: ACoS 80–99% or moderate spend, no conversions
                              </div>
                              <div>
                                <strong>Monitor</strong>: Some activity, not enough signal yet
                              </div>
                              <div>
                                <strong>None</strong>: Acceptable performance
                              </div>
                              <div style={{ marginTop: 4, color: "#9CA3AF" }}>
                                On search term sheets, suggestions automatically show Negative.
                              </div>
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                  </TableHead>
                  <TableHead
                    className="freeze-col-right"
                    style={{
                      width: 140,
                      letterSpacing: "0.06em",
                      position: "sticky",
                      right: 0,
                      zIndex: 7,
                      background: "#F9FAFB",
                      boxShadow: "-1px 0 0 #E5E7EB",
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      Decision
                      {/* Column picker — adds Ad Group back when hidden */}
                      {!showAdGroup && (
                        <span className="relative" ref={colPickerRef}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setColPickerOpen((o) => !o);
                            }}
                            className="inline-flex items-center justify-center w-4 h-4 rounded text-[hsl(var(--text-tertiary))] hover:bg-secondary hover:text-foreground"
                            aria-label="Add columns"
                            title="Add columns"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          {colPickerOpen && (
                            <div
                              className="absolute right-0 top-6 min-w-[160px] rounded-lg border border-border bg-popover shadow-pop p-1 z-30 animate-scale-in"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={() => {
                                  toggleOptionalCol("ad_group");
                                  setColPickerOpen(false);
                                }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-[12px] text-foreground hover:bg-secondary rounded-md text-left normal-case font-normal tracking-normal"
                              >
                                <Check className="w-3 h-3 opacity-0" />
                                Ad Group
                              </button>
                            </div>
                          )}
                        </span>
                      )}
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedIndices.filter(passesFilter).map((rowIdx) => {
                  const row = currentRows[rowIdx];
                  const key = `${currentSheet}-ROWINDEX-${rowIdx}`;
                  const decision = decisions[key];
                  const indicatorClass = decisionRowClass(decision);
                  const entityDisplay =
                    row.customer_search_term || row.keyword_text || row.product_targeting || row.entity || "—";
                  const sug = suggestB1Row({
                    clicks: row.clicks ?? 0,
                    spend: row.spend ?? 0,
                    sales: row.sales ?? 0,
                    orders: row.orders ?? 0,
                    acos: parseAcosNum(row.acos),
                  });
                  const displayKind =
                    isSearchTermSheet && (sug.kind === "cut_bid" || sug.kind === "monitor" || sug.kind === "pause")
                      ? "pause"
                      : sug.kind;
                  const sugStyle = SUGGESTION_PILL_CLASS[displayKind] ?? SUGGESTION_PILL_CLASS.keep;
                  const acosNum = parseAcosNum(row.acos);
                  const hasAcos = acosNum >= 0 && row.acos && row.acos !== "0" && row.acos !== "0%";
                  const decisionPill = DECISION_PILL(decision);
                  const isEven = rowIdx % 2 === 1;
                  const decisionCellBg = isEven ? "#F9FAFB" : "#FFFFFF";
                  const heatColor = spendBandColor(row.spend || 0, !!decision);

                  return (
                    <TableRow
                      key={rowIdx}
                      className={`${indicatorClass} transition-opacity`}
                      style={{ opacity: decision ? 0.88 : 1, boxShadow: `inset 3px 0 0 ${heatColor}` }}
                    >
                      <TableCell className="font-medium" style={{ width: 240 }}>
                        <TooltipProvider delayDuration={300}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block truncate" style={{ maxWidth: 220 }}>
                                {row.campaign || "—"}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[420px] break-words text-[12px]">
                              {row.campaign || "—"}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </TableCell>
                      <TableCell style={{ width: 160 }}>
                        <span className="inline-flex items-center gap-1.5 whitespace-normal break-words text-[12.5px]">
                          {repeatEntities.has(entityDisplay) && (
                            <span
                              className="inline-block rounded-full flex-shrink-0"
                              style={{ width: 6, height: 6, background: "#F59E0B" }}
                              title="Repeat bleeder — seen in previous sessions"
                              aria-label="Repeat bleeder"
                            />
                          )}
                          {entityDisplay}
                        </span>
                      </TableCell>
                      {showAdGroup && (
                        <TableCell className="text-[hsl(var(--text-secondary))]" style={{ width: 160 }}>
                          <TooltipProvider delayDuration={300}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="block truncate" style={{ maxWidth: 140 }}>
                                  {row.ad_group || "—"}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[420px] break-words text-[12px]">
                                {row.ad_group || "—"}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </TableCell>
                      )}
                      <TableCell className="text-[hsl(var(--text-tertiary))] text-[12px]" style={{ width: 70 }}>
                        {row.match_type || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono-nums text-[12.5px]" style={{ width: 70 }}>
                        {row.clicks}
                      </TableCell>
                      <TableCell className="text-right font-mono-nums text-[12.5px] font-medium" style={{ width: 90 }}>
                        ${row.spend.toFixed(2)}
                      </TableCell>
                      <TableCell
                        className="text-right tabular-nums text-[12.5px]"
                        style={{ width: 80, color: (row.sales || 0) <= 0 ? "#EF4444" : "hsl(var(--text-secondary))" }}
                      >
                        ${row.sales.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right" style={{ width: 80 }}>
                        {hasAcos ? (
                          <span
                            className="inline-block text-[11px] font-mono-nums px-2 py-0.5 rounded-full font-medium text-white"
                            style={{ background: acosNum >= 100 ? "#EF4444" : "#F59E0B" }}
                          >
                            {row.acos}
                          </span>
                        ) : (
                          <span className="text-[12px] text-[hsl(var(--text-tertiary))]">—</span>
                        )}
                      </TableCell>
                      <TableCell style={{ width: 100 }}>
                        <span
                          className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: sugStyle.bg, color: sugStyle.color }}
                        >
                          {sugStyle.label}
                        </span>
                      </TableCell>
                      <TableCell
                        className="freeze-col-right"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          width: 140,
                          position: "sticky",
                          right: 0,
                          zIndex: 4,
                          background: decisionCellBg,
                          boxShadow: "-1px 0 0 #E5E7EB",
                        }}
                      >
                        <div className="flex items-center gap-1 flex-wrap">
                          {decisionPill ? (
                            <Select value={decision} onValueChange={(val) => setDecision(key, val)}>
                              <SelectTrigger
                                className="h-7 w-auto inline-flex border-0 px-2.5 rounded-full text-[11.5px] font-semibold gap-1.5 [&>svg]:opacity-70 [&>svg]:w-3 [&>svg]:h-3 hover:scale-[1.02] transition-transform"
                                style={{ background: decisionPill.bg, color: decisionPill.color }}
                              >
                                {decisionPill.label}
                              </SelectTrigger>
                              <SelectContent>
                                {decisionOptions.map((opt) => (
                                  <SelectItem key={opt} value={opt} className="text-[12.5px]">
                                    {opt}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <DecisionSelect
                              value={decision}
                              onChange={(val) => setDecision(key, val)}
                              options={decisionOptions}
                              width="100%"
                              placeholder="Decide…"
                            />
                          )}
                          {decision?.startsWith("Cut Bid") && (
                            <div className="flex items-center gap-0.5">
                              <input
                                type="number"
                                min={1}
                                max={99}
                                className="h-7 w-16 text-[12px] rounded border border-border px-1.5 font-mono"
                                value={cutBidPcts[key] ?? 50}
                                onChange={(e) => {
                                  const pct = parseInt(e.target.value) || 50;
                                  setCutBidPcts((prev) => ({ ...prev, [key]: pct }));
                                  setDecision(key, `Cut Bid ${pct}%`);
                                }}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <span className="text-[11px]" style={{ color: "#9CA3AF" }}>
                                %
                              </span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      {/* "/" command-palette hint — fixed, anchored 24px past sidebar's right edge */}
      <div className="fixed text-[11px]" style={{ bottom: 16, left: 188, color: "#9CA3AF", zIndex: 50 }}>
        Press{" "}
        <kbd className="px-1.5 py-0.5 rounded font-mono-nums" style={{ background: "#F3F4F6", color: "#374151" }}>
          /
        </kbd>{" "}
        for commands
      </div>

      {/* Command palette */}
      {paletteOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-start justify-center pt-[20vh] px-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={() => setPaletteOpen(false)}
        >
          <div
            className="w-full max-w-[480px] rounded-xl overflow-hidden"
            style={{ background: "#1F2937", border: "1px solid #374151", boxShadow: "0 25px 60px rgba(0,0,0,0.5)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              placeholder="Type a command or filter..."
              className="w-full bg-transparent text-white px-4 py-3 text-[14px] outline-none border-b"
              style={{ borderColor: "#374151" }}
            />
            <div className="max-h-[320px] overflow-y-auto py-1">
              {filteredCommands.length === 0 ? (
                <div className="px-4 py-3 text-[13px]" style={{ color: "#9CA3AF" }}>
                  No matching commands
                </div>
              ) : (
                filteredCommands.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      c.run();
                      setPaletteOpen(false);
                      setPaletteQuery("");
                    }}
                    className="w-full text-left px-4 py-2 text-[13px] hover:bg-white/5"
                    style={{ color: "#F3F4F6" }}
                  >
                    {c.label}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
