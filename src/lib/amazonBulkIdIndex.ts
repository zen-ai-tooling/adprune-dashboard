// src/lib/amazonBulkIdIndex.ts
import * as XLSX from "xlsx";

export interface BulkIdMatch {
  product: "SP" | "SB" | "SD";
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  targetingId?: string;
  productTargetingId?: string;
}

export interface BulkIdIndex {
  findCampaign(product: "SP" | "SB" | "SD", campaignName: string): BulkIdMatch | undefined;
  findKeyword(
    product: "SP" | "SB" | "SD",
    campaignName: string,
    adGroupName: string,
    keywordText: string,
    matchType?: string,
  ): BulkIdMatch | undefined;
  findTargeting(
    product: "SP" | "SB" | "SD",
    campaignName: string,
    adGroupName: string,
    targetingText: string,
  ): BulkIdMatch | undefined;
  listCampaignNames(product: "SP" | "SB" | "SD"): string[];
}

const DEBUG_BULK_INDEX = false;

/* =========================
 * Helpers
 * ========================= */

const normalizeText = (text: string): string => {
  return text.toLowerCase().trim().replace(/\s+/g, " ").replace(/[""]/g, '"').replace(/['']/g, "'");
};

const normalizeHeader = (header: string): string => {
  return header
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
};

const findColumn = (headers: string[], possibleNames: string[]): number => {
  const normalizedHeaders = headers.map((h) => normalizeHeader(h));
  for (const name of possibleNames) {
    const normalized = normalizeHeader(name);
    const index = normalizedHeaders.indexOf(normalized);
    if (index !== -1) return index;
  }
  return -1;
};

const normalizeProduct = (productValue: string): "SP" | "SB" | "SD" | null => {
  const norm = normalizeText(productValue);
  if (norm.includes("sponsored products") || norm === "sponsored products") return "SP";
  if (norm.includes("sponsored brands") || norm === "sponsored brands") return "SB";
  if (norm.includes("sponsored display") || norm === "sponsored display") return "SD";
  return null;
};

const normalizeMatchType = (matchType: string): string => {
  const norm = matchType.toLowerCase().trim();
  if (norm === "exact" || norm === "exact match") return "exact";
  if (norm === "phrase" || norm === "phrase match") return "phrase";
  if (norm === "broad" || norm === "broad match") return "broad";
  if (norm.includes("negative")) return norm;
  return norm;
};

/* =========================
 * Builder
 * ========================= */

