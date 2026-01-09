/**
 * Load Scotland 2022 council election data into SQLite
 *
 * Data source: Scotland council elections 2022
 * Format: Pre-aggregated round-by-round vote totals
 *
 * Attribution: This dataset is made available under the CC-BY-SA 4.0 license.
 * Authored by @gerrymulvenna, containing candidate data provided by Democracy Club.
 * https://democracyclub.org.uk/
 *
 * Usage: bun scripts/load-scotland.ts
 */

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";

interface CandidateRow {
  id: string;
  name: string;
  party_name: string;
  council_id: string;
  council_name: string;
  election: string;
  cand_ward_id: string;
  map_ward_id: string;
  ward_name: string;
  contested: number;
  elected: number;
  status: string;
  occurred_on_count: number | null;
  first_prefs: number;
  // Round totals: transfers02..13, total_votes02..13
  roundTotals: (number | null)[]; // total_votes for rounds 2-13
  roundTransfers: (number | null)[]; // transfers for rounds 2-13
  electorate: number;
  total_poll: number;
  valid_poll: number;
  rejected: number;
  quota: number;
  seats: number;
  candidates: number;
}

interface WardContest {
  council_id: string;
  council_name: string;
  ward_id: string;
  ward_name: string;
  election: string;
  electorate: number;
  valid_poll: number;
  rejected: number;
  quota: number;
  seats: number;
  candidates: CandidateRow[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseScotlandCSV(filepath: string): WardContest[] {
  const content = readFileSync(filepath, "utf-8");
  const lines = content.trim().split("\n");

  // Skip header
  const rows = lines.slice(1);

  // Parse each row
  const candidateRows: CandidateRow[] = [];

  for (const line of rows) {
    // Handle quoted fields properly
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    if (fields.length < 45) continue;

    // Extract round totals (total_votes02 through total_votes13)
    const roundTotals: (number | null)[] = [];
    const roundTransfers: (number | null)[] = [];

    for (let i = 0; i < 12; i++) {
      // transfers02..13 are at indices 14, 16, 18, etc.
      // total_votes02..13 are at indices 15, 17, 19, etc.
      const transferIdx = 14 + i * 2;
      const totalIdx = 15 + i * 2;

      const transferVal = fields[transferIdx];
      const totalVal = fields[totalIdx];

      roundTransfers.push(
        transferVal && transferVal !== "" ? parseFloat(transferVal) : null
      );
      roundTotals.push(
        totalVal && totalVal !== "" ? parseFloat(totalVal) : null
      );
    }

    const row: CandidateRow = {
      id: fields[0],
      name: fields[1].replace(/^"|"$/g, ""),
      party_name: fields[2].replace(/^"|"$/g, ""),
      council_id: fields[3],
      council_name: fields[4].replace(/^"|"$/g, ""),
      election: fields[5],
      cand_ward_id: fields[6],
      map_ward_id: fields[7],
      ward_name: fields[8].replace(/^"|"$/g, ""),
      contested: parseInt(fields[9]) || 0,
      elected: parseInt(fields[10]) || 0,
      status: fields[11].replace(/^"|"$/g, ""),
      occurred_on_count:
        fields[12] && fields[12] !== "" ? parseInt(fields[12]) : null,
      first_prefs: parseFloat(fields[13]) || 0,
      roundTotals,
      roundTransfers,
      electorate: parseInt(fields[38]) || 0,
      total_poll: parseInt(fields[39]) || 0,
      valid_poll: parseInt(fields[40]) || 0,
      rejected: parseInt(fields[41]) || 0,
      quota: parseFloat(fields[42]) || 0,
      seats: parseInt(fields[43]) || 0,
      candidates: parseInt(fields[44]) || 0,
    };

    // Skip uncontested wards
    if (row.contested === 0) continue;

    candidateRows.push(row);
  }

  // Group by ward
  const wardMap = new Map<string, WardContest>();

  for (const row of candidateRows) {
    const key = `${row.council_id}|${row.map_ward_id}`;

    if (!wardMap.has(key)) {
      wardMap.set(key, {
        council_id: row.council_id,
        council_name: row.council_name,
        ward_id: row.map_ward_id,
        ward_name: row.ward_name,
        election: row.election,
        electorate: row.electorate,
        valid_poll: row.valid_poll,
        rejected: row.rejected,
        quota: row.quota,
        seats: row.seats,
        candidates: [],
      });
    }

    wardMap.get(key)!.candidates.push(row);
  }

  return Array.from(wardMap.values());
}

function determineNumRounds(ward: WardContest): number {
  // Find the maximum round where any candidate has data
  let maxRound = 1;

  for (const c of ward.candidates) {
    for (let i = 0; i < c.roundTotals.length; i++) {
      if (c.roundTotals[i] !== null) {
        maxRound = Math.max(maxRound, i + 2); // +2 because index 0 = round 2
      }
    }
  }

  return maxRound;
}

function loadWard(db: Database, ward: WardContest) {
  const numRounds = determineNumRounds(ward);

  // Build paths
  // Format: gb/scotland/<council-id>/<ward-slug>
  const wardSlug = slugify(ward.ward_name);
  const jurisdictionPath = `gb/scotland/${ward.council_id}`;
  const electionPath = "2022/05";
  const path = `${jurisdictionPath}/${electionPath}`;

  // Determine winners (sorted by election round, then by first_prefs for tiebreakers)
  const winners = ward.candidates
    .filter((c) => c.elected === 1)
    .sort((a, b) => {
      const roundA = a.occurred_on_count ?? 999;
      const roundB = b.occurred_on_count ?? 999;
      if (roundA !== roundB) return roundA - roundB;
      return b.first_prefs - a.first_prefs;
    });

  // Create candidate index mapping
  const candidateIndexMap = new Map<string, number>();
  ward.candidates.forEach((c, idx) => {
    candidateIndexMap.set(c.id, idx);
  });

  const winnerIndices = winners.map((w) => candidateIndexMap.get(w.id)!);

  // Insert report
  const insertReport = db.prepare(`
    INSERT INTO reports (
      name, date, jurisdictionPath, electionPath, office, officeName,
      jurisdictionName, electionName, ballotCount, path, seats, quota,
      numRounds, winners, dataFormat, tabulation
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const reportResult = insertReport.run(
    `${ward.council_name} - ${ward.ward_name}`,
    "2022-05-05",
    jurisdictionPath,
    electionPath,
    wardSlug,
    ward.ward_name,
    `${ward.council_name}, Scotland`,
    "May 2022",
    ward.valid_poll,
    path,
    ward.seats,
    Math.floor(ward.quota),
    numRounds,
    JSON.stringify(winnerIndices),
    "scotland-council-2022",
    "stv"
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
    const c = ward.candidates[i];
    const isWinner = c.elected === 1 ? 1 : 0;

    // Calculate transfer votes
    let finalVotes = c.first_prefs;
    for (let r = 0; r < c.roundTotals.length; r++) {
      if (c.roundTotals[r] !== null && c.roundTotals[r]! > 0) {
        finalVotes = c.roundTotals[r]!;
      }
    }
    const transferVotes = Math.round(finalVotes - c.first_prefs);

    // Determine round eliminated/elected
    let roundEliminated: number | null = null;
    let roundElected: number | null = null;

    if (c.status === "Excluded") {
      roundEliminated = c.occurred_on_count;
    } else if (c.status === "Elected") {
      roundElected = c.occurred_on_count;
    }

    insertCandidate.run(
      reportId,
      i,
      c.name,
      0, // writeIn
      Math.round(c.first_prefs),
      transferVotes,
      roundEliminated,
      roundElected,
      isWinner,
      c.party_name // Store party in candidate_type field
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

  for (let round = 1; round <= numRounds; round++) {
    // Determine who was elected/eliminated this round
    const electedThisRound = ward.candidates
      .filter((c) => c.status === "Elected" && c.occurred_on_count === round)
      .map((c) => candidateIndexMap.get(c.id)!);

    const eliminatedThisRound = ward.candidates
      .filter((c) => c.status === "Excluded" && c.occurred_on_count === round)
      .map((c) => candidateIndexMap.get(c.id)!);

    // Calculate continuing ballots (sum of active candidate votes)
    let continuingBallots = 0;
    const allocations: { candidateIdx: number; votes: number }[] = [];

    for (const c of ward.candidates) {
      const candidateIdx = candidateIndexMap.get(c.id)!;
      let votes: number;

      if (round === 1) {
        votes = c.first_prefs;
      } else {
        // Round N uses total_votes from roundTotals[N-2]
        const totalVotesIdx = round - 2;
        votes =
          c.roundTotals[totalVotesIdx] !== null
            ? c.roundTotals[totalVotesIdx]!
            : 0;
      }

      if (votes > 0) {
        allocations.push({ candidateIdx, votes: Math.round(votes * 100) / 100 });
        continuingBallots += votes;
      }
    }

    const roundResult = insertRound.run(
      reportId,
      round,
      0, // undervote - not available in this data
      0, // overvote - not available in this data
      Math.round(continuingBallots),
      electedThisRound.length > 0 ? JSON.stringify(electedThisRound) : null,
      eliminatedThisRound.length > 0 ? JSON.stringify(eliminatedThisRound) : null
    );

    const roundId = roundResult.lastInsertRowid;

    // Insert allocations
    for (const alloc of allocations) {
      insertAllocation.run(roundId, String(alloc.candidateIdx), alloc.votes);
    }

    // Calculate and insert transfers for rounds > 1
    if (round > 1) {
      const transferIdx = round - 2; // transfers02 is index 0, etc.

      // Find sources: candidates with negative transfers (surplus or elimination)
      const sources: { candidateIdx: number; amount: number; type: "surplus" | "elimination" }[] = [];
      // Find destinations: candidates with positive transfers
      const destinations: { candidateIdx: number; amount: number }[] = [];
      let exhausted = 0;

      for (const c of ward.candidates) {
        const candidateIdx = candidateIndexMap.get(c.id)!;
        const transfer = c.roundTransfers[transferIdx];

        if (transfer === null || transfer === 0) continue;

        if (transfer < 0) {
          // Source: lost votes
          const wasElectedPrevRound =
            c.status === "Elected" && c.occurred_on_count === round - 1;
          const wasEliminatedPrevRound =
            c.status === "Excluded" && c.occurred_on_count === round - 1;

          // Check if elected this round (surplus from reaching quota)
          const electedThisRoundByQuota =
            c.status === "Elected" && c.occurred_on_count === round;

          const type: "surplus" | "elimination" =
            wasElectedPrevRound || electedThisRoundByQuota
              ? "surplus"
              : wasEliminatedPrevRound
                ? "elimination"
                : "surplus"; // Default to surplus for quota adjustments

          sources.push({
            candidateIdx,
            amount: Math.abs(transfer),
            type,
          });
        } else {
          // Destination: gained votes
          destinations.push({
            candidateIdx,
            amount: transfer,
          });
        }
      }

      // Calculate exhausted votes (source total - destination total)
      const totalOut = sources.reduce((sum, s) => sum + s.amount, 0);
      const totalIn = destinations.reduce((sum, d) => sum + d.amount, 0);
      exhausted = totalOut - totalIn;

      // Create transfer records
      // When there's one source, transfers go directly from that candidate
      // When there are multiple sources, we distribute proportionally
      for (const source of sources) {
        const sourceRatio = totalOut > 0 ? source.amount / totalOut : 0;

        for (const dest of destinations) {
          const transferAmount = dest.amount * sourceRatio;
          if (transferAmount > 0.01) {
            insertTransfer.run(
              roundId,
              source.candidateIdx,
              String(dest.candidateIdx),
              Math.round(transferAmount * 100) / 100,
              source.type
            );
          }
        }

        // Add exhausted transfer if applicable
        if (exhausted > 0.01 && sourceRatio > 0) {
          const exhaustedAmount = exhausted * sourceRatio;
          if (exhaustedAmount > 0.01) {
            insertTransfer.run(
              roundId,
              source.candidateIdx,
              "X", // Exhausted
              Math.round(exhaustedAmount * 100) / 100,
              source.type
            );
          }
        }
      }
    }
  }
}

// Main
const db = new Database("data.sqlite3");

// Ensure tables exist
console.log("Initializing database...");
await import("./init-database.js");

// Parse the data
console.log("\nParsing Scotland 2022 council data...");
const wards = parseScotlandCSV("raw-data/scotland/2022/council.csv");
console.log(`Found ${wards.length} contested ward elections`);

// Count total candidates
const totalCandidates = wards.reduce((sum, w) => sum + w.candidates.length, 0);
console.log(`Total candidates: ${totalCandidates}`);

// Clear existing Scotland data
console.log("\nClearing existing Scotland data...");
db.run("DELETE FROM reports WHERE jurisdictionPath LIKE 'gb/scotland/%'");

// Load all wards
console.log("\nLoading ward elections...");
let loaded = 0;
for (const ward of wards) {
  try {
    loadWard(db, ward);
    loaded++;
    if (loaded % 50 === 0) {
      console.log(`  Loaded ${loaded}/${wards.length} wards...`);
    }
  } catch (e) {
    console.error(`Error loading ${ward.council_name} - ${ward.ward_name}:`, e);
  }
}

console.log(`\nDone! Loaded ${loaded} ward elections into data.sqlite3`);

// Verify
const count = db.query("SELECT COUNT(*) as count FROM reports").get() as {
  count: number;
};
console.log(`Total reports in database: ${count.count}`);

// Show some stats
const scotlandCount = db
  .query(
    "SELECT COUNT(*) as count FROM reports WHERE jurisdictionPath LIKE 'gb/scotland/%'"
  )
  .get() as { count: number };
console.log(`Scotland reports: ${scotlandCount.count}`);

const councils = db
  .query(`
    SELECT jurisdictionPath, COUNT(*) as count 
    FROM reports 
    WHERE jurisdictionPath LIKE 'gb/scotland/%'
    GROUP BY jurisdictionPath 
    ORDER BY count DESC
    LIMIT 10
  `)
  .all() as { jurisdictionPath: string; count: number }[];

console.log("\nTop 10 councils by ward count:");
for (const c of councils) {
  console.log(`  ${c.jurisdictionPath}: ${c.count} wards`);
}
