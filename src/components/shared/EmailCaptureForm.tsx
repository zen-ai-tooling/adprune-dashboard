import * as React from "react";

export const EMAIL_CAPTURE_SUBMITTED_KEY = "emailCaptureSubmitted";
const BEEHIIV_FORM_ID = "00ad444b-3d9d-47f8-8deb-f511141d8565";

interface EmailCaptureFormProps {
  maxWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Shared beehiiv email-capture embed. Injects the loader script once per mount
 * and marks the session as "submitted" when the embedded form dispatches a
 * submit event or posts a success message.
 */
export const EmailCaptureForm: React.FC<EmailCaptureFormProps> = ({
  maxWidth = 400,
  className,
  style,
}) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [hasChild, setHasChild] = React.useState(false);
  const [minElapsed, setMinElapsed] = React.useState(false);

  React.useEffect(() => {
    const mountTime = Date.now();
    const minDuration = 600;
    let minTimer: number | undefined;
    const elapsed = Date.now() - mountTime;
    if (elapsed >= minDuration) {
      setMinElapsed(true);
    } else {
      minTimer = window.setTimeout(() => setMinElapsed(true), minDuration - elapsed);
    }

    const container = containerRef.current;
    if (!container) return;

    const formHost = container.querySelector<HTMLDivElement>("[data-beehiiv-host]");
    let observer: MutationObserver | undefined;
    let fallback: number | undefined;
    if (formHost) {
      const check = () => {
        if (formHost.querySelector("iframe, form")) {
          setHasChild(true);
          observer?.disconnect();
          return true;
        }
        return false;
      };
      if (!check()) {
        observer = new MutationObserver(check);
        observer.observe(formHost, { childList: true, subtree: true });
        fallback = window.setTimeout(() => setHasChild(true), 3000);
      }
    }

    if (formHost && !formHost.querySelector("script[data-beehiiv-form]")) {
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://subscribe-forms.beehiiv.com/v3/loader.js";
      script.setAttribute("data-beehiiv-form", BEEHIIV_FORM_ID);
      formHost.appendChild(script);
    }

    const markSubmitted = () => {
      try {
        sessionStorage.setItem(EMAIL_CAPTURE_SUBMITTED_KEY, "1");
      } catch {
        // ignore
      }
    };

    const onSubmit = () => markSubmitted();
    container.addEventListener("submit", onSubmit, true);

    const onMessage = (e: MessageEvent) => {
      const src = typeof e.origin === "string" ? e.origin : "";
      if (!src.includes("beehiiv.com")) return;
      const data: any = e.data;
      const asString = typeof data === "string" ? data : JSON.stringify(data ?? "");
      if (/subscribe|success|submitted/i.test(asString)) markSubmitted();
    };
    window.addEventListener("message", onMessage);

    return () => {
      if (minTimer) window.clearTimeout(minTimer);
      observer?.disconnect();
      if (fallback) window.clearTimeout(fallback);
      container.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const loaded = hasChild && minElapsed;

  return (
    <div
      ref={containerRef}
      className={className}
      data-email-capture
      style={{ maxWidth, width: "100%", marginLeft: "auto", marginRight: "auto", ...style }}
    >
      <style>{`
        [data-email-capture] input[type="email"],
        [data-email-capture] input[type="text"] {
          background: #FFFFFF !important;
          border: 1px solid #E5E5EA !important;
          border-radius: 10px !important;
        }
      `}</style>
      {!loaded && (
        <div
          aria-hidden
          style={{
            height: 44,
            width: "100%",
            background: "#F3F4F6",
            borderRadius: 10,
          }}
        />
      )}
      <div
        data-beehiiv-host
        style={{
          opacity: loaded ? 1 : 0,
          height: loaded ? "auto" : 0,
          overflow: loaded ? "visible" : "hidden",
          transition: "opacity 150ms ease",
        }}
      />
    </div>
  );
};

