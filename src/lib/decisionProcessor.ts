import * as XLSX from "xlsx";

const DEBUG_DECISION = false;
import {
  normalizeSheetName,
  sanitizeHeader,
  findColumnValue,
  parseNumeric,
  SHEET_TARGETS,
  COLUMN_ALIASES,
} from "./bleederAnalyzer";
import {
  CanonicalBulkInputRow,
  buildBulkRowsFromCanonical,
  BULK_UPDATE_HEADERS,
  bulkRowToArray,
  type AmazonRecordType,
  classifyEntity,
  type AmazonProduct,
  recordTypeToProductEntity,
} from "./amazonBulkBuilder";
import { normalizeDecision as sharedNormalizeDecision } from "./normalizeDecision";

interface ProcessedRow {
  [key: string]: any;
}

interface AutoRepair {
  type: string;
  count: number;
  details: string;
}

interface ProcessingResult {
  success: boolean;
  fileName: string;
  summary: {
    pausedCount: number;
    negativesCreated: number;
    searchTermRowsAdded: number;
    negativeProductTargets: number;
  };
  workbook: XLSX.WorkBook;
  validation: {
    totalSpend: number;
    hasBlankEntities: boolean;
    errors: string[];
    warnings: string[];
  };
  autoRepairs: AutoRepair[];
  preFlight: {
    fileReadable: boolean;
    recognizedSheets: string[];
    decisionColumnFound: boolean;
    columnsNormalized: boolean;
    actionableRows: number;
  };
}

// Canonical sheet type mapping
const SHEET_TYPES = {
  SP_CAMPAIGNS: "sp_campaigns",
  SB_CAMPAIGNS: "sb_campaigns",
  SD_CAMPAIGNS: "sd_campaigns",
  SP_SEARCH: "sp_search",
  SB_SEARCH: "sb_search",
} as const;

// Normalize sheet name to canonical type
const normalizeSheetToCanonical = (sheetName: string): string | null => {
  // Make bullets, dashes, dots, etc. all turn into spaces
  const normalized = sheetName
    .toLowerCase()
    .replace(/[^\w]+/g, " ") // replaces "•", "—", etc. with space
    .replace(/\s+/g, " ")
    .trim();

  // Helper flags
  const hasSP = normalized.includes("sponsored product");
  const hasSB = normalized.includes("sponsored brand") || normalized.includes("sbv");
  const hasSD = normalized.includes("sponsored display") || normalized.startsWith("sd ");

  const hasCampaign = normalized.includes("campaign");
  const hasTargeting = normalized.includes("targeting");
  const hasKeyword = normalized.includes("keyword"); // 🔥 NEW FLAG

  const hasSearch =
    normalized.includes("search term") ||
    normalized.includes("search ter") || // handles truncated "Search Ter"
    normalized.includes("search");

  // Sponsored Products Campaigns / Targeting sheets
  // SP sheets usually say "Targeting" or "Campaigns"
  if (hasSP && (hasCampaign || hasTargeting)) {
    return SHEET_TYPES.SP_CAMPAIGNS;
  }

  // Sponsored Brands Campaigns / Targeting sheets
  // 🔧 FIX: Added check for 'hasKeyword' to capture "Sponsored Brands • Keywords"
  if (hasSB && (hasCampaign || hasTargeting || hasKeyword)) {
    return SHEET_TYPES.SB_CAMPAIGNS;
  }

  // Sponsored Display Targeting sheets ONLY
  if (hasSD && hasTargeting) {
    return SHEET_TYPES.SD_CAMPAIGNS;
  }

  // SP Search Terms
  if (hasSP && hasSearch) {
    return SHEET_TYPES.SP_SEARCH;
  }

  // SB Search Terms
  if (hasSB && hasSearch) {
    return SHEET_TYPES.SB_SEARCH;
  }

  return null;
};

const HEADER_ALIASES: Record<string, string[]> = {
  campaign: ["campaign name", "campaign"],
  "ad group": ["ad group name", "ad group"],

  // 🔹 Anything that represents the biddable keyword/target
  "keyword text": [
    "keyword text",
    "keyword",
    "target",
    "term",
    "targeting", // <— new
    "keyword or product targeting", // <— new (Amazon uses this wording)
  ],

  // 🔹 Explicit product-targeting fields
  "product targeting expression": [
    "product targeting expression",
    "pte",
    "product target",
    "product targeting", // <— new
  ],

  "customer search term": ["customer search term", "search term", "query"],
  state: ["state", "status"],
  clicks: ["clicks", "click"],
  spend: ["spend", "cost"],
  sales: ["sales", "revenue"],
  "match type": ["match type", "match"],
  "campaign id": ["campaign id", "campaignid"],
  "ad group id": ["ad group id", "adgroup id", "ad groupid"],
  "keyword id": ["keyword id", "keywordid"],
  "product targeting id": ["product targeting id", "producttargetingid"],
  "ad id": ["ad id", "adid"],
  "targeting id": ["targeting id", "targetingid"],
  entity: ["entity"],
  operation: ["operation"],
  product: ["product"],
  bid: ["bid"],
};

// Normalize header using alias map
const normalizeHeaderWithAliases = (header: string): string => {
  const normalized = header
    .toLowerCase()
    .replace(/[_\-\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((alias) => normalized === alias)) {
      return canonical;
    }
  }

  return normalized;
};

// Find index of a canonical header in a raw header array
const findHeaderIndex = (rawHeaders: string[], canonical: string): number => {
  const normalized = rawHeaders.map((h) => normalizeHeaderWithAliases(h));
  return normalized.findIndex((h) => h === canonical);
};

