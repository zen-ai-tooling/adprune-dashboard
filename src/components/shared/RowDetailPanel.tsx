/**
 * RowDetailPanel — master/detail side panel for the decision tables.
 *
 * Generic across Bleeders 1.0, Bleeders 2.0 (all tracks), and Lifetime Audit.
 * The parent passes a normalized `RowDetail` for the currently selected row
 * plus the available decision options. The panel handles its own keyboard
 * shortcuts, "Decision saved" flash, and auto-advance.
 *
 * UX-only — no business logic. Decisions are saved through the parent's
 * existing setDecision() / dropdown handler. The Action dropdown still works.
 */

import * as React from 'react';
import { X, CheckCircle2, ArrowRight } from 'lucide-react';

export interface RowDetailMetric {
  label: string;
  value: string;
  /** Optional accent color (e.g. red for top-25% spend). */
  color?: string;
  /** Optional pill background — used for the ACoS pill. */
  pillBg?: string;
  /** Optional pill text color (white on the pill). */
  pillColor?: string;
  /** When true the value is rendered inside a pill matching the table's ACoS treatment. */
  pill?: boolean;
}

export interface RowDetail {
  /** Stable identifier for this row in the parent's decision map. */
  key: string | number;
  campaign: string;
  adGroup?: string;
  entity: string;
  matchType?: string;
  /** Pre-formatted metric cards (Clicks / Spend / Sales / ACoS / Orders / CPC …). */
  metrics: RowDetailMetric[];
  /** Suggestion pill content. */
  suggestion?: {
    label: string;
    bg: string;
    color: string;
    border: string;
  };
  /** Italic one-line rationale beneath the suggestion pill. */
  rationale?: string;
}

export interface DecisionButtonSpec {
  /** The exact decision string to write (matches what the dropdown saves). */
  value: string;
  /** Display label on the big button (e.g. "Pause", "Cut Bid 50%"). */
  label: string;
  bg: string;
  color: string;
  border: string;
  hoverBg: string;
}

interface RowDetailPanelProps {
  open: boolean;
  detail: RowDetail | null;
  /** Currently saved decision for this row, if any. */
  currentDecision?: string;
  /** Decision buttons in the order they should be stacked. */
  buttons: DecisionButtonSpec[];
  onSelectDecision: (value: string) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** True when no undecided rows remain — switches the panel to a completion message. */
  allComplete?: boolean;
  /** Called when the user clicks "Generate Amazon file →" from the all-complete state. */
  onGenerate?: () => void;
}

/** Map number keys 1..N → button spec for keyboard shortcuts. */
function useKeyboardShortcuts(
  open: boolean,
  buttons: DecisionButtonSpec[],
  onSelectDecision: (v: string) => void,
  onClose: () => void,
  onPrev: () => void,
  onNext: () => void,
) {
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in inputs / selects
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;

      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); onNext(); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); onPrev(); return; }

      const numIdx = parseInt(e.key, 10);
      if (Number.isFinite(numIdx) && numIdx >= 1 && numIdx <= buttons.length) {
        e.preventDefault();
        onSelectDecision(buttons[numIdx - 1].value);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, buttons, onSelectDecision, onClose, onPrev, onNext]);
}

