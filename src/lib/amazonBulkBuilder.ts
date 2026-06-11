/**
 * Amazon Bulksheets 2.0 canonical builder
 * This file is the SINGLE source of truth for post-decision Amazon upload formatting.
 */

export type AmazonRecordType =
  | "sponsoredProductsKeyword"
  | "sponsoredProductsNegativeKeyword"
  | "sponsoredProductsProductTargeting"
  | "sponsoredProductsNegativeProductTargeting"
  | "sponsoredProductsCampaign"
  | "sponsoredProductsAdGroup"
  | "sponsoredBrandsKeyword"
  | "sponsoredBrandsNegativeKeyword"
  | "sponsoredBrandsProductTargeting" // Supported
  | "sponsoredBrandsCampaign"
  | "sponsoredBrandsAdGroup"
  | "sponsoredDisplayProductTargeting"
  | "sponsoredDisplayNegativeProductTargeting"
  | "sponsoredDisplayCampaign"
  | "sponsoredDisplayAudienceTargeting"
  | "sponsoredDisplayAdGroup";

/**
 * Classifies whether an entity is a keyword or product targeting...
 */
export function classifyEntity(params: {
  matchType?: string;
  keywordText?: string;
  targetingText?: string;
}): "keyword" | "productTargeting" {
  const { matchType, keywordText, targetingText } = params;
  const mt = (matchType || "").toLowerCase().trim();

  // Explicit keywords
  if (mt === "exact" || mt === "phrase" || mt === "broad") {
    return "keyword";
  }

  const target = targetingText || keywordText || "";
  const targetLower = target.toLowerCase();

  // Explicit targeting signals
  if (targetLower.includes("asin=") || targetLower.includes("category=")) return "productTargeting";
  if (
    targetLower.includes("close-match") ||
    targetLower.includes("loose-match") ||
    targetLower.includes("substitutes") ||
    targetLower.includes("complements")
  ) {
    return "productTargeting";
  }
  if (
    targetLower.includes("views=") ||
    targetLower.includes("purchases=") ||
    targetLower.includes("price=") ||
    targetLower.includes("rating=") ||
    targetLower.includes("brand=") ||
    targetLower.includes("audience=")
  ) {
    return "productTargeting";
  }

  // Fallback heuristics
  if (mt && !mt.includes("negative")) return "keyword";
  if (target && !mt) return "productTargeting"; // likely SD or auto-target

  return "keyword";
}

export interface CanonicalBulkInputRow {
  recordType: AmazonRecordType;
  action: "pause" | "negative" | "cutBid" | "keep";
  campaignId?: string;
  adGroupId?: string;
  keywordId?: string;
  productTargetingId?: string;
  targetingId?: string;
  campaignName?: string;
  adGroupName?: string;
  keywordText?: string;
  targetingText?: string;
  matchType?: string;
  currentBid?: number;
  cutBidPercent?: number;
}

export type AmazonProduct = "Sponsored Products" | "Sponsored Brands" | "Sponsored Display";
type AmazonOperation = "Create" | "Update" | "Archive";

function toAmazonOperation(action: CanonicalBulkInputRow["action"]): AmazonOperation {
  if (action === "negative") return "Create";
  if (action === "pause" || action === "cutBid") return "Update";
  return "Update";
}

function toAmazonState(action: CanonicalBulkInputRow["action"]): string {
  if (action === "negative") return "Enabled";
  if (action === "pause") return "Paused";
  return "Enabled";
}

export function recordTypeToProductEntity(rt: AmazonRecordType): { product: AmazonProduct; entity: string } {
  const lower = rt.toLowerCase();

  if (lower.includes("sponsoredproducts")) {
    if (lower.includes("negativekeyword")) return { product: "Sponsored Products", entity: "Negative keyword" };
    if (lower.includes("keyword")) return { product: "Sponsored Products", entity: "Keyword" };
    if (lower.includes("negativeproducttargeting"))
      return { product: "Sponsored Products", entity: "Negative product targeting" };
    if (lower.includes("producttargeting")) return { product: "Sponsored Products", entity: "Product targeting" };
    if (lower.includes("campaign")) return { product: "Sponsored Products", entity: "Campaign" };
    if (lower.includes("adgroup")) return { product: "Sponsored Products", entity: "Ad group" };
  }

  if (lower.includes("sponsoredbrands")) {
    if (lower.includes("negativekeyword")) return { product: "Sponsored Brands", entity: "Negative keyword" };
    if (lower.includes("keyword")) return { product: "Sponsored Brands", entity: "Keyword" };
    if (lower.includes("producttargeting")) return { product: "Sponsored Brands", entity: "Product targeting" };
    if (lower.includes("campaign")) return { product: "Sponsored Brands", entity: "Campaign" };
    if (lower.includes("adgroup")) return { product: "Sponsored Brands", entity: "Ad group" };
  }

  if (lower.includes("sponsoreddisplay")) {
    if (lower.includes("negativeproducttargeting"))
      return { product: "Sponsored Display", entity: "Negative product targeting" };
    if (lower.includes("producttargeting")) return { product: "Sponsored Display", entity: "Product targeting" };
    if (lower.includes("campaign")) return { product: "Sponsored Display", entity: "Campaign" };
    if (lower.includes("adgroup")) return { product: "Sponsored Display", entity: "Ad group" };
    if (lower.includes("audiencetargeting")) return { product: "Sponsored Display", entity: "Audience targeting" };
  }

  return { product: "Sponsored Products", entity: "Keyword" };
}