// Fuzzy match decision values using shared normalizer
const fuzzyMatchDecision = (
  value: any,
): { decision: "pause" | "negative" | "negative phrase" | "cut bid" | "keep"; wasRepaired: boolean } => {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === "" ||
    String(value).toLowerCase() === "nan" ||
    String(value).toLowerCase() === "none"
  ) {
    return { decision: "keep", wasRepaired: false };
  }

  const original = String(value).trim();
  const lower = original.toLowerCase();

  // 🔒 Fast substring safety net — phrase check MUST come before plain negative
  if (lower.includes("pause")) {
    return { decision: "pause", wasRepaired: lower !== "pause" };
  }
  if (
    lower.includes("negative phrase") ||
    lower.includes("negate phrase") ||
    lower.includes("neg phrase") ||
    (lower.includes("negate") && lower.includes("phrase")) ||
    (lower.includes("negative") && lower.includes("phrase"))
  ) {
    return { decision: "negative phrase", wasRepaired: lower !== "negative phrase" };
  }
  if (lower.includes("negative") || lower.includes("negate")) {
    return { decision: "negative", wasRepaired: lower !== "negative" };
  }

  if (lower.includes("cut bid") || lower.includes("cut-bid") || (lower.includes("cut") && lower.includes("bid"))) {
    return { decision: "cut bid", wasRepaired: lower !== "cut bid" };
  }

  const normalized = sharedNormalizeDecision(original);

  const wasRepaired = !["pause", "negative", "keep"].includes(lower);

  if (normalized === "pause") return { decision: "pause", wasRepaired };
  if (normalized === "negative") return { decision: "negative", wasRepaired };

  return { decision: "keep", wasRepaired: false };
};

