// Search Term Harvesting — isolated utilities.
// Lives under src/lib/ui/ so it does not touch any "sacred" engines.

import * as XLSX from "xlsx";

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
  return String(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
};

export const isASIN = (s: string): boolean => ASIN_REGEX.test(s.trim());

export const exceedsLength = (s: string): boolean => {
  const trimmed = s.trim();
  if (trimmed.length > 80) return true;
  const words = trimmed.split(/\s+/).filter(Boolean);
  return words.length > 10;
};

// Smart destination guesser:
// `BrandABC_Auto_Blenders` → `BrandABC_Exact_Blenders`
// `BrandABC_Broad_X` → `BrandABC_Exact_X`
// fallback: append `_Exact_Harvest`
export const guessDestinationCampaign = (source: string): string => {
  if (!source) return "";
  const replaced = source.replace(/(_)(Auto|Broad|Phrase|Discovery|Research)(_|$)/i, "$1Exact$3");
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

  // Prefer a sheet that smells like a search term report.
  const candidate =
    wb.SheetNames.find((n) => /search\s*term/i.test(n)) ??
    wb.SheetNames.find((n) => /sp.*search/i.test(n)) ??
    wb.SheetNames[0];
  const ws = wb.Sheets[candidate];
  const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

  if (!aoa.length) {
    return { rows: [], sheetUsed: candidate, totalRowsRead: 0 };
  }

  // Find header row (first row with >=4 non-empty cells)
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
    if (acos > 5) acos = acos / 100; // percent → ratio

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

// ── Amazon Bulk Export ──
// Produces two-row pairs per harvest:
//   Row A: Keyword/Product Targeting CREATE in destination campaign (Exact match)
//   Row B: Negative Exact in source campaign/ad group (cannibalization guard)

export interface BulkExportInput {
  rows: HarvestRow[];
  defaultBid: number;
  lookbackLabel: string;
}

export const buildHarvestBulkWorkbook = ({ rows, defaultBid, lookbackLabel }: BulkExportInput) => {
  const SP_HEADERS = [
    "Record Type",
    "Operation",
    "Campaign Name",
    "Ad Group Name",
    "Keyword Text",
    "Product Targeting Expression",
    "Match Type",
    "State",
    "Bid",
    "Advertised ASIN",
    "Source Campaign",
    "Lookback Window",
    "Notes",
  ];
  const aoa: any[][] = [SP_HEADERS];

  rows.forEach((r) => {
    if (r.dismissed || !r.harvested) return;
    const bid = Number.isFinite(r.cpc) && r.cpc > 0 ? Math.max(r.cpc, 0.02) : defaultBid;

    if (r.termKind === "KEYWORD") {
      // Stage exact-match keyword in destination campaign
      aoa.push([
        "Keyword",
        "Create",
        r.destinationCampaign,
        r.adGroupName,
        r.cleanedTerm,
        "",
        "exact",
        "enabled",
        bid.toFixed(2),
        r.advertisedASIN,
        r.campaignName,
        lookbackLabel,
        "Harvested from search term report",
      ]);
      // Negative exact in source
      aoa.push([
        "Negative Keyword",
        "Create",
        r.campaignName,
        r.adGroupName,
        r.cleanedTerm,
        "",
        "negativeExact",
        "enabled",
        "",
        r.advertisedASIN,
        r.campaignName,
        lookbackLabel,
        "Block cannibalization of harvested term",
      ]);
    } else {
      // ASIN / Product Targeting (PAT)
      const expr = `asin="${r.cleanedTerm.toUpperCase()}"`;
      aoa.push([
        "Product Targeting",
        "Create",
        r.destinationCampaign,
        r.adGroupName,
        "",
        expr,
        "",
        "enabled",
        bid.toFixed(2),
        r.advertisedASIN,
        r.campaignName,
        lookbackLabel,
        "Harvested PAT from search term report",
      ]);
      aoa.push([
        "Negative Product Targeting",
        "Create",
        r.campaignName,
        r.adGroupName,
        "",
        expr,
        "",
        "enabled",
        "",
        r.advertisedASIN,
        r.campaignName,
        lookbackLabel,
        "Block cannibalization of harvested PAT",
      ]);
    }
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Harvest");
  return wb;
};

export const downloadWorkbook = (wb: XLSX.WorkBook, fileName: string) => {
  XLSX.writeFile(wb, fileName);
};
