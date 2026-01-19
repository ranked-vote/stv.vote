/**
 * Load Scotland 2022 council election data from ballot files
 *
 * Uses the ballot-level data from Denis Mollison (Heriot-Watt University)
 * https://www.macs.hw.ac.uk/~denis/stv_elections/SC2022/
 *
 * This is the primary/authoritative data source. We tabulate the election
 * ourselves using our STV tabulator to compute round-by-round results.
 *
 * Usage: bun scripts/load-scotland-ballots.ts
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import {
  parseCouncilBallots,
  getCouncils,
  expandBallots,
  type ScotlandWardData,
} from "./parse-scotland-ballots.js";
import { tabulateSTV, type Ballot } from "./tabulate-stv-cambridge.js";
import { computePairwiseTables } from "./compute-pairwise.js";
import { normalizeName } from "./normalize-name.js";

const BALLOT_DATA_DIR = "raw-data/uk/scotland/2022/SC2022_ballot_format";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Normalize all candidate names in ward data (both the candidate list and ballot rankings)
 * This ensures the names are consistent throughout the tabulation and storage.
 */
function normalizeWardNames(ward: ScotlandWardData): ScotlandWardData {
  // Create a mapping from original names to normalized names
  const normalizedCandidates = ward.candidates.map(normalizeName);

  // Build a map for quick lookup when normalizing ballots
  const nameMap = new Map<string, string>();
  for (let i = 0; i < ward.candidates.length; i++) {
    nameMap.set(ward.candidates[i], normalizedCandidates[i]);
  }

  // Normalize ballot rankings
  const normalizedBallots = ward.ballots.map((ballot) => ({
    ...ballot,
    rankings: ballot.rankings.map((name) => nameMap.get(name) ?? name),
  }));

  return {
    ...ward,
    candidates: normalizedCandidates,
    ballots: normalizedBallots,
  };
}

