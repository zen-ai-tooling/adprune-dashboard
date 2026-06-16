// Search Term Harvesting — isolated utilities.
// Lives under src/lib/ui/ so it does not touch any "sacred" engines.

import * as XLSX from "xlsx";
import {
  BULK_UPDATE_HEADERS,
  type AmazonProduct,
} from "@/lib/amazonBulkBuilder";
import { buildBulkIdIndexFromWorkbook, type BulkIdIndex } from "@/lib/amazonBulkIdIndex";

export type LookbackPreset = "30d" | "60d" | "90d" | "custom";

export interface RawSearchTermRow {
  campaignName: string;
  adGroupName: string;
  advertisedASIN: string;
  searchTerm: string;
  matchType: string;
  clicks: number;
  spend: number;
  cpc: number;
  orders: number;
  sales: number;
  acos: number; // 0–1 ratio normalized later if percent
  __rowIndex: number;
}

export interface HarvestRow extends RawSearchTermRow {
  id: string;
  cleanedTerm: string;
  termKind: "ASIN" | "KEYWORD";
  lengthWarning: boolean;
  destinationCampaign: string;
  dismissed: boolean;
  harvested: boolean;
}

const ASIN_REGEX = /^B0[A-Z0-9]{8}$/i;

export const sanitizeTerm = (s: string): string => {
  if (!s) return "";
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
};

export const isASIN = (s: string): boolean => ASIN_REGEX.test(s.trim());

export const exceedsLength = (s: string): boolean => {
  const trimmed = s.trim();
  if (trimmed.length > 80) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length > 10;
};

export const guessDestinationCampaign = (source: string): string => {
  if (!source) return "";
  const replaced = source.replace(/([-_ ])(Auto|Broad|Phrase|Discovery|Research)([-_ ]|$)/i, "$1Exact$3");
  if (replaced !== source) return replaced;
  return `${source}_Exact_Harvest`;
};

// ── Parsing ──

const HEADER_ALIASES: Record<keyof Omit<RawSearchTermRow, "__rowIndex">, string[]> = {
  campaignName: ["campaign name", "campaign", "campaign name (informational only)"],
  adGroupName: ["ad group name", "ad group", "ad group name (informational only)"],
  advertisedASIN: ["advertised asin", "asin", "child asin", "advertised sku"],
  searchTerm: ["customer search term", "search term", "search term text"],
  matchType: ["match type"],
  clicks: ["clicks"],
  spend: ["spend", "cost", "ad spend"],
  cpc: ["cpc", "cost per click"],
  orders: ["orders", "7 day total orders (#)", "14 day total orders (#)", "total orders"],
  sales: ["sales", "7 day total sales", "14 day total sales", "total sales"],
  acos: ["acos", "total acos", "acos %", "total advertising cost of sales (acos) "],
};

const norm = (s: any) => String(s ?? "").toLowerCase().replace(/[%()#]/g, "").replace(/\s+/g, " ").trim();

const buildColMap = (headers: any[]): Partial<Record<keyof RawSearchTermRow, number>> => {
  const map: Partial<Record<keyof RawSearchTermRow, number>> = {};
  const normHeaders = headers.map(norm);
  (Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>).forEach((field) => {
    for (const alias of HEADER_ALIASES[field]) {
      const a = norm(alias);
      const idx = normHeaders.findIndex((h) => h === a || h.startsWith(a));
      if (idx >= 0) {
        map[field] = idx;
        return;
      }
    }
  });
  return map;
};

const num = (v: any): number => {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[$,%\s]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
};

export interface ParseResult {
  rows: HarvestRow[];
  sheetUsed: string;
  totalRowsRead: number;
}

export const parseSearchTermReport = async (file: File): Promise<ParseResult> => {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const candidate =
    wb.SheetNames.find((n) => /search\s*term/i.test(n)) ??
    wb.SheetNames.find((n) => /sp.*search/i.test(n)) ??
    wb.SheetNames[0];
  const ws = wb.Sheets[candidate];
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

  if (!aoa.length) {
    return { rows: [], sheetUsed: candidate, totalRowsRead: 0 };
  }

  let headerIdx = 0;
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    if (aoa[i].filter((c) => String(c ?? "").trim()).length >= 4) {
      headerIdx = i;
      break;
    }
  }
  const headers = aoa[headerIdx];
  const colMap = buildColMap(headers);
  const rows: HarvestRow[] = [];

  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const row = aoa[r];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const rawTerm = String(row[colMap.searchTerm ?? -1] ?? "").trim();
    if (!rawTerm) continue;

    const cleaned = sanitizeTerm(rawTerm);
    const campaign = String(row[colMap.campaignName ?? -1] ?? "").trim();
    const adGroup = String(row[colMap.adGroupName ?? -1] ?? "").trim();
    const asin = String(row[colMap.advertisedASIN ?? -1] ?? "").trim();

    let acos = num(row[colMap.acos ?? -1]);
    if (acos > 5) acos = acos / 100;

    const raw: RawSearchTermRow = {
      campaignName: campaign,
      adGroupName: adGroup,
      advertisedASIN: asin,
      searchTerm: rawTerm,
      matchType: String(row[colMap.matchType ?? -1] ?? "").trim(),
      clicks: num(row[colMap.clicks ?? -1]),
      spend: num(row[colMap.spend ?? -1]),
      cpc: num(row[colMap.cpc ?? -1]),
      orders: num(row[colMap.orders ?? -1]),
      sales: num(row[colMap.sales ?? -1]),
      acos,
      __rowIndex: r,
    };

    const termKind: "ASIN" | "KEYWORD" = isASIN(cleaned) ? "ASIN" : "KEYWORD";

    rows.push({
      ...raw,
      id: `${campaign}|${adGroup}|${asin}|${cleaned}|${r}`,
      cleanedTerm: cleaned,
      termKind,
      lengthWarning: exceedsLength(cleaned),
      destinationCampaign: guessDestinationCampaign(campaign),
      dismissed: false,
      harvested: false,
    });
  }

  return { rows, sheetUsed: candidate, totalRowsRead: aoa.length - headerIdx - 1 };
};

