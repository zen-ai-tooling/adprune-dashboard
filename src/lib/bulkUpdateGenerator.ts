/**
 * Amazon Bulksheets 2.0 Generator
 * Generates bulk update files compliant with Amazon Advertising API Bulksheets 2.0 spec
 */

import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { ModuleType } from "./moduleConfig";
import { xlSafe } from "./reportFormatter";
import {
  BULK_UPDATE_HEADERS,
  type AmazonProduct,
  type AmazonRecordType,
  recordTypeToProductEntity,
} from "./amazonBulkBuilder";

export interface BulkUpdateRow {
  recordType: string;
  recordId?: string;
  campaignId?: string;
  campaignName?: string;
  adGroupId?: string;
  adGroupName?: string;
  keywordId?: string;
  targetingId?: string;
  keywordText?: string;
  targetingText?: string;
  matchType?: string;
  bid?: number;
  state?: string;
  operation: "create" | "update" | "delete";
  [key: string]: any;
}

export interface BulkUpdateRequest {
  decisionFile: File;
  bulksheetFile: File;
  moduleType: ModuleType;
  bidReductionPercent?: number; // Default 20%
}

export interface BulkUpdateResult {
  workbook: ExcelJS.Workbook;
  fileName: string;
  summary: {
    pausedCount: number;
    negativesCreated: number;
    bidsCutCount: number;
    campaignsTurnedOff: number;
  };
  validation: {
    errors: string[];
    warnings: string[];
  };
}

// --- Amazon Bulksheets 2.0 canonical mapping helpers ---

type AmazonOperation = "Create" | "Update" | "Archive";

function toAmazonOperation(op: BulkUpdateRow["operation"]): AmazonOperation {
  if (op === "create") return "Create";
  if (op === "update") return "Update";
  return "Archive";
}

function toAmazonState(state?: string): string | undefined {
  if (!state) return undefined;
  const s = state.toLowerCase();
  if (s === "paused" || s === "pause") return "Paused";
  if (s === "enabled" || s === "enable") return "Enabled";
  if (s === "archived" || s === "archive") return "Archived";
  return state; // fallback
}

// Decode common Excel/HTML entity escapes from decision files
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

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

interface NormalizedDecisionRow {
  campaign: string;
  adGroup: string;
  term: string; // keyword / target / search term
  matchType: string;
  decisionRaw: string;
  decisionNormalized: string;
  bid: number;
  sheetName: string;
}

