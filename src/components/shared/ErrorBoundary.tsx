import React from "react";

interface Props {
  children: React.ReactNode;
  moduleName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.moduleName ?? "", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "400px",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚠️</div>
          <h2 style={{ fontSize: "20px", fontWeight: 600, color: "#111827", marginBottom: "8px" }}>
            Something went wrong
          </h2>
          <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "24px", maxWidth: "400px" }}>
            {this.props.moduleName
              ? `An error occurred in ${this.props.moduleName}. Your uploaded file may have an unexpected format.`
              : "An unexpected error occurred while processing your file."}
          </p>
          <details
            style={{
              fontSize: "12px",
              color: "#9CA3AF",
              marginBottom: "24px",
              maxWidth: "500px",
              textAlign: "left",
            }}
          >
            <summary style={{ cursor: "pointer", marginBottom: "8px" }}>Error details</summary>
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {this.state.error?.message}
            </pre>
          </details>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            style={{
              background: "#0071E3",
              color: "white",
              border: "none",
              borderRadius: "10px",
              padding: "12px 24px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reset and try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
