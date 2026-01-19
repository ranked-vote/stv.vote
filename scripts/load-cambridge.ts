/**
 * Load Cambridge MA election data into SQLite
 *
 * Usage: bun scripts/load-cambridge.ts
 */

import { Database } from "bun:sqlite";
import {
  parseCambridgeCSV,
  normalizeCandidate,
} from "./parse-cambridge-csv.js";
import { tabulateSTV } from "./tabulate-stv-cambridge.js";
import { computePairwiseTables } from "./compute-pairwise.js";
import { existsSync } from "node:fs";

interface ElectionConfig {
  year: string;
  month: string;
  day: string;
  office: string;
  officeName: string;
  seats: number;
  csvFile: string;
}

// Cambridge election configurations
const CAMBRIDGE_ELECTIONS: ElectionConfig[] = [
  // 2019
  {
    year: "2019",
    month: "11",
    day: "05",
    office: "council",
    officeName: "City Council",
    seats: 9,
    csvFile: "raw-data/us/cambridge-ma/2019/votes.csv",
  },
  // 2021
  {
    year: "2021",
    month: "11",
    day: "02",
    office: "council",
    officeName: "City Council",
    seats: 9,
    csvFile: "raw-data/us/cambridge-ma/2021/council.csv",
  },
  // 2023
  {
    year: "2023",
    month: "11",
    day: "07",
    office: "council",
    officeName: "City Council",
    seats: 9,
    csvFile: "raw-data/us/cambridge-ma/2023/council.csv",
  },
];

function loadElection(db: Database, config: ElectionConfig) {
  console.log(`\nLoading ${config.year} ${config.officeName}...`);

  if (!existsSync(config.csvFile)) {
    console.log(`  Skipping: ${config.csvFile} not found`);
    return;
  }

  // Parse ballots
  const parseResult = parseCambridgeCSV(config.csvFile);
  console.log(`  Parsed ${parseResult.ballots.length} valid ballots`);
  console.log(`  Found ${parseResult.candidates.length} candidates`);

  // Tabulate
  const stvResult = tabulateSTV(
    parseResult.ballots,
    config.seats,
    parseResult.candidates,
  );
  console.log(`  Quota: ${stvResult.quota}`);
  console.log(`  Rounds: ${stvResult.rounds.length}`);
  console.log(
    `  Winners: ${stvResult.winners.map((w) => stvResult.candidates[w]).join(", ")}`,
  );

  // Compute pairwise preference tables
  console.log(`  Computing pairwise preferences...`);
  const pairwiseData = computePairwiseTables(
    parseResult.ballots,
    stvResult.candidates,
    stvResult.rounds,
  );

  // Build paths
  const date = `${config.year}-${config.month}-${config.day}`;
  const jurisdictionPath = "us/ma/cambridge";
  const electionPath = `${config.year}/${config.month}`;
  const path = `${jurisdictionPath}/${electionPath}`;

  // Insert report
  const insertReport = db.prepare(`
    INSERT INTO reports (
      name, date, jurisdictionPath, electionPath, office, officeName,
      jurisdictionName, electionName, ballotCount, path, seats, quota,
      numRounds, winners, dataFormat, tabulation,
      pairwisePreferences, firstAlternate, firstFinal, rankingDistribution
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const reportResult = insertReport.run(
    `Cambridge ${config.officeName} ${config.year}`,
    date,
    jurisdictionPath,
    electionPath,
    config.office,
    config.officeName,
    "Cambridge, MA",
    `November ${config.year}`,
    parseResult.ballots.length,
    path,
    config.seats,
    stvResult.quota,
    stvResult.rounds.length,
    JSON.stringify(stvResult.winners),
    "cambridge-csv",
    "stv",
    JSON.stringify(pairwiseData.pairwisePreferences),
    JSON.stringify(pairwiseData.firstAlternate),
    pairwiseData.firstFinal ? JSON.stringify(pairwiseData.firstFinal) : null,
    JSON.stringify(pairwiseData.rankingDistribution),
  );

  const reportId = reportResult.lastInsertRowid;
  console.log(`  Report ID: ${reportId}`);

  // Insert candidates
  const insertCandidate = db.prepare(`
    INSERT INTO candidates (
      report_id, candidate_index, name, writeIn, firstRoundVotes,
      transferVotes, roundEliminated, roundElected, winner
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < stvResult.candidates.length; i++) {
    const name = stvResult.candidates[i];
    const { isWriteIn } = normalizeCandidate(name);
    const votes = stvResult.candidateVotes.find((v) => v.candidate === i);
    const isWinner = stvResult.winners.includes(i) ? 1 : 0;

    insertCandidate.run(
      reportId,
      i,
      name,
      isWriteIn ? 1 : 0,
      votes?.firstRoundVotes ?? 0,
      votes?.transferVotes ?? 0,
      votes?.roundEliminated ?? null,
      votes?.roundElected ?? null,
      isWinner,
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

  console.log(
    `  Loaded ${stvResult.rounds.length} rounds with allocations and transfers`,
  );
}

// Main
const db = new Database("data.sqlite3");

// Ensure tables exist
console.log("Initializing database...");
await import("./init-database.js");

// Clear existing Cambridge data
console.log("\nClearing existing Cambridge data...");
db.run("DELETE FROM reports WHERE jurisdictionPath = 'us/ma/cambridge'");

// Load all elections
for (const config of CAMBRIDGE_ELECTIONS) {
  loadElection(db, config);
}

console.log("\nDone! Data loaded into data.sqlite3");

// Verify
const count = db.query("SELECT COUNT(*) as count FROM reports").get() as {
  count: number;
};
console.log(`Total reports in database: ${count.count}`);
