import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildBulkIdIndexFromWorkbook } from "@/lib/amazonBulkIdIndex";
import { buildHarvestBulkWorkbook, type HarvestRow } from "@/lib/ui/searchTermHarvest";

/** Build a realistic Amazon bulk export: a Broad source campaign and an Exact destination. */
const makeReferenceBulk = (): XLSX.WorkBook => {
  const rows = [
    ["Product","Entity","Campaign Id","Campaign Name","Ad Group Id","Ad Group Name","Keyword Text","Match Type"],
    ["Sponsored Products","Keyword","CID-BROAD-1","SP-BROAD-B01-Tie Down","AGID-BROAD-1","AG-Broad-Main","e track","broad"],
    ["Sponsored Products","Keyword","CID-EXACT-1","SP-Exact-B01-Tie Down","AGID-EXACT-1","AG-Exact-Main","existing kw","exact"],
    ["Sponsored Products","Keyword","CID-EXACT-1","SP-Exact-B01-Tie Down","AGID-EXACT-2","AG-Exact-Secondary","other kw","exact"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sponsored Products Campaigns");
  return wb;
};

const srcRow = (over: Partial<HarvestRow> = {}): HarvestRow => ({
  campaignName: "SP-BROAD-B01-Tie Down",
  adGroupName: "AG-Broad-Main",
  advertisedASIN: "B012345678",
  searchTerm: "e track tie down",
  matchType: "broad",
  clicks: 20, spend: 10, cpc: 0.5, orders: 3, sales: 60, acos: 0.16,
  __rowIndex: 1, id: "r1",
  cleanedTerm: "e track tie down",
  termKind: "KEYWORD", lengthWarning: false,
  destinationCampaign: "SP-Exact-B01-Tie Down",
  destinationAdGroup: "AG-Exact-Main",
  dismissed: false, harvested: true,
  ...over,
});

const flat = (wb: XLSX.WorkBook) => {
  const out: Record<string, any>[] = [];
  for (const n of wb.SheetNames) {
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[n], { header: 1 });
    if (aoa.length < 2) continue;
    const h = aoa[0].map(String);
    for (const r of aoa.slice(1)) {
      const o: Record<string, any> = {};
      h.forEach((k, i) => (o[k] = r[i]));
      out.push(o);
    }
  }
  return out;
};

describe("END TO END: reference bulk → destination resolution → output file", () => {
  const index = buildBulkIdIndexFromWorkbook(makeReferenceBulk());

  it("index lists both ad groups of the destination campaign", () => {
    const ags = index.listAdGroups("SP", "SP-Exact-B01-Tie Down");
    expect(ags.map((a) => a.name)).toEqual(["AG-Exact-Main", "AG-Exact-Secondary"]);
    expect(ags.find((a) => a.name === "AG-Exact-Main")!.id).toBe("AGID-EXACT-1");
  });

  it("positive row carries the DESTINATION campaign id AND ad group id", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [srcRow()], defaultBid: 0.75, autoNegate: true, bulkIdIndex: index,
    });
    const kw = flat(workbook).find((r) => r.Entity === "Keyword")!;
    expect(kw["Campaign Name"]).toBe("SP-Exact-B01-Tie Down");
    expect(kw["Ad Group Name"]).toBe("AG-Exact-Main");
    expect(kw["Campaign Id"]).toBe("CID-EXACT-1");
    expect(kw["Ad Group Id"]).toBe("AGID-EXACT-1");
  });

  it("the campaign/ad group PAIR actually exists in the reference bulk", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [srcRow()], defaultBid: 0.75, autoNegate: true, bulkIdIndex: index,
    });
    for (const r of flat(workbook)) {
      const valid = index.listAdGroups("SP", r["Campaign Name"]).map((a) => a.name);
      expect(valid, `${r["Campaign Name"]} / ${r["Ad Group Name"]}`).toContain(r["Ad Group Name"]);
    }
  });

  it("negative row targets the SOURCE campaign id and source ad group", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [srcRow()], defaultBid: 0.75, autoNegate: true, bulkIdIndex: index,
    });
    const neg = flat(workbook).find((r) => String(r.Entity).startsWith("Negative"))!;
    expect(neg["Campaign Name"]).toBe("SP-BROAD-B01-Tie Down");
    expect(neg["Ad Group Name"]).toBe("AG-Broad-Main");
    expect(neg["Campaign Id"]).toBe("CID-BROAD-1");
  });

  it("selecting the SECOND ad group routes there instead", () => {
    const { workbook } = buildHarvestBulkWorkbook({
      rows: [srcRow({ destinationAdGroup: "AG-Exact-Secondary" })],
      defaultBid: 0.75, autoNegate: false, bulkIdIndex: index,
    });
    const kw = flat(workbook).find((r) => r.Entity === "Keyword")!;
    expect(kw["Ad Group Name"]).toBe("AG-Exact-Secondary");
    expect(kw["Ad Group Id"]).toBe("AGID-EXACT-2");
  });
});