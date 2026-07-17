import React, { useState, useMemo, useEffect, useRef } from 'react';
import { clearSession, confirmBulkOverride, loadSavedSession, saveSession } from "@/lib/decisionSession";
import { ResumeSessionBanner } from "@/components/shared/ResumeSessionBanner";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Download, CheckCircle2, Loader2, XCircle, ChevronDown, AlertTriangle, DollarSign, Percent, Sparkles, Zap, List as ListIcon, Info } from "lucide-react";
import { TriageMode, type TriageItem, type TriageDecisionSpec } from "@/components/results/TriageMode";
import { toast } from "sonner";
import type { Bleeder2TrackResult, Bleeder2TrackType } from "@/lib/bleeder2TrackAnalyzer";
import { DecisionFileDropzone } from "./DecisionFileDropzone";
import { suggestDecision, getConfidenceStyle } from '@/lib/ui/suggestionEngine';
import type { Suggestion } from '@/lib/ui/suggestionEngine';
import { DecisionSelect, decisionRowClass } from "@/components/shared/DecisionSelect";
import { CompactStatsBar } from "@/components/shared/CompactStatsBar";
import { SortHeader, useSortable } from "@/components/shared/SortHeader";
import { CompletionView } from "@/components/shared/CompletionView";
import { DecisionProgressBar } from "@/components/shared/DecisionProgressBar";
import { SpendDistributionStrip } from "@/components/shared/SpendDistributionStrip";
import { RowDetailPanel, type DecisionButtonSpec, type RowDetail } from "@/components/shared/RowDetailPanel";

interface Bleeder2TrackResultsProps {
  result: Bleeder2TrackResult;
  onDownload: () => void;
  onUploadDecision: (trackType: Bleeder2TrackType, file: File, cutBidPct?: number) => void;
  onAdjustThresholds: () => void;
  onUploadNewFile: (trackType: Bleeder2TrackType) => void;
  decisionFile?: File | null;
  amazonFile?: { workbook: any; fileName: string } | null;
  onDownloadAmazon?: () => void;
  onStartNew?: () => void;
  acosThresholdLabel?: string;
}

const TRACK_LABELS: Record<Bleeder2TrackType, string> = {
  'SBSD': 'SB/SD Bad Targets',
  'SP': 'SP Bad Search Terms',
  'SP_KEYWORDS': 'SP Bad Targets',
  'ACOS100': 'Campaigns >100% ACoS'
};

const TRACK_DECISIONS: Record<Bleeder2TrackType, string[]> = {
  'SBSD': ['Pause', 'Negative', 'Cut Bid', 'Keep'],
  'SP': ['Pause', 'Negative', 'Cut Bid', 'Keep'],
  'SP_KEYWORDS': ['Pause', 'Negative', 'Cut Bid', 'Keep'],
  'ACOS100': ['Pause', 'Negative', 'Cut Bid', 'Keep'],
};

