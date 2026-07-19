import React, { useState } from "react";
import { ArrowLeft, Clock, Plus, Check, ChevronsUpDown } from "lucide-react";
import { useClient } from "@/context/ClientContext";
import type { Bleeder2Track } from "@/components/bleeders2/TrackSelector";

type ActiveModule = "bleeders_1" | "bleeders_2" | "lifetime_bleeders" | "search_harvest" | null;

interface AppSidebarProps {
  activeModule: ActiveModule;
  onSelectModule: (module: ActiveModule) => void;
  bleeder2ActiveTrack: Bleeder2Track | null;
  onSelectTrack: (track: Bleeder2Track) => void;
  showTracks: boolean;
  onBackToTrackPicker?: () => void;
  trackStatus?: Record<Bleeder2Track, "idle" | "active" | "done">;
  trackCompletionStatus?: Record<string, "idle" | "complete">;
  onReset?: () => void;
  showHistoryView?: boolean;
  setShowHistoryView?: (v: boolean) => void;
}

const TRACKS: { id: Bleeder2Track; label: string }[] = [
  { id: "SBSD", label: "SB/SD Targets" },
  { id: "SP", label: "SP Search Terms" },
  { id: "SP_KEYWORDS", label: "SP Targets" },
  { id: "ACOS100", label: ">100% ACoS" },
];

const MODULES: { id: Exclude<ActiveModule, null>; label: string; dot: string }[] = [
  { id: "bleeders_1", label: "Bleeders 1.0", dot: "#EF4444" },
  { id: "bleeders_2", label: "Bleeders 2.0", dot: "#F59E0B" },
  { id: "lifetime_bleeders", label: "Lifetime Audit", dot: "#8B5CF6" },
  { id: "search_harvest", label: "Search Term Harvesting", dot: "#10B981" },
];

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-4 mt-6 mb-2 text-[11px] font-semibold uppercase text-[#6B7280]" style={{ letterSpacing: "0.1em" }}>
    {children}
  </div>
);

