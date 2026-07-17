import { formatSavedAgo, type SavedSession } from "@/lib/decisionSession";

interface Props {
  saved: SavedSession;
  onResume: () => void;
  onStartFresh: () => void;
}

export const ResumeSessionBanner = ({ saved, onResume, onStartFresh }: Props) => {
  const count = Object.keys(saved.decisions).length;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        marginBottom: 12,
        borderRadius: 10,
        border: "1px solid #BFDBFE",
        background: "#EFF6FF",
        color: "#1E3A8A",
        fontSize: 13,
      }}
    >
      <div>
        <strong style={{ fontWeight: 600 }}>Resume previous session?</strong>{" "}
        <span style={{ color: "#1E40AF" }}>
          {count} decision{count === 1 ? "" : "s"} saved from {formatSavedAgo(saved.timestamp)}.
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onResume}
          style={{
            background: "#1D4ED8",
            color: "white",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Resume
        </button>
        <button
          onClick={onStartFresh}
          style={{
            background: "transparent",
            color: "#1E3A8A",
            border: "1px solid #BFDBFE",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Start fresh
        </button>
      </div>
    </div>
  );
};
