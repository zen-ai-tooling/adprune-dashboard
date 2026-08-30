import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildHarvestBulkWorkbook, type HarvestRow } from "@/lib/ui/searchTermHarvest";

// ---- helpers ---------------------------------------------------------------

const row = (over: Partial<HarvestRow> = {}): HarvestRow => ({
  campaignName: "Widget Cover_Broad",
  adGroupName: "AG1",
  advertisedASIN: "B012345678",
  searchTerm: "widget cover",
  matchType: "broad",
  clicks: 10,
  spend: 5,
  cpc: 0.5,
  orders: 2,
  sales: 40,
  acos: 0.125,
  __rowIndex: 1,
  id: "r1",
  cleanedTerm: "widget cover",
  termKind: "KEYWORD",
  lengthWarning: false,
  destinationCampaign: "Widget Cover_Exact",
  destinationAdGroup: "AG-Exact",
  dismissed: false,
  harvested: true,
  ...over,
});

/** Flatten every sheet back to objects keyed by header. */
const sheetRows = (wb: XLSX.WorkBook): Record<string, any>[] => {
  const out: Record<string, any>[] = [];
  for (const name of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 });
    if (aoa.length < 2) continue;
    const headers = aoa[0].map(String);
    for (const r of aoa.slice(1)) {
      const obj: Record<string, any> = {};
      headers.forEach((h, i) => (obj[h] = r[i]));
      out.push(obj);
    }
  }
  return out;
};

const entities = (wb: XLSX.WorkBook) => sheetRows(wb).map((r) => r.Entity);
const negatives = (wb: XLSX.WorkBook) =>
  sheetRows(wb).filter((r) => String(r.Entity ?? "").toLowerCase().startsWith("negative"));

// ---- Test plan item 2: toggle OFF -----------------------------------------

describe("item 2 — toggle OFF", () => {
  it("produces zero negative rows", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: [row()],
      defaultBid: 0.75,
      autoNegate: false,
    });
    expect(negatives(workbook)).toHaveLength(0);
    expect(summary.negativeRows).toBe(0);
  });

  it("still emits the exact-match keyword row correctly", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: [row()],
      defaultBid: 0.75,
      autoNegate: false,
    });
    const rows = sheetRows(workbook);
    expect(rows).toHaveLength(1);
    expect(rows[0].Entity).toBe("Keyword");
    expect(rows[0]["Match Type"]).toBe("Exact");
    expect(rows[0]["Keyword Text"]).toBe("widget cover");
    expect(summary.exactRows).toBe(1);
  });

  it("multi-source aggregation yields exactly one exact keyword per term", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: [
        row({ id: "a", campaignName: "Widget Cover_Broad", sales: 40 }),
        row({ id: "b", campaignName: "Widget Cover_Phrase", sales: 90 }),
        row({ id: "c", campaignName: "Widget Cover_Auto", sales: 10 }),
      ],
      defaultBid: 0.75,
      autoNegate: false,
    });
    const kw = sheetRows(workbook).filter((r) => r.Entity === "Keyword");
    expect(kw).toHaveLength(1);
    expect(summary.duplicateExactsRemoved).toBe(2);
  });
});

// ---- Test plan item 3: toggle ON is byte-for-byte the old behavior ---------

describe("item 3 — toggle ON regression", () => {
  it("ON output matches the original always-on shape exactly", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: [row({ id: "a" }), row({ id: "b", campaignName: "Widget Cover_Phrase" })],
      defaultBid: 0.75,
      autoNegate: true,
    });
    const rows = sheetRows(workbook);

    // 1 deduped exact target + 1 negative per distinct source campaign
    expect(summary.exactRows).toBe(1);
    expect(summary.negativeRows).toBe(2);
    expect(rows).toHaveLength(3);

    const exact = rows.find((r) => r.Entity === "Keyword")!;
    expect(exact["Campaign Name"]).toBe("Widget Cover_Exact");
    expect(exact["Match Type"]).toBe("Exact");
    expect(exact.Bid).toBe("0.50");
    expect(exact.State).toBe("Enabled");
    expect(exact.Operation).toBe("Create");

    const negs = negatives(workbook);
    expect(negs.map((r) => r["Campaign Name"]).sort()).toEqual([
      "Widget Cover_Broad",
      "Widget Cover_Phrase",
    ]);
    for (const n of negs) {
      expect(n["Match Type"]).toBe("Negative Exact");
      expect(n["Keyword Text"]).toBe("widget cover");
      expect(n.Bid).toBe(""); // negatives never carry a bid
    }
  });

  it("creates a Negative Exact for a broad-match source", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: [row()],
      defaultBid: 0.75,
      autoNegate: true,
    });
    const neg = negatives(workbook);
    expect(neg).toHaveLength(1);
    expect(neg[0].Entity).toBe("Negative keyword");
    expect(neg[0]["Match Type"]).toBe("Negative Exact");
    expect(neg[0]["Campaign Name"]).toBe("Widget Cover_Broad"); // source, not destination
    expect(summary.negativeRows).toBe(1);
  });
});

