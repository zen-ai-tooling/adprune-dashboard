import React, { useMemo } from "react";
import {
  Clock,
  ChevronRight,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  SlidersHorizontal,
  FileText,
  Sparkles,
} from "lucide-react";
import { useHistory } from "@/context/HistoryContext";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

type ActiveModule = "bleeders_1" | "bleeders_2" | "lifetime_bleeders" | "search_harvest" | null;

interface HomeScreenProps {
  onSelectModule: (module: ActiveModule) => void;
}

const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
};

const getGreetingHeadline = (firstName: string | null): string => {
  const base = getGreeting();
  if (firstName) return `${base}, ${firstName}`;
  return `${base}, welcome back`;
};

const getTimeString = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

const getUserFirstName = (): string | null => {
  try {
    const raw = localStorage.getItem("gno-adops-user-profile") || localStorage.getItem("user-profile");
    if (raw) {
      const p = JSON.parse(raw);
      const name: string | undefined =
        p?.firstName || p?.first_name || p?.given_name || (p?.name ? String(p.name).split(" ")[0] : undefined);
      if (name && name.trim()) return name.trim();
    }
  } catch {}
  return null;
};

const MODULES = [
  {
    id: "bleeders_1" as const,
    name: "Bleeders 1.0",
    desc: "Find targets with zero sales that are wasting your budget",
    dot: "hsl(var(--destructive))",
    tag: "Standard",
    historyKey: "bleeders_1",
  },
  {
    id: "bleeders_2" as const,
    name: "Bleeders 2.0",
    desc: "Find low-performing targets with high ACoS and low sales",
    dot: "hsl(var(--amber))",
    tag: "Recommended",
    historyKey: "bleeders_2",
  },
  {
    id: "lifetime_bleeders" as const,
    name: "Lifetime Audit",
    desc: "Find targets that have never converted across their entire lifetime",
    dot: "hsl(265 70% 60%)",
    tag: "Audit",
    historyKey: "lifetime",
  },
  {
    id: "search_harvest" as const,
    name: "Search Term Harvesting",
    desc: "Promote proven converters to exact-match and block source cannibalization",
    dot: "hsl(160 84% 39%)",
    tag: "Growth",
    historyKey: "search_harvest",
  },
];

const MODULE_LABELS: Record<string, string> = {
  bleeders_1: "Bleeders 1.0",
  bleeders_2: "Bleeders 2.0",
  lifetime: "Lifetime Audit",
};

const MODULE_ACCENT: Record<string, string> = {
  bleeders_1: "#EF4444",
  bleeders_2: "#F59E0B",
  lifetime: "#8B5CF6",
};

