/**
 * Lifetime Audit — Inline Decision Results
 *
 * Mirrors the Bleeders 1.0/2.0 inline decision-making pattern:
 *  - Compact stat bar with bleeders count, at-risk spend, ranking excluded
 *  - 3-step workflow indicator
 *  - Decision table with Suggestion pills + per-row Decision dropdown
 *  - Bulk action buttons + sticky footer with Generate Amazon file →
 *  - CompletionView after generation
 *
 * Business logic (analyzer / Amazon bulk row construction) is reused via
 * `lifetimeBleederAnalysis` + `amazonBulkBuilder`. Only UI/presentation is new.
 */

import * as React from "react";
import { useMemo, useState, useEffect, useRef } from "react";
import { clearSession, confirmBulkOverride, loadSavedSession, saveSession } from "@/lib/decisionSession";
import { ResumeSessionBanner } from "@/components/shared/ResumeSessionBanner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Loader2, XCircle, Download, Zap, List, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { CompactStatsBar } from "@/components/shared/CompactStatsBar";
import { CompletionView } from "@/components/shared/CompletionView";
import { DecisionProgressBar } from "@/components/shared/DecisionProgressBar";
import { SpendDistributionStrip } from "@/components/shared/SpendDistributionStrip";
import { DecisionSelect, decisionRowClass } from "@/components/shared/DecisionSelect";
import { SortHeader, useSortable } from "@/components/shared/SortHeader";
import { RowDetailPanel, type DecisionButtonSpec, type RowDetail } from "@/components/shared/RowDetailPanel";
import { TriageMode, type TriageItem, type TriageDecisionSpec } from "@/components/results/TriageMode";
import { suggestLifetimeRow } from "@/lib/ui/lifetimeSuggestion";
import type { LifetimeBleederResult, LifetimeBleederRow } from "@/lib/lifetimeBleederAnalysis";
import {
  buildBulkRowsFromCanonical,
  bulkRowToArray,
  BULK_UPDATE_HEADERS,
  recordTypeToProductEntity,
  type AmazonProduct,
  type AmazonRecordType,
  type CanonicalBulkInputRow,
} from "@/lib/amazonBulkBuilder";
import * as XLSX from "xlsx";

interface AmazonFileBundle {
  workbook: XLSX.WorkBook;
  fileName: string;
}

interface LifetimeBleederResultsProps {
  result: LifetimeBleederResult;
  /** Optional: also keep a download for the legacy decision XLSX (hidden by default) */
  onDownloadDecisionSheet?: () => void;
  onStartNew?: () => void;
}

const DECISION_OPTIONS = ["Pause", "Keep"];

/** Map a UI Decision label to canonical action + cutBidPercent */
function decisionToAction(
  decision: string,
): { action: CanonicalBulkInputRow["action"]; cutBidPercent?: number } | null {
  if (decision === "Pause") return { action: "pause" };
  if (decision === "Keep") return { action: "keep" };
  if (decision === "Cut Bid 50%") return { action: "cutBid", cutBidPercent: 50 };
  return null;
}

/** Determine Amazon record type for a Lifetime bleeder row */
function getRecordType(b: LifetimeBleederRow): AmazonRecordType {
  const isKeyword = (b.entityType || "Keyword") === "Keyword";
  const src = (b.source || "SP").toUpperCase();
  if (src === "SB") return isKeyword ? "sponsoredBrandsKeyword" : "sponsoredBrandsProductTargeting";
  if (src === "SD") return "sponsoredDisplayProductTargeting";
  return isKeyword ? "sponsoredProductsKeyword" : "sponsoredProductsProductTargeting";
}