export const Bleeder2TrackResults: React.FC<Bleeder2TrackResultsProps> = ({
  result, onDownload, onUploadDecision, onAdjustThresholds, onUploadNewFile,
  decisionFile, amazonFile, onDownloadAmazon, onStartNew, acosThresholdLabel
}) => {
  const [decisions, setDecisions] = useState<Record<number, string>>({});
  const [cutBidPcts, setCutBidPcts] = useState<Record<number, number>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateDone, setGenerateDone] = useState(false);
  const [showFullResults, setShowFullResults] = useState(false);
  const [flashIdx, setFlashIdx] = useState<{ idx: number; cls: string; ts: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [panelComplete, setPanelComplete] = useState(false);
  const [viewMode, setViewMode] = useState<'triage' | 'review'>('review');
  type FocusFilter = 'all' | 'pause' | 'review' | 'decided' | 'highspend';
  const [focusFilter, setFocusFilter] = useState<FocusFilter>('all');

  // ---------- Session auto-save (data-loss guard) ----------
  const sessionModule = `bleeders2_${result.trackType}`;
  const sessionFileRef = useRef<string>(result.fileName);
  const [savedSession, setSavedSession] = useState(() =>
    loadSavedSession(sessionModule, sessionFileRef.current),
  );
  const [sessionHydrated, setSessionHydrated] = useState(false);

  useEffect(() => {
    if (!sessionHydrated) return;
    saveSession(sessionModule, sessionFileRef.current, decisions, result.bleeders.length);
  }, [decisions, sessionHydrated, sessionModule, result.bleeders.length]);

  const setDecisionWithFlash = (idx: number, val: string) => {
    if (!sessionHydrated) setSessionHydrated(true);
    setDecisions(prev => ({ ...prev, [idx]: val }));
    let cls = '';
    if (val === 'Pause') cls = 'row-flash-pause';
    else if (val === 'Keep') cls = 'row-flash-keep';
    else if (val.startsWith('Cut')) cls = 'row-flash-cut';
    else if (val.startsWith('Negat')) cls = 'row-flash-negate';
    if (cls) setFlashIdx({ idx, cls, ts: Date.now() });
  };

  const hasBleeders = result.bleeders.length > 0;

  const suggestions = useMemo(() => result.bleeders.map(bleeder => {
    const passThreshold =
      result.trackType === 'SBSD' ||
      result.trackType === 'SP' ||
      result.trackType === 'SP_KEYWORDS';
    const raw = suggestDecision({
      acos: bleeder.acos,
      spend: bleeder.spend,
      orders: bleeder.orders,
      clicks: bleeder.clicks,
      matchType: bleeder.matchType,
      entity: bleeder.entity,
      trackType: result.trackType,
      thresholdAcos: passThreshold ? result.acosThreshold : undefined,
    });
    // SP Search Terms: cut_bid/review → Negative
    if (result.trackType === 'SP' &&
        (raw.decision === 'Cut Bid' ||
         raw.shortLabel === 'Review' ||
         raw.shortLabel === 'Cut bid' ||
         raw.shortLabel === 'Cut bid?')) {
      return {
        ...raw,
        decision: 'Negative' as any,
        shortLabel: 'Negative',
        reason: 'Search term — negate to stop spend',
      };
    }
    return raw;
  }), [result.bleeders, result.trackType]);

  const getDecisionOptions = () => {
    if (result.trackType === 'ACOS100') return ['Pause', 'Cut Bid', 'Keep'];
    if (result.trackType === 'SP') return ['Negative', 'Keep'];
    return ['Negative', 'Pause', 'Cut Bid', 'Keep'];
  };

  const decisionsMade = useMemo(() => {
    return Object.values(decisions).filter(d => d && d !== '').length;
  }, [decisions]);

  const avgAcos = useMemo(() => {
    if (!hasBleeders) return 0;
    return result.bleeders.reduce((s, b) => s + b.acos, 0) / result.bleeders.length;
  }, [result.bleeders, hasBleeders]);

  const topAcos = useMemo(() => {
    return [...result.bleeders].sort((a, b) => b.acos - a.acos).slice(0, 3);
  }, [result.bleeders]);

  // Hide Ad Group dynamically — only show if at least one row has a non-empty value
  const showAdGroupBase = result.trackType === 'SBSD' || result.trackType === 'SP_KEYWORDS';
  const showAdGroup = showAdGroupBase && result.bleeders.some(b => b.adGroupName && b.adGroupName.trim() !== '' && b.adGroupName.trim() !== '—');
  const RANK_COLORS = ['hsl(45 90% 50%)', 'hsl(220 8% 60%)', 'hsl(28 60% 45%)'];

  // Sortable
  type SortKey = 'campaign' | 'adGroup' | 'entity' | 'spend' | 'orders' | 'acos';
  const { sortKey, sortDir, toggle: toggleSort } = useSortable<SortKey>('spend', 'desc');
  const sortedIndices = useMemo(() => {
    const idx = result.bleeders.map((_, i) => i);
    idx.sort((a, b) => {
      const ra = result.bleeders[a]; const rb = result.bleeders[b];
      let va: any; let vb: any;
      switch (sortKey) {
        case 'campaign': va = (ra.campaignName || '').toLowerCase(); vb = (rb.campaignName || '').toLowerCase(); break;
        case 'adGroup':  va = (ra.adGroupName || '').toLowerCase();  vb = (rb.adGroupName || '').toLowerCase();  break;
        case 'entity':   va = (ra.entity || '').toLowerCase();        vb = (rb.entity || '').toLowerCase();        break;
        case 'spend':    va = ra.spend ?? 0; vb = rb.spend ?? 0; break;
        case 'orders':   va = ra.orders ?? 0; vb = rb.orders ?? 0; break;
        case 'acos':     va = ra.acos ?? 0; vb = rb.acos ?? 0; break;
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return idx;
  }, [result.bleeders, sortKey, sortDir]);

  // Urgency quartiles based on Spend
  const urgencyBands = useMemo(() => {
    const spends = result.bleeders.map(b => b.spend || 0).slice().sort((a, b) => a - b);
    if (spends.length === 0) return { high: Infinity, low: -Infinity };
    const q = (p: number) => spends[Math.min(spends.length - 1, Math.floor(spends.length * p))];
    return { high: q(0.75), low: q(0.25) };
  }, [result.bleeders]);

  // Filter pill counts (mirror Bleeders 1.0 buckets)
  const focusMeta = useMemo(() => {
    let pause = 0, review = 0, decided = 0, highspend = 0;
    result.bleeders.forEach((b, idx) => {
      const sug = suggestions[idx];
      if (sug?.decision === 'Pause') pause++;
      else if (sug && sug.decision !== 'Keep') review++;
      if (decisions[idx]) decided++;
      if ((b.spend || 0) >= urgencyBands.high && (b.spend || 0) > 0) highspend++;
    });
    return { all: result.bleeders.length, pause, review, decided, highspend };
  }, [result.bleeders, suggestions, decisions, urgencyBands.high]);

  const matchesFocus = (idx: number): boolean => {
    if (focusFilter === 'all') return true;
    const b = result.bleeders[idx];
    const sug = suggestions[idx];
    if (focusFilter === 'pause') return sug?.decision === 'Pause';
    if (focusFilter === 'review') return !!sug && sug.decision !== 'Keep' && sug.decision !== 'Pause';
    if (focusFilter === 'decided') return !!decisions[idx];
    if (focusFilter === 'highspend') return (b.spend || 0) >= urgencyBands.high && (b.spend || 0) > 0;
    return true;
  };

  const filteredSortedIndices = useMemo(
    () => sortedIndices.filter(matchesFocus),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sortedIndices, focusFilter, decisions, suggestions, urgencyBands.high]
  );

  const isSearchTermSheet = result.trackType === 'SP';

  const applyBulk = (label: string, value: string) => {
    const keys = result.bleeders.map((_, idx) => idx);
    if (!confirmBulkOverride(label, keys, decisions)) return;
    if (!sessionHydrated) setSessionHydrated(true);
    const all: Record<number, string> = {};
    keys.forEach((idx) => { all[idx] = value; });
    setDecisions(all);
  };

  const handleSetAllPause = () => applyBulk('Pause', 'Pause');
  const handleSetAllKeep = () => applyBulk('Keep', 'Keep');
  const handleSetAllCutBid = () => applyBulk('Cut Bid', 'Cut Bid');
  const handleSetAllNegative = () => applyBulk('Negative', 'Negative');

  const handleClearAll = () => {
    if (!sessionHydrated) setSessionHydrated(true);
    setDecisions({});
    setCutBidPcts({});
  };


  const handleGenerateInline = async () => {
    setIsGenerating(true);
    setGenerateDone(false);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();

      type BleederRow = (typeof result.bleeders)[number];

      const getSheetName = (bleeder: BleederRow): string => {
        if (result.trackType === 'ACOS100') return 'Campaign • High ACOS';
        if (result.trackType === 'SP') return 'Sponsored Products • Search Term';
        if (result.trackType === 'SP_KEYWORDS') return 'Sponsored Products • Targeting';
        if (result.trackType === 'SBSD') {
          return (bleeder as any).source === 'SD'
            ? 'Sponsored Display • Targeting'
            : 'Sponsored Brands • Keywords';
        }
        return 'Sponsored Products • Targeting';
      };

      const sheetRows: Record<string, Array<{ bleeder: BleederRow; decision: string; cutPct: number }>> = {};
      result.bleeders.forEach((bleeder, idx) => {
        const decision = decisions[idx];
        if (!decision) return;
        const sheetName = getSheetName(bleeder);
        if (!sheetRows[sheetName]) sheetRows[sheetName] = [];
        sheetRows[sheetName].push({
          bleeder,
          decision,
          cutPct: cutBidPcts[idx] ?? 50,
        });
      });

      for (const [sheetName, rows] of Object.entries(sheetRows)) {
        const ws = wb.addWorksheet(sheetName);
        ws.addRow([
          'Campaign Name', 'Ad Group Name', 'Keyword Text',
          'Product Targeting Expression', 'Match Type', 'Bid',
          'Decision', 'Source',
          'Campaign Id', 'Ad Group Id', 'Keyword Id',
          'Product Targeting Id', 'Targeting Id',
        ]);
        rows.forEach(({ bleeder, decision, cutPct }) => {
          const isProductTargeting =
            bleeder.entity?.toLowerCase().includes('asin=') ||
            bleeder.entity?.toLowerCase().includes('category=');
          ws.addRow([
            bleeder.campaignName ?? '',
            bleeder.adGroupName ?? '',
            isProductTargeting ? '' : (bleeder.entity ?? ''),
            isProductTargeting ? (bleeder.entity ?? '') : '',
            bleeder.matchType ?? '',
            decision === 'Cut Bid'
              ? (bleeder.bid ?? bleeder.cpc ?? 0)
              : 0,
            decision,
            (bleeder as any).source ?? '',
            bleeder.campaignId ?? '',
            bleeder.adGroupId ?? '',
            bleeder.keywordId ?? '',
            bleeder.productTargetingId ?? '',
            bleeder.targetingId ?? '',
          ]);
        });
      }

      const buffer = await wb.xlsx.writeBuffer();
      const file = new File(
        [buffer],
        'inline_decisions.xlsx',
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      );
      const cutBidPctValues = Object.keys(decisions)
        .filter(k => decisions[Number(k)] === 'Cut Bid')
        .map(k => cutBidPcts[Number(k)] ?? 50);
      const dominantCutPct = cutBidPctValues.length > 0
        ? Math.round(
            cutBidPctValues.reduce((a, b) => a + b, 0) /
            cutBidPctValues.length
          )
        : 25;
      onUploadDecision(result.trackType, file, dominantCutPct);
      setGenerateDone(true);
      clearSession(sessionModule, sessionFileRef.current);
      setSavedSession(null);
    } catch (err) {
      console.error('[Generate] Failed:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!hasBleeders) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-success mb-2">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-[13px] font-medium font-display">No action needed — 0 bleeders found</span>
        </div>
        <p className="text-[13px] text-muted-foreground mb-4">
          {TRACK_LABELS[result.trackType]} returned no actionable rows under current thresholds.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onAdjustThresholds} className="text-[12px] btn-press">
            Adjust Thresholds
          </Button>
          <Button variant="outline" size="sm" onClick={() => onUploadNewFile(result.trackType)} className="text-[12px] btn-press">
            Upload New File
          </Button>
        </div>
      </div>
    );
  }

  // Decisions breakdown for completion view
  const breakdownCounts = (() => {
    const counts: Record<string, number> = {};
    Object.values(decisions).forEach(d => { if (d) counts[d] = (counts[d] ?? 0) + 1; });
    return counts;
  })();

  // Spend addressed vs. undecided — drives the impact donut
  const { addressedSpend, undecidedSpend } = (() => {
    let addressed = 0;
    let undecided = 0;
    result.bleeders.forEach((b, idx) => {
      const dec = decisions[idx];
      const spend = b.spend || 0;
      if (dec) addressed += spend;
      else undecided += spend;
    });
    return { addressedSpend: addressed, undecidedSpend: undecided };
  })();

  // ── Completion view (replaces full results page after generation) ──
  if (amazonFile && !showFullResults) {
    return (
      <CompletionView
        fileName={amazonFile.fileName}
        title="Workflow complete"
        impactHeadline={`$${result.totalSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })} in at-risk spend addressed`}
        impactSubtitle={`${TRACK_LABELS[result.trackType]} captured into your Amazon bulk file.`}
        totalRows={result.bleeders.length}
        summary={[
          { label: 'Bleeders found', value: result.bleeders.length.toLocaleString() },
          { label: 'Average ACoS', value: `${avgAcos.toFixed(1)}%` },
          { label: 'Decisions made', value: `${decisionsMade}/${result.bleeders.length}` },
          { label: 'Avg spend per bleeder', value: `$${(result.totalSpend / Math.max(result.bleeders.length, 1)).toFixed(2)}` },
          ...(acosThresholdLabel ? [{ label: 'ACoS threshold', value: acosThresholdLabel.replace(/\((SB\/SD)\)/, '$1').replace(/\((SP)\)/, '$1').replace(' / ', ' · ') }] : []),
        ]}
        breakdown={[
          { label: 'Paused', count: breakdownCounts['Pause'] ?? 0, color: '#EF4444' },
          { label: 'Cut Bid', count: breakdownCounts['Cut Bid'] ?? 0, color: '#F59E0B' },
          { label: 'Negative', count: breakdownCounts['Negative'] ?? 0, color: '#6366F1' },
          { label: 'Keep', count: breakdownCounts['Keep'] ?? 0, color: '#059669' },
          { label: 'No decision', count: Math.max(0, result.bleeders.length - decisionsMade), color: '#D1D5DB' },
        ]}
        onDownload={onDownloadAmazon}
        onStartNew={onStartNew}
        onViewFullResults={() => setShowFullResults(true)}
        accentColor="#0D9488"
        addressedSpend={addressedSpend}
        undecidedSpend={undecidedSpend}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Back to summary */}
      {amazonFile && showFullResults && (
        <button
          onClick={() => setShowFullResults(false)}
          className="text-[12.5px] text-[#4F6EF7] hover:underline btn-press"
        >
          ← Back to summary
        </button>
      )}

      {/* Mode toggle — Triage vs Review All (matches Bleeders 1.0) */}
      <div className="flex items-center justify-end">
        <div
          className="inline-flex items-center p-0.5 rounded-full border border-border bg-card"
          role="tablist"
          aria-label="View mode"
        >
          <button
            role="tab"
            aria-selected={viewMode === 'triage'}
            onClick={() => setViewMode('triage')}
            className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
              viewMode === 'triage' ? 'text-white shadow-sm' : 'text-[hsl(var(--text-secondary))] hover:text-foreground'
            }`}
            style={viewMode === 'triage' ? { background: '#0D9488' } : undefined}
          >
            <Zap className="w-3.5 h-3.5" /> Triage
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'review'}
            onClick={() => setViewMode('review')}
            className={`inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12.5px] font-medium transition-colors ${
              viewMode === 'review' ? 'text-white shadow-sm' : 'text-[hsl(var(--text-secondary))] hover:text-foreground'
            }`}
            style={viewMode === 'review' ? { background: '#0D9488' } : undefined}
          >
            <ListIcon className="w-3.5 h-3.5" /> Review All
          </button>
        </div>
      </div>

      {/* TRIAGE MODE — full-bleed one-card-at-a-time */}
      {viewMode === 'triage' && (() => {
        const items: TriageItem[] = result.bleeders.map((b, idx) => ({
          key: String(idx),
          sheet: TRACK_LABELS[result.trackType],
          campaign: b.campaignName || '—',
          adGroup: b.adGroupName || '',
          entity: b.entity || '—',
          matchType: b.matchType || undefined,
          clicks: b.clicks ?? 0,
          spend: b.spend ?? 0,
          sales: (b as any).sales ?? 0,
          acos: b.acos ? `${b.acos.toFixed(1)}%` : '',
          acosNum: b.acos ?? 0,
          orders: b.orders ?? 0,
        }));
        items.sort((a, b) => b.spend - a.spend);

        const triageDecisions: Record<string, string> = {};
        Object.entries(decisions).forEach(([k, v]) => { triageDecisions[String(k)] = v; });

        const decisionSpecsBySheet = (_sheet: string): TriageDecisionSpec[] => {
          const opts = getDecisionOptions();
          return opts.map((opt) => {
            if (opt === 'Pause') return { value: 'Pause', label: 'PAUSE', bg: '#EF4444', color: '#FFFFFF', shortcut: 'P', countsAsSavings: true };
            if (opt === 'Cut Bid') return { value: 'Cut Bid', label: 'CUT BID', bg: '#F59E0B', color: '#FFFFFF', shortcut: 'C', countsAsSavings: true };
            if (opt === 'Keep') return { value: 'Keep', label: 'KEEP', bg: '#059669', color: '#FFFFFF', shortcut: 'K', countsAsSavings: false };
            if (opt === 'Negative') return { value: 'Negative', label: 'NEGATIVE', bg: '#6366F1', color: '#FFFFFF', shortcut: 'N', countsAsSavings: true };
            return { value: opt, label: opt.toUpperCase(), bg: '#9CA3AF', color: '#FFFFFF', shortcut: opt[0].toUpperCase(), countsAsSavings: false };
          });
        };

        return (
          <TriageMode
            items={items}
            decisions={triageDecisions}
            decisionSpecsBySheet={decisionSpecsBySheet}
            onDecide={(key, val) => setDecisionWithFlash(Number(key), val)}
            onUndo={(key) => setDecisions(prev => { const n = { ...prev }; delete n[Number(key)]; return n; })}
            onGenerate={async () => {
              await handleGenerateInline();
              toast.success('Amazon file ready', {
                description: `${decisionsMade} decisions exported`,
                duration: 3000,
              });
            }}
            onSwitchToReview={() => setViewMode('review')}
            totalSpend={result.totalSpend}
            sheetsCount={1}
            addressedSavings={addressedSpend}
            shortSheetLabel={(s) => s}
          />
        );
      })()}

      {viewMode === 'review' && (<>

      {/* Compact stats + 4-step workflow — single unified container */}
      <CompactStatsBar
        accent="amber"
        stats={[
          { value: result.bleeders.length.toLocaleString(), label: 'bleeders' },
          { value: `$${result.totalSpend.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, label: 'at risk' },
          { value: `${avgAcos.toFixed(1)}%`, label: 'avg ACoS', danger: avgAcos > 100 },
        ]}
        steps={[
          { label: 'Thresholds set', status: 'complete' },
          { label: 'File analyzed', status: 'complete' },
          { label: 'Make decisions', status: (generateDone || amazonFile) ? 'complete' : 'active' },
          { label: 'Generate Amazon file', status: (generateDone || amazonFile) ? 'complete' : 'pending' },
        ]}
      />

      {/* Insights — Highest ACoS */}
      {topAcos.length > 0 && (
        <details className="group rounded-xl border border-border bg-card shadow-card overflow-hidden">
          <summary className="flex items-center justify-between px-5 py-3 cursor-pointer list-none select-none hover:bg-secondary/40 transition-colors">
            <div className="flex items-center gap-2">
              <ChevronDown className="w-3.5 h-3.5 text-[hsl(var(--text-tertiary))] transition-transform duration-200 group-open:rotate-180" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--text-secondary))]">
                Insights · Highest ACoS
              </span>
            </div>
            <span className="text-[11px] text-[hsl(var(--text-tertiary))]">
              Top {topAcos.length} ranked by ACoS
            </span>
          </summary>
          <div className="px-5 py-3 border-t border-border bg-secondary/30 flex items-center gap-5 flex-wrap">
            {topAcos.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold text-white"
                  style={{ backgroundColor: RANK_COLORS[i] ?? 'hsl(var(--text-tertiary))' }}
                >
                  {i + 1}
                </span>
                <span className="text-[12.5px] text-foreground max-w-[200px] truncate" title={b.entity}>
                  {b.entity || b.campaignName}
                </span>
                <span className="text-[12px] font-mono-nums text-destructive font-medium">
                  {b.acos.toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Spend distribution — collapsible visualization */}
      <SpendDistributionStrip
        items={result.bleeders.map((b) => ({
          label: b.entity || b.campaignName || 'Untitled',
          spend: b.spend || 0,
        }))}
      />

      {/* ─── Focus filter pills (matches Bleeders 1.0) ─── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium" style={{ color: '#9CA3AF' }}>
          {TRACK_LABELS[result.trackType]}:
        </span>
        {([
          { id: 'all', label: 'All', icon: '', count: focusMeta.all },
          { id: 'pause', label: 'Pause candidates', icon: '🔴', count: focusMeta.pause },
          { id: 'review', label: 'Needs review', icon: '🟡', count: focusMeta.review },
          { id: 'decided', label: 'Decided', icon: '✓', count: focusMeta.decided },
          { id: 'highspend', label: 'High spend', icon: '💰', count: focusMeta.highspend },
        ] as const).map(f => (
          <button
            key={f.id}
            onClick={() => setFocusFilter(f.id as FocusFilter)}
            className={`focus-pill ${focusFilter === f.id ? 'is-active' : ''}`}
          >
            {f.icon && <span aria-hidden>{f.icon}</span>}
            {f.label}
            <span className="count">· {f.count}</span>
          </button>
        ))}
      </div>

      {/* Decision table */}
      <div className="decision-table-card">

        {/* ─── Contextual amber callout for SP Search Terms ─── */}
        {isSearchTermSheet && (
          <div
            className="px-4 py-2.5 border-b flex items-start gap-2"
            style={{ background: '#FFFBEB', borderBottomColor: '#FDE68A', borderLeft: '3px solid #F59E0B' }}
          >
            <Info className="w-4 h-4 mt-px flex-shrink-0" style={{ color: '#F59E0B' }} />
            <p className="text-[12.5px]" style={{ color: '#92400E' }}>
              <strong>Pause</strong> on search terms auto-converts to <strong>Negate (Exact)</strong> when generating the Amazon file.
            </p>
          </div>
        )}

        {/* Bulk action buttons */}
        <div className="decision-table-bar flex items-center justify-between gap-2 px-4 py-2.5">
          <div className="text-[12px] text-[hsl(var(--text-secondary))] truncate">
            <span className="font-medium text-foreground">{TRACK_LABELS[result.trackType]}</span>
            <span className="mx-1.5 text-[hsl(var(--text-tertiary))]">·</span>
            <span className="font-mono-nums">{result.bleeders.length}</span> bleeders
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                const allSuggested: Record<number, string> = {};
                suggestions.forEach((s, idx) => { allSuggested[idx] = s.decision; });
                setDecisions(allSuggested);
                setCutBidPcts({});
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold text-white btn-press"
              style={{ background: "#0D9488" }}
            >
              <Sparkles className="w-3 h-3" />
              Apply recommendations
            </button>
            {getDecisionOptions().includes('Cut Bid') && (
              <button onClick={handleSetAllCutBid} className="bulk-btn btn-press">
                <span className="decision-dot" style={{ background: '#F59E0B' }} />
                Select all → Cut Bid
              </button>
            )}
            {getDecisionOptions().includes('Keep') && (
              <button onClick={handleSetAllKeep} className="bulk-btn btn-press">
                <span className="decision-dot" style={{ background: '#10B981' }} />
                Select all → Keep
              </button>
            )}
            <button onClick={handleClearAll} className="bulk-btn bulk-btn-ghost btn-press">
              <XCircle className="w-3 h-3" />
              Clear
            </button>
          </div>
        </div>

        {/* Table — scrollable with sticky thead, pinned footer below */}
        <div className="max-h-[58vh] overflow-auto table-sticky-header decision-table">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-b border-border">
                <TableHead style={{ letterSpacing: '0.08em' }}>
                  <SortHeader active={sortKey === 'campaign'} dir={sortDir} onClick={() => toggleSort('campaign')}>Campaign</SortHeader>
                </TableHead>
                {showAdGroup && (
                  <TableHead style={{ letterSpacing: '0.08em' }}>
                    <SortHeader active={sortKey === 'adGroup'} dir={sortDir} onClick={() => toggleSort('adGroup')}>Ad Group</SortHeader>
                  </TableHead>
                )}
                <TableHead style={{ letterSpacing: '0.08em' }}>
                  <SortHeader active={sortKey === 'entity'} dir={sortDir} onClick={() => toggleSort('entity')}>
                    {result.trackType === 'SP' ? 'Search Term' : 'Entity'}
                  </SortHeader>
                </TableHead>
                <TableHead style={{ letterSpacing: '0.08em' }}>Match</TableHead>
                <TableHead className="text-right" style={{ letterSpacing: '0.08em' }}>Clicks</TableHead>
                <TableHead className="text-right" style={{ letterSpacing: '0.08em' }}>
                  <SortHeader active={sortKey === 'spend'} dir={sortDir} onClick={() => toggleSort('spend')} align="right">Spend</SortHeader>
                </TableHead>
                {result.trackType !== 'ACOS100' && (
                  <TableHead className="text-right" style={{ letterSpacing: '0.08em' }}>
                    <SortHeader active={sortKey === 'orders'} dir={sortDir} onClick={() => toggleSort('orders')} align="right">Orders</SortHeader>
                  </TableHead>
                )}
                <TableHead className="text-right" style={{ letterSpacing: '0.08em' }}>
                  <SortHeader active={sortKey === 'acos'} dir={sortDir} onClick={() => toggleSort('acos')} align="right">ACoS</SortHeader>
                </TableHead>
                <TableHead className="w-[80px]" style={{ letterSpacing: '0.08em' }}>Suggestion</TableHead>
                <TableHead style={{ width: 170, letterSpacing: '0.08em', position: 'sticky', right: 0, zIndex: 7, background: '#F9FAFB', boxShadow: '-1px 0 0 #E5E7EB' }}>Decision</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSortedIndices.map((idx) => {
                const bleeder = result.bleeders[idx];
                const suggestion = suggestions[idx];
                const decision = decisions[idx];
                const indicatorClass = decisionRowClass(decision);
                const isKeep = suggestion.shortLabel?.toLowerCase().includes('keep');
                const sugStyle = isKeep
                  ? { background: 'rgba(16, 185, 129, 0.10)', color: '#047857', border: '1px solid rgba(16, 185, 129, 0.25)' }
                  : { background: 'rgba(245, 158, 11, 0.10)', color: '#B45309', border: '1px solid rgba(245, 158, 11, 0.25)' };
                const acosVal = bleeder.acos;
                const aboveThreshold = acosVal >= (result.acosThreshold ?? 0);
                const acosBg = aboveThreshold ? '#EF4444' : '#F59E0B';

                const isHighUrgency = !decision && bleeder.spend >= urgencyBands.high && bleeder.spend > 0;
                const isLowUrgency = !decision && bleeder.spend <= urgencyBands.low;
                const urgencyClass = decision
                  ? ''
                  : isHighUrgency ? 'row-urgency-high' : isLowUrgency ? 'row-urgency-low' : '';
                const flashClass =
                  flashIdx && flashIdx.idx === idx && Date.now() - flashIdx.ts < 400 ? flashIdx.cls : '';

                const isPanelSelected = selectedIdx === idx;

                return (
                  <TableRow
                    key={`${idx}-${flashIdx?.idx === idx ? flashIdx.ts : 'r'}`}
                    onClick={() => { setSelectedIdx(idx); setPanelComplete(false); }}
                    className={`cursor-pointer transition-colors ${urgencyClass} ${indicatorClass} ${flashClass} ${isPanelSelected ? 'row-detail-selected' : ''}`}
                  >
                    <TableCell className="text-[13px] max-w-[180px] truncate" title={bleeder.campaignName}>
                      {bleeder.campaignName}
                    </TableCell>
                    {showAdGroup && (
                      <TableCell className="text-[13px] max-w-[120px] truncate text-[hsl(var(--text-secondary))]" title={bleeder.adGroupName}>
                        {bleeder.adGroupName || '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-[13px] max-w-[180px] truncate" title={bleeder.entity}>
                      {bleeder.entity}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">
                      {bleeder.matchType || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-[13px] font-mono-nums text-foreground">
                        {(bleeder.clicks ?? 0).toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-[13px] font-mono-nums text-foreground">
                        ${bleeder.spend.toFixed(2)}
                      </span>
                    </TableCell>
                    {result.trackType !== 'ACOS100' && (
                      <TableCell className="text-right">
                        <span className="text-[13px] font-mono-nums">
                          {bleeder.orders}
                        </span>
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      {acosVal > 0 ? (
                        <span
                          className="inline-block text-[11px] font-mono-nums px-2 py-0.5 rounded-full font-medium text-white"
                          style={{ background: acosBg }}
                        >
                          {acosVal.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-[13px] text-[#D1D5DB]">—</span>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => setDecisionWithFlash(idx, suggestion.decision)}
                        title={suggestion.reason}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium cursor-pointer transition-all hover:opacity-80"
                        style={{ ...sugStyle, opacity: decision ? 0.45 : 1 }}
                      >
                        {suggestion.shortLabel}
                      </button>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()} style={{ width: 210, position: 'sticky', right: 0, zIndex: 4, background: 'var(--card)', boxShadow: '-1px 0 0 #E5E7EB' }}>
                      <div className="flex items-center gap-1 min-w-0">
                        <div className="flex-shrink-0">
                          <DecisionSelect
                            value={decision}
                            onChange={(val) => setDecisionWithFlash(idx, val)}
                            options={getDecisionOptions()}
                            placeholder="Decide..."
                            width="110px"
                          />
                        </div>
                        {decisions[idx] === 'Cut Bid' && (
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <input
                              type="number"
                              min={1}
                              max={99}
                              className="h-7 text-[12px] rounded border border-border font-mono text-center no-spinner"
                              style={{ width: 44, padding: '0 4px' }}
                              value={cutBidPcts[idx] ?? 50}
                              onChange={(e) => setCutBidPcts(prev => ({ ...prev, [idx]: parseInt(e.target.value) || 50 }))}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <span className="text-[11px]" style={{ color: '#9CA3AF' }}>%</span>
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

        {/* Pinned action bar */}
        <div className="decision-table-footer p-4 space-y-2">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              {decisionsMade >= result.bleeders.length && result.bleeders.length > 0 ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold font-mono-nums" style={{ color: '#10B981' }}>
                    All {result.bleeders.length} decisions complete
                  </span>
                  <CheckCircle2 className="w-4 h-4" style={{ color: '#10B981' }} />
                </div>
              ) : (
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-semibold text-foreground font-mono-nums">
                    {decisionsMade}<span className="text-[hsl(var(--text-tertiary))]">/{result.bleeders.length}</span>
                  </span>
                  <span className="text-[12px] text-[hsl(var(--text-secondary))]">decisions</span>
                </div>
              )}
              <div className="mt-2">
                <DecisionProgressBar
                  total={result.bleeders.length}
                  segments={[
                    { key: 'Pause', count: Object.values(decisions).filter(d => d === 'Pause').length, color: '#EF4444' },
                    { key: 'Cut', count: Object.values(decisions).filter(d => d === 'Cut Bid').length, color: '#F59E0B' },
                    { key: 'Negative', count: Object.values(decisions).filter(d => d === 'Negative').length, color: '#4F6EF7' },
                    { key: 'Keep', count: Object.values(decisions).filter(d => d === 'Keep').length, color: '#10B981' },
                  ]}
                />
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button variant="outline" size="sm" onClick={onDownload} className="text-[11px] h-9 btn-press">
                <Download className="w-3 h-3 mr-1" />
                Download XLSX
              </Button>
              <button
                onClick={async () => {
                  await handleGenerateInline();
                  toast.success('Amazon file ready', {
                    description: `${decisionsMade} decisions exported`,
                    duration: 3000,
                  });
                }}
                disabled={decisionsMade === 0 || isGenerating || !!amazonFile}
                className={`btn-primary-action btn-press ${(generateDone || amazonFile) ? 'is-done' : ''} ${decisionsMade >= result.bleeders.length && result.bleeders.length > 0 && !generateDone && !amazonFile ? 'is-ready' : ''}`}
              >
                {isGenerating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (generateDone || amazonFile) ? (
                  <><CheckCircle2 className="w-4 h-4" /> Downloaded ✓</>
                ) : (
                  <>Generate Amazon file →</>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced — collapsed manual upload */}
      <details className="group">
        <summary className="list-none select-none cursor-pointer inline-flex items-center gap-1.5 text-[12px] text-[hsl(var(--text-secondary))] hover:text-foreground transition-colors">
          <ChevronDown className="w-3 h-3 transition-transform duration-200 group-open:rotate-180" />
          Or upload a decision file manually
        </summary>
        <div className="mt-3 max-w-[480px]">
          <DecisionFileDropzone
            onFileUpload={(file) => onUploadDecision(result.trackType, file)}
            disabled={!!amazonFile}
            label={decisionFile ? 'Reupload Decision File' : 'Upload Decision File'}
            variant="compact"
          />
        </div>
      </details>

      </>)}

      {/* Master/detail side panel */}
      {(() => {
        const idx = selectedIdx;
        const bleeder = idx != null ? result.bleeders[idx] : null;
        const decision = idx != null ? decisions[idx] : undefined;

        const opts = getDecisionOptions();
        const buttonSpecs: DecisionButtonSpec[] = opts.map((opt) => {
          if (opt === 'Pause')    return { value: 'Pause',    label: 'Pause',    bg: 'rgba(239, 68, 68, 0.10)', color: '#B91C1C', border: 'rgba(239, 68, 68, 0.20)', hoverBg: 'rgba(239, 68, 68, 0.20)' };
          if (opt === 'Cut Bid')  return { value: 'Cut Bid',  label: 'Cut Bid',  bg: 'rgba(245, 158, 11, 0.10)', color: '#B45309', border: 'rgba(245, 158, 11, 0.20)', hoverBg: 'rgba(245, 158, 11, 0.20)' };
          if (opt === 'Keep')     return { value: 'Keep',     label: 'Keep',     bg: 'rgba(16, 185, 129, 0.10)', color: '#047857', border: 'rgba(16, 185, 129, 0.20)', hoverBg: 'rgba(16, 185, 129, 0.20)' };
          if (opt === 'Negative') return { value: 'Negative', label: 'Negative', bg: 'rgba(99, 102, 241, 0.10)', color: '#4338CA', border: 'rgba(99, 102, 241, 0.20)', hoverBg: 'rgba(99, 102, 241, 0.20)' };
          return { value: opt, label: opt, bg: '#F3F4F6', color: '#111827', border: '#E5E7EB', hoverBg: '#E5E7EB' };
        });

        const detail: RowDetail | null = bleeder && idx != null ? (() => {
          const sug = suggestions[idx];
          const isHighSpend = bleeder.spend >= urgencyBands.high && bleeder.spend > 0;
          const cpc = (bleeder.clicks && bleeder.clicks > 0) ? bleeder.spend / bleeder.clicks : 0;
          const aboveAcosThreshold = bleeder.acos >= (result.acosThreshold ?? 0);
          // Inline rationale — uses orders + ACoS + threshold context
          const rationale =
            result.trackType === 'ACOS100'
              ? `${bleeder.acos.toFixed(1)}% ACoS — well above your ${(result.acosThreshold ?? 100).toFixed(0)}% threshold`
              : (bleeder.orders ?? 0) === 0
                ? `0 orders at $${bleeder.spend.toFixed(2)} spend — strong negative signal`
                : `${bleeder.orders} order(s) at ${bleeder.acos.toFixed(1)}% ACoS — ${aboveAcosThreshold ? `above your ${(result.acosThreshold ?? 0).toFixed(0)}% threshold` : 'borderline performance'}`;

          const metrics: RowDetail['metrics'] = [
            { label: 'Clicks', value: (bleeder.clicks ?? 0).toLocaleString() },
            { label: 'Spend', value: `$${bleeder.spend.toFixed(2)}`, color: isHighSpend ? '#EF4444' : undefined },
          ];
          if (result.trackType !== 'ACOS100') {
            metrics.push({ label: 'Orders', value: String(bleeder.orders ?? 0) });
          }
          metrics.push(
            bleeder.acos > 0
              ? { label: 'ACoS', value: `${bleeder.acos.toFixed(1)}%`, pill: true, pillBg: aboveAcosThreshold ? '#EF4444' : '#F59E0B' }
              : { label: 'ACoS', value: '—' },
            { label: 'CPC', value: cpc > 0 ? `$${cpc.toFixed(2)}` : '—' },
          );

          return {
            key: idx,
            campaign: bleeder.campaignName || '—',
            adGroup: showAdGroup ? (bleeder.adGroupName || undefined) : undefined,
            entity: bleeder.entity || '—',
            matchType: bleeder.matchType || undefined,
            metrics,
            suggestion: {
              label: sug.shortLabel,
              bg: 'rgba(245, 158, 11, 0.10)',
              color: '#B45309',
              border: 'rgba(245, 158, 11, 0.25)',
            },
            rationale: sug.reason || rationale,
          };
        })() : null;

        const moveTo = (delta: number) => {
          if (idx == null || sortedIndices.length === 0) return;
          const pos = sortedIndices.indexOf(idx);
          if (pos === -1) return;
          const next = (pos + delta + sortedIndices.length) % sortedIndices.length;
          setSelectedIdx(sortedIndices[next]);
          setPanelComplete(false);
        };

        const advanceToNextUndecided = () => {
          if (idx == null) { setPanelComplete(true); return; }
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
            onClose={() => { setSelectedIdx(null); setPanelComplete(false); }}
            onPrev={() => moveTo(-1)}
            onNext={() => moveTo(1)}
            onGenerate={async () => {
              setSelectedIdx(null);
              setPanelComplete(false);
              await handleGenerateInline();
              toast.success('Amazon file ready', {
                description: `${decisionsMade} decisions exported`,
                duration: 3000,
              });
            }}
          />
        );
      })()}
    </div>
  );
};

function StatCellV2({ icon, value, label, danger }: { icon: React.ReactNode; value: string; label: string; danger?: boolean }) {
  return (
    <div className="px-5 py-4">
      <div className="flex items-center gap-1.5 text-[hsl(var(--text-tertiary))] mb-1.5">
        {icon}
        <span className="text-[11px] font-semibold uppercase" style={{ letterSpacing: '0.08em' }}>{label}</span>
      </div>
      <div className={`text-[28px] font-semibold leading-none font-mono-nums tracking-tight ${danger ? 'text-destructive' : 'text-foreground'}`}>
        {value}
      </div>
    </div>
  );
}

