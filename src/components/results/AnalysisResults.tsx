import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Download,
  Loader2,
  CheckCircle2,
  MoreHorizontal,
  AlertTriangle,
  FileSpreadsheet,
  Layers,
  ChevronDown,
  Percent,
  DollarSign,
  Info,
  XCircle,
  Upload,
} from "lucide-react";
import { useState, useMemo, useRef, useEffect } from "react";
import { toast } from "sonner";
import { DecisionSelect, decisionRowClass } from "@/components/shared/DecisionSelect";
import { CompactStatsBar } from "@/components/shared/CompactStatsBar";
import { SortHeader, useSortable } from "@/components/shared/SortHeader";
import { CompletionView } from "@/components/shared/CompletionView";
import { DecisionProgressBar } from "@/components/shared/DecisionProgressBar";
import { SpendDistributionStrip } from "@/components/shared/SpendDistributionStrip";
import { RowDetailPanel, type DecisionButtonSpec, type RowDetail } from "@/components/shared/RowDetailPanel";
import { suggestB1Row } from "@/lib/ui/bleeder1Suggestion";
import { TriageMode, type TriageItem, type TriageDecisionSpec } from "@/components/results/TriageMode";
import { ReviewAllMode } from "@/components/results/ReviewAllMode";
import { Zap, List as ListIcon } from "lucide-react";
import { processDecisions } from "@/lib/decisionProcessor";
import { clearSession, loadSavedSession, saveSession } from "@/lib/decisionSession";
import { ResumeSessionBanner } from "@/components/shared/ResumeSessionBanner";
import * as XLSX from "xlsx";

interface TopSpender {
  term: string;
  spend: number;
  clicks: number;
  sheet: string;
  isCombined: boolean;
}

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

interface SheetDiagnostics {
  sheetName: string;
  rowsLoaded: number;
  afterNormalization: number;
  actionableEntity: number;
  enabledRows: number;
  clicksAboveThreshold: number;
  salesZero: number;
  finalBleeders: number;
  columnsNormalized: string[];
  missingColumns: string[];
  coercionsApplied: string[];
}

interface AnalysisResultsProps {
  summary: string;
  tables: Record<string, string>;
  csvData: { combined: string };
  brandName?: string;
  validation: any;
  topSpenders: TopSpender[];
  allRows: NormalizedRow[];
  onProceedToProcessor?: () => void;
  formattedWorkbook?: any;
  diagnostics?: SheetDiagnostics[];
  mode?: "standard" | "lifetime";
}

const SEARCH_TERM_DECISIONS = ["Negate (Exact)", "Negate (Phrase)", "Keep"];
const CAMPAIGN_DECISIONS = ["Pause", "Cut Bid 50%", "Keep"];
const DEFAULT_DECISIONS = ["Negate (Exact)", "Negate (Phrase)", "Pause", "Keep"];

function getDecisionOptions(sheetName: string): string[] {
  const lower = sheetName.toLowerCase();
  if (lower.includes("search term")) return SEARCH_TERM_DECISIONS;
  if (lower.includes("campaign")) return CAMPAIGN_DECISIONS;
  return DEFAULT_DECISIONS;
}

function shortTabLabel(name: string): string {
  return name
    .replace(/Sponsored Products/i, "SP")
    .replace(/Sponsored Brands/i, "SB")
    .replace(/Sponsored Display/i, "SD")
    .replace(/Search Term Report/i, "Search Terms")
    .replace(/Campaigns$/i, "Campaigns");
}

const RANK_COLORS = ["hsl(45 90% 50%)", "hsl(220 8% 60%)", "hsl(28 60% 45%)"]; // gold/silver/bronze