export const RowDetailPanel: React.FC<RowDetailPanelProps> = ({
  open, detail, currentDecision, buttons, onSelectDecision,
  onClose, onPrev, onNext, allComplete, onGenerate,
}) => {
  // Track narrow viewport for overlay-vs-shift behavior
  const [isNarrow, setIsNarrow] = React.useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth < 1200 : false,
  );
  React.useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1200);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Toggle the body class that shifts the main content area on wide viewports.
  React.useEffect(() => {
    if (!open) return;
    if (isNarrow) {
      document.body.classList.remove('row-panel-open');
    } else {
      document.body.classList.add('row-panel-open');
    }
    document.body.dataset.rowDetailOpen = 'true';
    return () => {
      document.body.classList.remove('row-panel-open');
      delete document.body.dataset.rowDetailOpen;
    };
  }, [open, isNarrow]);

  // Brief "Decision saved" confirmation state.
  const [savedFlash, setSavedFlash] = React.useState(false);
  // Fade-out → fade-in when the detail key changes (auto-advance).
  const [contentVisible, setContentVisible] = React.useState(true);
  const lastKeyRef = React.useRef<string | number | null>(null);

  React.useEffect(() => {
    if (!detail) { lastKeyRef.current = null; return; }
    if (lastKeyRef.current !== null && lastKeyRef.current !== detail.key) {
      setContentVisible(false);
      const id = window.setTimeout(() => setContentVisible(true), 150);
      return () => window.clearTimeout(id);
    }
    lastKeyRef.current = detail.key;
  }, [detail?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDecision = React.useCallback((value: string) => {
    onSelectDecision(value);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 500);
  }, [onSelectDecision]);

  useKeyboardShortcuts(open, buttons, handleDecision, onClose, onPrev, onNext);

  if (!open) return null;

  return (
    <>
      {/* Mobile/narrow backdrop */}
      {isNarrow && (
        <div
          className="row-panel-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        role="dialog"
        aria-label="Bleeder detail"
        className={`row-detail-panel ${isNarrow ? 'is-overlay' : 'is-docked'}`}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="row-panel-close"
          aria-label="Close detail panel"
        >
          <X className="w-4 h-4" />
        </button>

        {allComplete ? (
          <div className="row-panel-complete">
            <CheckCircle2 className="w-12 h-12" style={{ color: '#10B981' }} />
            <h3 className="text-[16px] font-semibold text-[#111827] mt-3">
              All decisions complete
            </h3>
            <p className="text-[13px] text-[#374151] mt-1.5 text-center max-w-[280px]">
              You've reviewed every bleeder. Generate the Amazon bulk file to download your changes.
            </p>
            <div className="flex flex-col gap-2 w-full mt-5">
              {onGenerate && (
                <button
                  type="button"
                  onClick={onGenerate}
                  className="row-panel-decision-btn"
                  style={{
                    background: '#4F6EF7',
                    color: '#FFFFFF',
                    border: '1px solid #4F6EF7',
                  }}
                >
                  Generate Amazon file <ArrowRight className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="row-panel-decision-btn"
                style={{
                  background: '#FFFFFF',
                  color: '#111827',
                  border: '1px solid #E5E7EB',
                }}
              >
                Close panel
              </button>
            </div>
          </div>
        ) : detail ? (
          <div
            className="row-panel-body"
            style={{ opacity: contentVisible ? 1 : 0, transition: 'opacity 150ms ease' }}
          >
            {/* Header */}
            <div className="row-panel-header">
              <div className="text-[16px] font-semibold text-[#111827] leading-[1.3]">
                {detail.campaign || '—'}
              </div>
              {detail.adGroup && (
                <div className="text-[13px] text-[#374151] mt-1">{detail.adGroup}</div>
              )}
              <div className="mt-3 flex items-start gap-2 flex-wrap">
                <span className="row-panel-entity-pill">{detail.entity || '—'}</span>
                {detail.matchType && (
                  <span className="row-panel-match-badge">{detail.matchType}</span>
                )}
              </div>
            </div>

            {/* Metrics grid */}
            <div className="row-panel-metrics">
              {detail.metrics.map((m, i) => (
                <div key={i} className="row-panel-metric">
                  <div className="row-panel-metric-label">{m.label}</div>
                  {m.pill ? (
                    <span
                      className="inline-block text-[12px] font-mono-nums px-2.5 py-1 rounded-full font-medium text-white"
                      style={{ background: m.pillBg ?? '#9CA3AF' }}
                    >
                      {m.value}
                    </span>
                  ) : (
                    <div
                      className="row-panel-metric-value"
                      style={m.color ? { color: m.color } : undefined}
                    >
                      {m.value}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Suggestion + rationale */}
            {detail.suggestion && (
              <div className="row-panel-suggestion">
                <span
                  className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    background: detail.suggestion.bg,
                    color: detail.suggestion.color,
                    border: `1px solid ${detail.suggestion.border}`,
                  }}
                >
                  Suggestion: {detail.suggestion.label}
                </span>
                {detail.rationale && (
                  <p className="row-panel-rationale">{detail.rationale}</p>
                )}
              </div>
            )}

            {/* Decision buttons */}
            <div className="row-panel-decisions">
              {buttons.map((btn, idx) => {
                const isSelected = currentDecision === btn.value;
                return (
                  <button
                    key={btn.value}
                    type="button"
                    onClick={() => handleDecision(btn.value)}
                    className="row-panel-decision-btn btn-press"
                    style={{
                      background: isSelected ? btn.hoverBg : btn.bg,
                      color: btn.color,
                      border: `1px solid ${btn.border}`,
                      fontWeight: isSelected ? 700 : 600,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = btn.hoverBg; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = isSelected ? btn.hoverBg : btn.bg; }}
                  >
                    {isSelected && <CheckCircle2 className="w-4 h-4" />}
                    {btn.label}
                    <span className="row-panel-decision-key">{idx + 1}</span>
                  </button>
                );
              })}
            </div>

            {/* Saved flash overlay */}
            {savedFlash && (
              <div className="row-panel-saved-flash">
                <CheckCircle2 className="w-4 h-4" />
                Decision saved
              </div>
            )}

            {/* Keyboard hint */}
            <div className="row-panel-hint">
              ↑↓ navigate · 1{buttons.length > 1 ? `–${buttons.length}` : ''} decide · Esc close
            </div>
          </div>
        ) : null}
      </aside>
    </>
  );
};