// ── Reference Bulk File parser → BulkIdIndex ──
export const parseReferenceBulkFile = async (file: File): Promise<BulkIdIndex> => {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  return buildBulkIdIndexFromWorkbook(wb);
};

// ── Amazon Bulksheets 2.0 Export ──

export interface HarvestExportSummary {
  exactRows: number;
  negativeRows: number;
  duplicateExactsRemoved: number;
  destinationsMissing: number;
  campaignsAffected: number;
}

export interface BulkExportInput {
  rows: HarvestRow[];
  defaultBid: number;
  maxBid?: number;
  dateRangeLabel?: string; // e.g. "60d"
  bulkIdIndex?: BulkIdIndex;
}

interface BuiltRow {
  product: AmazonProduct;
  entity: string;
  operation: "Create";
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  keywordText: string;
  targetingText: string;
  matchType: string;
  bid: string;
  state: "Enabled";
  destinationMissing?: boolean;
}

const toRowArray = (r: BuiltRow): any[] => [
  r.product,
  r.entity,
  r.operation,
  r.campaignId,
  r.campaignName,
  r.adGroupId,
  r.adGroupName,
  "", // Keyword Id
  "", // Product Targeting Id
  "", // Targeting Id
  r.keywordText,
  r.targetingText,
  r.matchType,
  r.bid,
  r.state,
];

