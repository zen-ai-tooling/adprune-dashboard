import * as React from 'react';
import { CheckCircle2, Download, ArrowRight } from 'lucide-react';

const EMAIL_CAPTURE_WEBHOOK_URL = "REPLACE_ME";
const EMAIL_CAPTURE_SESSION_KEY = "adprune_completion_email_capture";

const isValidEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());


export interface CompletionSummaryItem {
  label: string;
  value: string;
}

export interface DecisionBreakdownItem {
  label: string;
  count: number;
  color: string; // hex
}

interface CompletionViewProps {
  fileName: string;
  title?: string;
  summary: CompletionSummaryItem[];
  breakdown: DecisionBreakdownItem[];
  onDownload?: () => void;
  onStartNew?: () => void;
  onViewFullResults?: () => void;
  /** module accent color (kept for back-compat — no longer used as top border) */
  accentColor?: string;
  /** Headline number (e.g. "$1,026 protected") — rendered as hero */
  impactHeadline?: string;
  impactSubtitle?: string;
  totalRows?: number;
  addressedSpend?: number;
  undecidedSpend?: number;
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const CompletionView: React.FC<CompletionViewProps> = ({
  fileName,
  summary,
  breakdown,
  onDownload,
  onStartNew,
  onViewFullResults,
  impactHeadline,
  impactSubtitle,
  totalRows,
}) => {
  const [showRecap, setShowRecap] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setShowRecap(true), 400);
    return () => clearTimeout(t);
  }, []);
  const findCount = (re: RegExp) =>
    breakdown.filter((b) => re.test(b.label)).reduce((s, b) => s + b.count, 0);
  const pausedCount = findCount(/^paused?$/i);
  const negativesCount = findCount(/negat/i);
  const cutBidCount = findCount(/cut\s*bid/i);
  const decidedTotal = breakdown
    .filter((b) => !/no decision|undecided/i.test(b.label))
    .reduce((s, b) => s + b.count, 0);
  const total = totalRows ?? breakdown.reduce((s, b) => s + b.count, 0);
  const noDecisionItem = breakdown.find((b) => /no decision|undecided/i.test(b.label));
  const noCount = noDecisionItem?.count ?? 0;

  // Try to extract sheets count from the summary list for the subtitle copy
  const sheetsItem = summary.find((s) => /sheet/i.test(s.label));
  const sheetsCount = sheetsItem ? sheetsItem.value : null;

  const subtitle =
    impactSubtitle ??
    `You addressed ${decidedTotal} bleeder${decidedTotal === 1 ? '' : 's'}${
      sheetsCount ? ` across ${sheetsCount} sheets` : ''
    }. Your Amazon bulk file is ready.`;

  return (
    <div
      className="flex flex-col items-center px-4 py-12"
      style={{ minHeight: 'calc(100vh - 52px)', background: '#F9FAFB' }}
    >
      <style>{`
        @keyframes cv-hero-pop { 0% { transform: scale(0.8); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
        @keyframes cv-fade-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div className="w-full" style={{ maxWidth: 900 }}>
        {/* ── Hero ── */}
        <div className="text-center">
          <div
            className="relative w-[72px] h-[72px] rounded-full flex items-center justify-center mx-auto"
            style={{
              background: '#059669',
              animation: 'cv-hero-pop 300ms ease-out both',
            }}
          >
            <CheckCircle2 className="w-10 h-10 text-white" strokeWidth={2.4} />
          </div>

          {impactHeadline && (
            <h1
              className="mt-7"
              style={{
                fontSize: 42,
                fontWeight: 800,
                color: '#111827',
                letterSpacing: '-0.03em',
                lineHeight: 1.05,
                fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
                animation: 'cv-fade-in 250ms ease-out 200ms both',
              }}
            >
              {impactHeadline}
            </h1>
          )}

          <p
            className="mx-auto mt-4"
            style={{
              fontSize: 15,
              color: '#6B7280',
              lineHeight: 1.6,
              maxWidth: 400,
              animation: 'cv-fade-in 250ms ease-out 300ms both',
            }}
          >
            {subtitle}
          </p>

          <div
            className="flex items-center justify-center mt-7"
            style={{ gap: 12, animation: 'cv-fade-in 250ms ease-out 400ms both' }}
          >
            {onDownload && (
              <button
                onClick={onDownload}
                className="rounded-[10px] btn-press inline-flex items-center gap-1.5"
                style={{
                  background: '#059669',
                  color: '#FFFFFF',
                  border: '1px solid #059669',
                  padding: '12px 22px',
                  fontSize: 14,
                  fontWeight: 600,
                  boxShadow: '0 1px 2px rgba(5,150,105,0.15)',
                }}
              >
                <Download className="w-4 h-4" />
                Download file
              </button>
            )}
            {onStartNew && (
              <button
                onClick={onStartNew}
                className="rounded-[10px] btn-press inline-flex items-center gap-1.5"
                style={{
                  background: '#FFFFFF',
                  color: '#374151',
                  border: '1px solid #E5E7EB',
                  padding: '12px 22px',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Start new session
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>

          <p
            className="mt-3 truncate"
            title={fileName}
            style={{
              fontSize: 11,
              color: '#9CA3AF',
              animation: 'cv-fade-in 250ms ease-out 500ms both',
            }}
          >
            {truncate(fileName, 40)}
          </p>

          {showRecap && (
            <div
              className="mt-6 mx-auto rounded-xl p-4 animate-fade-in text-left"
              style={{
                background: '#F9FAFB',
                border: '1px solid #E5E7EB',
                maxWidth: 420,
              }}
            >
              <p
                className="text-[11px] font-semibold uppercase tracking-wide mb-3"
                style={{ color: '#9CA3AF' }}
              >
                Session summary
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Paused', value: pausedCount, color: '#EF4444' },
                  { label: 'Negated', value: negativesCount, color: '#6366F1' },
                  { label: 'Bid cut', value: cutBidCount, color: '#F59E0B' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center">
                    <div className="text-[22px] font-bold tabular-nums" style={{ color }}>
                      {value}
                    </div>
                    <div className="text-[11px] mt-0.5" style={{ color: '#9CA3AF' }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Two-column layout ── */}
        <div
          className="mt-10 grid"
          style={{
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            animation: 'cv-fade-in 300ms ease-out 600ms both',
          }}
        >
          {/* LEFT — Session summary */}
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#9CA3AF',
                marginBottom: 18,
              }}
            >
              Session summary
            </h3>

            <div className="grid grid-cols-2" style={{ gap: '14px 24px' }}>
              {summary.map((s) => (
                <div key={s.label} className="flex flex-col">
                  <span style={{ fontSize: 12, color: '#9CA3AF' }}>{s.label}</span>
                  <span
                    className="tabular-nums"
                    style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginTop: 2, letterSpacing: '-0.01em' }}
                  >
                    {s.value}
                  </span>
                </div>
              ))}
            </div>

            {breakdown.length > 0 && (
              <>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: '#9CA3AF',
                    marginTop: 22,
                    marginBottom: 8,
                  }}
                >
                  Decisions breakdown
                </div>

                {/* Bar */}
                <div
                  className="flex w-full overflow-hidden"
                  style={{ height: 10, borderRadius: 999, background: '#F3F4F6', gap: 1 }}
                >
                  {breakdown.map((b) => {
                    const pct = total > 0 ? (b.count / total) * 100 : 0;
                    if (pct === 0) return null;
                    const isUndecided = /no decision|undecided/i.test(b.label);
                    return (
                      <div
                        key={b.label}
                        style={{
                          width: `${pct}%`,
                          background: isUndecided ? '#E5E7EB' : b.color,
                          transition: 'width 320ms ease',
                        }}
                        title={`${b.label}: ${b.count} (${pct.toFixed(0)}%)`}
                      />
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center" style={{ gap: '6px 12px', marginTop: 12 }}>
                  {breakdown.map((b, i) => {
                    const isUndecided = /no decision|undecided/i.test(b.label);
                    const pct = total > 0 ? (b.count / total) * 100 : 0;
                    return (
                      <React.Fragment key={b.label}>
                        {i > 0 && <span style={{ color: '#D1D5DB', fontSize: 12 }}>·</span>}
                        <span className="inline-flex items-center" style={{ gap: 5, fontSize: 12 }}>
                          <span
                            className="rounded-full"
                            style={{
                              width: 7,
                              height: 7,
                              background: isUndecided ? 'transparent' : b.color,
                              border: isUndecided ? '1px solid #D1D5DB' : 'none',
                            }}
                          />
                          <span style={{ color: isUndecided ? '#9CA3AF' : '#374151' }}>{b.label}</span>
                          <span className="tabular-nums" style={{ fontWeight: 600, color: '#111827' }}>
                            {b.count}
                          </span>
                          {!isUndecided && b.count > 0 && pct > 0 && (
                            <span className="tabular-nums" style={{ color: '#9CA3AF' }}>
                              ({pct.toFixed(0)}%)
                            </span>
                          )}
                        </span>
                      </React.Fragment>
                    );
                  })}
                </div>

                {noCount > 0 && (
                  <p
                    className="italic"
                    style={{ fontSize: 12, color: '#9CA3AF', marginTop: 12 }}
                  >
                    {noCount === 1
                      ? '1 target kept at current state'
                      : `${noCount} targets kept at current state`}
                  </p>
                )}
              </>
            )}
          </div>

          {/* RIGHT — What's next */}
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E5E7EB',
              borderRadius: 12,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <h3
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#9CA3AF',
                marginBottom: 18,
              }}
            >
              What's next
            </h3>

            <div className="flex items-start" style={{ gap: 12 }}>
              <div
                className="flex-shrink-0 rounded-full flex items-center justify-center tabular-nums"
                style={{
                  width: 24,
                  height: 24,
                  background: '#0D9488',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 700,
                  marginTop: 1,
                }}
              >
                1
              </div>
              <div className="min-w-0 flex-1">
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
                  Upload to Campaign Manager
                </div>
                <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4, lineHeight: 1.5 }}>
                  Your file is ready to import back into Amazon Ads.
                </p>
              </div>
            </div>

            <p
              className="inline-flex items-center flex-wrap"
              style={{ fontSize: 12, color: '#374151', marginTop: 14, gap: 6 }}
            >
              <span>Amazon Ads</span>
              <span style={{ color: '#D1D5DB' }}>›</span>
              <span>Campaign Manager</span>
              <span style={{ color: '#D1D5DB' }}>›</span>
              <span>Bulk Operations</span>
              <span style={{ color: '#D1D5DB' }}>›</span>
              <span>Upload</span>
            </p>

            <div style={{ flex: 1 }} />

            {onViewFullResults && (
              <button
                onClick={onViewFullResults}
                className="btn-press inline-flex items-center justify-center w-full"
                style={{
                  marginTop: 20,
                  background: '#FFFFFF',
                  border: '1px solid #E5E7EB',
                  color: '#374151',
                  borderRadius: 10,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  gap: 6,
                }}
              >
                View full results
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