const formatRelative = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const decisionsSummary = (e: {
  pausedCount: number;
  negativesCreated: number;
  bidsCutCount: number;
}): string | null => {
  const parts: string[] = [];
  if (e.pausedCount) parts.push(`${e.pausedCount} paused`);
  if (e.bidsCutCount) parts.push(`${e.bidsCutCount} bid${e.bidsCutCount === 1 ? "" : "s"} cut`);
  if (e.negativesCreated) parts.push(`${e.negativesCreated} negative${e.negativesCreated === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : null;
};

export const HomeScreen: React.FC<HomeScreenProps> = ({ onSelectModule }) => {
  const { entries } = useHistory();
  const firstName = getUserFirstName();

  const lastRunByModule: Record<string, string | undefined> = {};
  entries.forEach((e) => {
    if (!lastRunByModule[e.module]) lastRunByModule[e.module] = e.completedAt;
  });

  const recent = entries.slice(0, 3);

  const monthStats = useMemo(() => {
    const now = new Date();
    const monthEntries = entries.filter((e) => {
      const d = new Date(e.completedAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const totalSpend = monthEntries.reduce((sum, e) => sum + (e.atRiskSpend || 0), 0);
    return { sessions: monthEntries.length, totalSpend };
  }, [entries]);

  const hasSessions = entries.length > 0;
  const greetingHeadline = getGreetingHeadline(firstName);

  return (
    <div className="flex flex-col" style={{ paddingTop: 40 }}>
      {/* Greeting + value hook */}
      <div>
        <p
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.12em",
            color: "#9CA3AF",
            textTransform: "uppercase",
          }}
        >
          {getTimeString()}
        </p>
        <h1 className="type-page-title mt-2">{greetingHeadline}</h1>
        {hasSessions ? (
          <p className="mt-3 max-w-2xl" style={{ fontSize: 16, fontWeight: 400, color: "#374151", lineHeight: 1.5 }}>
            You've addressed{" "}
            <span style={{ fontSize: 24, fontWeight: 700, color: "#111827" }}>
              ${Math.round(monthStats.totalSpend).toLocaleString()}
            </span>{" "}
            in at-risk spend across {monthStats.sessions} session{monthStats.sessions === 1 ? "" : "s"} this month
          </p>
        ) : (
          <p className="mt-3 max-w-2xl" style={{ fontSize: 16, fontWeight: 400, color: "#374151", lineHeight: 1.5 }}>
            Run your first workflow to start tracking at-risk spend.
          </p>
        )}
      </div>

      {/* Workflows */}
      <div style={{ marginTop: 48 }}>
        <p className="type-section-eyebrow mb-4">Workflows</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {MODULES.map((m) => {
            const lastRun = lastRunByModule[m.historyKey];
            const isRecommended = m.tag === "Recommended";
            const isEmptyState = !hasSessions && isRecommended;
            return (
              <button
                key={m.id}
                onClick={() => onSelectModule(m.id)}
                className="group text-left rounded-xl border p-6 relative overflow-hidden flex flex-col workflow-card"
                style={{
                  minHeight: "180px",
                  cursor: "pointer",
                  borderColor: isRecommended ? "rgba(13, 148, 136, 0.25)" : "#E5E7EB",
                  background: "#FFFFFF",
                  boxShadow: isEmptyState
                    ? "0 6px 20px rgba(13, 148, 136, 0.10)"
                    : isRecommended
                      ? "0 2px 8px rgba(0,0,0,0.04)"
                      : "0 1px 3px rgba(0,0,0,0.04)",
                  transition: "transform 200ms ease, box-shadow 200ms ease",
                }}
                onMouseEnter={(ev) => {
                  ev.currentTarget.style.transform = "translateY(-2px)";
                  ev.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.08)";
                }}
                onMouseLeave={(ev) => {
                  ev.currentTarget.style.transform = "translateY(0)";
                  ev.currentTarget.style.boxShadow = isEmptyState
                    ? "0 6px 20px rgba(13, 148, 136, 0.10)"
                    : isRecommended
                      ? "0 2px 8px rgba(0,0,0,0.04)"
                      : "0 1px 3px rgba(0,0,0,0.04)";
                }}
              >
                {/* Recommended top accent line */}
                {isRecommended && (
                  <span
                    aria-hidden
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      height: 3,
                      background: "#0D9488",
                    }}
                  />
                )}

                <div className="flex items-start justify-between mb-4">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: m.dot }} />
                  {isRecommended ? (
                    <span
                      className="text-[10px] font-semibold uppercase px-2 py-[3px] rounded-full"
                      style={{
                        background: "rgba(13, 148, 136, 0.10)",
                        color: "#0D9488",
                        letterSpacing: "0.08em",
                      }}
                    >
                      Recommended
                    </span>
                  ) : (
                    <span
                      className="text-[10px] font-semibold uppercase text-[#9CA3AF]"
                      style={{ letterSpacing: "0.08em" }}
                    >
                      {m.tag}
                    </span>
                  )}
                </div>
                <div className="type-card-title">{m.name}</div>
                <p className="type-card-desc mt-2 flex-1">{m.desc}</p>

                {isEmptyState && (
                  <div
                    className="mt-3 flex items-center gap-1.5 text-[11.5px] font-medium"
                    style={{ color: "#0D9488" }}
                  >
                    <Sparkles style={{ width: 12, height: 12 }} strokeWidth={2} />
                    Recommended first workflow
                  </div>
                )}

                <div className="flex items-center justify-between mt-5 pt-4 border-t border-[#F3F4F6]">
                  {lastRun ? (
                    <span className="flex items-center gap-1.5 text-[12px] text-[#111827] font-medium">
                      <Clock className="w-3 h-3" strokeWidth={1.8} />
                      Last run {formatRelative(lastRun)}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5" style={{ fontSize: 11, color: "#9CA3AF" }}>
                      <span>↑ Start here to find wasted spend</span>
                    </span>
                  )}
                  <span
                    className="text-[12px] font-semibold flex items-center gap-1"
                    style={{ color: "hsl(var(--primary))" }}
                  >
                    Start{" "}
                    <ArrowRight
                      className="start-arrow"
                      style={{ width: 13, height: 13, transition: "transform 200ms ease" }}
                      strokeWidth={2.2}
                    />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Recent activity */}
      <div style={{ marginTop: 40 }}>
        <div className="flex items-end justify-between mb-4">
          <p className="type-section-eyebrow">Recent activity</p>
          {recent.length > 0 && (
            <button
              type="button"
              className="text-[12px] font-medium flex items-center gap-1 hover:underline"
              style={{ color: "hsl(var(--primary))" }}
            >
              View all <ArrowRight style={{ width: 12, height: 12 }} strokeWidth={2.2} />
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <div
            className="rounded-[10px] border border-[#E5E7EB] bg-white px-5 py-10 text-center"
            style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}
          >
            <Clock className="w-4 h-4 mx-auto text-[#9CA3AF] opacity-60" strokeWidth={1.6} />
            <p className="text-[13px] text-[#9CA3AF] mt-2">Your completed sessions will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recent.map((e) => {
              const accent = MODULE_ACCENT[e.module] ?? "#9CA3AF";
              const success = e.bleedersFound >= 0;
              const Icon = success ? CheckCircle2 : AlertTriangle;
              return (
                <div
                  key={e.id}
                  className="rounded-[10px] border border-[#E5E7EB] bg-white px-5 py-4 flex items-center gap-4 cursor-pointer"
                  style={{
                    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
                    borderLeft: `3px solid ${accent}`,
                    transition: "background 150ms ease",
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.background = "#F9FAFB")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.background = "#FFFFFF")}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon
                        className="w-3.5 h-3.5 flex-shrink-0"
                        strokeWidth={2}
                        style={{ color: success ? "#10B981" : "#F59E0B" }}
                      />
                      <span className="text-[14px] font-semibold text-[#111827] truncate">
                        {MODULE_LABELS[e.module] ?? e.module}
                      </span>
                      {e.track &&
                        (e.track === "SBSD" ? (
                          <TooltipProvider delayDuration={200}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[10.5px] font-mono-nums px-1.5 py-px rounded bg-[#F3F4F6] text-[#9CA3AF] cursor-help">
                                  {e.track}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top">Sponsored Brands + Sponsored Display</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : (
                          <span className="text-[10.5px] font-mono-nums px-1.5 py-px rounded bg-[#F3F4F6] text-[#9CA3AF]">
                            {e.track}
                          </span>
                        ))}
                    </div>
                    <p className="text-[12px] text-[#9CA3AF] truncate mt-0.5 ml-5">
                      {e.clientName} · {
                        (e.pausedCount || e.negativesCreated || e.bidsCutCount)
                          ? `${(e.pausedCount ?? 0) + (e.negativesCreated ?? 0) + (e.bidsCutCount ?? 0)} decisions exported`
                          : e.bleedersFound > 0
                            ? `${e.bleedersFound} bleeders reviewed`
                            : 'Session complete'
                      }
                    </p>
                    {decisionsSummary(e) && (
                      <p className="text-[12px] text-[#374151] truncate mt-0.5 ml-5">{decisionsSummary(e)}</p>
                    )}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="flex items-center justify-end gap-1.5">
                      <span className="rounded-full" style={{ width: 6, height: 6, background: accent }} />
                      <span className="font-mono-nums text-[#111827]" style={{ fontSize: 14, fontWeight: 600 }}>
                        {e.bleedersFound.toLocaleString()} bleeders
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>{formatRelative(e.completedAt)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Learn the basics */}
      <div style={{ marginTop: 32 }}>
        <p className="type-section-eyebrow mb-4">Learn the basics</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              title: "What are bleeders?",
              desc: "Targets with high spend and zero or near-zero conversions.",
              Icon: HelpCircle,
            },
            {
              title: "How thresholds work",
              desc: "SB/SD use Target ACoS + 10%. SP uses Target ACoS + 20%.",
              Icon: SlidersHorizontal,
            },
            { title: "Bulk file guide", desc: "Export 60-day Bulk Operations from Campaign Manager.", Icon: FileText },
          ].map((q) => (
            <div
              key={q.title}
              className="rounded-[10px] border border-[#E5E7EB] flex items-start justify-between gap-3 cursor-pointer tile-hover"
              style={{
                background: "#FFFFFF",
                borderLeft: "2px solid rgba(37, 99, 235, 0.15)",
                padding: 16,
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <div className="flex items-start gap-3 min-w-0">
                <q.Icon
                  className="flex-shrink-0 mt-0.5"
                  style={{ width: 18, height: 18, color: "#374151" }}
                  strokeWidth={1.8}
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[#111827] tracking-tight">{q.title}</div>
                  <p className="text-[12.5px] text-[#374151] mt-1.5 leading-relaxed">{q.desc}</p>
                </div>
              </div>
              <ChevronRight
                className="flex-shrink-0 mt-0.5"
                style={{ width: 16, height: 16, color: "#D1D5DB" }}
                strokeWidth={1.8}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        className="border-t border-[#F3F4F6] py-4 flex items-center justify-between"
        style={{ marginTop: 48, opacity: 0.75 }}
      >
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>AdPrune · Amazon Ads Optimization</span>
        <div className="flex items-center gap-4">
          <a
            href="mailto:feedback@adprune.com"
            style={{ fontSize: 11, color: "#9CA3AF" }}
            className="hover:text-[#111827] transition-colors"
          >
            Feedback
          </a>
          <a
            href="https://docs.lovable.dev"
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: "#9CA3AF" }}
            className="hover:text-[#111827] transition-colors"
          >
            Changelog
          </a>
          <span style={{ fontSize: 11, color: "#9CA3AF" }} className="font-mono-nums">
            v2.0
          </span>
        </div>
      </div>
    </div>
  );
};