export const buildHarvestBulkWorkbook = ({
  rows,
  defaultBid,
  maxBid,
  bulkIdIndex,
}: BulkExportInput): { workbook: XLSX.WorkBook; summary: HarvestExportSummary; warnings: string[] } => {
  const warnings: string[] = [];
  const bidCap = Number.isFinite(maxBid) && (maxBid as number) > 0 ? (maxBid as number) : defaultBid * 3;

  // 1. Dedup exact-keyword creations by (cleanedTerm + destinationCampaign + adGroupName).
  //    Keep highest-sales winner.
  const exactKey = (r: HarvestRow) => `${r.cleanedTerm}||${r.destinationCampaign}||${r.adGroupName}`;
  const exactWinners = new Map<string, HarvestRow>();
  let dupsRemoved = 0;
  for (const r of rows) {
    if (r.dismissed || !r.harvested) continue;
    const k = exactKey(r);
    const cur = exactWinners.get(k);
    if (!cur) {
      exactWinners.set(k, r);
    } else {
      dupsRemoved++;
      if (r.sales > cur.sales) exactWinners.set(k, r);
    }
  }

  // 2. Negative rows — dedup by (source campaign + ad group + cleanedTerm).
  const negKey = (r: HarvestRow) => `${r.campaignName}||${r.adGroupName}||${r.cleanedTerm}`;
  const negWinners = new Map<string, HarvestRow>();
  for (const r of rows) {
    if (r.dismissed || !r.harvested) continue;
    const k = negKey(r);
    if (!negWinners.has(k)) negWinners.set(k, r);
  }

  if (dupsRemoved > 0) warnings.push(`Removed ${dupsRemoved} duplicate exact keyword entries`);

  // Build rows
  const built: BuiltRow[] = [];
  let destinationsMissing = 0;
  let bidsCapped = 0;
  const campaignsAffected = new Set<string>();

  for (const r of exactWinners.values()) {
    const rawBid = Number.isFinite(r.cpc) && r.cpc > 0 ? Math.max(r.cpc, 0.02) : defaultBid;
    const bid = Math.min(rawBid, bidCap);
    if (rawBid > bidCap) bidsCapped++;
    const destMatch = bulkIdIndex?.findCampaign("SP", r.destinationCampaign);
    if (bulkIdIndex && !destMatch) destinationsMissing++;
    campaignsAffected.add(r.destinationCampaign);

    if (r.termKind === "KEYWORD") {
      built.push({
        product: "Sponsored Products",
        entity: "Keyword",
        operation: "Create",
        campaignId: destMatch?.campaignId ?? "",
        campaignName: r.destinationCampaign,
        // For destination Create rows, leave adGroupId empty — Amazon resolves by name.
        // destMatch.adGroupId may belong to a different ad group than r.adGroupName.
        adGroupId: "",
        adGroupName: r.adGroupName,
        keywordText: r.cleanedTerm,
        targetingText: "",
        matchType: "Exact",
        bid: bid.toFixed(2),
        state: "Enabled",
        destinationMissing: bulkIdIndex && !destMatch,
      });
    } else {
      const expr = `asin="${r.cleanedTerm.toUpperCase()}"`;
      built.push({
        product: "Sponsored Products",
        entity: "Product Targeting",
        operation: "Create",
        campaignId: destMatch?.campaignId ?? "",
        campaignName: r.destinationCampaign,
        adGroupId: "",
        adGroupName: r.adGroupName,
        keywordText: "",
        targetingText: expr,
        matchType: "",
        bid: bid.toFixed(2),
        state: "Enabled",
        destinationMissing: bulkIdIndex && !destMatch,
      });
    }
  }

  if (bidsCapped > 0) {
    warnings.push(`${bidsCapped} bid(s) capped at $${bidCap.toFixed(2)} (3× default bid).`);
  }

  let exactRows = built.length;

  for (const r of negWinners.values()) {
    // Don't create negatives for terms that already came from Exact match —
    // a negative exact would disable the existing positive exact keyword in the same ad group.
    if (r.matchType.trim().toLowerCase() === "exact") {
      warnings.push(`Skipped negative for "${r.cleanedTerm}" in ${r.campaignName} — source is already Exact match.`);
      continue;
    }
    const srcMatch = bulkIdIndex?.findCampaign("SP", r.campaignName);
    campaignsAffected.add(r.campaignName);

    if (r.termKind === "KEYWORD") {
      built.push({
        product: "Sponsored Products",
        entity: "Negative keyword",
        operation: "Create",
        campaignId: srcMatch?.campaignId ?? "",
        campaignName: r.campaignName,
        adGroupId: "",
        adGroupName: r.adGroupName,
        keywordText: r.cleanedTerm,
        targetingText: "",
        matchType: "Negative Exact",
        bid: "",
        state: "Enabled",
      });
    } else {
      const expr = `asin="${r.cleanedTerm.toUpperCase()}"`;
      built.push({
        product: "Sponsored Products",
        entity: "Negative product targeting",
        operation: "Create",
        campaignId: srcMatch?.campaignId ?? "",
        campaignName: r.campaignName,
        adGroupId: "",
        adGroupName: r.adGroupName,
        keywordText: "",
        targetingText: expr,
        matchType: "",
        bid: "",
        state: "Enabled",
      });
    }
  }
  const negativeRows = built.length - exactRows;

  if (destinationsMissing > 0) {
    warnings.push(
      `${destinationsMissing} destination campaign(s) not found in reference bulk file — verify they exist.`,
    );
  }

  // 3. Group by product into tabs (Search Term Harvest is SP-only, but use canonical structure).
  const groups: Record<AmazonProduct, BuiltRow[]> = {
    "Sponsored Products": [],
    "Sponsored Brands": [],
    "Sponsored Display": [],
  };
  built.forEach((b) => groups[b.product].push(b));

  const wb = XLSX.utils.book_new();
  (Object.keys(groups) as AmazonProduct[]).forEach((prod) => {
    const list = groups[prod];
    if (!list.length) return;
    const aoa: any[][] = [BULK_UPDATE_HEADERS, ...list.map(toRowArray)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, prod);
  });

  // Ensure at least one sheet
  if (wb.SheetNames.length === 0) {
    const ws = XLSX.utils.aoa_to_sheet([BULK_UPDATE_HEADERS]);
    XLSX.utils.book_append_sheet(wb, ws, "Sponsored Products");
  }

  return {
    workbook: wb,
    summary: {
      exactRows,
      negativeRows,
      duplicateExactsRemoved: dupsRemoved,
      destinationsMissing,
      campaignsAffected: campaignsAffected.size,
    },
    warnings,
  };
};

export const downloadWorkbook = (wb: XLSX.WorkBook, fileName: string) => {
  XLSX.writeFile(wb, fileName);
};