// ---- Test plan item 4: "Already Exact" rule --------------------------------

describe("item 4 — Already Exact rule", () => {
  it("ON + source already exact → no negative created", () => {
    const { workbook, summary, warnings } = buildHarvestBulkWorkbook({
      rows: [row({ matchType: "exact" })],
      defaultBid: 0.75,
      autoNegate: true,
    });
    expect(negatives(workbook)).toHaveLength(0);
    expect(summary.negativeRows).toBe(0);
    expect(warnings.join(" ")).toMatch(/already Exact/i);
  });

  it("is case- and whitespace-insensitive on match type", () => {
    for (const mt of ["Exact", " EXACT ", "eXaCt"]) {
      const { workbook } = buildHarvestBulkWorkbook({
        rows: [row({ matchType: mt })],
        defaultBid: 0.75,
        autoNegate: true,
      });
      expect(negatives(workbook), `match type ${JSON.stringify(mt)}`).toHaveLength(0);
    }
  });

  it("OFF + source already exact → also no negative", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [row({ matchType: "exact" })],
      defaultBid: 0.75,
      autoNegate: false,
    });
    expect(negatives(workbook)).toHaveLength(0);
  });
});

// ---- Test plan item 8: mixed batch -----------------------------------------

describe("item 8 — mixed batch, toggle ON", () => {
  const mixed = [
    row({ id: "1", cleanedTerm: "alpha", searchTerm: "alpha", matchType: "broad", campaignName: "C_Broad", destinationCampaign: "C_Exact", destinationAdGroup: "AG-Exact" }),
    row({ id: "2", cleanedTerm: "beta", searchTerm: "beta", matchType: "exact", campaignName: "C_Exact2", destinationCampaign: "C_Exact", destinationAdGroup: "AG-Exact" }),
    row({ id: "3", cleanedTerm: "gamma", searchTerm: "gamma", matchType: "phrase", campaignName: "C_Phrase", destinationCampaign: "C_Exact", destinationAdGroup: "AG-Exact" }),
  ];

  it("produces 3 exacts and only 2 negatives (beta skipped)", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: mixed,
      defaultBid: 0.75,
      autoNegate: true,
    });
    expect(summary.exactRows).toBe(3);
    expect(summary.negativeRows).toBe(2);
    const negTerms = negatives(workbook).map((r) => r["Keyword Text"]).sort();
    expect(negTerms).toEqual(["alpha", "gamma"]);
  });

  it("summary counts equal the real sheet row counts (no orphans)", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: mixed,
      defaultBid: 0.75,
      autoNegate: true,
    });
    expect(sheetRows(workbook)).toHaveLength(summary.exactRows + summary.negativeRows);
  });

  it("every negative points at its own source campaign", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: mixed,
      defaultBid: 0.75,
      autoNegate: true,
    });
    const byTerm = Object.fromEntries(
      negatives(workbook).map((r) => [r["Keyword Text"], r["Campaign Name"]]),
    );
    expect(byTerm["alpha"]).toBe("C_Broad");
    expect(byTerm["gamma"]).toBe("C_Phrase");
  });
});

// ---- ASIN / product-targeting path -----------------------------------------

describe("ASIN harvest path respects the toggle", () => {
  const asinRow = row({
    termKind: "ASIN",
    cleanedTerm: "b0abcdefgh",
    searchTerm: "B0ABCDEFGH",
    matchType: "broad",
  });

  it("OFF → product targeting only, no negative product targeting", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [asinRow],
      defaultBid: 0.75,
      autoNegate: false,
    });
    expect(entities(workbook)).toEqual(["Product Targeting"]);
  });

  it("ON → adds Negative product targeting", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [asinRow],
      defaultBid: 0.75,
      autoNegate: true,
    });
    expect(entities(workbook).sort()).toEqual(["Negative product targeting", "Product Targeting"]);
  });
});

