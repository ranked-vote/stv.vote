/**
 * Load Albany, California proportional RCV contests (2024, 2026) from NIST CVRs.
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

const JURISDICTION_PATH = "us/ca/albany";

type AlbanyElection = {
	year: number;
	dataDirectory: string;
	date: string;
	electionPath: string;
	electionName: string;
	sourceUrl: string;
	councilContestId: number;
	boardContestId: number;
};

const ELECTIONS: AlbanyElection[] = [
	{
		year: 2024,
		dataDirectory: "raw-data/us/albany-ca/2024",
		date: "2024-11-05",
		electionPath: "2024/11",
		electionName: "November 2024",
		sourceUrl: "https://alamedacountyca.gov/rovresults/rcv/252",
		councilContestId: 85,
		boardContestId: 86,
	},
	{
		year: 2026,
		dataDirectory: "raw-data/us/albany-ca/2026",
		date: "2026-11-03",
		electionPath: "2026/11",
		electionName: "November 2026",
		sourceUrl: "https://alamedacountyca.gov/rovresults/rcv/260",
		councilContestId: 102,
		boardContestId: 103,
	},
];

function officeSlug(election: AlbanyElection, contestId: number): string {
	if (contestId === election.councilContestId) return "city-council";
	if (contestId === election.boardContestId) return "board-of-education";
	throw new Error(`Unknown Albany ${election.year} contest ${contestId}`);
}

function displayOfficeName(
	election: AlbanyElection,
	contest: NistContest,
): string {
	return contest.contestId === election.councilContestId
		? "City Council"
		: "Board of Education";
}

function insertContest(
	db: Database,
	election: AlbanyElection,
	contest: NistContest,
): void {
	// Match the other STV loaders: ballots without a valid ranking never enter
	// the count, so they should not appear as initially exhausted in the Sankey.
	const countablePatterns = contest.ballots.filter(
		(pattern) => pattern.rankings.length > 0,
	);
	const expandedBallots = countablePatterns.flatMap((pattern) =>
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
	const office = officeSlug(election, contest.contestId);
	const officeName = displayOfficeName(election, contest);

	console.log(`\nLoading ${officeName} ${election.year}...`);
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
			`Albany ${officeName} ${election.year}`,
			election.date,
			JURISDICTION_PATH,
			election.electionPath,
			office,
			officeName,
			"Albany, CA",
			election.electionName,
			election.sourceUrl,
			contest.continuingBallots,
			`${JURISDICTION_PATH}/${election.electionPath}`,
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

const loaded = ELECTIONS.map((election) => {
	const contestIds = [election.councilContestId, election.boardContestId];
	const contests = parseNistCvr(election.dataDirectory, contestIds);
	if (contests.length !== contestIds.length) {
		throw new Error(
			`Expected ${contestIds.length} Albany ${election.year} contests, found ${contests.length}`,
		);
	}
	return { election, contests };
});

db.transaction(() => {
	for (const { election, contests } of loaded) {
		for (const contest of contests) insertContest(db, election, contest);
	}
})();

const reportCount = loaded.reduce((sum, { contests }) => sum + contests.length, 0);
console.log(`\nLoaded ${reportCount} Albany reports into data.sqlite3`);
db.close();
