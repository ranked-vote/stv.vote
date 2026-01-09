/**
 * Parse Scotland 2022 council election ballot data
 *
 * Format from https://www.macs.hw.ac.uk/~denis/stv_elections/SC2022/
 *
 * Each .dat file contains:
 * - Line 1: Ward name
 * - Line 2: seats, candidates_count, ballot_lines, electorate
 * - Lines 3 to 3+candidates_count-1: "Candidate Name, Party"
 * - Remaining lines: "count pref1 pref2 ... prefN"
 *   where prefI is the rank given to candidate I (1=first, 2=second, 0=not ranked)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";

export interface ScotlandBallot {
  rankings: string[]; // Candidate names in preference order
  count: number; // Number of voters with this ballot pattern
}

export interface ScotlandWardData {
  wardName: string;
  seats: number;
  candidates: string[];
  parties: string[];
  ballots: ScotlandBallot[];
  totalBallots: number;
  electorate: number;
  councilName: string;
  wardSlug: string;
}

/**
 * Parse a single Scotland ballot .dat file
 */
export function parseScotlandBallotFile(
  filepath: string,
  councilName: string,
): ScotlandWardData {
  const content = readFileSync(filepath, "utf-8");
  const lines = content.trim().split("\n");

  // Line 1: Ward name
  const wardName = lines[0].trim();

  // Line 2: seats, candidates_count, ballot_lines, electorate
  const [seats, candidateCount, _ballotLines, electorate] = lines[1]
    .trim()
    .split(/\s+/)
    .map(Number);

  // Parse candidates (lines 3 to 3+candidateCount-1)
  const candidates: string[] = [];
  const parties: string[] = [];

  for (let i = 2; i < 2 + candidateCount; i++) {
    const line = lines[i].trim();
    // Format: "Name, Party" or "Name,Party"
    const commaIndex = line.lastIndexOf(",");
    if (commaIndex > 0) {
      const name = line.substring(0, commaIndex).trim();
      const party = line.substring(commaIndex + 1).trim();
      candidates.push(name);
      parties.push(party);
    } else {
      candidates.push(line);
      parties.push("Unknown");
    }
  }

  // Parse ballots (remaining lines)
  const ballots: ScotlandBallot[] = [];
  let totalBallots = 0;

  for (let i = 2 + candidateCount; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/).map(Number);
    if (parts.length < candidateCount + 1) continue;

    const count = parts[0];
    if (count === 0) continue; // End marker or empty

    const preferences = parts.slice(1);

    // Convert preferences to rankings
    // preferences[i] = rank given to candidate i (1=first, 0=not ranked)
    const rankToCandidateIndex: [number, number][] = [];

    for (let candIdx = 0; candIdx < preferences.length; candIdx++) {
      const rank = preferences[candIdx];
      if (rank > 0) {
        rankToCandidateIndex.push([rank, candIdx]);
      }
    }

    // Sort by rank to get preference order
    rankToCandidateIndex.sort((a, b) => a[0] - b[0]);

    // Extract candidate names in preference order
    const rankings = rankToCandidateIndex.map(
      ([_rank, candIdx]) => candidates[candIdx],
    );

    if (rankings.length > 0) {
      ballots.push({ rankings, count });
      totalBallots += count;
    }
  }

  // Create ward slug from filename
  const wardSlug = basename(filepath, ".dat")
    .toLowerCase()
    .replace(/^\d+_/, "") // Remove leading number prefix
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    wardName,
    seats,
    candidates,
    parties,
    ballots,
    totalBallots,
    electorate,
    councilName,
    wardSlug,
  };
}

/**
 * Expand ballots from aggregated format to individual ballot array
 * (for use with computePairwiseTables which expects one entry per ballot)
 */
export function expandBallots(
  ballots: ScotlandBallot[],
): { rankings: string[] }[] {
  const expanded: { rankings: string[] }[] = [];

  for (const ballot of ballots) {
    for (let i = 0; i < ballot.count; i++) {
      expanded.push({ rankings: ballot.rankings });
    }
  }

  return expanded;
}

/**
 * Parse all ballot files for a council
 */
export function parseCouncilBallots(
  councilDir: string,
  councilName: string,
): ScotlandWardData[] {
  const wards: ScotlandWardData[] = [];

  const files = readdirSync(councilDir);
  for (const file of files) {
    if (!file.endsWith(".dat")) continue;

    const filepath = join(councilDir, file);
    if (!statSync(filepath).isFile()) continue;

    try {
      const ward = parseScotlandBallotFile(filepath, councilName);
      wards.push(ward);
    } catch (e) {
      console.error(`Error parsing ${filepath}:`, e);
    }
  }

  // Sort by ward number (extracted from filename)
  wards.sort((a, b) => {
    const numA = parseInt(basename(a.wardSlug).match(/^\d+/)?.[0] || "0");
    const numB = parseInt(basename(b.wardSlug).match(/^\d+/)?.[0] || "0");
    return numA - numB;
  });

  return wards;
}

/**
 * Get all councils from the ballot data directory
 */
export function getCouncils(baseDir: string): string[] {
  const entries = readdirSync(baseDir);
  const councils: string[] = [];

  for (const entry of entries) {
    const path = join(baseDir, entry);
    if (statSync(path).isDirectory() && !entry.startsWith(".")) {
      councils.push(entry);
    }
  }

  return councils.sort();
}

// CLI for testing
if (import.meta.main) {
  const baseDir =
    process.argv[2] || "raw-data/scotland/2022/SC2022_ballot_format";

  console.log(`Parsing Scotland 2022 ballot data from ${baseDir}...`);

  const councils = getCouncils(baseDir);
  console.log(`Found ${councils.length} councils\n`);

  let totalWards = 0;

  for (const council of councils.slice(0, 3)) {
    // Just show first 3 for demo
    console.log(`\n=== ${council} ===`);
    const councilDir = join(baseDir, council);
    const wards = parseCouncilBallots(councilDir, council);

    for (const ward of wards.slice(0, 2)) {
      // Show first 2 wards
      console.log(
        `  ${ward.wardName}: ${ward.seats} seats, ${ward.candidates.length} candidates, ${ward.totalBallots} ballots`,
      );
      console.log(`    Candidates: ${ward.candidates.join(", ")}`);

      // Show sample ballot
      if (ward.ballots.length > 0) {
        const sample = ward.ballots[0];
        console.log(
          `    Sample ballot (${sample.count}x): ${sample.rankings.join(" > ")}`,
        );
      }
    }

    totalWards += wards.length;
  }

  console.log(`\n... and ${councils.length - 3} more councils`);
  console.log(`\nTotal: ${totalWards} wards in first 3 councils`);
}
