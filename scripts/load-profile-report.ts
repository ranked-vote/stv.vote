/**
 * Count a grouped ballot profile with the fractional STV tabulator and store
 * the report. Shared by the ACT and AEC Senate loaders.
 */

import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { computePairwiseTables } from "./compute-pairwise.js";
import type { ActProfile } from "./convert-act-preferences.js";
import { tabulateFractionalSTV } from "./tabulate-stv-fractional.js";

export type BallotProfile = ActProfile;

export interface ProfileReport {
	name: string;
	date: string;
	jurisdictionPath: string;
	jurisdictionName: string;
	electionPath: string;
	electionName: string;
	office: string;
	officeName: string;
	website: string;
	seats: number;
	dataFormat: string;
	partyName: (raw: string) => string;
}

export function readProfile(path: string): BallotProfile {
	return JSON.parse(gunzipSync(readFileSync(path)).toString("utf-8"));
}

export function insertProfileReport(
	db: Database,
	profile: BallotProfile,
	meta: ProfileReport,
) {
	const names = profile.candidates.map((c) => c.name);
	if (new Set(names).size !== names.length) {
		throw new Error(`${profile.electorate}: duplicate candidate names`);
	}

	const ballots = profile.ballots.map(([count, order]) => ({
		rankings: order.map((i) => names[i]),
		weight: count,
		count,
	}));
	const totalBallots = profile.ballots.reduce((sum, [count]) => sum + count, 0);

	const result = tabulateFractionalSTV(ballots, meta.seats, names, totalBallots);
	const pairwise = computePairwiseTables(ballots, names, result.rounds);
	const path = `${meta.jurisdictionPath}/${meta.electionPath}`;

	const report = db
		.prepare(`
    INSERT INTO reports (
      name, date, jurisdictionPath, electionPath, office, officeName,
      jurisdictionName, electionName, website, ballotCount, path, seats, quota,
      numRounds, winners, dataFormat, tabulation,
      pairwisePreferences, firstAlternate, firstFinal, rankingDistribution
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
		.run(
			meta.name,
			meta.date,
			meta.jurisdictionPath,
			meta.electionPath,
			meta.office,
			meta.officeName,
			meta.jurisdictionName,
			meta.electionName,
			meta.website,
			totalBallots,
			path,
			meta.seats,
			result.quota,
			result.rounds.length,
			JSON.stringify(result.winners),
			meta.dataFormat,
			"stv",
			JSON.stringify(pairwise.pairwisePreferences),
			JSON.stringify(pairwise.firstAlternate),
			pairwise.firstFinal ? JSON.stringify(pairwise.firstFinal) : null,
			JSON.stringify(pairwise.rankingDistribution),
		);
	const reportId = report.lastInsertRowid;

	const insertCandidate = db.prepare(`
    INSERT INTO candidates (
      report_id, candidate_index, name, writeIn, firstRoundVotes,
      transferVotes, roundEliminated, roundElected, winner, candidate_type
    ) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
  `);
	profile.candidates.forEach((candidate, i) => {
		const votes = result.candidateVotes.find((v) => v.candidate === i);
		insertCandidate.run(
			reportId,
			i,
			candidate.name,
			votes?.firstRoundVotes ?? 0,
			votes?.transferVotes ?? 0,
			votes?.roundEliminated ?? null,
			votes?.roundElected ?? null,
			result.winners.includes(i) ? 1 : 0,
			meta.partyName(candidate.party),
		);
	});

	const insertRound = db.prepare(`
    INSERT INTO rounds (
      report_id, round_number, undervote, overvote, continuingBallots,
      electedThisRound, eliminatedThisRound
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
	const insertAllocation = db.prepare(
		"INSERT INTO allocations (round_id, allocatee, votes) VALUES (?, ?, ?)",
	);
	const insertTransfer = db.prepare(`
    INSERT INTO transfers (round_id, from_candidate, to_allocatee, count, transfer_type)
    VALUES (?, ?, ?, ?, ?)
  `);
	result.rounds.forEach((round, i) => {
		const roundId = insertRound.run(
			reportId,
			i + 1,
			round.undervote,
			round.overvote,
			round.continuingBallots,
			round.electedThisRound ? JSON.stringify(round.electedThisRound) : null,
			round.eliminatedThisRound
				? JSON.stringify(round.eliminatedThisRound)
				: null,
		).lastInsertRowid;
		for (const alloc of round.allocations) {
			insertAllocation.run(roundId, String(alloc.allocatee), alloc.votes);
		}
		for (const transfer of round.transfers) {
			insertTransfer.run(
				roundId,
				transfer.from,
				String(transfer.to),
				transfer.count,
				transfer.type || "elimination",
			);
		}
	});


	return { result, names, totalBallots };
}