// Coerce numeric values safely
const coerceNumeric = (value: any): number => {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (!value) return 0;

  let str = String(value).trim();

  // Remove currency symbols and %
  str = str.replace(/[$£€¥%,]/g, "");

  // Handle European decimals (1.234,56 -> 1234.56)
  if (/\d+\.\d{3},\d+/.test(str)) {
    str = str.replace(/\./g, "").replace(",", ".");
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
};

// Detect ASIN pattern
const isASIN = (text: string): boolean => {
  if (!text) return false;
  return /^B0[A-Z0-9]{8}$/i.test(String(text).trim());
};

// Generate Pacific Time timestamp
const getPacificTimestamp = (): string => {
  const now = new Date();
  const pacific = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(now);

  const [month, day, year] = pacific.split("/");
  return `${month}-${day}-${year}`;
};

// Strip .0 from ID fields
const cleanIDField = (value: any): string => {
  if (!value) return "";
  const str = String(value);
  if (str.endsWith(".0")) {
    return str.slice(0, -2);
  }
  return str;
};

export const processDecisions = async (file: File): Promise<ProcessingResult> => {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const outputWorkbook = XLSX.utils.book_new();

  // Initialize counters and storage
  let pausedCount = 0;
  let negativesCreated = 0;
  let searchTermRowsAdded = 0;
  let negativeProductTargets = 0;
  let totalSpend = 0;
  let hasBlankEntities = false;
  const errors: string[] = [];
  const warnings: string[] = [];
  const autoRepairs: AutoRepair[] = [];

  let decisionRepairedCount = 0;
  let entityBackfilledCount = 0;
  let headerAliasCount = 0;
  let numericCoercionCount = 0;

  // Pre-flight diagnostics
  const preFlight = {
    fileReadable: true,
    recognizedSheets: [] as string[],
    decisionColumnFound: false,
    columnsNormalized: false,
    actionableRows: 0,
  };

  // We'll keep processed rows per sheet in memory, then build a *single* Bulk Update sheet.
  const processedSheets: Record<string, any[][]> = {};

  let keywordIdCounter = 1;
  const blankEntityRows: { sheet: string; row: number }[] = [];

  // Process each sheet
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];

    const data = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
    }) as any[][];

    if (data.length < 2) continue; // Skip empty sheets

    // 🔍 Find the actual header row (first row that contains "Decision")
    let headerRowIdx = 0;
    const maxHeaderScan = Math.min(data.length, 5);

    for (let r = 0; r < maxHeaderScan; r++) {
      const row = data[r];
      const normalizedCells = row.map((cell: any) => String(cell).toLowerCase().trim());
      if (normalizedCells.includes("decision")) {
        headerRowIdx = r;
        break;
      }
    }

    // Normalize headers using alias map, from the detected header row
    const rawHeaders = data[headerRowIdx].map((h: any) => String(h || "").trim());
    const headers = rawHeaders.map((h) => normalizeHeaderWithAliases(h));

    // Track header aliasing
    rawHeaders.forEach((raw, idx) => {
      const normalized = headers[idx];
      const rawNorm = normalizeHeaderWithAliases(raw);
      if (
        rawNorm !==
        raw
          .toLowerCase()
          .replace(/[_\-\/]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      ) {
        headerAliasCount++;
      }
    });

    // Normalize sheet name to canonical type
    const canonicalSheetType = normalizeSheetToCanonical(sheetName);

    if (!canonicalSheetType) continue; // Not a recognized sheet

    preFlight.recognizedSheets.push(sheetName);

    // 🔧 CHANGE #1: Auto-create Entity / Operation / State columns if missing
    if (canonicalSheetType) {
      const ensureColumn = (canonicalName: string, rawName: string) => {
        const hasCol = headers.includes(canonicalName);
        if (hasCol) return;

        if (DEBUG_DECISION) console.log(`[DECISION] Added ${rawName} column to sheet:`, sheetName);

        // Add to headers
        rawHeaders.push(rawName);
        headers.push(canonicalName);

        // Extend every row to match new header length
        for (let r = 0; r < data.length; r++) {
          const row = data[r];
          if (row.length < rawHeaders.length) row.push("");
        }
      };

      ensureColumn("entity", "Entity");
      ensureColumn("operation", "Operation");
      ensureColumn("state", "State");
    }

    // 🔧 CHANGE #2: For SD campaigns, remap "Targeting" from keyword text → product targeting expression
    if (canonicalSheetType === SHEET_TYPES.SD_CAMPAIGNS) {
      headers.forEach((normalizedHeader, idx) => {
        const raw = (rawHeaders[idx] || "").toLowerCase().trim();

        // If this column came in as "Targeting" and was normalized to keyword text,
        // treat it instead as a product targeting expression.
        const isTargetingColumn = raw.includes("targeting");
        const isCurrentlyKeyword = normalizedHeader === "keyword text";

        if (isTargetingColumn && isCurrentlyKeyword) {
          headers[idx] = "product targeting expression";
          console.log("[DECISION] SD Targeting mapped to product targeting expression on sheet:", sheetName);
        }
      });
    }

    // Find Decision column
    const decisionIdx = headers.findIndex((h: string) => h === "decision" || /^decision$/i.test(h));

    if (decisionIdx === -1) {
      // No decision column: keep sheet as-is but drop any title row above headers
      const trimmedData = headerRowIdx === 0 ? data : data.slice(headerRowIdx);
      const newSheet = XLSX.utils.aoa_to_sheet(trimmedData);
      XLSX.utils.book_append_sheet(outputWorkbook, newSheet, sheetName);
      continue;
    }

    preFlight.decisionColumnFound = true;

    const spendIdx = headers.findIndex((h: string) => h === "spend");

    const processedRows: any[][] = [rawHeaders]; // Keep original headers

    // Check if this is a search term sheet
    // Check if this is a search term sheet
    const isSearchTermSheet =
      canonicalSheetType === SHEET_TYPES.SP_SEARCH || canonicalSheetType === SHEET_TYPES.SB_SEARCH;

    // Process data rows
    for (let i = headerRowIdx + 1; i < data.length; i++) {
      const row = data[i];
      const { decision, wasRepaired } = fuzzyMatchDecision(row[decisionIdx]);

      if (wasRepaired) {
        decisionRepairedCount++;
      }

      // Parse spend with coercion
      if (spendIdx !== -1) {
        const spendValue = row[spendIdx];
        const spend = coerceNumeric(spendValue);
        if (spend === 0 && spendValue && String(spendValue).trim() !== "" && String(spendValue).trim() !== "0") {
          numericCoercionCount++;
        }
        totalSpend += spend;
      }

      // Skip keeps
      if (decision === "keep") {
        continue;
      }

      preFlight.actionableRows++;

      // --- Build a mutable row object using the ORIGINAL headers ---
      const rowObj: any = {};
      rawHeaders.forEach((h: string, idx: number) => {
        rowObj[h] = row[idx];
      });

      // Map normalized headers to raw for lookups
      const headerMap = new Map<string, string>();
      headers.forEach((norm, idx) => {
        headerMap.set(norm, rawHeaders[idx]);
      });

      const getRowValue = (normalizedHeader: string): any => {
        const rawHeader = headerMap.get(normalizedHeader);
        return rawHeader ? rowObj[rawHeader] : "";
      };

      const setRowValue = (normalizedHeader: string, value: any): void => {
        const rawHeader = headerMap.get(normalizedHeader);
        if (rawHeader) {
          rowObj[rawHeader] = value;
        }
      };

      // Read and classify IDs
      const rawCampaignId = cleanIDField(getRowValue("campaign id"));
      const rawAdGroupId = cleanIDField(getRowValue("ad group id"));
      const rawKeywordId = cleanIDField(getRowValue("keyword id"));
      const rawProductTargetingId = cleanIDField(getRowValue("product targeting id"));
      const rawTargetingId = cleanIDField(getRowValue("targeting id"));

      const keywordText = String(getRowValue("keyword text") || "");
      const productTargeting = String(getRowValue("product targeting expression") || "");
      const matchType = String(getRowValue("match type") || "");

      // Classify entity type
      const matchTypeLower = matchType.toLowerCase();
      const isKeywordEntity = ["exact", "phrase", "broad"].includes(matchTypeLower);
      const keywordLower = keywordText.toLowerCase();
      const targetingLower = productTargeting.toLowerCase();
      const isTargetingEntity =
        !isKeywordEntity &&
        (keywordLower.includes("asin=") ||
          keywordLower.includes("category=") ||
          targetingLower.includes("asin=") ||
          targetingLower.includes("category=") ||
          keywordLower.includes("close-match") ||
          keywordLower.includes("loose-match") ||
          targetingLower.includes("views=") ||
          targetingLower.includes("purchases="));

      // Assign IDs to correct fields based on classification
      // IMPORTANT: Only ONE of keywordId or productTargetingId should be set, never both
      if (isKeywordEntity) {
        setRowValue("campaign id", rawCampaignId);
        setRowValue("ad group id", rawAdGroupId);
        setRowValue("keyword id", rawKeywordId);
        setRowValue("product targeting id", "");
        setRowValue("targeting id", "");
      } else if (isTargetingEntity) {
        setRowValue("campaign id", rawCampaignId);
        setRowValue("ad group id", rawAdGroupId);
        setRowValue("keyword id", "");
        // Prefer explicit Targeting Id, fall back to Product Targeting Id
        const finalTargetingId = rawTargetingId || rawProductTargetingId;
        setRowValue("product targeting id", finalTargetingId);
        setRowValue("targeting id", finalTargetingId);
      } else {
        // Fallback: use what's available
        setRowValue("campaign id", rawCampaignId);
        setRowValue("ad group id", rawAdGroupId);
        if (rawKeywordId && !rawTargetingId && !rawProductTargetingId) {
          setRowValue("keyword id", rawKeywordId);
          setRowValue("product targeting id", "");
          setRowValue("targeting id", "");
        } else {
          setRowValue("keyword id", "");
          const finalTargetingId = rawTargetingId || rawProductTargetingId;
          setRowValue("product targeting id", finalTargetingId);
          setRowValue("targeting id", finalTargetingId);
        }
      }

      // --- Apply decisions ---

      if (decision === "pause") {
        // Pause keyword / target
        setRowValue("state", "Paused");
        setRowValue("operation", "update");

        // Default entity if blank
        const currentEntity = getRowValue("entity");
        if (!currentEntity || String(currentEntity).trim() === "") {
          // 🔥 SMART BACKFILL: Don't blindly assume Keyword. Check the text!
          const txt = (keywordText || productTargeting).toLowerCase();
          if (txt.includes("asin=") || txt.includes("category=")) {
            setRowValue("entity", "Product Targeting");
          } else {
            setRowValue("entity", "Keyword");
          }
          entityBackfilledCount++;
        }

        pausedCount++;
      } else if (decision === "negative") {
        // New negatives should be CREATED + ENABLED
        setRowValue("operation", "create");

        const keywordText = String(getRowValue("keyword text") || "");
        const productTargeting = String(getRowValue("product targeting expression") || "");

        if (isSearchTermSheet) {
          // ✅ Search term sheets: always create a Negative Keyword on the CUSTOMER SEARCH TERM
          const searchTerm = String(getRowValue("customer search term") || "") || keywordText;

          setRowValue("entity", "Negative Keyword");
          setRowValue("keyword text", searchTerm);
          setRowValue("match type", "Negative Exact");
          setRowValue("state", "Enabled");

          negativesCreated++;
          searchTermRowsAdded++;
        } else {
          // Campaign / targeting sheets
          if (isASIN(keywordText)) {
            // ASIN in keyword text → Negative Product Targeting
            setRowValue("entity", "Negative Product Targeting");
            setRowValue("product targeting expression", `asin="${keywordText}"`);
            setRowValue("keyword text", "");
            setRowValue("match type", "");
            setRowValue("bid", "");
            setRowValue("state", "Enabled");
            negativeProductTargets++;
          } else if (productTargeting && /asin\s*=\s*"?B0[A-Z0-9]{8}"?/i.test(productTargeting)) {
            // Existing ASIN expression
            setRowValue("entity", "Negative Product Targeting");
            setRowValue("keyword text", "");
            setRowValue("match type", "");
            setRowValue("bid", "");
            setRowValue("state", "Enabled");
            negativeProductTargets++;
          } else if (productTargeting) {
            // Other product targeting expression
            setRowValue("entity", "Negative Product Targeting");
            setRowValue("bid", "");
            setRowValue("state", "Enabled");
            negativeProductTargets++;
          } else {
            // Keyword text → Negative Keyword
            setRowValue("entity", "Negative Keyword");
            setRowValue("match type", "Negative Exact");
            setRowValue("state", "Enabled");
          }

          negativesCreated++;
        }
      } else if (decision === "cut bid") {
        // Cut Bid: Update the keyword/target with a reduced bid
        setRowValue("operation", "update");
        setRowValue("state", "enabled");

        // Default entity if blank
        const currentEntity = getRowValue("entity");
        if (!currentEntity || String(currentEntity).trim() === "") {
          const txt = (keywordText || productTargeting).toLowerCase();
          if (txt.includes("asin=") || txt.includes("category=")) {
            setRowValue("entity", "Product Targeting");
          } else {
            setRowValue("entity", "Keyword");
          }
          entityBackfilledCount++;
        }
        // Bid value is already written in the intermediate file
        // (calculated as originalBid * (1 - pct/100) in AnalysisResults.tsx)
        // The action will be set to "cutBid" in the canonical inputs step below
        // because: operation === "update" && bidValue > 0
      }

      // Final entity sanity check
      const finalEntity = getRowValue("entity");
      if (!finalEntity || String(finalEntity).trim() === "") {
        if (decision === "pause") {
          setRowValue("entity", "Keyword");
          entityBackfilledCount++;
        } else if (decision === "negative") {
          setRowValue("entity", "Negative Keyword");
          setRowValue("match type", "Negative Exact");
          entityBackfilledCount++;
        }
      }

      const reCheckEntity = getRowValue("entity");
      if (!reCheckEntity || String(reCheckEntity).trim() === "") {
        hasBlankEntities = true;
        blankEntityRows.push({ sheet: sheetName, row: i + 1 });
      }

      // Clean ID fields + NaNs
      rawHeaders.forEach((h: string) => {
        let val = rowObj[h];

        if (
          val === null ||
          val === undefined ||
          (typeof val === "number" && isNaN(val)) ||
          String(val).toLowerCase() === "nan"
        ) {
          val = "";
        }

        const normalized = normalizeHeaderWithAliases(h);
        if (normalized.includes("id")) {
          val = cleanIDField(val);
        }

        rowObj[h] = val;
      });

      const newRow = rawHeaders.map((h: string) => rowObj[h]);
      processedRows.push(newRow);
    }

    // Store processed rows in memory; we'll only emit a single Bulk Update sheet later.
    if (processedRows.length > 1) {
      processedSheets[sheetName] = processedRows;
    }
  } // Close the main sheet processing loop

  // ---------------------------------------------------------------------------
  // Build Amazon Bulksheets 2.0 "Bulk Update" sheet from processed tabs
  // ---------------------------------------------------------------------------
  const canonicalInputs: CanonicalBulkInputRow[] = [];

  // 🔹 Use processedSheets (the rows you actually mutated), not outputWorkbook.SheetNames
  for (const [sheetName, data] of Object.entries(processedSheets)) {
    const canonicalSheetType = normalizeSheetToCanonical(sheetName);

    // We now support:
    // - SP / SB Search Term sheets
    // - SP / SB Campaign / Targeting sheets
    // - SD Targeting sheets
    if (
      canonicalSheetType !== SHEET_TYPES.SP_SEARCH &&
      canonicalSheetType !== SHEET_TYPES.SB_SEARCH &&
      canonicalSheetType !== SHEET_TYPES.SP_CAMPAIGNS &&
      canonicalSheetType !== SHEET_TYPES.SB_CAMPAIGNS &&
      canonicalSheetType !== SHEET_TYPES.SD_CAMPAIGNS
    ) {
      continue;
    }

    if (data.length < 2) continue;

    const rawHeaders = (data[0] as any[]).map((h: any) => String(h || "").trim());

    // Name-based fields
    const campaignNameIdx = findHeaderIndex(rawHeaders, "campaign");
    const adGroupNameIdx = findHeaderIndex(rawHeaders, "ad group");
    const keywordTextIdx = findHeaderIndex(rawHeaders, "keyword text");
    const targetingIdx = findHeaderIndex(rawHeaders, "targeting"); // Generic targeting column (may contain keywords or targeting expressions)
    const productTargetIdx = findHeaderIndex(rawHeaders, "product targeting expression");
    const matchTypeIdx = findHeaderIndex(rawHeaders, "match type");
    const entityIdx = findHeaderIndex(rawHeaders, "entity");
    const stateIdx = findHeaderIndex(rawHeaders, "state");
    const opIdx = findHeaderIndex(rawHeaders, "operation");
    const customerSearchIdx = findHeaderIndex(rawHeaders, "customer search term");

    // ID fields (nice-to-have, auto-propagated if present)
    const campaignIdIdx = findHeaderIndex(rawHeaders, "campaign id");
    const adGroupIdIdx = findHeaderIndex(rawHeaders, "ad group id");
    const keywordIdIdx = findHeaderIndex(rawHeaders, "keyword id");
    const productTargetIdIdx = findHeaderIndex(rawHeaders, "product targeting id");
    const targetingIdIdx = findHeaderIndex(rawHeaders, "targeting id"); // Amazon may provide "Targeting Id" instead of "Product Targeting Id"
    const bidIdx = findHeaderIndex(rawHeaders, "bid");

    for (let r = 1; r < data.length; r++) {
      const row = data[r];
      if (!row || (row as any[]).every((cell: any) => cell === "")) continue;

      const entity = entityIdx !== -1 ? String(row[entityIdx] || "") : "";
      const decisionOp =
        opIdx !== -1
          ? String(row[opIdx] || "")
              .toLowerCase()
              .trim()
          : "";
      const state =
        stateIdx !== -1
          ? String(row[stateIdx] || "")
              .toLowerCase()
              .trim()
          : "";

      // Skip rows that never got turned into Create/Update
      if (!entity && !decisionOp) continue;

      const entityLower = entity.toLowerCase();

      const campaignName = campaignNameIdx !== -1 ? String(row[campaignNameIdx] || "") : "";
      const adGroupName = adGroupNameIdx !== -1 ? String(row[adGroupNameIdx] || "") : "";
      const matchType = matchTypeIdx !== -1 ? String(row[matchTypeIdx] || "") : "";

      const campaignId = campaignIdIdx !== -1 ? cleanIDField(row[campaignIdIdx]) : "";
      const adGroupId = adGroupIdIdx !== -1 ? cleanIDField(row[adGroupIdIdx]) : "";
      const keywordId = keywordIdIdx !== -1 ? cleanIDField(row[keywordIdIdx]) : "";
      // Read both Product Targeting Id and Targeting Id (Amazon may use either)
      const productTargetingId = productTargetIdIdx !== -1 ? cleanIDField(row[productTargetIdIdx]) : "";
      const targetingId = targetingIdIdx !== -1 ? cleanIDField(row[targetingIdIdx]) : "";
      const bidValue = bidIdx !== -1 ? parseFloat(String(row[bidIdx] || "0")) : 0;

      let recordType = "";
      let keywordText = "";
      let targetingText = "";
      let operation: "create" | "update" = "update";
      let status = state || "";
      // Start with whatever match type we got from upstream
      let matchTypeFinal = matchType;

      // Normalize operation
      if (decisionOp === "create" || decisionOp === "update") {
        operation = decisionOp as "create" | "update";
      }

      // ---------------------------
      // Map to Amazon record types
      // ---------------------------
      switch (canonicalSheetType) {
        // 🔹 SP Search Term sheet
        case SHEET_TYPES.SP_SEARCH: {
          const searchTerm =
            (customerSearchIdx !== -1 ? String(row[customerSearchIdx] || "") : "") ||
            (keywordTextIdx !== -1 ? String(row[keywordTextIdx] || "") : "");

          const targetingValue = targetingIdx !== -1 ? String(row[targetingIdx] || "") : "";
          const keywordCellValue = keywordTextIdx !== -1 ? String(row[keywordTextIdx] || "") : targetingValue;

          if (entityLower.includes("negative")) {
            // ✅ for Bleeders 1.0, search term negatives are always negative keywords
            recordType = "sponsoredProductsNegativeKeyword";
            keywordText = searchTerm;
            targetingText = "";
            status = "enabled";
            operation = "create";
          } else {
            // ✅ Decide keyword vs product targeting using the shared classifier
            const kind = classifyEntity({
              matchType,
              keywordText: keywordCellValue,
              targetingText: targetingValue,
            });

            if (kind === "productTargeting") {
              recordType = "sponsoredProductsProductTargeting";
              targetingText = targetingValue || keywordCellValue; // auto targets: close-match, complements, etc.
              keywordText = "";
              // match type should be blank for product targeting
              matchTypeFinal = "";
            } else {
              recordType = "sponsoredProductsKeyword";
              keywordText = keywordCellValue;
              targetingText = "";
            }
          }

          break;
        }

        // 🔹 SB Search Term sheet
        case SHEET_TYPES.SB_SEARCH: {
          const searchTerm =
            (customerSearchIdx !== -1 ? String(row[customerSearchIdx] || "") : "") ||
            (keywordTextIdx !== -1 ? String(row[keywordTextIdx] || "") : "");

          // Get the targeting column value
          const targetingValue = targetingIdx !== -1 ? String(row[targetingIdx] || "") : "";

          if (entityLower.includes("negative")) {
            recordType = "sponsoredBrandsNegativeKeyword";
            keywordText = searchTerm;
            targetingText = "";
            status = "enabled";
            operation = "create";
          } else {
            recordType = "sponsoredBrandsKeyword";
            keywordText = keywordTextIdx !== -1 ? String(row[keywordTextIdx] || "") : targetingValue;
            targetingText = "";
          }
          break;
        }

        // 🔹 SP Campaign / Targeting sheet
        case SHEET_TYPES.SP_CAMPAIGNS: {
          const kw = keywordTextIdx !== -1 ? String(row[keywordTextIdx] || "") : "";
          const pte = productTargetIdx !== -1 ? String(row[productTargetIdx] || "") : "";

          if (entityLower.includes("negative")) {
            // Decide neg keyword vs neg product targeting
            const kind = classifyEntity({
              matchType,
              keywordText: kw,
              targetingText: pte,
            });

            if (kind === "productTargeting") {
              recordType = "sponsoredProductsNegativeProductTargeting";
              targetingText = pte || kw;
              keywordText = "";
              matchTypeFinal = ""; // product targeting doesn't use match type
            } else {
              recordType = "sponsoredProductsNegativeKeyword";
              keywordText = kw;
              targetingText = "";
              matchTypeFinal = "Negative Exact";
            }

            status = "enabled";
            operation = "create";
          } else {
            // Pause / cut-bid case
            // 🔥 UPGRADE: Use explicit Entity column if available, else fallback to classifier
            const kind =
              entityLower.includes("product targeting") || entityLower.includes("targeting")
                ? "productTargeting"
                : classifyEntity({
                    matchType,
                    keywordText: kw,
                    targetingText: pte,
                  });

            if (kind === "productTargeting") {
              recordType = "sponsoredProductsProductTargeting";
              targetingText = pte || kw;
              keywordText = "";
              matchTypeFinal = "";
            } else {
              recordType = "sponsoredProductsKeyword";
              keywordText = kw;
              targetingText = "";
            }
          }

          break;
        }

        // 🔹 SB Campaign / Targeting sheet
        case SHEET_TYPES.SB_CAMPAIGNS: {
          // 1. Grab Text (Check both columns to be safe)
          const rawKw = keywordTextIdx !== -1 ? String(row[keywordTextIdx] || "") : "";
          const rawTarg = targetingIdx !== -1 ? String(row[targetingIdx] || "") : "";
          const textValue = rawKw || rawTarg;
          const textLower = textValue.toLowerCase();

          // 2. Grab Entity (Explicitly check the new column we added)
          const rawEntity = entityIdx !== -1 ? String(row[entityIdx] || "").trim() : "";
          const entityLabel = rawEntity.toLowerCase();

          // 3. Determine if Product Targeting
          // Logic: TRUE if Entity column says "product targeting" OR if text contains "asin=" (failsafe)
          const isPAT =
            entityLabel.includes("product targeting") ||
            entityLabel.includes("targeting") || // generic catch-all for SB
            textLower.includes("asin=") ||
            textLower.includes("category=") ||
            (productTargetIdIdx !== -1 && String(row[productTargetIdIdx]).trim() !== "");

          if (entityLower.includes("negative")) {
            // Negatives are usually "Negative Keywords" in SB unless specified otherwise
            recordType = "sponsoredBrandsNegativeKeyword";
            keywordText = textValue;
            status = "enabled";
            operation = "create";
          } else {
            // PAUSE / UPDATE Logic
            if (isPAT) {
              // ✅ CORRECT: It is Product Targeting
              recordType = "sponsoredBrandsProductTargeting";

              // CRITICAL: Text must go to 'Targeting Text', 'Keyword Text' must be blank
              targetingText = textValue;
              keywordText = "";
            } else {
              // ✅ CORRECT: It is a Keyword
              recordType = "sponsoredBrandsKeyword";

              // CRITICAL: Text must go to 'Keyword Text', 'Targeting Text' must be blank
              keywordText = textValue;
              targetingText = "";
            }
          }
          break;
        }

        // 🔹 SD Targeting sheet
        case SHEET_TYPES.SD_CAMPAIGNS: {
          const rawKw = keywordTextIdx !== -1 ? String(row[keywordTextIdx] || "") : "";
          const rawTarg = targetingIdx !== -1 ? String(row[targetingIdx] || "") : "";
          const rawPte = productTargetIdx !== -1 ? String(row[productTargetIdx] || "") : "";

          // SD text is usually in "Product Targeting Expression" or "Targeting"
          const textValue = rawPte || rawTarg || rawKw;
          const textLower = textValue.toLowerCase();

          // 3. SD Content Awareness: Distinguish Audience vs PAT
          const isAudience =
            textLower.includes("views=") ||
            textLower.includes("purchases=") ||
            textLower.includes("audience=") ||
            entityLower.includes("audience");

          // Amazon SD bulk always requires Keyword Text to be blank
          keywordText = "";
          targetingText = textValue;

          if (entityLower.includes("negative")) {
            // SD Negative is always Negative Product Targeting
            recordType = "sponsoredDisplayNegativeProductTargeting";
            status = "enabled";
            operation = "create";
          } else {
            // PAUSE / UPDATE Logic
            if (isAudience) {
              recordType = "sponsoredDisplayAudienceTargeting";
            } else {
              recordType = "sponsoredDisplayProductTargeting";
            }
          }
          break;
        }
      }

      if (!recordType) continue;

      // Force Amazon-compliant match type for Negative Keyword records
      if (recordType.toLowerCase().includes("negativekeyword")) {
        const mtLower = String(matchTypeFinal || "").toLowerCase();
        matchTypeFinal = mtLower.includes("phrase") ? "Negative Phrase" : "Negative Exact";
      }

      // Determine canonical action
      let action: "pause" | "negative" | "cutBid" | "keep" = "keep";
      if (entityLower.includes("negative") && operation === "create") {
        action = "negative";
      } else if (operation === "update" && status === "paused") {
        action = "pause";
      } else if (operation === "update" && bidValue > 0) {
        action = "cutBid";
      }

      // Attach only the correct ID for the record type
      const lowerRT = recordType.toLowerCase();
      const isKeywordRT = lowerRT.includes("keyword");
      const isTargetRT = lowerRT.includes("producttargeting");
      const isNegativeRT = lowerRT.includes("negative");

      // For keyword record types, keep keywordId; for targeting record types, keep productTargetingId
      // IMPORTANT: Only ONE of keywordId or productTargetingId should be set, never both
      let keywordIdFinal = isKeywordRT ? keywordId : undefined;
      let productTargetingIdFinal = isTargetRT ? targetingId || productTargetingId : undefined;

      // Negative records are always CREATEd as *new* entities → IDs must be blank
      if (isNegativeRT) {
        keywordIdFinal = undefined;
        productTargetingIdFinal = undefined;
      }

      // If this is an UPDATE row, warn when the relevant ID is missing
      if (operation === "update") {
        if (isKeywordRT && !keywordIdFinal) {
          warnings.push(
            `Update row missing Keyword Id (may fail). Sheet "${sheetName}", campaign "${campaignName}", ad group "${adGroupName}", keyword "${keywordText}".`,
          );
        }
        if (isTargetRT && !productTargetingIdFinal) {
          warnings.push(
            `Update row missing Targeting Id (may fail). Sheet "${sheetName}", campaign "${campaignName}", ad group "${adGroupName}", targeting "${targetingText}".`,
          );
        }
      }

      canonicalInputs.push({
        recordType: recordType as AmazonRecordType,
        action,
        campaignId,
        adGroupId,
        keywordId: keywordIdFinal,
        productTargetingId: productTargetingIdFinal,
        targetingId: targetingId || productTargetingIdFinal,
        campaignName,
        adGroupName,
        keywordText,
        targetingText,
        matchType: matchTypeFinal,
        currentBid: action === "cutBid" ? bidValue : undefined,
        cutBidPercent: action === "cutBid" ? 0 : undefined,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pre-export semantic validation
  // ---------------------------------------------------------------------------
  const semanticErrors: string[] = [];

  for (const c of canonicalInputs) {
    const rt = c.recordType.toLowerCase();
    const isKeywordRT = rt.includes("keyword");
    const isTargetRT = rt.includes("producttargeting");
    const isNegRT = rt.includes("negative");

    // Negative record types must always be CREATE actions
    if (isNegRT && c.action !== "negative") {
      semanticErrors.push(
        `Negative record is not marked as negative/create. RecordType "${c.recordType}", Campaign "${c.campaignName}", AdGroup "${c.adGroupName}".`,
      );
    }
    if (!isNegRT && c.action === "negative") {
      warnings.push(`Non-negative record marked negative. RecordType "${c.recordType}", Campaign "${c.campaignName}".`);
    }

    if (isKeywordRT) {
      if (c.targetingText && String(c.targetingText).trim() !== "") {
        semanticErrors.push(
          `Keyword record has Targeting Text. Campaign "${c.campaignName}", AdGroup "${c.adGroupName}", Targeting "${c.targetingText}".`,
        );
      }
      if (!c.keywordText || String(c.keywordText).trim() === "") {
        semanticErrors.push(
          `Keyword record missing Keyword Text. Campaign "${c.campaignName}", AdGroup "${c.adGroupName}".`,
        );
      }
    }

    if (isTargetRT) {
      if (c.keywordText && String(c.keywordText).trim() !== "") {
        semanticErrors.push(
          `Targeting record has Keyword Text. Campaign "${c.campaignName}", AdGroup "${c.adGroupName}", Keyword "${c.keywordText}".`,
        );
      }
      if (!c.targetingText || String(c.targetingText).trim() === "") {
        semanticErrors.push(
          `Targeting record missing Targeting Text. Campaign "${c.campaignName}", AdGroup "${c.adGroupName}".`,
        );
      }
    }
  }

  if (semanticErrors.length > 0) {
    errors.push(
      "Amazon semantic validation failed:\n" +
        semanticErrors.slice(0, 20).join("\n") +
        (semanticErrors.length > 20 ? `\n...and ${semanticErrors.length - 20} more.` : ""),
    );
  }

  // ---------------------------------------------------------------------------
  // Build Amazon Bulksheets 2.0 "Bulk Update" sheets from canonical inputs
  // One sheet per Product type (SP / SB / SD) to keep Amazon happy.
  // ---------------------------------------------------------------------------

  // Group canonical inputs by Product
  const inputsByProduct: Record<AmazonProduct, CanonicalBulkInputRow[]> = {
    "Sponsored Products": [],
    "Sponsored Brands": [],
    "Sponsored Display": [],
  };

  for (const c of canonicalInputs) {
    const { product } = recordTypeToProductEntity(c.recordType);
    inputsByProduct[product].push(c);
  }

  // Build AOA rows per Product
  type ProductBulk = { product: AmazonProduct; rows: any[][] };
  const bulkRowsByProduct: ProductBulk[] = [];

  (["Sponsored Products", "Sponsored Brands", "Sponsored Display"] as AmazonProduct[]).forEach((product) => {
    const subset = inputsByProduct[product];
    if (!subset.length) return;

    const built = buildBulkRowsFromCanonical(subset);
    if (!built.length) return;

    const rows: any[][] = [BULK_UPDATE_HEADERS, ...built.map(bulkRowToArray)];
    bulkRowsByProduct.push({ product, rows });
  });

  // Emit one sheet per Product type using Amazon-required exact tab names
  for (const { product, rows } of bulkRowsByProduct) {
    // CRITICAL: Amazon requires these exact case-sensitive tab names
    const sheetName = product; // "Sponsored Products", "Sponsored Brands", or "Sponsored Display"

    const sheet = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(outputWorkbook, sheet, sheetName);
  }

  // For downstream checks, "hasContent" now means "any product had rows"
  const hasContent = bulkRowsByProduct.some((b) => b.rows.length > 1);

  // Build auto-repair summary
  preFlight.columnsNormalized = headerAliasCount > 0;

  if (decisionRepairedCount > 0) {
    autoRepairs.push({
      type: "decision_normalization",
      count: decisionRepairedCount,
      details: `Normalized 'Decision' values (typo repairs) — ${decisionRepairedCount} rows`,
    });
  }

  if (entityBackfilledCount > 0) {
    autoRepairs.push({
      type: "entity_backfill",
      count: entityBackfilledCount,
      details: `Back-filled missing Entity — ${entityBackfilledCount} rows`,
    });
  }

  if (headerAliasCount > 0) {
    autoRepairs.push({
      type: "header_aliases",
      count: headerAliasCount,
      details: `Header aliases resolved — ${headerAliasCount} columns`,
    });
  }

  if (numericCoercionCount > 0) {
    warnings.push(`Data quality: ${numericCoercionCount} non-numeric values coerced to 0`);
  }

  // Validation checks
  if (totalSpend === 0 && preFlight.actionableRows > 0) {
    warnings.push("Total spend is zero across all actionable rows");
  }

  if (hasBlankEntities && blankEntityRows.length > 0) {
    const exampleRows = blankEntityRows
      .slice(0, 10)
      .map((r) => `${r.sheet} row ${r.row}`)
      .join(", ");
    errors.push(
      `We couldn't produce a valid upload file.\nSome rows still have blank Entity after normalization.\nExample offenders (first 10): ${exampleRows}\nTip: For Pause, Entity should usually be Keyword. For Negative, use Negative Keyword or Negative Product Targeting (ASIN).`,
    );
  }

  // 🔒 Safety net: if we had actionable rows but somehow no Bulk Update rows,
  // make sure we don't throw a misleading error.
  if (!hasContent && preFlight.actionableRows > 0) {
    warnings.push(
      "We processed decisions but couldn't construct an Amazon upload sheet from this file.\n" +
        "Check that your Bleeders 1 decisions file still contains the Campaign / Search Term sheets (SP/SB/SD) from the original Bulk export.",
    );
  }

  if (!hasContent && preFlight.actionableRows === 0) {
    // Informational, not an error
    warnings.push(
      "No actionable rows after Decisions.\nIt looks like all rows were set to Keep. If that's expected, you can skip this cycle.",
    );
  } else if (!hasContent) {
    errors.push(
      "All rows were filtered out when building the Bulk Update sheet. This may be due to mismatched headers or Decision capitalization. Try re-saving with lowercase decisions (pause, negative, keep).",
    );
  }

  const timestamp = getPacificTimestamp();
  const fileName = `Amazon_Bulk_Operations_Bleeders1_${timestamp}_PT.xlsx`;

  return {
    success: errors.length === 0,
    fileName,
    summary: {
      pausedCount,
      negativesCreated,
      searchTermRowsAdded,
      negativeProductTargets,
    },
    workbook: outputWorkbook,
    validation: {
      totalSpend,
      hasBlankEntities,
      errors,
      warnings,
    },
    autoRepairs,
    preFlight,
  };
};
