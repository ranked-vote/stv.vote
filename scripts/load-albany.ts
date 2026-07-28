/**
 * Load Albany, California proportional RCV contests from NIST CVRs.
 *
 * Usage: bun scripts/load-albany.ts
 */

import { Database } from "bun:sqlite";
import { computePairwiseTables } from "./compute-pairwise.js";
import { type NistContest, parseNistCvr } from "./parse-nist-cvr.js";
import {
	type Ballot,
	tabulateFractionalSTV,
} from "./tabulate-stv-fractional.js";

const DATA_DIRECTORY = "raw-data/us/albany-ca/2024";
const CONTEST_IDS = [85, 86];
const DATE = "2024-11-05";
const JURISDICTION_PATH = "us/ca/albany";
const ELECTION_PATH = "2024/11";
const REPORT_PATH = `${JURISDICTION_PATH}/${ELECTION_PATH}`;
const SOURCE_URL = "https://alamedacountyca.gov/rovresults/rcv/252";

function officeSlug(contestId: number): string {
	if (contestId === 85) return "city-council";
	if (contestId === 86) return "board-of-education";
	throw new Error(`Unknown Albany contest ${contestId}`);
}

function displayOfficeName(contest: NistContest): string {
	return contest.contestId === 85 ? "City Council" : "Board of Education";
}

function insertContest(db: Database, contest: NistContest): void {
	const expandedBallots = contest.ballots.flatMap((pattern) =>
		Array.from({ length: pattern.count }, () => ({
			rankings: pattern.rankings,
		})),
	);
	const tabulatorBallots: Ballot[] = expandedBallots.map((ballot) => ({
		rankings: ballot.rankings,
		weight: 1,
	}));
	const result = tabulateFractionalSTV(
		tabulatorBallots,
		contest.seats,
		contest.candidates,
		contest.continuingBallots,
	);
	const pairwise = computePairwiseTables(
		expandedBallots,
		result.candidates,
		result.rounds,
	);
	const office = officeSlug(contest.contestId);
	const officeName = displayOfficeName(contest);

	console.log(`\nLoading ${officeName}...`);
	console.log(
		`  ${contest.totalBallots.toLocaleString()} ballots; ${contest.continuingBallots.toLocaleString()} continuing`,
	);
	console.log(`  ${contest.seats} seats; quota ${result.quota}`);
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
			`Albany ${officeName} 2024`,
			DATE,
			JURISDICTION_PATH,
			ELECTION_PATH,
			office,
			officeName,
			"Albany, CA",
			"November 2024",
			SOURCE_URL,
			contest.totalBallots,
			REPORT_PATH,
			contest.seats,
			result.quota,
			result.rounds.length,
			JSON.stringify(result.winners),
			"nist-sp-1500-103",
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
		insertCandidate.run(
			reportId,
			index,
			result.candidates[index],
			contest.candidateTypes[index] === "WriteIn" ? 1 : 0,
			contest.candidateTypes[index],
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

const contests = parseNistCvr(DATA_DIRECTORY, CONTEST_IDS);
if (contests.length !== CONTEST_IDS.length) {
	throw new Error(
		`Expected ${CONTEST_IDS.length} Albany contests, found ${contests.length}`,
	);
}

db.transaction(() => {
	for (const contest of contests) insertContest(db, contest);
})();

console.log(`\nLoaded ${contests.length} Albany reports into data.sqlite3`);
db.close();