export function buildBulkIdIndexFromWorkbook(workbook: XLSX.WorkBook): BulkIdIndex {
  const campaignIndex = new Map<string, BulkIdMatch>();
  const keywordIndex = new Map<string, BulkIdMatch>();
  const targetingIndex = new Map<string, BulkIdMatch>();
  const campaignNamesByProduct: Record<"SP" | "SB" | "SD", Set<string>> = {
    SP: new Set(),
    SB: new Set(),
    SD: new Set(),
  };

  if (DEBUG_BULK_INDEX) console.log("[B2 BULK] building bulk ID index, sheets:", workbook.SheetNames);

  // DEBUG: collect a few sample keys so we can compare against lookups later
  const sampleKeywordKeys: string[] = [];
  const sampleTargetingKeys: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const normSheetName = normalizeHeader(sheetName);

    // Detect Bulk 2.0 sheets by sheet name
    const isSP = normSheetName.includes("sponsoredproducts");
    const isSB = normSheetName.includes("sponsoredbrands");
    const isSD = normSheetName.includes("sponsoreddisplay");

    if (!isSP && !isSB && !isSD) continue;

    // NEW: infer product from sheet name (Bulk 2.0 often has no "Product" column)
    const sheetProduct: "SP" | "SB" | "SD" | null = isSP ? "SP" : isSB ? "SB" : isSD ? "SD" : null;

    const ws = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
    if (!data.length) continue;

    // Find header row (contains "Product" or "Campaign")
    let headerRowIndex = 0;
    for (let i = 0; i < Math.min(5, data.length); i++) {
      const row = data[i];
      if (
        row &&
        row.some((cell: any) => {
          const norm = normalizeHeader(String(cell || ""));
          return norm === "product" || norm.includes("campaign");
        })
      ) {
        headerRowIndex = i;
        break;
      }
    }

    const headers = (data[headerRowIndex] || []).map((h) => String(h ?? ""));

    // Find columns
    const productCol = findColumn(headers, ["Product", "Product Type", "Record Type"]);
    const campaignNameCol = findColumn(headers, ["Campaign Name", "Campaign"]);
    const campaignIdCol = findColumn(headers, [
      "Campaign Id",
      "Campaign ID",
      "CampaignId",
      "campaignId",
      "Campaign Id (Informational only)",
    ]);
    const adGroupNameCol = findColumn(headers, ["Ad Group Name", "Ad Group"]);
    const adGroupIdCol = findColumn(headers, [
      "Ad Group Id",
      "Ad Group ID",
      "AdGroupId",
      "adGroupId",
      "Ad Group Id (Informational only)",
    ]);
    const keywordTextCol = findColumn(headers, ["Keyword Text", "Keyword"]);
    const keywordIdCol = findColumn(headers, ["Keyword Id", "Keyword ID", "KeywordId", "keywordId"]);
    const targetingTextCol = findColumn(headers, [
      "Targeting Text",
      "Targeting Expression",
      "Product Targeting Expression",
      "Resolved Targeting Expression (Informational only)",
      "Product Targeting",
    ]);
    const targetingIdCol = findColumn(headers, ["Targeting Id", "Targeting ID", "TargetingId", "targetingId"]);
    const productTargetingIdCol = findColumn(headers, [
      "Product Targeting Id",
      "Product Targeting ID",
      "ProductTargetingId",
      "productTargetingId",
    ]);
    const matchTypeCol = findColumn(headers, ["Match Type", "MatchType"]);

    if (campaignNameCol === -1) continue;

    // Process rows
    for (let r = headerRowIndex + 1; r < data.length; r++) {
      const row = data[r];
      if (!row || row.length === 0) continue;

      // Prefer product inferred from the sheet; fall back to row-level value only if needed
      const productValue = productCol !== -1 ? String(row[productCol] ?? "").trim() : "";
      let product: "SP" | "SB" | "SD" | null = sheetProduct;

      if (!product && productValue) {
        product = normalizeProduct(productValue);
      }

      if (!product) {
        // If we still don't know the product, skip this row
        continue;
      }

      const campaignName = campaignNameCol !== -1 ? String(row[campaignNameCol] ?? "").trim() : "";
      if (!campaignName) continue;

      const campaignId = campaignIdCol !== -1 ? String(row[campaignIdCol] ?? "").trim() : "";
      const adGroupName = adGroupNameCol !== -1 ? String(row[adGroupNameCol] ?? "").trim() : "";
      const adGroupId = adGroupIdCol !== -1 ? String(row[adGroupIdCol] ?? "").trim() : "";
      const keywordText = keywordTextCol !== -1 ? String(row[keywordTextCol] ?? "").trim() : "";
      const keywordId = keywordIdCol !== -1 ? String(row[keywordIdCol] ?? "").trim() : "";
      const targetingText = targetingTextCol !== -1 ? String(row[targetingTextCol] ?? "").trim() : "";
      const targetingId = targetingIdCol !== -1 ? String(row[targetingIdCol] ?? "").trim() : "";
      const productTargetingId = productTargetingIdCol !== -1 ? String(row[productTargetingIdCol] ?? "").trim() : "";
      const matchType = matchTypeCol !== -1 ? String(row[matchTypeCol] ?? "").trim() : "";

      // Track campaign names per product
      campaignNamesByProduct[product].add(campaignName);

      // Index campaign
      const campaignKey = `${product}|${normalizeText(campaignName)}`;
      if (!campaignIndex.has(campaignKey) && campaignId) {
        campaignIndex.set(campaignKey, {
          product,
          campaignId,
          adGroupId: adGroupId || undefined,
        });
      }

      // Index keyword
      if (keywordText && adGroupName) {
        const normMatchType = matchType ? normalizeMatchType(matchType) : "";
        const keywordKey = `${product}|${normalizeText(campaignName)}|${normalizeText(adGroupName)}|${normalizeText(keywordText)}|${normMatchType}`;
        if (!keywordIndex.has(keywordKey) && (keywordId || campaignId)) {
          keywordIndex.set(keywordKey, {
            product,
            campaignId: campaignId || undefined,
            adGroupId: adGroupId || undefined,
            keywordId: keywordId || undefined,
          });

          // DEBUG: capture a few SP keyword keys
          if (product === "SP" && sampleKeywordKeys.length < 20) {
            sampleKeywordKeys.push(keywordKey);
          }
        }
      }

      // Index targeting
      if (targetingText && adGroupName) {
        const targetingKey = `${product}|${normalizeText(campaignName)}|${normalizeText(adGroupName)}|${normalizeText(targetingText)}`;
        if (!targetingIndex.has(targetingKey) && (targetingId || productTargetingId || campaignId)) {
          targetingIndex.set(targetingKey, {
            product,
            campaignId: campaignId || undefined,
            adGroupId: adGroupId || undefined,
            targetingId: targetingId || undefined,
            productTargetingId: productTargetingId || undefined,
          });

          // DEBUG: capture a few SP targeting keys
          if (product === "SP" && sampleTargetingKeys.length < 20) {
            sampleTargetingKeys.push(targetingKey);
          }
        }
      }
    }
  }

  if (DEBUG_BULK_INDEX) {
    console.log("[B2 BULK] keywordIndex size:", keywordIndex.size);
    console.log("[B2 BULK] sampleKeywordKeys:", sampleKeywordKeys);
    console.log("[B2 BULK] targetingIndex size:", targetingIndex.size);
    console.log("[B2 BULK] sampleTargetingKeys:", sampleTargetingKeys);
  }

  return {
    findCampaign(product: "SP" | "SB" | "SD", campaignName: string): BulkIdMatch | undefined {
      const key = `${product}|${normalizeText(campaignName)}`;
      return campaignIndex.get(key);
    },

    findKeyword(
      product: "SP" | "SB" | "SD",
      campaignName: string,
      adGroupName: string,
      keywordText: string,
      matchType?: string,
    ): BulkIdMatch | undefined {
      const normMatchType = matchType ? normalizeMatchType(matchType) : "";
      const key = `${product}|${normalizeText(campaignName)}|${normalizeText(adGroupName)}|${normalizeText(keywordText)}|${normMatchType}`;
      return keywordIndex.get(key);
    },

    findTargeting(
      product: "SP" | "SB" | "SD",
      campaignName: string,
      adGroupName: string,
      targetingText: string,
    ): BulkIdMatch | undefined {
      const key = `${product}|${normalizeText(campaignName)}|${normalizeText(adGroupName)}|${normalizeText(targetingText)}`;
      return targetingIndex.get(key);
    },

    listCampaignNames(product: "SP" | "SB" | "SD"): string[] {
      return Array.from(campaignNamesByProduct[product]).sort();
    },
  };
}
