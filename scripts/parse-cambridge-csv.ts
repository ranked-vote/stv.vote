/**
 * Cambridge MA ballot CSV parser
 *
 * Handles multiple Cambridge CSV formats:
 * - 2019: ballot_ID,Precinct,Ward,WardPrecinct,invalid,rank1,rank10,rank11,...rank15,rank2-rank9 (columns out of order!)
 * - 2021: pile,ward,precinct,rank1,rank2,...rank15
 * - 2023: precinct,ward,valid,pile,rank1,rank2,...rank15
 */

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";

export interface Ballot {
  rankings: string[]; // Candidate names in rank order
  precinct?: string;
  ward?: string;
  valid?: boolean;
}

export interface ParseResult {
  ballots: Ballot[];
  candidates: string[]; // Unique candidate names
  format: "2019" | "2021" | "2023" | "unknown";
}

/**
 * Extract rank columns in correct numerical order
 */
function extractRankings(
  row: Record<string, string>,
  headers: string[],
): string[] {
  // Find all rank columns
  const rankColumns: { col: string; num: number }[] = [];

  for (const header of headers) {
    const match = header.match(/^rank(\d+)$/);
    if (match) {
      rankColumns.push({ col: header, num: parseInt(match[1], 10) });
    }
  }

  // Sort by rank number
  rankColumns.sort((a, b) => a.num - b.num);

  // Extract values in order, filtering out empty/null
  const rankings: string[] = [];
  for (const { col } of rankColumns) {
    const value = row[col]?.trim();
    if (value && value.length > 0) {
      rankings.push(value);
    }
  }

  return rankings;
}

/**
 * Detect the format based on headers
 */
function detectFormat(headers: string[]): ParseResult["format"] {
  const headerSet = new Set(headers.map((h) => h.toLowerCase()));

  if (headerSet.has("ballot_id") || headerSet.has("invalid")) {
    return "2019";
  }
  if (headerSet.has("valid")) {
    return "2023";
  }
  if (headerSet.has("pile") && !headerSet.has("valid")) {
    return "2021";
  }
  return "unknown";
}

/**
 * Parse a Cambridge ballot CSV file
 */
export function parseCambridgeCSV(csvPath: string): ParseResult {
  const content = readFileSync(csvPath, "utf-8");

  const records: Record<string, string>[] = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true, // Ballots may have fewer rankings than columns
  });

  if (records.length === 0) {
    return { ballots: [], candidates: [], format: "unknown" };
  }

  const headers = Object.keys(records[0]);
  const format = detectFormat(headers);
  const candidateSet = new Set<string>();
  const ballots: Ballot[] = [];

  for (const row of records) {
    // Check validity based on format
    let isValid = true;
    if (format === "2019") {
      isValid = row["invalid"]?.toLowerCase() !== "true";
    } else if (format === "2023") {
      isValid = row["valid"]?.toLowerCase() === "t";
    }

    if (!isValid) continue;

    const rawRankings = extractRankings(row, headers);

    if (rawRankings.length === 0) continue;

    // Normalize candidate names (consolidates write-ins)
    const rankings = rawRankings.map((name) => normalizeCandidate(name).name);

    // Track candidates (using normalized names)
    for (const name of rankings) {
      candidateSet.add(name);
    }

    ballots.push({
      rankings,
      precinct: row["precinct"] || row["Precinct"],
      ward: row["ward"] || row["Ward"],
      valid: isValid,
    });
  }

  // Sort candidates alphabetically
  const candidates = Array.from(candidateSet).sort();

  return { ballots, candidates, format };
}

/**
 * Get candidate name normalization (handles write-ins)
 */
export function normalizeCandidate(name: string): {
  name: string;
  isWriteIn: boolean;
} {
  const trimmed = name.trim();
  const isWriteIn = /^write-?in/i.test(trimmed);

  return {
    // Consolidate all write-ins into a single candidate
    name: isWriteIn ? "Write-in" : trimmed,
    isWriteIn,
  };
}

// CLI usage
if (import.meta.main) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: bun scripts/parse-cambridge-csv.ts <path-to-csv>");
    process.exit(1);
  }

  const result = parseCambridgeCSV(csvPath);
  console.log(`Format detected: ${result.format}`);
  console.log(`Total valid ballots: ${result.ballots.length}`);
  console.log(`Unique candidates: ${result.candidates.length}`);
  console.log("\nCandidates:");
  for (const c of result.candidates) {
    const { isWriteIn } = normalizeCandidate(c);
    console.log(`  - ${c}${isWriteIn ? " (write-in)" : ""}`);
  }

  // Sample of first 3 ballots
  console.log("\nSample ballots:");
  for (const ballot of result.ballots.slice(0, 3)) {
    console.log(`  Rankings: ${ballot.rankings.join(" > ")}`);
  }
}
