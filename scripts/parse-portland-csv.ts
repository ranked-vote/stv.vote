/**
 * Portland OR CVR CSV parser
 *
 * Handles Portland's Cast Vote Record format:
 * - Each candidate has 6 columns (Choice_X_1 through Choice_X_6) representing ranks 1-6
 * - Column format: Choice_X_Y:Office:Rank:Number of Winners N:Candidate Name:Type
 * - Value "1" in a column indicates that rank was selected for that candidate
 * - Ballots are deduplicated during parsing to reduce memory usage
 */

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { parse } from "csv-parse";

export interface PortlandBallot {
  rankings: string[]; // Candidate names in rank order
  count: number; // Number of identical ballots
}

export interface ParseResult {
  ballots: PortlandBallot[];
  candidates: string[]; // Unique candidate names
  office: string; // Office name extracted from headers
  seats: number; // Number of seats (from "Number of Winners N")
  totalBallots: number; // Total valid ballots with rankings for this contest (for quota calculation)
}

/**
 * Extract candidate name from column header
 * Format: Choice_X_Y:Office:Rank:Number of Winners N:Candidate Name:Type
 */
function extractCandidateName(header: string): string | null {
  const parts = header.split(":");
  if (parts.length < 5) return null;

  // Candidate name is between "Number of Winners N" and the last part (Type)
  // Parts: [Choice_X_Y, Office, Rank, "Number of Winners N", Candidate Name, Type]
  const candidateName = parts[4]?.trim();
  return candidateName || null;
}

/**
 * Extract office name from column header
 */
function extractOfficeName(header: string): string | null {
  const parts = header.split(":");
  if (parts.length < 2) return null;
  return parts[1]?.trim() || null;
}

/**
 * Extract number of seats from column header
 */
