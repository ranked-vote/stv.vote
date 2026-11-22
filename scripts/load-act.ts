/**
 * Load ACT Legislative Assembly elections (Hare-Clark STV).
 *
 * Source: Elections ACT ballot paper preference data, converted to compact
 * profiles by scripts/convert-act-preferences.ts (see raw-data/au/act/SOURCE.md).
 *
 * The count uses the project's fractional (weighted inclusive Gregory)
 * tabulator. Elections ACT transfers surpluses from the last parcel received
 * instead, so vote totals in later counts can differ slightly from the
 * official distribution of preferences.
 *
 * Usage: bun scripts/load-act.ts
 */

import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { computePairwiseTables } from "./compute-pairwise.js";
import type { ActProfile } from "./convert-act-preferences.js";
import { slugify } from "./convert-act-preferences.js";
import { tabulateFractionalSTV } from "./tabulate-stv-fractional.js";

const DATA_DIR = "raw-data/au/act";
const JURISDICTION_PATH = "au/act";
const JURISDICTION_NAME = "Australian Capital Territory";

interface ActElection {
	year: string;
	date: string;
	website: string;
	/** Seats per electorate when not 5. */
	seats?: Record<string, number>;
}

const ELECTIONS: ActElection[] = [
	{
		year: "2008",
		date: "2008-10-18",
		website:
			"https://www.elections.act.gov.au/elections/previous-assembly-elections/2008-election",
		seats: { Molonglo: 7 },
	},
	{
		year: "2012",
		date: "2012-10-20",
		website:
			"https://www.elections.act.gov.au/elections/previous-assembly-elections/2012-election",
		seats: { Molonglo: 7 },
	},
	{
		year: "2016",
		date: "2016-10-15",
		website:
			"https://www.elections.act.gov.au/elections/previous-assembly-elections/2016-election",
	},
	{
		year: "2020",
		date: "2020-10-17",
		website:
			"https://www.elections.act.gov.au/elections/previous-assembly-elections/2020-election",
	},
	{
		year: "2024",
		date: "2024-10-19",
		website:
			"https://www.elections.act.gov.au/elections/previous-assembly-elections/2024-election",
	},
];

const SMALL_WORDS = new Set(["for", "of", "the", "and", "in"]);

/** "THE ACT GREENS" -> "The ACT Greens", "UNGROUPED" -> "Ungrouped" */
export function partyName(raw: string): string {
	return raw
		.toLowerCase()
		.split(/\s+/)
		.map((word, i) => {
			if (word === "act" || word === "dlp") return word.toUpperCase();
			if (i > 0 && SMALL_WORDS.has(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1);
		})
		.join(" ");
}

function loadProfile(path: string): ActProfile {
	return JSON.parse(gunzipSync(readFileSync(path)).toString("utf-8"));
}

function loadElectorate(
	db: Database,
	election: ActElection,
	profile: ActProfile,
) {
	const seats = election.seats?.[profile.electorate] ?? 5;
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

	const result = tabulateFractionalSTV(ballots, seats, names, totalBallots);
	const pairwise = computePairwiseTables(ballots, names, result.rounds);

	const electionPath = `${election.year}/10`;
	const office = slugify(profile.electorate);
	const path = `${JURISDICTION_PATH}/${electionPath}`;

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
			`ACT Legislative Assembly ${election.year} - ${profile.electorate}`,
			election.date,
			JURISDICTION_PATH,
			electionPath,
			office,
			profile.electorate,
			JURISDICTION_NAME,
			`${election.year} Legislative Assembly Election`,
			election.website,
			totalBallots,
			path,
			seats,
			result.quota,
			result.rounds.length,
			JSON.stringify(result.winners),
			"act-ballot-preferences",
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
			partyName(candidate.party),
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

	console.log(
		`  ${profile.electorate}: ${totalBallots.toLocaleString()} ballots, quota ${result.quota}, elected ${result.winners.map((w) => names[w]).join(", ")}`,
	);
}

if (import.meta.main) {
	const db = new Database("data.sqlite3");
	db.run("PRAGMA foreign_keys = ON");
	await import("./init-database.js");

	db.run("DELETE FROM reports WHERE jurisdictionPath = ?", [JURISDICTION_PATH]);

	for (const election of ELECTIONS) {
		console.log(`\nACT ${election.year}`);
		const dir = join(DATA_DIR, election.year);
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".json.gz"))
			.sort();
		db.transaction(() => {
			for (const file of files) {
				loadElectorate(db, election, loadProfile(join(dir, file)));
			}
		})();
	}

	const count = db
		.query("SELECT COUNT(*) AS n FROM reports WHERE jurisdictionPath = ?")
		.get(JURISDICTION_PATH) as { n: number };
	console.log(`\nACT reports: ${count.n}`);
}