export const LifetimeBleederResults: React.FC<LifetimeBleederResultsProps> = ({
  result,
  onDownloadDecisionSheet,
  onStartNew,
}) => {
  const bleeders = result.bleeders;
  const hasBleeders = bleeders.length > 0;

  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [amazonFile, setAmazonFile] = useState<AmazonFileBundle | null>(null);
  const [showFullResults, setShowFullResults] = useState(false);
  const [flashIdx, setFlashIdx] = useState<{ idx: number; cls: string; ts: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [panelComplete, setPanelComplete] = useState(false);
  const [viewMode, setViewMode] = useState<"triage" | "review">("review");

  type FocusFilter = "all" | "pause" | "review" | "decided" | "highspend";
  const [focusFilter, setFocusFilter] = useState<FocusFilter>("all");

  // ---------- Session auto-save (data-loss guard) ----------
  const sessionModule = "lifetime_audit";
  const sessionFileRef = useRef<string>(
    `lifetime_${bleeders.length}_${bleeders[0]?.campaignName ?? "empty"}`,
  );
  const [savedSession, setSavedSession] = useState(() =>
    loadSavedSession(sessionModule, sessionFileRef.current),
  );
  const [sessionHydrated, setSessionHydrated] = useState(false);

  useEffect(() => {
    if (!sessionHydrated) return;
    saveSession(sessionModule, sessionFileRef.current, decisions, bleeders.length);
  }, [decisions, sessionHydrated, sessionModule, bleeders.length]);

  const setDecisionWithFlash = (idx: number, val: string) => {
    if (!sessionHydrated) setSessionHydrated(true);
    setDecisions((prev) => ({ ...prev, [idx]: val }));
    let cls = "";
    if (val === "Pause") cls = "row-flash-pause";
    else if (val === "Keep") cls = "row-flash-keep";
    else if (val.startsWith("Cut")) cls = "row-flash-cut";
    if (cls) setFlashIdx({ idx, cls, ts: Date.now() });
  };

  const suggestions = useMemo(
    () => bleeders.map((b) => suggestLifetimeRow({ clicks: b.clicks, sales: b.sales, orders: b.orders })),
    [bleeders],
  );

  const decisionsMade = useMemo(() => Object.values(decisions).filter((d) => d && d !== "").length, [decisions]);

  // Sortable
  type SortKey = "campaign" | "adGroup" | "entity" | "spend" | "clicks" | "acos";
  const { sortKey, sortDir, toggle: toggleSort } = useSortable<SortKey>("spend", "desc");
  const sortedIndices = useMemo(() => {
    const idx = bleeders.map((_, i) => i);
    idx.sort((a, b) => {
      const ra = bleeders[a];
      const rb = bleeders[b];
      let va: any;
      let vb: any;
      switch (sortKey) {
        case "campaign":
          va = (ra.campaignName || "").toLowerCase();
          vb = (rb.campaignName || "").toLowerCase();
          break;
        case "adGroup":
          va = (ra.adGroupName || "").toLowerCase();
          vb = (rb.adGroupName || "").toLowerCase();
          break;
        case "entity":
          va = (ra.targetingText || "").toLowerCase();
          vb = (rb.targetingText || "").toLowerCase();
          break;
        case "spend":
          va = ra.spend ?? 0;
          vb = rb.spend ?? 0;
          break;
        case "clicks":
          va = ra.clicks ?? 0;
          vb = rb.clicks ?? 0;
          break;
        case "acos":
          va = ra.acos ?? 0;
          vb = rb.acos ?? 0;
          break;
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return idx;
  }, [bleeders, sortKey, sortDir]);

  // Urgency banding by spend
  const urgencyBands = useMemo(() => {
    const spends = bleeders
      .map((b) => b.spend || 0)
      .slice()
      .sort((a, b) => a - b);
    if (spends.length === 0) return { high: Infinity, low: -Infinity };
    const q = (p: number) => spends[Math.min(spends.length - 1, Math.floor(spends.length * p))];
    return { high: q(0.75), low: q(0.25) };
  }, [bleeders]);

  const focusMeta = useMemo(() => {
    let pause = 0,
      review = 0,
      decided = 0,
      highspend = 0;
    bleeders.forEach((b, idx) => {
      const sug = suggestions[idx];
      if (sug?.kind === "pause" || sug?.kind === "review") pause++;
      else if (sug?.kind === "monitor") review++;
      if (decisions[idx]) decided++;
      if ((b.spend || 0) >= urgencyBands.high && (b.spend || 0) > 0) highspend++;
    });
    return { all: bleeders.length, pause, review, decided, highspend };
  }, [bleeders, suggestions, decisions, urgencyBands.high]);

  const matchesFocus = (idx: number): boolean => {
    if (focusFilter === "all") return true;
    const b = bleeders[idx];
    const sug = suggestions[idx];
    if (focusFilter === "pause") return sug?.kind === "pause" || sug?.kind === "review";
    if (focusFilter === "review") return sug?.kind === "monitor";
    if (focusFilter === "decided") return !!decisions[idx];
    if (focusFilter === "highspend") return (b.spend || 0) >= urgencyBands.high && (b.spend || 0) > 0;
    return true;
  };

  // ── Bulk actions ──
  const setAll = (val: string) => {
    const keys = bleeders.map((_, idx) => idx);
    if (!confirmBulkOverride(val, keys, decisions)) return;
    if (!sessionHydrated) setSessionHydrated(true);
    const all: Record<number, string> = {};
    keys.forEach((idx) => { all[idx] = val; });
    setDecisions(all);
  };
  const handleClearAll = () => {
    if (!sessionHydrated) setSessionHydrated(true);
    setDecisions({});
  };

  // ── Generate Amazon file (inline) ──
  const handleGenerate = async () => {
    if (decisionsMade === 0 || isGenerating || amazonFile) return;
    setIsGenerating(true);

    try {
      const inputs: CanonicalBulkInputRow[] = [];

      bleeders.forEach((b, idx) => {
        const decision = decisions[idx];
        if (!decision) return;
        const mapped = decisionToAction(decision);
        if (!mapped || mapped.action === "keep") return;

        const recordType = getRecordType(b);
        const isKeyword = (b.entityType || "Keyword") === "Keyword";

        inputs.push({
          recordType,
          action: mapped.action,
          campaignId: b.campaignId,
          campaignName: b.campaignName,
          adGroupId: b.adGroupId,
          adGroupName: b.adGroupName,
          keywordId: isKeyword ? b.keywordId : undefined,
          keywordText: isKeyword ? b.targetingText : undefined,
          matchType: b.matchType,
          productTargetingId: !isKeyword ? b.productTargetingId || b.targetingId : undefined,
          targetingId: !isKeyword ? b.targetingId || b.productTargetingId : undefined,
          targetingText: !isKeyword ? b.targetingText : undefined,
          // Cut Bid uses spend as a proxy for currentBid (Lifetime has no bid column)
          // The Lifetime report doesn't carry bid info; cutBid will produce Bid = 0
          // unless the analyzer is later extended. Keep this consistent with existing behavior.
          cutBidPercent: mapped.cutBidPercent,
        });
      });

      const inputsByProduct: Record<AmazonProduct, CanonicalBulkInputRow[]> = {
        "Sponsored Products": [],
        "Sponsored Brands": [],
        "Sponsored Display": [],
      };
      for (const c of inputs) {
        inputsByProduct[recordTypeToProductEntity(c.recordType).product].push(c);
      }

      const wb = XLSX.utils.book_new();
      (["Sponsored Products", "Sponsored Brands", "Sponsored Display"] as AmazonProduct[]).forEach((product) => {
        const subset = inputsByProduct[product];
        if (!subset.length) return;
        const built = buildBulkRowsFromCanonical(subset);
        if (!built.length) return;
        const rows: any[][] = [BULK_UPDATE_HEADERS, ...built.map(bulkRowToArray)];
        const sheet = XLSX.utils.aoa_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, sheet, product);
      });

      const today = new Date().toISOString().split("T")[0];
      const fileName = `Amazon_Bulk_Operations_Lifetime_${today}.xlsx`;

      setAmazonFile({ workbook: wb, fileName });
      clearSession(sessionModule, sessionFileRef.current);
      setSavedSession(null);
      toast.success("Amazon file ready", {
        description: `${decisionsMade} decisions exported`,
        duration: 3000,
      });
    } catch (err: any) {
      toast.error("Generation failed", { description: err?.message || "Unknown error" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadAmazon = () => {
    if (!amazonFile) return;
    try {
      const wbout = XLSX.write(amazonFile.workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbout], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = amazonFile.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error("Download failed", { description: err?.message });
    }
  };

  // ── No bleeders state ──
  if (!hasBleeders) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 max-w-[760px] mx-auto">
        <div className="flex items-center gap-2 text-success mb-2">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-[13px] font-medium font-display">No action needed — 0 bleeders found</span>
        </div>
        <p className="text-[13px] text-muted-foreground">
          Lifetime Audit returned no actionable rows under current thresholds.
        </p>
      </div>
    );
  }

  // ── Completion view ──
  const breakdownCounts: Record<string, number> = {};
  Object.values(decisions).forEach((d) => {
    if (d) breakdownCounts[d] = (breakdownCounts[d] ?? 0) + 1;
  });

  // Spend addressed vs. undecided — drives the impact donut
  const { addressedSpend, undecidedSpend } = (() => {
    let addressed = 0;
    let undecided = 0;
    bleeders.forEach((b, idx) => {
      const dec = decisions[idx];
      const spend = b.spend || 0;
      if (dec) addressed += spend;
      else undecided += spend;
    });
    return { addressedSpend: addressed, undecidedSpend: undecided };
  })();

  if (amazonFile && !showFullResults) {
    return (
      <CompletionView
        fileName={amazonFile.fileName}
        title="Workflow complete"
        impactHeadline={`$${result.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 2 })} in at-risk spend addressed`}
        impactSubtitle="Lifetime audit captured into your Amazon bulk file."
        totalRows={bleeders.length}
        summary={[
          { label: "Bleeders found", value: bleeders.length.toLocaleString() },
          { label: "Decisions made", value: `${decisionsMade}/${bleeders.length}` },
          {
            label: "Avg spend per bleeder",
            value: `$${(result.totalSpend / Math.max(bleeders.length, 1)).toFixed(2)}`,
          },
          { label: "Ranking excluded", value: result.excludedRankingCount.toLocaleString() },
        ]}
        breakdown={[
          { label: "Paused", count: breakdownCounts["Pause"] ?? 0, color: "#EF4444" },
          { label: "Keep", count: breakdownCounts["Keep"] ?? 0, color: "#10B981" },
          { label: "No decision", count: Math.max(0, bleeders.length - decisionsMade), color: "#D1D5DB" },
        ]}
        onDownload={handleDownloadAmazon}
        onStartNew={() => {
          clearSession(sessionModule, sessionFileRef.current);
          setSavedSession(null);
          onStartNew?.();
        }}
        onViewFullResults={() => setShowFullResults(true)}
        accentColor="#A855F7"
        addressedSpend={addressedSpend}
        undecidedSpend={undecidedSpend}
      />
    );
  }

  return (
    <div className="space-y-5">
      {savedSession && !sessionHydrated && (
        <ResumeSessionBanner
          saved={savedSession}
          onResume={() => {
            setDecisions(savedSession.decisions as Record<number, string>);
            setSessionHydrated(true);
            setSavedSession(null);
          }}
          onStartFresh={() => {
            clearSession(sessionModule, sessionFileRef.current);
            setSavedSession(null);
            setSessionHydrated(true);
          }}
        />
      )}

      {/* Mode toggle */}
      <div className="flex items-center justify-end">
        <div className="inline-flex items-center p-0.5 rounded-full border border-border bg-card">
          <button
            onClick={() => setViewMode("triage")}
            className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
              viewMode === "triage" ? "text-white shadow-sm" : "text-[hsl(var(--text-secondary))] hover:text-foreground"
            }`}
            style={viewMode === "triage" ? { background: "#A855F7" } : undefined}
          >
            <Zap className="w-3.5 h-3.5" /> Triage
          </button>
          <button
            onClick={() => setViewMode("review")}
            className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
              viewMode === "review" ? "text-white shadow-sm" : "text-[hsl(var(--text-secondary))] hover:text-foreground"
            }`}
            style={viewMode === "review" ? { background: "#A855F7" } : undefined}
          >
            <List className="w-3.5 h-3.5" /> Review All
          </button>
        </div>
      </div>

      {/* Back to summary (when viewing full results from completion) */}
      {amazonFile && showFullResults && (
        <button
          onClick={() => setShowFullResults(false)}
          className="text-[12.5px] text-[#4F6EF7] hover:underline btn-press"
        >
          ← Back to summary
        </button>
      )}

      {/* Compact stats + workflow */}
      <CompactStatsBar
        accent="red"
        stats={[
          { value: bleeders.length.toLocaleString(), label: "bleeders" },
          { value: `$${result.totalSpend.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, label: "at risk" },
          { value: result.excludedRankingCount.toLocaleString(), label: "ranking excluded" },
        ]}
        steps={[
          { label: "Files analyzed", status: "complete" },
          { label: "Make decisions", status: amazonFile ? "complete" : "active" },
          { label: "Generate Amazon file", status: amazonFile ? "complete" : "pending" },
        ]}
      />

      {/* Spend distribution — collapsible visualization */}
      <SpendDistributionStrip
        items={bleeders.map((b) => ({
          label: b.targetingText || b.campaignName || "Untitled",
          spend: b.spend || 0,
        }))}
      />

      {viewMode === "triage" &&
        (() => {
          const triageItems: TriageItem[] = bleeders.map((b, idx) => ({
            key: String(idx),
            sheet: "Lifetime Audit",
            campaign: b.campaignName || "—",
            adGroup: b.adGroupName || "",
            entity: b.targetingText || "—",
            matchType: b.matchType || undefined,
            clicks: b.clicks ?? 0,
            spend: b.spend ?? 0,
            sales: b.sales ?? 0,
            acosNum: b.acos ?? 0,
            orders: b.orders ?? 0,
            acos: b.acos ? `${b.acos.toFixed(1)}%` : "",
          }));

          const triageDecisions: Record<string, string> = {};
          Object.entries(decisions).forEach(([k, v]) => {
            triageDecisions[String(k)] = v;
          });

          const triageSpecsBySheet = (): TriageDecisionSpec[] => [
            { value: "Pause", label: "PAUSE", bg: "#EF4444", color: "#FFFFFF", shortcut: "P", countsAsSavings: true },
            { value: "Keep", label: "KEEP", bg: "#059669", color: "#FFFFFF", shortcut: "K", countsAsSavings: false },
          ];

          return (
            <TriageMode
              items={triageItems}
              decisions={triageDecisions}
              decisionSpecsBySheet={triageSpecsBySheet}
              onDecide={(key, val) => setDecisionWithFlash(Number(key), val)}
              onUndo={(key) =>
                setDecisions((prev) => {
                  const n = { ...prev };
                  delete n[Number(key)];
                  return n;
                })
              }
              onGenerate={async () => {
                await handleGenerate();
                toast.success("Amazon file ready", {
                  description: `${decisionsMade} decisions`,
                  duration: 3000,
                });
              }}
              onSwitchToReview={() => setViewMode("review")}
              totalSpend={result.totalSpend}
              sheetsCount={1}
              addressedSavings={addressedSpend}
              shortSheetLabel={(s) => s}
            />
          );
        })()}

      {viewMode === "review" && (
        <>
          {/* Filter pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[12px] text-[hsl(var(--text-secondary))] font-medium">Lifetime Audit:</span>
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
                {f.icon && <span>{f.icon}</span>}
                {f.label}
                <span className="count">· {f.count}</span>
              </button>
            ))}
          </div>

          {/* Decision table */}
          <div className="decision-table-card">
            {/* Bulk actions */}
            <div className="decision-table-bar flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="text-[12px] text-[hsl(var(--text-secondary))] truncate">
                <span className="font-medium text-foreground">Lifetime Audit</span>
                <span className="mx-1.5 text-[hsl(var(--text-tertiary))]">·</span>
                <span className="font-mono-nums">{bleeders.length}</span> bleeders
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    const all: Record<number, string> = {};
                    suggestions.forEach((s, idx) => {
                      all[idx] = s.decision;
                    });
                    setDecisions(all);
                  }}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold text-white btn-press"
                  style={{ background: "#A855F7" }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Apply recommendations
                </button>
                <button onClick={() => setAll("Pause")} className="bulk-btn btn-press">
                  <span className="decision-dot" style={{ background: "#EF4444" }} />
                  Select all → Pause
                </button>
                <button onClick={() => setAll("Keep")} className="bulk-btn btn-press">
                  <span className="decision-dot" style={{ background: "#10B981" }} />
                  Select all → Keep
                </button>
                <button onClick={handleClearAll} className="bulk-btn bulk-btn-ghost btn-press">
                  <XCircle className="w-3 h-3" />
                  Clear
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="max-h-[58vh] overflow-auto table-sticky-header decision-table">
              <Table style={{ tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "8%" }} />
                  <col style={{ width: "7%" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "140px" }} />
                </colgroup>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border">
                    <TableHead style={{ letterSpacing: "0.08em" }}>
                      <SortHeader active={sortKey === "campaign"} dir={sortDir} onClick={() => toggleSort("campaign")}>
                        Campaign
                      </SortHeader>
                    </TableHead>
                    <TableHead style={{ letterSpacing: "0.08em" }}>
                      <SortHeader active={sortKey === "adGroup"} dir={sortDir} onClick={() => toggleSort("adGroup")}>
                        Ad Group
                      </SortHeader>
                    </TableHead>
                    <TableHead style={{ letterSpacing: "0.08em" }}>
                      <SortHeader active={sortKey === "entity"} dir={sortDir} onClick={() => toggleSort("entity")}>
                        Entity
                      </SortHeader>
                    </TableHead>
                    <TableHead style={{ letterSpacing: "0.08em" }}>Match</TableHead>
                    <TableHead className="text-right" style={{ letterSpacing: "0.08em" }}>
                      <SortHeader
                        active={sortKey === "clicks"}
                        dir={sortDir}
                        onClick={() => toggleSort("clicks")}
                        align="right"
                      >
                        Clicks
                      </SortHeader>
                    </TableHead>
                    <TableHead className="text-right" style={{ letterSpacing: "0.08em" }}>
                      <SortHeader
                        active={sortKey === "spend"}
                        dir={sortDir}
                        onClick={() => toggleSort("spend")}
                        align="right"
                      >
                        Spend
                      </SortHeader>
                    </TableHead>
                    <TableHead className="text-right" style={{ letterSpacing: "0.08em" }}>
                      Sales
                    </TableHead>
                    <TableHead className="text-right" style={{ letterSpacing: "0.08em" }}>
                      <SortHeader
                        active={sortKey === "acos"}
                        dir={sortDir}
                        onClick={() => toggleSort("acos")}
                        align="right"
                      >
                        ACoS
                      </SortHeader>
                    </TableHead>
                    <TableHead className="w-[80px]" style={{ letterSpacing: "0.08em" }}>
                      Suggestion
                    </TableHead>
                    <TableHead
                      style={{
                        width: 140,
                        letterSpacing: "0.08em",
                        position: "sticky",
                        right: 0,
                        zIndex: 7,
                        background: "#F9FAFB",
                        boxShadow: "-1px 0 0 #E5E7EB",
                      }}
                    >
                      Decision
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedIndices.filter(matchesFocus).map((idx) => {
                    const b = bleeders[idx];
                    const sug = suggestions[idx];
                    const decision = decisions[idx];
                    const indicatorClass = decisionRowClass(decision);

                    const isHighUrgency = !decision && b.spend >= urgencyBands.high && b.spend > 0;
                    const isLowUrgency = !decision && b.spend <= urgencyBands.low;
                    const urgencyClass = decision
                      ? ""
                      : isHighUrgency
                        ? "row-urgency-high"
                        : isLowUrgency
                          ? "row-urgency-low"
                          : "";
                    const flashClass =
                      flashIdx && flashIdx.idx === idx && Date.now() - flashIdx.ts < 400 ? flashIdx.cls : "";

                    const isPanelSelected = selectedIdx === idx;

                    return (
                      <TableRow
                        key={`${idx}-${flashIdx?.idx === idx ? flashIdx.ts : "r"}`}
                        onClick={() => {
                          setSelectedIdx(idx);
                          setPanelComplete(false);
                        }}
                        className={`cursor-pointer transition-colors ${urgencyClass} ${indicatorClass} ${flashClass} ${isPanelSelected ? "row-detail-selected" : ""}`}
                      >
                        <TableCell className="text-[13px] max-w-[180px] truncate" title={b.campaignName}>
                          {b.campaignName}
                        </TableCell>
                        <TableCell
                          className="text-[13px] max-w-[140px] truncate text-[hsl(var(--text-secondary))]"
                          title={b.adGroupName}
                        >
                          {b.adGroupName || "—"}
                        </TableCell>
                        <TableCell className="text-[13px] max-w-[200px] truncate" title={b.targetingText}>
                          {b.targetingText}
                        </TableCell>
                        <TableCell
                          className="col-nowrap-ellipsis text-[13px] text-muted-foreground"
                          title={b.matchType || ""}
                        >
                          {b.matchType || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-[13px] font-mono-nums text-foreground">
                            {b.clicks.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-[13px] font-mono-nums text-foreground">${b.spend.toFixed(2)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-[13px] font-mono-nums">${b.sales.toFixed(2)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {b.acos && b.acos > 0 ? (
                            <span className="text-[13px] font-mono-nums text-destructive">{b.acos.toFixed(1)}%</span>
                          ) : (
                            <span className="text-[13px] text-[#D1D5DB]">—</span>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => setDecisionWithFlash(idx, sug.decision)}
                            title={sug.reason}
                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-all hover:opacity-80"
                            style={{
                              background: sug.bg,
                              color: sug.color,
                              border: `1px solid ${sug.border}`,
                              opacity: decision ? 0.45 : 1,
                            }}
                          >
                            {sug.label}
                          </button>
                        </TableCell>
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            width: 140,
                            position: "sticky",
                            right: 0,
                            zIndex: 4,
                            background: idx % 2 === 1 ? "#F9FAFB" : "#FFFFFF",
                            boxShadow: "-1px 0 0 #E5E7EB",
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            <DecisionSelect
                              value={decision}
                              onChange={(val) => setDecisionWithFlash(idx, val)}
                              options={DECISION_OPTIONS}
                              width="128px"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pinned action bar */}
            <div className="decision-table-footer p-4 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {decisionsMade >= bleeders.length && bleeders.length > 0 ? (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[14px] font-semibold font-mono-nums" style={{ color: "#10B981" }}>
                        All {bleeders.length} decisions complete
                      </span>
                      <CheckCircle2 className="w-4 h-4" style={{ color: "#10B981" }} />
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="text-[14px] font-semibold text-foreground font-mono-nums">
                        {decisionsMade}
                        <span className="text-[hsl(var(--text-tertiary))]">/{bleeders.length}</span>
                      </span>
                      <span className="text-[12px] text-[hsl(var(--text-secondary))]">decisions</span>
                    </div>
                  )}
                  <div className="mt-2">
                    <DecisionProgressBar
                      total={bleeders.length}
                      segments={[
                        {
                          key: "Pause",
                          count: Object.values(decisions).filter((d) => d === "Pause").length,
                          color: "#EF4444",
                        },
                        {
                          key: "Keep",
                          count: Object.values(decisions).filter((d) => d === "Keep").length,
                          color: "#10B981",
                        },
                      ]}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={handleGenerate}
                    disabled={decisionsMade === 0 || isGenerating || !!amazonFile}
                    className={`btn-primary-action btn-press ${amazonFile ? "is-done" : ""} ${decisionsMade >= bleeders.length && bleeders.length > 0 && !amazonFile ? "is-ready" : ""}`}
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : amazonFile ? (
                      <>
                        <CheckCircle2 className="w-4 h-4" /> Downloaded ✓
                      </>
                    ) : (
                      <>Generate Amazon file →</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Master/detail side panel */}
      {(() => {
        const idx = selectedIdx;
        const b = idx != null ? bleeders[idx] : null;
        const decision = idx != null ? decisions[idx] : undefined;

        const buttonSpecs: DecisionButtonSpec[] = [
          {
            value: "Pause",
            label: "Pause",
            bg: "rgba(239, 68, 68, 0.10)",
            color: "#B91C1C",
            border: "rgba(239, 68, 68, 0.20)",
            hoverBg: "rgba(239, 68, 68, 0.20)",
          },

          {
            value: "Keep",
            label: "Keep",
            bg: "rgba(16, 185, 129, 0.10)",
            color: "#047857",
            border: "rgba(16, 185, 129, 0.20)",
            hoverBg: "rgba(16, 185, 129, 0.20)",
          },
        ];

        const detail: RowDetail | null =
          b && idx != null
            ? (() => {
                const sug = suggestions[idx];
                const isHighSpend = b.spend >= urgencyBands.high && b.spend > 0;
                const cpc = b.clicks && b.clicks > 0 ? b.spend / b.clicks : 0;
                const acosVal = b.acos ?? 0;
                return {
                  key: idx,
                  campaign: b.campaignName || "—",
                  adGroup: b.adGroupName || undefined,
                  entity: b.targetingText || "—",
                  matchType: b.matchType || undefined,
                  metrics: [
                    { label: "Clicks", value: (b.clicks ?? 0).toLocaleString() },
                    { label: "Spend", value: `$${b.spend.toFixed(2)}`, color: isHighSpend ? "#EF4444" : undefined },
                    { label: "Sales", value: `$${b.sales.toFixed(2)}` },
                    acosVal > 0
                      ? {
                          label: "ACoS",
                          value: `${acosVal.toFixed(1)}%`,
                          pill: true,
                          pillBg: acosVal >= 100 ? "#EF4444" : "#F59E0B",
                        }
                      : { label: "ACoS", value: "—" },
                    { label: "CPC", value: cpc > 0 ? `$${cpc.toFixed(2)}` : "—" },
                  ],
                  suggestion: { label: sug.label, bg: sug.bg, color: sug.color, border: sug.border },
                  rationale: sug.rationale,
                };
              })()
            : null;

        const moveTo = (delta: number) => {
          if (idx == null || sortedIndices.length === 0) return;
          const pos = sortedIndices.indexOf(idx);
          if (pos === -1) return;
          const next = (pos + delta + sortedIndices.length) % sortedIndices.length;
          setSelectedIdx(sortedIndices[next]);
          setPanelComplete(false);
        };

        const advanceToNextUndecided = () => {
          if (idx == null) {
            setPanelComplete(true);
            return;
          }
          const start = sortedIndices.indexOf(idx);
          for (let i = 1; i <= sortedIndices.length; i++) {
            const probe = sortedIndices[(start + i) % sortedIndices.length];
            if (!decisions[probe]) {
              setSelectedIdx(probe);
              setPanelComplete(false);
              return;
            }
          }
          setPanelComplete(true);
        };

        return (
          <RowDetailPanel
            open={idx != null}
            detail={detail}
            currentDecision={decision}
            buttons={buttonSpecs}
            allComplete={panelComplete}
            onSelectDecision={(val) => {
              if (idx == null) return;
              setDecisionWithFlash(idx, val);
              window.setTimeout(advanceToNextUndecided, 520);
            }}
            onClose={() => {
              setSelectedIdx(null);
              setPanelComplete(false);
            }}
            onPrev={() => moveTo(-1)}
            onNext={() => moveTo(1)}
            onGenerate={() => {
              setSelectedIdx(null);
              setPanelComplete(false);
              handleGenerate();
            }}
          />
        );
      })()}
    </div>
  );
};

export default LifetimeBleederResults;