export const AppSidebar: React.FC<AppSidebarProps> = ({
  activeModule,
  onSelectModule,
  bleeder2ActiveTrack,
  onSelectTrack,
  showTracks,
  onBackToTrackPicker,
  trackStatus = { SBSD: "idle", SP: "idle", SP_KEYWORDS: "idle", ACOS100: "idle" },
  trackCompletionStatus = { SBSD: "idle", SP: "idle", SP_KEYWORDS: "idle", ACOS100: "idle" },
  onReset,
  showHistoryView = false,
  setShowHistoryView,
}) => {
  const { clients, activeClient, setActiveClient, addClient } = useClient();
  const [clientDropdownOpen, setClientDropdownOpen] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientAcos, setNewClientAcos] = useState(35);

  const onHome = !activeModule && !showHistoryView;

  return (
    <aside className="app-sidebar w-[240px] flex-shrink-0 h-screen sticky top-0 flex flex-col bg-sidebar text-sidebar-foreground relative z-10">
      {/* Brand */}
      <button
        onClick={() => {
          onSelectModule(null);
          setShowHistoryView?.(false);
        }}
        className="px-6 pt-6 pb-6 text-left btn-press"
      >
        <div>
          <svg width="175" viewBox="18 78 420 148" xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(76,162)">
              <circle cx="0" cy="0" r="58" fill="#9333ea" />
              <path
                d="M0,-58 C12,-46 20,-20 18,12 C16,40 6,56 0,58 C6,54 24,38 36,14 C46,0 44,-28 30,-46 C20,-58 10,-62 0,-58 Z"
                fill="#3b0764"
              />
              <ellipse cx="-16" cy="-18" rx="11" ry="15" transform="rotate(-15 -16 -18)" fill="rgba(255,255,255,0.1)" />
              <path
                d="M0,-58 C-4,-68 -8,-76 -10,-84"
                stroke-width="3"
                stroke-linecap="round"
                fill="none"
                stroke="#ffffff"
              />
              <path d="M-7,-74 C2,-84 18,-84 18,-78 C8,-71 -5,-72 -7,-74 Z" fill="#a78bfa" />
              <path d="M-8,-67 C-16,-75 -28,-74 -28,-69 C-20,-63 -9,-64 -8,-67 Z" fill="#a78bfa" opacity="0.65" />
            </g>
            <text
              x="148"
              y="172"
              font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif"
              font-size="83"
              font-weight="700"
              letter-spacing="-5"
              fill="#ffffff"
            >
              adprune
            </text>
            <text
              x="149"
              y="212"
              font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif"
              font-size="25"
              font-weight="500"
              letter-spacing="0.2"
              fill="#9CA3AF"
            >
              Amazon Ads Optimization
            </text>
          </svg>
        </div>
      </button>
      <div className="border-b border-white/[0.08] mx-4" />

      {/* Modules */}
      <nav className="flex-1 overflow-y-auto pb-2">
        <SectionLabel>Modules</SectionLabel>

        <div className="px-3">
          {MODULES.map((mod) => {
            const isActive = activeModule === mod.id && !showHistoryView;
            return (
              <button
                key={mod.id}
                onClick={() => onSelectModule(isActive ? null : mod.id)}
                className={`group relative w-full flex items-center gap-3 h-10 pl-4 pr-3 rounded-lg text-[14px] my-[1px] btn-press transition-colors ${
                  isActive
                    ? "bg-white/[0.10] text-white font-semibold"
                    : "text-[#E5E7EB] font-medium hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-2 bottom-2 w-[2px] rounded-r"
                    style={{ backgroundColor: mod.dot }}
                  />
                )}
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: mod.dot }} />
                <span className="truncate">{mod.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tracks sub-nav */}
        {showTracks && activeModule === "bleeders_2" && (
          <div className="px-3 mt-2">
            <div className="flex items-center justify-between px-3 mb-1.5">
              <span className="text-[10px] font-semibold uppercase text-[#374151]" style={{ letterSpacing: "0.1em" }}>
                Tracks
              </span>
              {bleeder2ActiveTrack && onBackToTrackPicker && (
                <button
                  onClick={onBackToTrackPicker}
                  className="flex items-center gap-1 text-[10px] text-[#9CA3AF] hover:text-white btn-press"
                >
                  <ArrowLeft className="w-3 h-3" /> Back
                </button>
              )}
            </div>
            {TRACKS.map((t) => {
              const status = trackStatus[t.id];
              const isTrackActive = bleeder2ActiveTrack === t.id;
              const isComplete = trackCompletionStatus[t.id] === "complete";
              return (
                <button
                  key={t.id}
                  onClick={() => onSelectTrack(t.id)}
                  className={`w-full flex items-center gap-2.5 px-3 h-8 rounded-md text-[13px] my-[1px] btn-press transition-colors ${
                    isTrackActive
                      ? "bg-white/[0.08] text-white font-medium"
                      : "text-[#E5E7EB] hover:bg-white/[0.05] hover:text-white"
                  }`}
                >
                  {isComplete ? (
                    <span className="w-3.5 h-3.5 rounded-full bg-success/20 text-success flex items-center justify-center flex-shrink-0">
                      <Check className="w-2.5 h-2.5" />
                    </span>
                  ) : (
                    <span
                      className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{
                        backgroundColor: isTrackActive
                          ? "hsl(var(--primary))"
                          : status === "done"
                            ? "hsl(var(--success))"
                            : "#374151",
                      }}
                    />
                  )}
                  <span className="truncate">{t.label}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* History */}
        <SectionLabel>History</SectionLabel>
        <div className="px-3">
          <button
            onClick={() => setShowHistoryView?.(true)}
            className={`w-full flex items-center gap-3 h-10 px-4 rounded-lg text-[14px] my-[1px] btn-press transition-colors ${
              showHistoryView
                ? "bg-white/[0.10] text-white font-semibold"
                : "text-[#E5E7EB] font-medium hover:bg-white/[0.05] hover:text-white"
            }`}
          >
            <Clock className="w-3.5 h-3.5 opacity-70" />
            Session log
          </button>
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/[0.08]">
        <div className="text-center" style={{ fontSize: "12px", color: "#6E6E73" }}>
          AdPrune v2.0
        </div>
      </div>
    </aside>
  );
};
