import * as React from "react";
import { X } from "lucide-react";
import { EmailCaptureForm, EMAIL_CAPTURE_SUBMITTED_KEY } from "./EmailCaptureForm";

const EXIT_INTENT_SHOWN_KEY = "exitIntentShown";

interface ExitIntentModalProps {
  /** Return true to suppress the modal (e.g. RowDetailPanel is open). */
  isSuppressed?: () => boolean;
}

export const ExitIntentModal: React.FC<ExitIntentModalProps> = ({ isSuppressed }) => {
  const [open, setOpen] = React.useState(false);

  // Attach the mouseleave listener once at mount. Skip on touch devices.
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const isTouch =
      "ontouchstart" in window ||
      (typeof navigator !== "undefined" && (navigator as any).maxTouchPoints > 0);
    if (isTouch) return;

    const onMouseLeave = (e: MouseEvent) => {
      if (e.clientY > 0) return;
      try {
        if (sessionStorage.getItem(EXIT_INTENT_SHOWN_KEY)) return;
        if (sessionStorage.getItem(EMAIL_CAPTURE_SUBMITTED_KEY)) return;
      } catch {
        // ignore storage errors and continue
      }
      if (isSuppressed?.()) return;

      try {
        sessionStorage.setItem(EXIT_INTENT_SHOWN_KEY, "1");
      } catch {
        // ignore
      }
      setOpen(true);
    };

    document.addEventListener("mouseleave", onMouseLeave);
    return () => document.removeEventListener("mouseleave", onMouseLeave);
  }, [isSuppressed]);

  // Escape to close + body scroll lock while open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        animation: "exit-intent-fade 150ms ease-out both",
      }}
    >
      <style>{`@keyframes exit-intent-fade { from { opacity: 0; } to { opacity: 1; } }`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-intent-headline"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          maxWidth: 420,
          width: "calc(100% - 32px)",
          background: "#FFFFFF",
          border: "1px solid #E5E5EA",
          borderRadius: 12,
          padding: 32,
          boxShadow: "none",
        }}
      >
        <button
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="exit-intent-close"
          style={{
            position: "absolute",
            top: 24,
            right: 24,
            width: 32,
            height: 32,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: "none",
            color: "#6B7280",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <X className="w-4 h-4" />
        </button>
        <style>{`.exit-intent-close:hover { color: #374151; }`}</style>

        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: "#6B7280",
          }}
        >
          Before you go
        </div>
        <h2
          id="exit-intent-headline"
          style={{ fontSize: 18, fontWeight: 700, color: "#1D1D1F", marginTop: 8 }}
        >
          Get notified when new features launch
        </h2>
        <p style={{ fontSize: 14, color: "#6B7280", marginTop: 8, marginBottom: 20 }}>
          We're adding live account sync and more — want to hear when it's ready?
        </p>

        <EmailCaptureForm maxWidth={420} />
      </div>
    </div>
  );
};
