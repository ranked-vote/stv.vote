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
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./convert-act-preferences.js";
import {
	type BallotProfile,
	insertProfileReport,
	readProfile,
} from "./load-profile-report.js";

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

function loadElectorate(
	db: Database,
	election: ActElection,
	profile: BallotProfile,
) {
	const seats = election.seats?.[profile.electorate] ?? 5;
	const { result, names, totalBallots } = insertProfileReport(db, profile, {
		name: `ACT Legislative Assembly ${election.year} - ${profile.electorate}`,
		date: election.date,
		jurisdictionPath: JURISDICTION_PATH,
		jurisdictionName: JURISDICTION_NAME,
		electionPath: `${election.year}/10`,
		electionName: `${election.year} Legislative Assembly Election`,
		office: slugify(profile.electorate),
		officeName: profile.electorate,
		website: election.website,
		seats,
		dataFormat: "act-ballot-preferences",
		partyName,
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
				loadElectorate(db, election, readProfile(join(dir, file)));
			}
		})();
	}

	const count = db
		.query("SELECT COUNT(*) AS n FROM reports WHERE jurisdictionPath = ?")
		.get(JURISDICTION_PATH) as { n: number };
	console.log(`\nACT reports: ${count.n}`);
}