function extractSeats(header: string): number | null {
  const match = header.match(/Number of Winners (\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Normalize candidate name (handles write-ins)
 */
function normalizeCandidate(name: string): {
  name: string;
  isWriteIn: boolean;
} {
  const trimmed = name.trim();
  const isWriteIn =
    /^write-?in/i.test(trimmed) || /^uncertified write in/i.test(trimmed);

  return {
    // Consolidate all write-ins into a single candidate
    name: isWriteIn ? "Write-in" : trimmed,
    isWriteIn,
  };
}

/**
 * Extract rankings from a ballot row
 * Returns array of candidate names in rank order (1st, 2nd, 3rd, etc.)
 */
function extractRankings(
  row: Record<string, string>,
  candidateRankColumns: Map<string, Array<{ rank: number; header: string }>>,
): string[] {
  const rankings: Array<{ rank: number; name: string }> = [];

  // For each candidate, find which rank column has value "1"
  for (const [candidateName, rankCols] of candidateRankColumns.entries()) {
    for (const col of rankCols) {
      const value = row[col.header]?.trim();
      if (value === "1") {
        rankings.push({ rank: col.rank, name: candidateName });
        break; // Only one rank per candidate should be "1"
      }
    }
  }

  // Sort by rank and extract names
  rankings.sort((a, b) => a.rank - b.rank);
  return rankings.map((r) => r.name);
}

/**
 * Parse a Portland CVR CSV file
 */
export function parsePortlandCSV(csvPath: string): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const ballotMap = new Map<string, number>(); // Key: JSON.stringify(rankings), Value: count
    const candidateSet = new Set<string>();
    let headers: string[] = [];
    // Map from candidate name to array of {rank, header} for that candidate
    const candidateRankColumns: Map<
      string,
      Array<{ rank: number; header: string }>
    > = new Map();
    let office: string | null = null;
    let seats: number | null = null;
    let statusColumn: string | null = null;
    let headerParsed = false;
    let totalValidBallots = 0; // Count all valid ballots including undervotes for quota calculation

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });

    parser.on("readable", function () {
      let record: Record<string, string>;

      while ((record = parser.read()) !== null) {
        // Parse headers on first record
        if (!headerParsed) {
          headers = Object.keys(record);

          // Find Status column
          statusColumn = "Status";

          // Group columns by candidate number (X in Choice_X_Y)
          // Format: Choice_X_Y:Office:Rank:Number of Winners N:Candidate Name:Type
          const candidateMap = new Map<
            number,
            { name: string; rankCols: Array<{ rank: number; header: string }> }
          >();

          for (const header of headers) {
            if (header.startsWith("Choice_")) {
              // Extract candidate number from Choice_X_Y
              const match = header.match(/Choice_(\d+)_(\d+):/);
              if (match) {
                const candidateNum = parseInt(match[1], 10);

                // Extract rank from header parts (parts[2] is the rank, NOT the Y in Choice_X_Y)
                // Format: Choice_X_Y:Office:Rank:Number of Winners N:Candidate Name:Type
                const parts = header.split(":");
                const rank = parts.length >= 3 ? parseInt(parts[2], 10) : null;
                if (rank === null || isNaN(rank)) continue;

                const candidateName = extractCandidateName(header);
                const officeName = extractOfficeName(header);
                const seatsValue = extractSeats(header);

                if (candidateName && officeName && seatsValue !== null) {
                  const normalized = normalizeCandidate(candidateName);

                  if (!candidateMap.has(candidateNum)) {
                    candidateMap.set(candidateNum, {
                      name: normalized.name,
                      rankCols: [],
                    });
                  }

                  candidateMap
                    .get(candidateNum)!
                    .rankCols.push({ rank, header });
                  candidateSet.add(normalized.name);

                  // Set office and seats from first candidate column
                  if (office === null) {
                    office = officeName;
                  }
                  if (seats === null) {
                    seats = seatsValue;
                  }
                }
              }
            }
          }

          // Build candidateRankColumns map sorted by candidate name
          const sortedCandidates = Array.from(candidateMap.values()).sort(
            (a, b) => a.name.localeCompare(b.name),
          );

          for (const candidate of sortedCandidates) {
            // Sort rank columns by rank
            candidate.rankCols.sort((a, b) => a.rank - b.rank);
            candidateRankColumns.set(candidate.name, candidate.rankCols);
          }

          headerParsed = true;

          if (!office || seats === null || candidateRankColumns.size === 0) {
            reject(
              new Error(
                "Failed to extract office, seats, or candidates from CSV headers",
              ),
            );
            return;
          }

          continue;
        }

        // Check ballot validity (Status = 0 means valid)
        if (statusColumn && record[statusColumn]?.trim() !== "0") {
          continue; // Skip invalid ballots
        }

        // Extract rankings
        const rankings = extractRankings(record, candidateRankColumns);

        // Only count ballots that actually have rankings for this contest
        // (CVR files contain all county ballots, not just ballots for this specific contest)
        if (rankings.length === 0) {
          continue; // Skip ballots from other districts/contests
        }

        // Count ballots with rankings for quota calculation
        totalValidBallots++;

        // Deduplicate ballots
        const key = JSON.stringify(rankings);
        ballotMap.set(key, (ballotMap.get(key) || 0) + 1);
      }
    });

    parser.on("error", (err) => {
      reject(err);
    });

    parser.on("end", () => {
      // Convert ballot map to array
      const ballots: PortlandBallot[] = [];
      for (const [key, count] of ballotMap.entries()) {
        const rankings = JSON.parse(key) as string[];
        ballots.push({ rankings, count });
      }

      // Sort candidates alphabetically
      const candidates = Array.from(candidateSet).sort();

      resolve({
        ballots,
        candidates,
        office: office!,
        seats: seats!,
        totalBallots: totalValidBallots,
      });
    });

    // Stream the file (handle both .csv and .csv.gz)
    const stream = createReadStream(csvPath);
    if (csvPath.endsWith(".gz")) {
      stream.pipe(createGunzip()).pipe(parser);
    } else {
      stream.pipe(parser);
    }
  });
}

// CLI usage
if (import.meta.main) {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Usage: bun scripts/parse-portland-csv.ts <path-to-csv>");
    process.exit(1);
  }

  parsePortlandCSV(csvPath)
    .then((result) => {
      console.log(`Office: ${result.office}`);
      console.log(`Seats: ${result.seats}`);
      console.log(`Total unique ballot patterns: ${result.ballots.length}`);
      console.log(`Total ballots: ${result.totalBallots}`);
      console.log(`Unique candidates: ${result.candidates.length}`);
      console.log("\nCandidates:");
      for (const c of result.candidates) {
        const { isWriteIn } = normalizeCandidate(c);
        console.log(`  - ${c}${isWriteIn ? " (write-in)" : ""}`);
      }

      // Sample of first 3 ballots
      console.log("\nSample ballots:");
      for (const ballot of result.ballots.slice(0, 3)) {
        console.log(`  ${ballot.count}x: ${ballot.rankings.join(" > ")}`);
      }
    })
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