function loadWard(
  db: Database,
  wardRaw: ScotlandWardData,
  councilSlug: string,
) {
  // Normalize all candidate names (convert ALL CAPS surnames to proper case)
  const ward = normalizeWardNames(wardRaw);

  // Build paths
  const wardSlug = slugify(ward.wardName.replace(/^\d+\s+/, "")); // Remove leading number
  const jurisdictionPath = `gb/scotland/${councilSlug}`;
  const electionPath = "2022/05";
  const path = `${jurisdictionPath}/${electionPath}`;

  // Expand ballots for tabulation
  const expandedBallots = expandBallots(ward.ballots);

  // Convert to tabulator format
  const tabulatorBallots: Ballot[] = expandedBallots.map((b) => ({
    rankings: b.rankings,
  }));

  // Tabulate the election
  const stvResult = tabulateSTV(tabulatorBallots, ward.seats, ward.candidates);

  // Compute pairwise preferences
  const pairwiseResult = computePairwiseTables(
    expandedBallots,
    ward.candidates,
    stvResult.rounds,
  );

  // Format council name nicely
  const councilName = ward.councilName
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  // Insert report
  const insertReport = db.prepare(`
    INSERT INTO reports (
      name, date, jurisdictionPath, electionPath, office, officeName,
      jurisdictionName, electionName, ballotCount, path, seats, quota,
      numRounds, winners, dataFormat, tabulation,
      pairwisePreferences, firstAlternate, firstFinal, rankingDistribution
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const wardDisplayName = ward.wardName.replace(/^\d+\s+/, ""); // Remove leading number

  const reportResult = insertReport.run(
    `${councilName} - ${wardDisplayName}`,
    "2022-05-05",
    jurisdictionPath,
    electionPath,
    wardSlug,
    wardDisplayName,
    `${councilName}, Scotland`,
    "May 2022",
    ward.totalBallots,
    path,
    ward.seats,
    stvResult.quota,
    stvResult.rounds.length,
    JSON.stringify(stvResult.winners),
    "scotland-ballot-2022",
    "stv",
    JSON.stringify(pairwiseResult.pairwisePreferences),
    JSON.stringify(pairwiseResult.firstAlternate),
    pairwiseResult.firstFinal
      ? JSON.stringify(pairwiseResult.firstFinal)
      : null,
    JSON.stringify(pairwiseResult.rankingDistribution),
  );

  const reportId = reportResult.lastInsertRowid;

  // Insert candidates
  const insertCandidate = db.prepare(`
    INSERT INTO candidates (
      report_id, candidate_index, name, writeIn, firstRoundVotes,
      transferVotes, roundEliminated, roundElected, winner, candidate_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < ward.candidates.length; i++) {
    const name = ward.candidates[i]; // Already normalized by normalizeWardNames
    const party = ward.parties[i];
    const votes = stvResult.candidateVotes.find((v) => v.candidate === i);
    const isWinner = stvResult.winners.includes(i) ? 1 : 0;

    insertCandidate.run(
      reportId,
      i,
      name,
      0, // writeIn
      votes?.firstRoundVotes ?? 0,
      votes?.transferVotes ?? 0,
      votes?.roundEliminated ?? null,
      votes?.roundElected ?? null,
      isWinner,
      party, // Store party in candidate_type
    );
  }

  // Insert rounds
  const insertRound = db.prepare(`
    INSERT INTO rounds (
      report_id, round_number, undervote, overvote, continuingBallots,
      electedThisRound, eliminatedThisRound
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAllocation = db.prepare(`
    INSERT INTO allocations (round_id, allocatee, votes)
    VALUES (?, ?, ?)
  `);

  const insertTransfer = db.prepare(`
    INSERT INTO transfers (round_id, from_candidate, to_allocatee, count, transfer_type)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < stvResult.rounds.length; i++) {
    const round = stvResult.rounds[i];

    const roundResult = insertRound.run(
      reportId,
      i + 1,
      round.undervote,
      round.overvote,
      round.continuingBallots,
      round.electedThisRound ? JSON.stringify(round.electedThisRound) : null,
      round.eliminatedThisRound
        ? JSON.stringify(round.eliminatedThisRound)
        : null,
    );

    const roundId = roundResult.lastInsertRowid;

    // Insert allocations
    for (const alloc of round.allocations) {
      insertAllocation.run(roundId, String(alloc.allocatee), alloc.votes);
    }

    // Insert transfers
    for (const transfer of round.transfers) {
      insertTransfer.run(
        roundId,
        transfer.from,
        String(transfer.to),
        transfer.count,
        transfer.type || "elimination",
      );
    }
  }
}

// Main
const db = new Database("data.sqlite3");

// Ensure tables exist
console.log("Initializing database...");
await import("./init-database.js");

// Clear existing Scotland data
console.log("\nClearing existing Scotland data...");
db.run("DELETE FROM reports WHERE jurisdictionPath LIKE 'gb/scotland/%'");

// Load ballot data
console.log(`\nLoading ballot data from ${BALLOT_DATA_DIR}...`);
const councils = getCouncils(BALLOT_DATA_DIR);
console.log(`Found ${councils.length} councils`);

let totalWards = 0;
let totalBallots = 0;

for (const council of councils) {
  const councilDir = join(BALLOT_DATA_DIR, council);
  const councilSlug = slugify(council);
  const wards = parseCouncilBallots(councilDir, council);

  console.log(`  ${council}: ${wards.length} wards`);

  for (const ward of wards) {
    // Skip uncontested wards (no ballot data)
    if (ward.totalBallots === 0) {
      continue;
    }

    try {
      loadWard(db, ward, councilSlug);
      totalWards++;
      totalBallots += ward.totalBallots;
    } catch (e) {
      console.error(`    Error loading ${ward.wardName}:`, e);
    }
  }
}

console.log(
  `\nDone! Loaded ${totalWards} wards with ${totalBallots.toLocaleString()} total ballots`,
);

// Verify
const count = db.query("SELECT COUNT(*) as count FROM reports").get() as {
  count: number;
};
console.log(`Total reports in database: ${count.count}`);

const scotlandCount = db
  .query(
    "SELECT COUNT(*) as count FROM reports WHERE jurisdictionPath LIKE 'gb/scotland/%'",
  )
  .get() as { count: number };
console.log(`Scotland reports: ${scotlandCount.count}`);

// Count how many have pairwise data
const pairwiseCount = db
  .query(
    "SELECT COUNT(*) as count FROM reports WHERE jurisdictionPath LIKE 'gb/scotland/%' AND pairwisePreferences IS NOT NULL",
  )
  .get() as { count: number };
console.log(`Scotland reports with pairwise data: ${pairwiseCount.count}`);