// ------------------------------------------------------------------
// ✅ CANONICAL BULK HEADERS
// ------------------------------------------------------------------
export const BULK_UPDATE_HEADERS = [
  "Product",
  "Entity",
  "Operation",
  "Campaign Id",
  "Campaign Name",
  "Ad Group Id",
  "Ad Group Name",
  "Keyword Id",
  "Product Targeting Id",
  "Targeting Id",
  "Keyword Text",
  "Targeting Text",
  "Match Type",
  "Bid",
  "State",
];

export interface BuiltBulkRow {
  recordType: AmazonRecordType;
  action: CanonicalBulkInputRow["action"];
  campaignId?: string;
  campaignName?: string;
  adGroupId?: string;
  adGroupName?: string;
  keywordId?: string;
  productTargetingId?: string;
  targetingId?: string;
  keywordText?: string;
  targetingText?: string;
  matchType?: string;
  bid?: number;
}

export function buildBulkRowsFromCanonical(inputs: CanonicalBulkInputRow[]): BuiltBulkRow[] {
  const out: BuiltBulkRow[] = [];

  for (const row of inputs) {
    if (row.action === "keep") continue;

    let bid: number | undefined = undefined;
    if (row.action === "cutBid" && row.currentBid && row.cutBidPercent != null) {
      const rawBid = row.currentBid * (1 - row.cutBidPercent / 100);
      bid = Math.max(0.02, parseFloat(rawBid.toFixed(2)));
    }

    // --------------------------------------------------------------
    // 🔥 AUTO-CORRECTION LOGIC (The Enforcer) 🔥
    // --------------------------------------------------------------
    // 1. Grab whatever text we have (processor might have put it in the wrong bucket)
    const rawText = row.targetingText || row.keywordText || "";

    // 2. DETECT: Is this actually Product Targeting (ASIN/Category)?
    const isASIN = rawText.toLowerCase().includes("asin=") || rawText.toLowerCase().includes("category=");

    // 3. FORCE: If it is an ASIN, we MUST use Product Targeting record types
    let finalRecordType = row.recordType;

    if (isASIN) {
      // If the incoming record type was "Keyword", upgrade it to "ProductTargeting"
      if (finalRecordType.endsWith("Keyword")) {
        // e.g. "sponsoredBrandsKeyword" -> "sponsoredBrandsProductTargeting"
        finalRecordType = finalRecordType.replace("Keyword", "ProductTargeting") as AmazonRecordType;
      }
      if (finalRecordType.endsWith("NegativeKeyword")) {
        finalRecordType = finalRecordType.replace("NegativeKeyword", "NegativeProductTargeting") as AmazonRecordType;
      }
    }

    // 4. ROUTE: Send text to the correct column based on the (potentially upgraded) record type
    const lowerType = finalRecordType.toLowerCase();
    const isTargetingType = lowerType.includes("producttargeting") || lowerType.includes("audiencetargeting");

    out.push({
      recordType: finalRecordType,
      action: row.action,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      adGroupId: row.adGroupId,
      adGroupName: row.adGroupName,
      keywordId: row.keywordId || undefined,
      productTargetingId: row.productTargetingId || undefined,
      targetingId: row.targetingId || undefined,
      // If targeting type, force text to targetingText. If keyword type, force to keywordText.
      keywordText: !isTargetingType ? rawText : undefined,
      targetingText: isTargetingType ? rawText : undefined,
      matchType: row.matchType,
      bid,
    });
  }

  // Deduplicate: same key = same logical row. For cutBid, keep the lower bid.
  const seen = new Map<string, BuiltBulkRow>();
  for (const r of out) {
    const key = [
      r.recordType,
      r.action,
      r.campaignId || "",
      r.adGroupId || "",
      r.keywordText || "",
      r.targetingText || "",
      r.matchType || "",
    ].join("||");
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, r);
      continue;
    }
    if (r.action === "cutBid" && typeof r.bid === "number" && typeof existing.bid === "number" && r.bid < existing.bid) {
      seen.set(key, r);
    }
  }

  return Array.from(seen.values());
}

export function bulkRowToArray(r: BuiltBulkRow): any[] {
  const { product, entity } = recordTypeToProductEntity(r.recordType);

  return [
    product,
    entity,
    toAmazonOperation(r.action),
    r.campaignId || "",
    r.campaignName || "",
    r.adGroupId || "",
    r.adGroupName || "",
    r.keywordId || "",
    r.productTargetingId || "",
    r.targetingId || "",
    r.keywordText || "",
    r.targetingText || "",
    r.matchType || "",
    r.bid ?? "",
    toAmazonState(r.action),
  ];
}

// ------------------------------------------------------------------
// ✅ UNIVERSAL MULTI-TAB HELPERS
// ------------------------------------------------------------------

/**
 * Groups built rows by Amazon Product type (SP, SB, SD)
 * Uses recordTypeToProductEntity for accurate classification
 */
export function groupRowsByProduct(rows: BuiltBulkRow[]): Record<AmazonProduct, BuiltBulkRow[]> {
  const groups: Record<AmazonProduct, BuiltBulkRow[]> = {
    "Sponsored Products": [],
    "Sponsored Brands": [],
    "Sponsored Display": [],
  };

  for (const row of rows) {
    const { product } = recordTypeToProductEntity(row.recordType);
    groups[product].push(row);
  }

  return groups;
}

/**
 * Amazon-required exact tab names for bulk uploads
 * CRITICAL: These must be case-sensitive and exact
 */
export const AMAZON_TAB_NAMES: Record<AmazonProduct, string> = {
  "Sponsored Products": "Sponsored Products",
  "Sponsored Brands": "Sponsored Brands",
  "Sponsored Display": "Sponsored Display",
};