// ---- Spec conformance: library default should be OFF ------------------------

describe("spec conformance — library default", () => {
  it("defaults autoNegate to OFF when the caller omits it", () => {
    const { summary } = buildHarvestBulkWorkbook({
      rows: [row()],
      defaultBid: 0.75,
    });
    expect(summary.negativeRows).toBe(0);
  });
});

// ---- Dismissed / un-harvested rows ------------------------------------------

describe("dismissed and un-harvested rows", () => {
  it("never generate negatives even with the toggle ON", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: [
        row({ id: "d", dismissed: true }),
        row({ id: "u", harvested: false, cleanedTerm: "other", searchTerm: "other" }),
      ],
      defaultBid: 0.75,
      autoNegate: true,
    });
    expect(summary.exactRows).toBe(0);
    expect(negatives(workbook)).toHaveLength(0);
  });
});

// ---- Destination resolution (new model) -------------------------------------

describe("destination campaign + ad group resolution", () => {
  it("positive rows use the DESTINATION ad group, not the source ad group", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [row({ adGroupName: "SRC-AdGroup", destinationAdGroup: "DEST-AdGroup" })],
      defaultBid: 0.75,
      autoNegate: false,
    });
    const kw = sheetRows(workbook).find((r) => r.Entity === "Keyword")!;
    expect(kw["Ad Group Name"]).toBe("DEST-AdGroup");
    expect(kw["Campaign Name"]).toBe("Widget Cover_Exact");
  });

  it("negative rows still use the SOURCE campaign and SOURCE ad group", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [row({ adGroupName: "SRC-AdGroup", destinationAdGroup: "DEST-AdGroup" })],
      defaultBid: 0.75,
      autoNegate: true,
    });
    const neg = negatives(workbook)[0];
    expect(neg["Ad Group Name"]).toBe("SRC-AdGroup");
    expect(neg["Campaign Name"]).toBe("Widget Cover_Broad");
  });

  it("skips rows with no destination campaign and warns", () => {
    const { workbook, warnings } = buildHarvestBulkWorkbook({
      rows: [row({ destinationCampaign: "" })],
      defaultBid: 0.75,
      autoNegate: false,
    });
    expect(sheetRows(workbook)).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/no destination campaign and ad group/i);
  });

  it("skips rows with no destination ad group and warns", () => {
    const { workbook, warnings } = buildHarvestBulkWorkbook({
      rows: [row({ destinationAdGroup: "" })],
      defaultBid: 0.75,
      autoNegate: false,
    });
    expect(sheetRows(workbook)).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/no destination campaign and ad group/i);
  });

  it("an unresolved row never emits a negative either", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [row({ destinationAdGroup: "" })],
      defaultBid: 0.75,
      autoNegate: true,
    });
    expect(negatives(workbook)).toHaveLength(0);
  });

  it("dedups on destination ad group — same term, two source ad groups, one destination", () => {
    const { workbook, summary } = buildHarvestBulkWorkbook({
      rows: [
        row({ id: "a", adGroupName: "SRC-A", destinationAdGroup: "DEST-1" }),
        row({ id: "b", adGroupName: "SRC-B", destinationAdGroup: "DEST-1" }),
      ],
      defaultBid: 0.75,
      autoNegate: false,
    });
    expect(sheetRows(workbook).filter((r) => r.Entity === "Keyword")).toHaveLength(1);
    expect(summary.duplicateExactsRemoved).toBe(1);
  });

  it("does NOT dedup across different destination ad groups", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [
        row({ id: "a", destinationAdGroup: "DEST-1" }),
        row({ id: "b", destinationAdGroup: "DEST-2" }),
      ],
      defaultBid: 0.75,
      autoNegate: false,
    });
    expect(sheetRows(workbook).filter((r) => r.Entity === "Keyword")).toHaveLength(2);
  });

  it("guessDestinationCampaign is gone from the module", async () => {
    const mod: any = await import("@/lib/ui/searchTermHarvest");
    expect(mod.guessDestinationCampaign).toBeUndefined();
  });
});