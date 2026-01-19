/**
 * Load Portland OR election data into SQLite
 *
 * Usage: bun scripts/load-portland.ts
 */

import { Database } from "bun:sqlite";
import { parsePortlandCSV } from "./parse-portland-csv.js";
import { expandBallots } from "./parse-scotland-ballots.js";
import {
  tabulateFractionalSTV,
  type Ballot,
} from "./tabulate-stv-fractional.js";
import { computePairwiseTables } from "./compute-pairwise.js";
import { existsSync } from "node:fs";

interface ElectionConfig {
  office: string;
  officeName: string;
  csvFile: string;
}

// Portland election configurations
const PORTLAND_ELECTIONS: ElectionConfig[] = [
  {
    office: "mayor",
    officeName: "Mayor",
    csvFile:
      "raw-data/us/portland-or/2024/City_of_Portland__Mayor_2024_11_29_17_26_12.cvr.csv.gz",
  },
  {
    office: "auditor",
    officeName: "Auditor",
    csvFile:
      "raw-data/us/portland-or/2024/City_of_Portland__Auditor_2024_11_29_17_26_12.cvr.csv.gz",
  },
  {
    office: "councilor-district-1",
    officeName: "Councilor, District 1",
    csvFile:
      "raw-data/us/portland-or/2024/City_of_Portland__Councilor__District_1_2024_11_29_17_26_12.cvr.csv.gz",
  },
  {
    office: "councilor-district-2",
    officeName: "Councilor, District 2",
    csvFile:
      "raw-data/us/portland-or/2024/City_of_Portland__Councilor__District_2_2024_11_29_17_26_12.cvr.csv.gz",
  },
  {
    office: "councilor-district-3",
    officeName: "Councilor, District 3",
    csvFile:
      "raw-data/us/portland-or/2024/City_of_Portland__Councilor__District_3_2024_11_29_17_26_12.cvr.csv.gz",
  },
  {
    office: "councilor-district-4",
    officeName: "Councilor, District 4",
    csvFile:
      "raw-data/us/portland-or/2024/City_of_Portland__Councilor__District_4_2024_11_29_17_26_12.cvr.csv.gz",
  },
];

function loadElection(db: Database, config: ElectionConfig) {
  console.log(`\nLoading ${config.officeName}...`);

  if (!existsSync(config.csvFile)) {
    console.log(`  Skipping: ${config.csvFile} not found`);
    return;
  }

  return parsePortlandCSV(config.csvFile)
    .then((parseResult) => {
      console.log(
        `  Parsed ${parseResult.ballots.length} unique ballot patterns`,
      );
      const totalBallots = parseResult.ballots.reduce(
        (sum, b) => sum + b.count,
        0,
      );
      console.log(`  Total ballots: ${totalBallots.toLocaleString()}`);
      console.log(`  Found ${parseResult.candidates.length} candidates`);
      console.log(`  Office: ${parseResult.office}`);
      console.log(`  Seats: ${parseResult.seats}`);

      // Expand ballots for tabulation (like Scotland)
      const expandedBallots = expandBallots(parseResult.ballots);
      console.log(
        `  Expanded to ${expandedBallots.length.toLocaleString()} ballots for tabulation`,
      );

      // Convert to Portland tabulator format (with weight)
      const tabulatorBallots: Ballot[] = expandedBallots.map((b) => ({
        rankings: b.rankings,
        weight: 1.0,
      }));

      // Tabulate using fractional surplus transfer method
      const stvResult = tabulateFractionalSTV(
        tabulatorBallots,
        parseResult.seats,
        parseResult.candidates,
        parseResult.totalBallots, // Use total ballots for quota calculation
      );
      console.log(`  Quota: ${stvResult.quota}`);
      console.log(`  Rounds: ${stvResult.rounds.length}`);
      console.log(
        `  Winners: ${stvResult.winners.map((w) => stvResult.candidates[w]).join(", ")}`,
      );

      // Compute pairwise preference tables
      console.log(`  Computing pairwise preferences...`);
      const pairwiseData = computePairwiseTables(
        expandedBallots,
        stvResult.candidates,
        stvResult.rounds,
      );

      // Build paths
      const date = "2024-11-05";
      const jurisdictionPath = "us/or/portland";
      const electionPath = "2024/11";
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
        `Portland ${config.officeName} 2024`,
        date,
        jurisdictionPath,
        electionPath,
        config.office,
        config.officeName,
        "Portland, OR",
        "November 2024",
        totalBallots,
        path,
        parseResult.seats,
        stvResult.quota,
        stvResult.rounds.length,
        JSON.stringify(stvResult.winners),
        "portland-cvr",
        "stv",
        JSON.stringify(pairwiseData.pairwisePreferences),
        JSON.stringify(pairwiseData.firstAlternate),
        pairwiseData.firstFinal
          ? JSON.stringify(pairwiseData.firstFinal)
          : null,
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
        const isWriteIn = /^write-?in/i.test(name);
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
          round.electedThisRound
            ? JSON.stringify(round.electedThisRound)
            : null,
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
    })
    .catch((err) => {
      console.error(`  Error loading ${config.officeName}:`, err);
      throw err;
    });
}

// Main
const db = new Database("data.sqlite3");

// Ensure tables exist
console.log("Initializing database...");
await import("./init-database.js");

// Clear existing Portland data
console.log("\nClearing existing Portland data...");
db.run("DELETE FROM reports WHERE jurisdictionPath = 'us/or/portland'");

// Load all elections
console.log("\nLoading Portland elections...");
for (const config of PORTLAND_ELECTIONS) {
  await loadElection(db, config);
}

console.log("\nDone! Data loaded into data.sqlite3");

// Verify
const count = db.query("SELECT COUNT(*) as count FROM reports").get() as {
  count: number;
};
console.log(`Total reports in database: ${count.count}`);

const portlandCount = db
  .query(
    "SELECT COUNT(*) as count FROM reports WHERE jurisdictionPath = 'us/or/portland'",
  )
  .get() as { count: number };
console.log(`Portland reports: ${portlandCount.count}`);