export async function generateBulkUpdate(request: BulkUpdateRequest): Promise<BulkUpdateResult> {
  const validation = { errors: [] as string[], warnings: [] as string[] };
  const summary = {
    pausedCount: 0,
    negativesCreated: 0,
    bidsCutCount: 0,
    campaignsTurnedOff: 0,
  };

  // ---------- 1) Parse decision file (multi-sheet) ----------
  const decisionBuffer = await request.decisionFile.arrayBuffer();
  const decisionWorkbook = XLSX.read(decisionBuffer, { type: "array" });

  const decisionRowsNormalized: NormalizedDecisionRow[] = [];

  // Helper: scan one sheet and push decisions
  const consumeDecisionSheet = (sheetName: string) => {
    const sheet = decisionWorkbook.Sheets[sheetName];
    if (!sheet) return;

    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
    if (!data.length) return;

    // Find header row: needs both Campaign + Decision somewhere
    let headerRow = -1;
    const maxScan = Math.min(10, data.length);

    for (let i = 0; i < maxScan; i++) {
      const row = data[i] || [];
      const normalizedRow = row.map((cell: any) => normalizeHeader(String(cell || "")));
      const hasCampaign = normalizedRow.some((h) => h.includes("campaignname") || h === "campaign");
      const hasDecision = normalizedRow.includes("decision");
      if (hasCampaign && hasDecision) {
        headerRow = i;
        break;
      }
    }

    if (headerRow === -1) return;

    const headers = (data[headerRow] || []).map((h) => String(h || ""));
    const rows = data.slice(headerRow + 1);

    const colDecision = findColumn(headers, ["Decision"]);
    if (colDecision === -1) return;

    const colCampaign = findColumn(headers, ["Campaign", "Campaign Name", "campaignname"]);
    const colAdGroup = findColumn(headers, ["Ad Group", "Ad Group Name", "adgroupname", "adgroup"]);

    // Term / keyword / target / search term can live in a few places
    const colSearchTerm = findColumn(headers, ["Customer Search Term", "Search Term", "searchterm"]);
    const colKeywordTarget = findColumn(headers, ["Keyword/Target", "KeywordTarget", "keyword/target"]);
    const colKeywordText = findColumn(headers, ["Keyword Text", "Keyword", "keywordtext"]);
    const colTargeting = findColumn(headers, ["Targeting", "Targeting Text", "Target", "targetingtext"]);

    const colMatch = findColumn(headers, ["Match Type", "matchtype", "match"]);
    const colBid = findColumn(headers, ["Bid", "Max CPC", "CPC"]);

    for (const row of rows) {
      if (!row || row.length === 0) continue;

      const rawDecision = String(row[colDecision] ?? "").trim();
      if (!rawDecision) continue;

      const decisionNormalized = normalizeDecision(rawDecision);
      // Treat keep / give it another week as non-actionable here
      if (decisionNormalized === "keep" || decisionNormalized === "give it another week") {
        continue;
      }

      const campaign = colCampaign !== -1 ? String(row[colCampaign] || "").trim() : "";
      if (!campaign) continue;

      const adGroup = colAdGroup !== -1 ? String(row[colAdGroup] || "").trim() : "";

      let term = "";
      if (colSearchTerm !== -1) {
        term = String(row[colSearchTerm] || "").trim();
      }
      if (!term && colKeywordTarget !== -1) {
        term = String(row[colKeywordTarget] || "").trim();
      }
      if (!term && colKeywordText !== -1) {
        term = String(row[colKeywordText] || "").trim();
      }
      if (!term && colTargeting !== -1) {
        term = String(row[colTargeting] || "").trim();
      }

      const matchType = colMatch !== -1 ? String(row[colMatch] || "").trim() : "";

      let bid = 0;
      if (colBid !== -1) {
        const bidStr = String(row[colBid] || "")
          .replace(/[$,]/g, "")
          .trim();
        if (bidStr) {
          const parsed = parseFloat(bidStr);
          if (!isNaN(parsed)) bid = parsed;
        }
      }

      decisionRowsNormalized.push({
        campaign,
        adGroup,
        term,
        matchType,
        decisionRaw: rawDecision,
        decisionNormalized,
        bid,
        sheetName,
      });
    }
  };

  // Walk all sheets in the operator file
  for (const sheetName of decisionWorkbook.SheetNames) {
    consumeDecisionSheet(sheetName);
  }

  if (decisionRowsNormalized.length === 0) {
    validation.errors.push(
      "Could not find any actionable decisions in the uploaded operator file (no Decision column or all decisions were KEEP / Give it another week).",
    );
    throw new Error("Invalid decision file");
  }

  // ---------- 2) Parse Amazon Bulksheet 2.0 ----------
  const bulkBuffer = await request.bulksheetFile.arrayBuffer();
  const bulkWorkbook = XLSX.read(bulkBuffer, { type: "array" });

  // Amazon bulksheets typically have one main sheet
  const bulkSheetName = bulkWorkbook.SheetNames[0];
  const bulkData = XLSX.utils.sheet_to_json(bulkWorkbook.Sheets[bulkSheetName], { header: 1 }) as any[][];

  // Find header row in bulksheet
  let bulkHeaderRow = 0;
  for (let i = 0; i < Math.min(5, bulkData.length); i++) {
    if (
      bulkData[i]?.some(
        (cell: any) =>
          normalizeHeader(String(cell || "")).includes("recordtype") ||
          normalizeHeader(String(cell || "")).includes("campaignname"),
      )
    ) {
      bulkHeaderRow = i;
      break;
    }
  }

  const bulkHeaders = bulkData[bulkHeaderRow].map((h) => String(h || ""));
  const bulkRows = bulkData.slice(bulkHeaderRow + 1);

  // Find columns in bulksheet
  const bulkRecordTypeCol = findColumn(bulkHeaders, ["recordtype", "record"]);
  const bulkCampaignCol = findColumn(bulkHeaders, ["campaignname", "campaign"]);
  const bulkAdGroupCol = findColumn(bulkHeaders, ["adgroupname", "adgroup"]);
  const bulkKeywordCol = findColumn(bulkHeaders, ["keywordtext", "keyword"]);
  const bulkTargetCol = findColumn(bulkHeaders, ["targetingtext", "targeting", "target"]);
  const bulkMatchCol = findColumn(bulkHeaders, ["matchtype", "match"]);
  const bulkBidCol = findColumn(bulkHeaders, ["bid", "maxcpc"]);
  const bulkStatusCol = findColumn(bulkHeaders, ["status", "state"]);
  const bulkCampaignIdCol = findColumn(bulkHeaders, ["campaignid"]);
  const bulkAdGroupIdCol = findColumn(bulkHeaders, ["adgroupid"]);
  const bulkKeywordIdCol = findColumn(bulkHeaders, ["keywordid"]);
  const bulkTargetIdCol = findColumn(bulkHeaders, [
    "Targeting Id",
    "Targeting ID",
    "Target Id",
    "Product Targeting ID",
    "targetingid",
    "targetid",
    "producttargetingid",
  ]);

  if (bulkRecordTypeCol === -1 || bulkCampaignCol === -1) {
    validation.errors.push("Invalid Amazon Bulksheet format. Missing required columns (Record Type / Campaign Name).");
    throw new Error("Invalid bulksheet file");
  }

  // ---------- 3) Generate output rows ----------
  const outputRows: BulkUpdateRow[] = [];

  for (const dec of decisionRowsNormalized) {
    const campaign = dec.campaign;
    const adGroup = dec.adGroup;
    const term = dec.term;
    const decisionNorm = dec.decisionNormalized;
    const currentBid = dec.bid;

    if (!campaign) continue;

    // Handle negatives (intelligent detection of ASINs and Campaign Type)
    if (decisionNorm === "negative" || decisionNorm === "negative exact") {
      const cleanTerm = decodeHtmlEntities(term);

      // Ensure Ad Group Name is present
      if (!adGroup) {
        validation.warnings.push(`Missing Ad Group Name for Negative: ${campaign} / ${cleanTerm}. Skipped.`);
        continue;
      }

      // 1. Detect if this is an ASIN/Category target or a Keyword
      const isTargeting =
        cleanTerm.toLowerCase().startsWith("asin=") || cleanTerm.toLowerCase().startsWith("category=");

      // 2. Try to infer Campaign Type (SP vs SB vs SD) by looking for the campaign in the bulk file
      // (Default to SP if campaign not found in reference file)
      let productPrefix = "sponsoredProducts";
      const campaignReferenceRow = bulkRows.find((r) => String(r[bulkCampaignCol] || "").trim() === campaign);

      if (campaignReferenceRow) {
        const refType = String(campaignReferenceRow[bulkRecordTypeCol] || "").toLowerCase();
        if (refType.includes("brand")) productPrefix = "sponsoredBrands";
        else if (refType.includes("display")) productPrefix = "sponsoredDisplay";
      }

      // 3. Construct the correct Record Type
      // SP: sponsoredProductsNegativeKeyword OR sponsoredProductsNegativeProductTargeting
      // SB: sponsoredBrandsNegativeKeyword OR sponsoredBrandsNegativeProductTargeting
      // SD: sponsoredDisplayNegativeProductTargeting (SD typically doesn't have neg keywords)
      let recordType = `${productPrefix}NegativeKeyword`;

      if (isTargeting) {
        recordType = `${productPrefix}NegativeProductTargeting`;
      } else if (productPrefix === "sponsoredDisplay") {
        // SD usually only supports negative targeting, not keywords (depending on API version)
        recordType = "sponsoredDisplayNegativeProductTargeting";
      }

      outputRows.push({
        recordType,
        operation: "create",
        campaignName: campaign,
        adGroupName: adGroup,
        // IF it's targeting (ASIN), mapped to targetingText. IF keyword, mapped to keywordText.
        keywordText: !isTargeting ? cleanTerm : undefined,
        targetingText: isTargeting ? cleanTerm : undefined,
        matchType: isTargeting ? "Negative Exact" : "Negative Exact",
        state: "Enabled",
      });
      summary.negativesCreated++;
      continue;
    }

    // Match against bulksheet rows for pause / reduce bid / cut bid / turn off campaign
    const matchingBulkRows = bulkRows.filter((bulkRow) => {
      if (!bulkRow || bulkRow.length === 0) return false;

      const bulkCampaign = String(bulkRow[bulkCampaignCol] || "").trim();
      const bulkAdGroup = bulkAdGroupCol !== -1 ? String(bulkRow[bulkAdGroupCol] || "").trim() : "";
      const bulkKeyword = bulkKeywordCol !== -1 ? String(bulkRow[bulkKeywordCol] || "").trim() : "";
      const bulkTarget = bulkTargetCol !== -1 ? String(bulkRow[bulkTargetCol] || "").trim() : "";

      if (campaign !== bulkCampaign) return false;
      if (adGroup && bulkAdGroup && adGroup !== bulkAdGroup) return false;

      if (term) {
        if (term !== bulkKeyword && term !== bulkTarget) return false;
      }

      return true;
    });

    // For actions that require a direct match, warn if nothing is found
    if (
      (decisionNorm === "pause" || decisionNorm === "reduce bid" || decisionNorm === "cut bid") &&
      matchingBulkRows.length === 0
    ) {
      validation.warnings.push(
        `No match found in bulksheet for: ${campaign} / ${adGroup || "-"} / ${term || "(no term)"}`,
      );
      continue;
    }

    switch (decisionNorm) {
      case "pause":
        for (const bulkRow of matchingBulkRows) {
          const recordType = String(bulkRow[bulkRecordTypeCol] || "").trim();
          outputRows.push({
            recordType,
            operation: "update",
            state: "paused",
            campaignName: String(bulkRow[bulkCampaignCol] || ""),
            adGroupName: bulkAdGroupCol !== -1 ? String(bulkRow[bulkAdGroupCol] || "") : undefined,
            campaignId: bulkCampaignIdCol !== -1 ? String(bulkRow[bulkCampaignIdCol] || "") : undefined,
            adGroupId: bulkAdGroupIdCol !== -1 ? String(bulkRow[bulkAdGroupIdCol] || "") : undefined,
            keywordId: bulkKeywordIdCol !== -1 ? String(bulkRow[bulkKeywordIdCol] || "") : undefined,
            targetingId: bulkTargetIdCol !== -1 ? String(bulkRow[bulkTargetIdCol] || "") : undefined,
            keywordText: bulkKeywordCol !== -1 ? String(bulkRow[bulkKeywordCol] || "") : undefined,
            targetingText: bulkTargetCol !== -1 ? String(bulkRow[bulkTargetCol] || "") : undefined,
            matchType: bulkMatchCol !== -1 ? String(bulkRow[bulkMatchCol] || "") : undefined,
          });
          summary.pausedCount++;
        }
        break;

      case "cut bid":
      case "reduce bid": {
        const reductionPercent = request.bidReductionPercent || 20;
        for (const bulkRow of matchingBulkRows) {
          const recordType = String(bulkRow[bulkRecordTypeCol] || "").trim();
          const existingBid =
            bulkBidCol !== -1 ? parseFloat(String(bulkRow[bulkBidCol] || "0").replace(/[$,]/g, "")) : currentBid;

          const newBid = existingBid * (1 - reductionPercent / 100);

          outputRows.push({
            recordType,
            operation: "update",
            bid: parseFloat(newBid.toFixed(2)),
            campaignName: String(bulkRow[bulkCampaignCol] || ""),
            adGroupName: bulkAdGroupCol !== -1 ? String(bulkRow[bulkAdGroupCol] || "") : undefined,
            campaignId: bulkCampaignIdCol !== -1 ? String(bulkRow[bulkCampaignIdCol] || "") : undefined,
            adGroupId: bulkAdGroupIdCol !== -1 ? String(bulkRow[bulkAdGroupIdCol] || "") : undefined,
            keywordId: bulkKeywordIdCol !== -1 ? String(bulkRow[bulkKeywordIdCol] || "") : undefined,
            targetingId: bulkTargetIdCol !== -1 ? String(bulkRow[bulkTargetIdCol] || "") : undefined,
            keywordText: bulkKeywordCol !== -1 ? String(bulkRow[bulkKeywordCol] || "") : undefined,
            targetingText: bulkTargetCol !== -1 ? String(bulkRow[bulkTargetCol] || "") : undefined,
            matchType: bulkMatchCol !== -1 ? String(bulkRow[bulkMatchCol] || "") : undefined,
          });
          summary.bidsCutCount++;
        }
        break;
      }

      case "turn off campaign":
      case "turn off": {
        const campaignRows = bulkRows.filter((bulkRow) => {
          const recordType = String(bulkRow[bulkRecordTypeCol] || "")
            .trim()
            .toLowerCase();
          const bulkCampaign = String(bulkRow[bulkCampaignCol] || "").trim(); // We only look for Campaign records in the bulksheet that match the Campaign name
          return recordType.includes("campaign") && bulkCampaign === campaign;
        });

        if (campaignRows.length > 0) {
          const bulkRow = campaignRows[0];
          outputRows.push({
            recordType: String(bulkRow[bulkRecordTypeCol] || ""),
            operation: "update",
            state: "paused",
            campaignName: campaign,
            campaignId: bulkCampaignIdCol !== -1 ? String(bulkRow[bulkCampaignIdCol] || "") : undefined, // Omit adGroupName/adGroupId for Campaign-level updates (cleaner)
          });
          summary.campaignsTurnedOff++;
        } else {
          validation.warnings.push(`No campaign-level row found in bulksheet for campaign: ${campaign}`);
        }
        break;
      }

      // "keep" / "give it another week" already filtered out above
      default:
        // Unknown or unsupported decision → ignore
        break;
    }
  }

  if (outputRows.length === 0) {
    validation.warnings.push(
      'No actionable rows were generated. All decisions may have been "keep" / "Give it another week", or none of them matched the Amazon bulksheet.',
    );
  }

  // ---------- 3.5) Deduplicate output rows to prevent Amazon upload errors ----------
  {
    const seen = new Map<string, BulkUpdateRow>();
    const keyFor = (r: BulkUpdateRow): string => {
      const base = [
        r.recordType || "",
        r.campaignName || "",
        r.adGroupName || "",
        r.keywordText || "",
        r.targetingText || "",
        r.matchType || "",
      ].join("||");
      const op = (r.operation || "").toLowerCase();
      const recLower = (r.recordType || "").toLowerCase();
      if (op === "create" || recLower.includes("negative")) {
        return `CREATE||${base}`;
      }
      // cut bid rows are updates with a bid; dedupe ignoring bid + state, keep lowest bid
      if (typeof r.bid === "number") {
        return `BID||${base}`;
      }
      // pause / update rows
      return `UPDATE||${base}||${(r.state || "").toLowerCase()}`;
    };

    let removed = 0;
    for (const row of outputRows) {
      const key = keyFor(row);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, row);
        continue;
      }
      removed++;
      // For cut bid: keep the one with the lower bid
      if (typeof row.bid === "number" && typeof existing.bid === "number" && row.bid < existing.bid) {
        seen.set(key, row);
      }
    }

    if (removed > 0) {
      const deduped = Array.from(seen.values());
      // Recompute summary counts from deduped rows
      summary.pausedCount = 0;
      summary.negativesCreated = 0;
      summary.bidsCutCount = 0;
      summary.campaignsTurnedOff = 0;
      for (const r of deduped) {
        const recLower = (r.recordType || "").toLowerCase();
        const op = (r.operation || "").toLowerCase();
        if (op === "create" || recLower.includes("negative")) {
          summary.negativesCreated++;
        } else if (typeof r.bid === "number") {
          summary.bidsCutCount++;
        } else if (recLower.includes("campaign") && (r.state || "").toLowerCase() === "paused" && !r.adGroupName) {
          summary.campaignsTurnedOff++;
        } else {
          summary.pausedCount++;
        }
      }
      outputRows.length = 0;
      outputRows.push(...deduped);
      validation.warnings.push(`Removed ${removed} duplicate row${removed === 1 ? "" : "s"} to prevent Amazon upload errors`);
    }
  }

  // ---------- 4) Build Amazon Bulksheets 2.0 ExcelJS output ----------
  const workbook = new ExcelJS.Workbook();

  const products: AmazonProduct[] = ["Sponsored Products", "Sponsored Brands", "Sponsored Display"];

  for (const product of products) {
    const rowsForProduct = outputRows.filter(
      (row) => recordTypeToProductEntity(row.recordType as AmazonRecordType).product === product,
    );
    if (!rowsForProduct.length) continue;

    const sheetName =
      product === "Sponsored Products"
        ? "Sponsored Products Campaigns"
        : product === "Sponsored Brands"
          ? "Sponsored Brands Campaigns"
          : "Sponsored Display Campaigns";

    const worksheet = workbook.addWorksheet(sheetName);

    // Canonical headers: first 3 must be Product, Entity, Operation
    const headers = BULK_UPDATE_HEADERS;
    worksheet.addRow(headers.map((h) => xlSafe(h)));
    worksheet.getRow(1).font = { bold: true };
    worksheet.views = [{ state: "frozen", xSplit: 0, ySplit: 1 }];

    for (const row of rowsForProduct) {
      const { entity } = recordTypeToProductEntity(row.recordType as AmazonRecordType);

      // Decode any escaped text before export
      const keywordText = row.keywordText ? decodeHtmlEntities(String(row.keywordText)) : "";
      const targetingText = row.targetingText ? decodeHtmlEntities(String(row.targetingText)) : "";

      worksheet.addRow([
        xlSafe(product),
        xlSafe(entity),
        xlSafe(toAmazonOperation(row.operation)),
        xlSafe(row.campaignId || ""),
        xlSafe(row.campaignName || ""),
        xlSafe(row.adGroupId || ""),
        xlSafe(row.adGroupName || ""),
        xlSafe(row.keywordId || ""),
        xlSafe(row.targetingId || ""),
        xlSafe(keywordText),
        xlSafe(targetingText),
        xlSafe(row.matchType || ""),
        xlSafe(row.bid ?? ""),
        xlSafe(toAmazonState(row.state) || ""),
      ]);
    }

    // Auto-size columns per sheet
    worksheet.columns.forEach((column) => {
      if (column && "eachCell" in column) {
        let maxLength = 10;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? String(cell.value).length : 10;
          if (columnLength > maxLength) maxLength = columnLength;
        });
        column.width = Math.min(maxLength + 2, 50);
      }
    });
  }

  const timestamp = new Date().toISOString().split("T")[0];
  //const fileName = `VTEST_001__Amazon_Bulk_${request.moduleType}_${timestamp}.xlsx`;
  const fileName = `Amazon_Bulk_Operations_${request.moduleType}_${timestamp}.xlsx`;

  return {
    workbook,
    fileName,
    summary,
    validation,
  };
}

function normalizeDecision(decision: string): string {
  const normalized = decision.trim().toLowerCase();

  const corrections: Record<string, string> = {
    puse: "pause",
    puase: "pause",
    paus: "pause",
    paue: "pause",
    negatve: "negative",
    negativ: "negative",
    neg: "negative",
    negative_exact: "negative exact",
    cut: "cut bid",
    cutbid: "cut bid",
    reduce: "reduce bid",
    reducebid: "reduce bid",
    turnoff: "turn off campaign",
    turn_off: "turn off campaign",
    kep: "keep",
    kepe: "keep",
  };

  return corrections[normalized] || normalized;
}
