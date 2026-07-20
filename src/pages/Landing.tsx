import React, { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

const useReveal = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    els.forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(20px)";
      el.style.transition = `opacity 600ms ease-out ${i * 50}ms, transform 600ms ease-out ${i * 50}ms`;
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            (e.target as HTMLElement).style.opacity = "1";
            (e.target as HTMLElement).style.transform = "translateY(0)";
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
};

const COLORS = {
  bg: "#0A0A0B",
  text: "#FAFAFA",
  sub: "#888888",
  muted: "#555555",
  faint: "#333333",
  accent: "#3B82F6",
  card: "rgba(255, 255, 255, 0.03)",
  border: "rgba(255, 255, 255, 0.06)",
};

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

const Landing: React.FC = () => {
  const ref = useReveal();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "AdPrune — Free Amazon Ads bleeder detection & optimization";
    const meta = document.querySelector('meta[name="description"]');
    const prevDesc = meta?.getAttribute("content") ?? "";
    meta?.setAttribute(
      "content",
      "AdPrune finds your worst-performing Amazon Ads keywords and targets in 60 seconds. Free, no login, no API keys.",
    );
    document.documentElement.style.scrollBehavior = "smooth";
    return () => {
      document.title = prevTitle;
      if (meta) meta.setAttribute("content", prevDesc);
      document.documentElement.style.scrollBehavior = "";
    };
  }, []);

  const cta = (label: string, big = false) => (
    <Link
      to="/app"
      style={{
        display: "inline-block",
        background: COLORS.accent,
        color: "#fff",
        borderRadius: big ? 10 : 8,
        padding: big ? "14px 32px" : "8px 20px",
        fontSize: big ? 16 : 14,
        fontWeight: 600,
        textDecoration: "none",
        transition: "background 150ms, box-shadow 150ms",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "#2563EB";
        if (big) e.currentTarget.style.boxShadow = "0 0 30px rgba(59,130,246,0.3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = COLORS.accent;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {label}
    </Link>
  );

  const sectionEyebrow = (t: string) => (
    <div
      data-reveal
      style={{
        fontSize: 14,
        fontWeight: 600,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: COLORS.accent,
        textAlign: "center",
      }}
    >
      {t}
    </div>
  );

  const sectionTitle = (t: string) => (
    <h2
      data-reveal
      style={{
        fontSize: 40,
        fontWeight: 700,
        letterSpacing: "-0.03em",
        color: COLORS.text,
        textAlign: "center",
        marginTop: 16,
        lineHeight: 1.15,
      }}
    >
      {t}
    </h2>
  );

  return (
    <div
      ref={ref}
      style={{
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: font,
        minHeight: "100vh",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{`
        .lp-hero-title { font-size: 56px; }
        .lp-bento { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .lp-steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
        .lp-table-wrap { overflow-x: auto; }
        @media (max-width: 768px) {
          .lp-hero-title { font-size: 36px !important; }
          .lp-bento { grid-template-columns: 1fr !important; }
          .lp-steps { grid-template-columns: 1fr !important; }
        }
        .lp-link { color: ${COLORS.faint}; text-decoration: none; transition: color 150ms; }
        .lp-link:hover { color: ${COLORS.muted}; }
      `}</style>

      {/* NAV */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          height: 56,
          padding: "0 24px",
          background: "rgba(10, 10, 11, 0.8)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: `1px solid ${COLORS.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.03em" }}>
          AdPrune
        </div>
        {cta("Open AdPrune →")}
      </nav>

      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "0 24px" }}>
        {/* HERO */}
        <section style={{ paddingTop: 160, textAlign: "center" }}>
          <div
            data-reveal
            style={{
              display: "inline-block",
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: COLORS.accent,
              background: "rgba(59, 130, 246, 0.1)",
              border: "1px solid rgba(59, 130, 246, 0.2)",
              borderRadius: 20,
              padding: "4px 14px",
              marginBottom: 24,
            }}
          >
            Free Amazon Ads Tool
          </div>
          <h1
            data-reveal
            className="lp-hero-title"
            style={{
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              color: COLORS.text,
              maxWidth: 800,
              margin: "0 auto",
            }}
          >
            Stop wasting money on Amazon Ads that don't convert
          </h1>
          <p
            data-reveal
            style={{
              fontSize: 18,
              lineHeight: 1.6,
              color: COLORS.sub,
              maxWidth: 560,
              margin: "20px auto 0",
            }}
          >
            AdPrune finds your worst-performing keywords and targets in 60
            seconds. Upload your bulk file, review the bleeders, download the
            fix.
          </p>
          <div data-reveal style={{ marginTop: 40 }}>
            {cta("Start optimizing — it's free →", true)}
          </div>
          <div
            data-reveal
            style={{ fontSize: 13, color: COLORS.muted, marginTop: 12 }}
          >
            No login. No API keys. No subscription.
          </div>

          {/* Browser mockup */}
          <div
            data-reveal
            style={{
              marginTop: 64,
              background: COLORS.card,
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 16,
              overflow: "hidden",
              boxShadow:
                "0 0 80px rgba(59, 130, 246, 0.08), 0 20px 60px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div
              style={{
                height: 40,
                background: "rgba(255, 255, 255, 0.03)",
                borderBottom: `1px solid ${COLORS.border}`,
                display: "flex",
                alignItems: "center",
                padding: "0 12px",
                position: "relative",
              }}
            >
              <div style={{ display: "flex", gap: 6 }}>
                {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                  <span
                    key={c}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: c,
                      display: "inline-block",
                    }}
                  />
                ))}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  textAlign: "center",
                  fontSize: 12,
                  color: COLORS.muted,
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  pointerEvents: "none",
                }}
              >
                adprune.com/app
              </div>
            </div>
            <div
              style={{
                aspectRatio: "16 / 9",
                background:
                  "linear-gradient(135deg, #111 0%, #1a1a2e 50%, #111 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: COLORS.faint,
                fontSize: 14,
              }}
            >
              Product screenshot
            </div>
          </div>

          {/* SOCIAL PROOF */}
          <div style={{ marginTop: 80 }}>
            <div data-reveal style={{ fontSize: 13, color: COLORS.muted }}>
              Trusted by Amazon sellers managing $500K+ in annual ad spend
            </div>
            <div
              data-reveal
              style={{
                marginTop: 24,
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "center",
                gap: 48,
              }}
            >
              {["Brand A", "Brand B", "Brand C", "Brand D", "Brand E"].map(
                (b) => (
                  <span
                    key={b}
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: COLORS.faint,
                    }}
                  >
                    {b}
                  </span>
                ),
              )}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section style={{ marginTop: 160 }}>
          {sectionEyebrow("How it works")}
          {sectionTitle("From bulk file to optimized campaigns in 60 seconds")}
          <div className="lp-steps" style={{ marginTop: 64 }}>
            {[
              {
                n: "01",
                t: "Upload",
                d: "Export your 60-day bulk file from Amazon Ads and drop it into AdPrune. We support SP, SB, and SD campaigns.",
              },
              {
                n: "02",
                t: "Review",
                d: "See every bleeding keyword and target — ranked by wasted spend. Each row shows clicks, spend, sales, and a smart recommendation.",
              },
              {
                n: "03",
                t: "Download",
                d: "Make your decisions, generate an Amazon-ready bulk file, and upload it back. Done.",
              },
            ].map((s) => (
              <div
                key={s.n}
                data-reveal
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 16,
                  padding: 32,
                }}
              >
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 700,
                    color: "rgba(59, 130, 246, 0.3)",
                    letterSpacing: "-0.03em",
                    lineHeight: 1,
                  }}
                >
                  {s.n}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: COLORS.text,
                    marginTop: 16,
                  }}
                >
                  {s.t}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: COLORS.sub,
                    lineHeight: 1.6,
                    marginTop: 8,
                  }}
                >
                  {s.d}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* BENTO */}
        <section style={{ marginTop: 160 }}>
          {sectionEyebrow("Everything you need")}
          {sectionTitle("Four modules. Zero wasted spend.")}
          <div className="lp-bento" style={{ marginTop: 64 }}>
            {[
              {
                dot: "#EF4444",
                title: "Bleeders 1.0",
                desc: "Find high-spend, zero-conversion targets across all campaign types. One upload, every bleeder found.",
              },
              {
                dot: "#F59E0B",
                title: "Bleeders 2.0",
                desc: "Track-based analysis with configurable ACoS thresholds. Smart suggestions powered by your break-even point.",
                pill: { label: "RECOMMENDED", color: "#F59E0B" },
              },
              {
                dot: "#8B5CF6",
                title: "Lifetime Audit",
                desc: "Find targets that have never converted in their entire lifetime — not just the last 60 days.",
              },
              {
                dot: "#3B82F6",
                title: "Search Term Harvesting",
                desc: "Promote proven search terms to exact match and auto-negate the source. Deduplication and bid capping built in.",
                pill: { label: "NEW", color: "#3B82F6" },
              },
            ].map((t) => (
              <div
                key={t.title}
                data-reveal
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 16,
                  padding: 32,
                  minHeight: 280,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: t.dot,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 600,
                      color: COLORS.text,
                    }}
                  >
                    {t.title}
                  </span>
                  {t.pill && (
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.1em",
                        padding: "3px 8px",
                        borderRadius: 999,
                        background: `${t.pill.color}20`,
                        color: t.pill.color,
                        border: `1px solid ${t.pill.color}40`,
                      }}
                    >
                      {t.pill.label}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 14,
                    color: COLORS.sub,
                    lineHeight: 1.6,
                    marginTop: 12,
                  }}
                >
                  {t.desc}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* COMPARISON */}
        <section style={{ marginTop: 160 }}>
          {sectionEyebrow("Why AdPrune")}
          {sectionTitle("Premium tools charge $275/month for this")}
          <div
            data-reveal
            className="lp-table-wrap"
            style={{
              marginTop: 64,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 16,
              overflow: "hidden",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 640,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: "rgba(255, 255, 255, 0.03)",
                    borderBottom: `1px solid ${COLORS.border}`,
                  }}
                >
                  <th style={{ textAlign: "left", padding: "16px 24px", fontSize: 13, fontWeight: 600, color: COLORS.text }}>Feature</th>
                  <th style={{ textAlign: "left", padding: "16px 24px", fontSize: 13, fontWeight: 500, color: COLORS.muted }}>Others</th>
                  <th style={{ textAlign: "left", padding: "16px 24px", fontSize: 13, fontWeight: 600, color: COLORS.accent }}>AdPrune</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Bleeder detection", "From $99/mo", "✓ Free"],
                  ["Search term harvesting", "From $199/mo", "✓ Free"],
                  ["Amazon bulk file output", "API required", "✓ Upload & download"],
                  ["Smart suggestions", "Basic rules", "✓ Threshold-aware AI"],
                  ["Setup time", "API keys + onboarding", "✓ Zero — just upload"],
                  ["Price", "$275/mo average", "$0"],
                ].map(([f, o, a], i) => {
                  const isPrice = f === "Price";
                  return (
                    <tr
                      key={f}
                      style={{
                        background:
                          i % 2 === 0 ? "rgba(255,255,255,0.01)" : "transparent",
                      }}
                    >
                      <td style={{ padding: "16px 24px", fontSize: 14, color: COLORS.text }}>{f}</td>
                      <td style={{ padding: "16px 24px", fontSize: 14, color: COLORS.muted }}>{o}</td>
                      <td
                        style={{
                          padding: "16px 24px",
                          fontSize: isPrice ? 24 : 14,
                          fontWeight: isPrice ? 700 : 500,
                          color: COLORS.accent,
                        }}
                      >
                        {a}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA FOOTER */}
        <section
          style={{ marginTop: 160, padding: "80px 0", textAlign: "center" }}
        >
          <h2
            data-reveal
            style={{
              fontSize: 40,
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: COLORS.text,
            }}
          >
            Ready to stop bleeding ad spend?
          </h2>
          <p
            data-reveal
            style={{
              fontSize: 16,
              color: COLORS.sub,
              marginTop: 16,
            }}
          >
            Upload your bulk file and see results in 60 seconds. No login required.
          </p>
          <div data-reveal style={{ marginTop: 32 }}>
            {cta("Open AdPrune — Free →", true)}
          </div>

          <div
            style={{
              marginTop: 80,
              borderTop: `1px solid ${COLORS.border}`,
              paddingTop: 32,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.muted }}>
              AdPrune
            </div>
            <div style={{ fontSize: 13, color: COLORS.faint }}>
              Built by JJ · <a href="#" className="lp-link">Feedback</a> ·{" "}
              <a href="#" className="lp-link">Changelog</a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Landing;
