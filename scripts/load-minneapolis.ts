/**
 * Load the 2025 Minneapolis multi-winner RCV contests.
 *
 * Usage: bun scripts/load-minneapolis.ts
 */

import { Database } from "bun:sqlite";
import { computePairwiseTables } from "./compute-pairwise.js";
import { parseMinneapolisCSV } from "./parse-minneapolis-csv.js";
import {
	type Ballot,
	tabulateFractionalSTV,
} from "./tabulate-stv-fractional.js";

interface ElectionConfig {
	office: string;
	officeName: string;
	seats: number;
	csvFile: string;
	website: string;
}

const DATE = "2025-11-04";
const JURISDICTION_PATH = "us/mn/minneapolis";
const ELECTION_PATH = "2025/11";
const REPORT_PATH = `${JURISDICTION_PATH}/${ELECTION_PATH}`;

const ELECTIONS: ElectionConfig[] = [
	{
		office: "park-board-at-large",
		officeName: "Park & Recreation Commissioner At Large",
		seats: 3,
		csvFile: "raw-data/us/minneapolis-mn/2025/park-board-at-large.csv.gz",
		website:
			"https://vote.minneapolismn.gov/results-data/election-results/2025/park-board-at-large/",
	},
	{
		office: "board-of-estimate-and-taxation",
		officeName: "Board of Estimate and Taxation",
		seats: 2,
		csvFile:
			"raw-data/us/minneapolis-mn/2025/board-of-estimate-and-taxation.csv.gz",
		website:
			"https://vote.minneapolismn.gov/results-data/election-results/2025/bet/",
	},
];

function insertElection(db: Database, config: ElectionConfig): void {
	const parsed = parseMinneapolisCSV(config.csvFile);
	const tabulatorBallots: Ballot[] = parsed.ballots.map((ballot) => ({
		rankings: ballot.rankings,
		weight: ballot.count,
	}));
	const result = tabulateFractionalSTV(
		tabulatorBallots,
		config.seats,
		parsed.candidates,
		parsed.countableBallots,
	);
	const expandedBallots = parsed.ballots.flatMap((ballot) =>
		Array.from({ length: ballot.count }, () => ({
			rankings: ballot.rankings,
		})),
	);
	const pairwise = computePairwiseTables(
		expandedBallots,
		result.candidates,
		result.rounds,
	);

	console.log(`\nLoading ${config.officeName}...`);
	console.log(
		`  ${parsed.totalBallots.toLocaleString()} CVRs; ${parsed.countableBallots.toLocaleString()} countable`,
	);
	console.log(`  ${config.seats} seats; quota ${result.quota}`);
	console.log(
		`  Winners: ${result.winners.map((winner) => result.candidates[winner]).join(", ")}`,
	);

	const report = db
		.prepare(
			`
        INSERT INTO reports (
          name, date, jurisdictionPath, electionPath, office, officeName,
          jurisdictionName, electionName, website, ballotCount, path, seats,
          quota, numRounds, winners, dataFormat, tabulation,
          pairwisePreferences, firstAlternate, firstFinal, rankingDistribution
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
		)
		.run(
			`Minneapolis ${config.officeName} 2025`,
			DATE,
			JURISDICTION_PATH,
			ELECTION_PATH,
			config.office,
			config.officeName,
			"Minneapolis, MN",
			"November 2025",
			config.website,
			parsed.countableBallots,
			REPORT_PATH,
			config.seats,
			result.quota,
			result.rounds.length,
			JSON.stringify(result.winners),
			"minneapolis-cvr",
			"fractional-stv",
			JSON.stringify(pairwise.pairwisePreferences),
			JSON.stringify(pairwise.firstAlternate),
			pairwise.firstFinal ? JSON.stringify(pairwise.firstFinal) : null,
			JSON.stringify(pairwise.rankingDistribution),
		);
	const reportId = report.lastInsertRowid;

	const insertCandidate = db.prepare(`
    INSERT INTO candidates (
      report_id, candidate_index, name, writeIn, candidate_type,
      firstRoundVotes, transferVotes, roundEliminated, roundElected, winner
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
	for (let index = 0; index < result.candidates.length; index++) {
		const votes = result.candidateVotes.find(
			(candidate) => candidate.candidate === index,
		);
		const writeIn = result.candidates[index] === "Undeclared write-ins";
		insertCandidate.run(
			reportId,
			index,
			result.candidates[index],
			writeIn ? 1 : 0,
			writeIn ? "WriteIn" : "Regular",
			votes?.firstRoundVotes ?? 0,
			votes?.transferVotes ?? 0,
			votes?.roundEliminated ?? null,
			votes?.roundElected ?? null,
			result.winners.includes(index) ? 1 : 0,
		);
	}

	const insertRound = db.prepare(`
    INSERT INTO rounds (
      report_id, round_number, undervote, overvote, continuingBallots,
      electedThisRound, eliminatedThisRound
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
	const insertAllocation = db.prepare(`
    INSERT INTO allocations (round_id, allocatee, votes) VALUES (?, ?, ?)
  `);
	const insertTransfer = db.prepare(`
    INSERT INTO transfers (
      round_id, from_candidate, to_allocatee, count, transfer_type
    ) VALUES (?, ?, ?, ?, ?)
  `);

	for (let index = 0; index < result.rounds.length; index++) {
		const round = result.rounds[index];
		const insertedRound = insertRound.run(
			reportId,
			index + 1,
			round.undervote,
			round.overvote,
			round.continuingBallots,
			round.electedThisRound ? JSON.stringify(round.electedThisRound) : null,
			round.eliminatedThisRound
				? JSON.stringify(round.eliminatedThisRound)
				: null,
		);
		const roundId = insertedRound.lastInsertRowid;
		for (const allocation of round.allocations) {
			insertAllocation.run(
				roundId,
				String(allocation.allocatee),
				allocation.votes,
			);
		}
		for (const transfer of round.transfers) {
			insertTransfer.run(
				roundId,
				transfer.from,
				String(transfer.to),
				transfer.count,
				transfer.type ?? "elimination",
			);
		}
	}
}

await import("./init-database.js");
const db = new Database("data.sqlite3");
db.run("PRAGMA foreign_keys = ON");
db.run("DELETE FROM reports WHERE jurisdictionPath = ?", [JURISDICTION_PATH]);

db.transaction(() => {
	for (const election of ELECTIONS) insertElection(db, election);
})();

console.log(
	`\nLoaded ${ELECTIONS.length} Minneapolis reports into data.sqlite3`,
);
db.close();