export const AnalysisResults = ({
  summary,
  tables,
  csvData,
  brandName,
  validation,
  topSpenders,
  allRows,
  onProceedToProcessor,
  formattedWorkbook,
  diagnostics,
  mode = "standard",
}: AnalysisResultsProps) => {
  const [decisions, setDecisions] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateDone, setGenerateDone] = useState(false);
  const [showFullResults, setShowFullResults] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [generatedFileName, setGeneratedFileName] = useState<string>("");
  const [flashKey, setFlashKey] = useState<{ key: string; cls: string; ts: number } | null>(null);
  const [viewMode, setViewMode] = useState<"triage" | "review">("review");
  const lastDownloadRef = useRef<(() => void) | null>(null);

  // ---------- Session auto-save (data-loss guard) ----------
  const sessionModule = "bleeders1";
  const sessionFileRef = useRef<string>(
    `b1_${mode}_${allRows.length}_${allRows[0]?.sheet ?? "empty"}`,
  );
  const [savedSession, setSavedSession] = useState(() =>
    loadSavedSession(sessionModule, sessionFileRef.current),
  );
  const [sessionHydrated, setSessionHydrated] = useState(false);

  useEffect(() => {
    if (!sessionHydrated) return;
    saveSession(sessionModule, sessionFileRef.current, decisions, allRows.length);
  }, [decisions, sessionHydrated, allRows.length]);

  const setDecisionWithFlash = (key: string, val: string) => {
    if (!sessionHydrated) setSessionHydrated(true);
    setDecisions((prev) => ({ ...prev, [key]: val }));
    let cls = "";
    if (val === "Pause") cls = "row-flash-pause";
    else if (val === "Keep") cls = "row-flash-keep";
    else if (val.startsWith("Cut")) cls = "row-flash-cut";
    else if (val.startsWith("Negat")) cls = "row-flash-negate";
    if (cls) setFlashKey({ key, cls, ts: Date.now() });
  };

  // Wrap setDecisions passed to ReviewAllMode so bulk actions also trigger auto-save.
  const setDecisionsTracked = (next: Record<string, string>) => {
    if (!sessionHydrated) setSessionHydrated(true);
    setDecisions(next);
  };

  const rowsBySheet = useMemo(() => {
    const grouped: Record<string, NormalizedRow[]> = {};
    allRows.forEach((row) => {
      if (!grouped[row.sheet]) grouped[row.sheet] = [];
      grouped[row.sheet].push(row);
    });
    return grouped;
  }, [allRows]);

  const sheetNames = useMemo(() => Object.keys(rowsBySheet), [rowsBySheet]);
  const [activeSheet, setActiveSheet] = useState<string>("");

  const currentSheet = activeSheet || sheetNames[0] || "";
  const currentRows = rowsBySheet[currentSheet] || [];
  const decisionOptions = getDecisionOptions(currentSheet);

  // Master/detail panel state — selectedRowIdx is an index into currentRows
  // (the active sheet's rows). Resets when the active sheet changes.
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [panelComplete, setPanelComplete] = useState(false);
  useEffect(() => {
    setSelectedRowIdx(null);
    setPanelComplete(false);
  }, [currentSheet]);

  // Build the side-panel button spec — uses unified color system.
  // PAUSE #EF4444 · CUT BID #F59E0B · KEEP #059669 · NEGATIVE #6366F1
  const panelButtonSpecs: DecisionButtonSpec[] = useMemo(() => {
    return decisionOptions.map((opt) => {
      if (opt === "Pause") {
        return {
          value: "Pause",
          label: "Pause",
          bg: "rgba(239, 68, 68, 0.10)",
          color: "#B91C1C",
          border: "rgba(239, 68, 68, 0.25)",
          hoverBg: "rgba(239, 68, 68, 0.18)",
        };
      }
      if (opt === "Cut Bid 50%") {
        return {
          value: "Cut Bid 50%",
          label: "Cut Bid 50%",
          bg: "rgba(245, 158, 11, 0.10)",
          color: "#B45309",
          border: "rgba(245, 158, 11, 0.25)",
          hoverBg: "rgba(245, 158, 11, 0.18)",
        };
      }
      if (opt === "Keep") {
        return {
          value: "Keep",
          label: "Keep",
          bg: "rgba(5, 150, 105, 0.10)",
          color: "#047857",
          border: "rgba(5, 150, 105, 0.25)",
          hoverBg: "rgba(5, 150, 105, 0.18)",
        };
      }
      // Negate (Exact) / Negate (Phrase) → INFO/NEGATIVE violet
      return {
        value: opt,
        label: opt,
        bg: "rgba(99, 102, 241, 0.10)",
        color: "#4338CA",
        border: "rgba(99, 102, 241, 0.25)",
        hoverBg: "rgba(99, 102, 241, 0.18)",
      };
    });
  }, [decisionOptions]);

  type SortKey = "campaign" | "ad_group" | "entity" | "clicks" | "spend" | "sales" | "acos";
  const { sortKey, sortDir, toggle: toggleSort } = useSortable<SortKey>("spend", "desc");

  const parseAcosNum = (s: string): number => {
    if (!s) return -1;
    const n = parseFloat(String(s).replace("%", ""));
    return Number.isFinite(n) ? n : -1;
  };

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

  // Urgency quartiles based on Spend within the current sheet
  const urgencyBands = useMemo(() => {
    const spends = currentRows
      .map((r) => r.spend || 0)
      .slice()
      .sort((a, b) => a - b);
    if (spends.length === 0) return { high: Infinity, low: -Infinity };
    const q = (p: number) => spends[Math.min(spends.length - 1, Math.floor(spends.length * p))];
    return { high: q(0.75), low: q(0.25) };
  }, [currentRows]);

  const decisionsMade = useMemo(() => Object.values(decisions).filter((d) => d && d !== "").length, [decisions]);

  const totalSpend = useMemo(() => allRows.reduce((s, r) => s + (r.spend || 0), 0), [allRows]);

  // Spend split by decision status — drives the impact donut on completion view
  const { addressedSpend, undecidedSpend } = useMemo(() => {
    let addressed = 0;
    let undecided = 0;
    Object.entries(rowsBySheet).forEach(([sheet, rows]) => {
      rows.forEach((row, idx) => {
        const dec = decisions[`${sheet}-ROWINDEX-${idx}`];
        if (dec) addressed += row.spend || 0;
        else undecided += row.spend || 0;
      });
    });
    return { addressedSpend: addressed, undecidedSpend: undecided };
  }, [rowsBySheet, decisions]);

  // Savings counter — at-risk spend on rows decided to anything other than Keep
  const addressedSavings = useMemo(() => {
    let s = 0;
    Object.entries(rowsBySheet).forEach(([sheet, rows]) => {
      rows.forEach((row, idx) => {
        const dec = decisions[`${sheet}-ROWINDEX-${idx}`];
        if (dec && dec !== "Keep") s += row.spend || 0;
      });
    });
    return s;
  }, [rowsBySheet, decisions]);

  const handleDownload = () => {
    if (formattedWorkbook) {
      formattedWorkbook.xlsx.writeBuffer().then((buffer: ArrayBuffer) => {
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        const date = new Date()
          .toLocaleDateString("en-US", {
            timeZone: "America/Los_Angeles",
            month: "2-digit",
            day: "2-digit",
            year: "numeric",
          })
          .replace(/\//g, "-");
        const filePrefix = mode === "lifetime" ? "B1_LIFETIME_Decisions" : "Bleeders_1_Report";
        link.setAttribute("href", url);
        link.setAttribute("download", `${filePrefix}_${brandName || "Account"}_${date}_PT.xlsx`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      });
    } else {
      const blob = new Blob([csvData.combined], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      const date = new Date()
        .toLocaleDateString("en-US", {
          timeZone: "America/Los_Angeles",
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        })
        .replace(/\//g, "-");
      link.setAttribute("href", url);
      link.setAttribute("download", `Bleeders_1_Report_${brandName || "Account"}_${date}_PT.csv`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
  };

  const handleGenerateDecisionFile = async () => {
    setIsGenerating(true);
    setGenerateDone(false);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      const sheetNameMap: Record<string, string> = {
        "SP Search Term Report": "Sponsored Products • Search Term",
        "SB Search Term Report": "Sponsored Brands • Search Term",
        "Sponsored Products Campaigns": "Sponsored Products • Targeting",
        "Sponsored Brands Campaigns": "Sponsored Brands • Keywords",
        "Sponsored Display Campaigns": "Sponsored Display • Targeting",
      };
      const grouped: Record<string, any[]> = {};
      Object.entries(decisions).forEach(([key, decision]) => {
        if (!decision) return;
        const sepIdx = key.indexOf("-ROWINDEX-");
        if (sepIdx === -1) return;
        const sheetName = key.substring(0, sepIdx);
        const rowIdx = parseInt(key.substring(sepIdx + 10));
        const sheetRows = rowsBySheet[sheetName];
        if (!sheetRows || !sheetRows[rowIdx]) return;
        const row = sheetRows[rowIdx];
        const outputSheet = sheetNameMap[sheetName] ?? sheetName;
        if (!grouped[outputSheet]) grouped[outputSheet] = [];
        // If Cut Bid but no bid in source file, convert to Pause (safe fallback)
        const effectiveDecision = decision.startsWith("Cut Bid") && !(row.bid > 0) ? "Pause" : decision;
        grouped[outputSheet].push({ ...row, _decision: effectiveDecision });
      });
      for (const [tabName, rows] of Object.entries(grouped)) {
        const ws = wb.addWorksheet(tabName);
        ws.addRow([
          "Campaign Name",
          "Ad Group Name",
          "Entity",
          "Keyword Text",
          "Product Targeting Expression",
          "Match Type",
          "Customer Search Term",
          "Decision",
          "Campaign Id",
          "Ad Group Id",
          "Keyword Id",
          "Product Targeting Id",
          "Targeting Id",
          "Bid",
        ]);
        rows.forEach((row: any) => {
          console.log("ROW BID:", row._decision, row.bid, row.keyword_text, row.campaign?.slice(0, 30));
          ws.addRow([
            row.campaign ?? "",
            row.ad_group ?? "",
            row.entityType ?? row.entity ?? "",
            row.keyword_text ?? "",
            row.product_targeting ?? "",
            row.match_type ?? "",
            row.customer_search_term ?? "",
            row._decision,
            row.campaignId ?? "",
            row.adGroupId ?? "",
            row.keywordId ?? "",
            row.productTargetingId ?? "",
            row.targetingId ?? "",
            (() => {
              if (row._decision?.startsWith("Cut Bid")) {
                const pctMatch = row._decision.match(/(\d+)%/);
                const pct = pctMatch ? parseInt(pctMatch[1]) : 50;
                const originalBid = parseFloat(String(row.bid ?? "0")) || 0;
                if (originalBid > 0) {
                  return Math.max(0.02, parseFloat((originalBid * (1 - pct / 100)).toFixed(2)));
                }
              }
              return row.bid ?? "";
            })(),
          ]);
        });
      }
      const buffer = await wb.xlsx.writeBuffer();
      const decisionsFile = new File([buffer], "decisions.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const result = await processDecisions(decisionsFile);
      const date = new Date()
        .toLocaleDateString("en-US", {
          timeZone: "America/Los_Angeles",
          month: "2-digit",
          day: "2-digit",
          year: "numeric",
        })
        .replace(/\//g, "-");

      if (result.validation.errors.length === 0) {
        const outBuffer = XLSX.write(result.workbook, { bookType: "xlsx", type: "array" });
        const amazonFileName = `Bleeders_1_Amazon_${date}_PT.xlsx`;
        const blob = new Blob([outBuffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = amazonFileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setGeneratedFileName(amazonFileName);
        setGenerateDone(true);
        lastDownloadRef.current = () => {
          const blob2 = new Blob([outBuffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          });
          const u2 = URL.createObjectURL(blob2);
          const a2 = document.createElement("a");
          a2.href = u2;
          a2.download = amazonFileName;
          document.body.appendChild(a2);
          a2.click();
          document.body.removeChild(a2);
          URL.revokeObjectURL(u2);
        };
        toast.success("Amazon bulk file ready", {
          description: `${decisionsMade} decisions processed`,
          duration: 3000,
        });
        if (result.validation.warnings.length > 0) {
          toast.warning(result.validation.warnings[0]);
        }
      } else {
        console.error("[Generate Decision File] Validation errors:", result.validation.errors);
        toast.error(result.validation.errors[0]);
      }
    } catch (err) {
      console.error("[Generate Decision File] Failed:", err);
      toast.error("Failed to generate decision file");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStartNew = () => {
    setDecisions({});
    setGenerateDone(false);
    setGeneratedFileName("");
    lastDownloadRef.current = null;
  };


  const sheetsCount = [...new Set(allRows.map((r) => r.sheet))].length;
  const decisionThresholdSpend = (totalSpend / Math.max(allRows.length, 1)) * 1.5; // highlight only above 1.5x mean

  // Decisions breakdown for completion view
  const breakdown = useMemo(() => {
    const counts: Record<string, number> = {
      Pause: 0,
      "Cut Bid 50%": 0,
      Keep: 0,
      "Negate (Exact)": 0,
      "Negate (Phrase)": 0,
    };
    Object.values(decisions).forEach((d) => {
      if (d) counts[d] = (counts[d] ?? 0) + 1;
    });
    const items = [
      { label: "Paused", count: counts["Pause"] ?? 0, color: "#EF4444" },
      { label: "Cut Bid 50%", count: counts["Cut Bid 50%"] ?? 0, color: "#F59E0B" },
      {
        label: "Negative",
        count: (counts["Negate (Exact)"] ?? 0) + (counts["Negate (Phrase)"] ?? 0),
        color: "#6366F1",
      },
      { label: "Keep", count: counts["Keep"] ?? 0, color: "#059669" },
      { label: "No decision", count: Math.max(0, allRows.length - decisionsMade), color: "#E5E7EB" },
    ];
    return items;
  }, [decisions, allRows.length, decisionsMade]);

  // ── Completion view (replaces full results page after generation) ──
  if (generateDone && generatedFileName && !showFullResults) {
    return (
      <CompletionView
        fileName={generatedFileName}
        title="Workflow complete"
        impactHeadline={`$${totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })} in at-risk spend addressed`}
        impactSubtitle="Your decisions have been packaged into an Amazon-ready bulk file."
        totalRows={allRows.length}
        summary={[
          { label: "Bleeders found", value: allRows.length.toLocaleString() },
          { label: "Sheets processed", value: String(sheetsCount) },
          { label: "Decisions made", value: `${decisionsMade}/${allRows.length}` },
          { label: "Avg spend per bleeder", value: `$${(totalSpend / Math.max(allRows.length, 1)).toFixed(2)}` },
        ]}
        breakdown={breakdown}
        onDownload={() => lastDownloadRef.current?.()}
        onStartNew={handleStartNew}
        onViewFullResults={() => setShowFullResults(true)}
        accentColor="#059669"
        addressedSpend={addressedSpend}
        undecidedSpend={undecidedSpend}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Lifetime mode notice — hidden during Triage */}
      {mode === "lifetime" && viewMode !== "triage" && (
        <div className="rounded-lg border border-[hsl(var(--amber-border))] bg-[hsl(var(--amber-light))] px-4 py-3 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-[hsl(var(--amber))] flex-shrink-0 mt-px" strokeWidth={1.8} />
          <div>
            <p className="text-[12.5px] font-semibold text-foreground">Lifetime Mode</p>
            <p className="text-[12px] text-[hsl(var(--text-secondary))] mt-0.5">
              Analysis uses lifetime performance data for deeper trend detection.
            </p>
          </div>
        </div>
      )}

      {/* Back to summary */}
      {generateDone && showFullResults && (
        <button
          onClick={() => setShowFullResults(false)}
          className="text-[12.5px] hover:underline btn-press inline-flex items-center gap-1"
          style={{ color: "#0D9488" }}
        >
          ← Back to summary
        </button>
      )}

      {/* Mode toggle — Triage vs Review All */}
      <div className="flex items-center justify-end">
        <div
          className="inline-flex items-center p-0.5 rounded-full border border-border bg-card"
          role="tablist"
          aria-label="View mode"
        >
          <button
            role="tab"
            aria-selected={viewMode === "triage"}
            onClick={() => setViewMode("triage")}
            className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
              viewMode === "triage" ? "text-white shadow-sm" : "text-[hsl(var(--text-secondary))] hover:text-foreground"
            }`}
            style={viewMode === "triage" ? { background: "#0D9488" } : undefined}
          >
            <Zap className="w-3.5 h-3.5" /> Triage
          </button>
          <button
            role="tab"
            aria-selected={viewMode === "review"}
            onClick={() => setViewMode("review")}
            className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
              viewMode === "review" ? "text-white shadow-sm" : "text-[hsl(var(--text-secondary))] hover:text-foreground"
            }`}
            style={viewMode === "review" ? { background: "#0D9488" } : undefined}
          >
            <ListIcon className="w-3.5 h-3.5" /> Review All
          </button>
        </div>
      </div>

      {/* Single command bar — hidden during Triage */}
      {viewMode !== "triage" && (
        <CompactStatsBar
          accent={mode === "lifetime" ? "purple" : "red"}
          stats={[
            { value: allRows.length.toLocaleString(), label: "bleeders" },
            { value: `$${totalSpend.toLocaleString("en-US", { maximumFractionDigits: 0 })}`, label: "at risk" },
            { value: String(sheetsCount), label: "sheets" },
          ]}
          steps={[
            { label: "File analyzed", status: "complete" },
            { label: "Make decisions", status: generateDone ? "complete" : "active" },
            { label: "Generate Amazon file", status: generateDone ? "complete" : "pending" },
          ]}
          trailing={
            <>
              <span className="text-[12.5px] tabular-nums">
                <span className="font-semibold text-[#111827]">
                  {decisionsMade}/{allRows.length}
                </span>
              </span>
              <span className="text-[12.5px] tabular-nums inline-flex items-center gap-1">
                <span aria-hidden>💰</span>
                <span className="font-semibold" style={{ color: "#059669" }}>
                  ${Math.round(addressedSavings).toLocaleString()}
                </span>
              </span>
              <button
                onClick={handleGenerateDecisionFile}
                disabled={decisionsMade === 0 || isGenerating}
                title={decisionsMade === 0 ? "Make at least one decision to generate your file" : undefined}
                className={`inline-flex items-center gap-1.5 px-3 text-[13px] font-semibold transition-all btn-press disabled:cursor-not-allowed ${
                  decisionsMade === allRows.length && allRows.length > 0 && !generateDone ? "ready-pulse" : ""
                }`}
                style={{
                  height: 32,
                  borderRadius: 6,
                  background: decisionsMade === 0 ? "#E5E7EB" : "#0D9488",
                  color: decisionsMade === 0 ? "#9CA3AF" : "#FFFFFF",
                }}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…
                  </>
                ) : generateDone ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Downloaded
                  </>
                ) : decisionsMade === allRows.length && allRows.length > 0 ? (
                  <>Generate →</>
                ) : (
                  <>
                    Generate ({decisionsMade}/{allRows.length}) →
                  </>
                )}
              </button>
            </>
          }
        />
      )}

      {/* TRIAGE MODE ─────────────────────────────────────── */}
      {viewMode === "triage" &&
        sheetNames.length > 0 &&
        (() => {
          const items: TriageItem[] = [];
          Object.entries(rowsBySheet).forEach(([sheet, rows]) => {
            rows.forEach((row, idx) => {
              items.push({
                key: `${sheet}-ROWINDEX-${idx}`,
                sheet,
                campaign: row.campaign || "—",
                adGroup: row.ad_group || "",
                entity: row.customer_search_term || row.keyword_text || row.product_targeting || row.entity || "—",
                matchType: row.match_type || undefined,
                clicks: row.clicks ?? 0,
                spend: row.spend ?? 0,
                sales: row.sales ?? 0,
                acos: row.acos || "",
                acosNum: parseAcosNum(row.acos),
                orders: row.orders ?? 0,
              });
            });
          });
          // Sort by spend desc — most at-risk first.
          items.sort((a, b) => b.spend - a.spend);

          const decisionSpecsBySheet = (sheet: string): TriageDecisionSpec[] => {
            const opts = getDecisionOptions(sheet);
            const isSearchTerm = /search term/i.test(sheet);
            const map = (opt: string): TriageDecisionSpec => {
              if (opt === "Pause")
                return {
                  value: "Pause",
                  label: "PAUSE",
                  bg: "#EF4444",
                  color: "#FFFFFF",
                  shortcut: "P",
                  countsAsSavings: true,
                };
              if (opt === "Cut Bid 50%")
                return {
                  value: "Cut Bid 50%",
                  label: "CUT BID",
                  bg: "#F59E0B",
                  color: "#FFFFFF",
                  shortcut: "C",
                  countsAsSavings: true,
                };
              if (opt === "Keep")
                return {
                  value: "Keep",
                  label: "KEEP",
                  bg: "#059669",
                  color: "#FFFFFF",
                  shortcut: "K",
                  countsAsSavings: false,
                };
              if (opt === "Negate (Phrase)")
                return {
                  value: opt,
                  label: "NEG PHRASE",
                  bg: "#8B5CF6",
                  color: "#FFFFFF",
                  shortcut: "M",
                  countsAsSavings: true,
                };
              if (opt.startsWith("Negat"))
                return {
                  value: opt,
                  label: "NEGATIVE",
                  bg: "#6366F1",
                  color: "#FFFFFF",
                  shortcut: "N",
                  countsAsSavings: true,
                };
              return {
                value: opt,
                label: opt.toUpperCase(),
                bg: "#9CA3AF",
                color: "#FFFFFF",
                shortcut: opt[0].toUpperCase(),
                countsAsSavings: false,
              };
            };
            const specs = opts.map(map);
            if (isSearchTerm) {
              const order = ["Negate (Exact)", "Negate (Phrase)", "Keep", "Pause"];
              return [...specs].sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
            }
            return specs;
          };

          return (
            <TriageMode
              items={items}
              decisions={decisions}
              decisionSpecsBySheet={decisionSpecsBySheet}
              onDecide={(key, val) => setDecisionWithFlash(key, val)}
              onUndo={(key) =>
                setDecisions((prev) => {
                  const n = { ...prev };
                  delete n[key];
                  return n;
                })
              }
              onGenerate={handleGenerateDecisionFile}
              onSwitchToReview={() => setViewMode("review")}
              totalSpend={totalSpend}
              sheetsCount={sheetsCount}
              addressedSavings={addressedSavings}
              shortSheetLabel={shortTabLabel}
            />
          );
        })()}

      {/* Completion banner removed — replaced by full CompletionView page */}

      {viewMode === "review" && sheetNames.length > 0 && (
        <ReviewAllMode
          rowsBySheet={rowsBySheet}
          decisions={decisions}
          setDecision={setDecisionWithFlash}
          setDecisions={setDecisions}
          onGenerate={handleGenerateDecisionFile}
          onDownloadLegacy={handleDownload}
          
          isGenerating={isGenerating}
          generateDone={generateDone}
          decisionsMade={decisionsMade}
          totalRows={allRows.length}
          shortTabLabel={shortTabLabel}
          getDecisionOptions={getDecisionOptions}
        />
      )}
    </div>
  );
};
