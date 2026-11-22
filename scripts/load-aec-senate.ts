/**
 * Load the 2025 Australian Senate election (half-Senate: six senators per
 * state, two per territory).
 *
 * Source: AEC Senate formal preferences, converted to grouped ballot profiles
 * by scripts/convert-aec-senate.ts (see raw-data/au/senate/SOURCE.md).
 *
 * The AEC counts with the weighted inclusive Gregory method too, but rounds
 * transfer values and excludes candidates in bulk, so vote totals in later
 * counts can differ slightly from the official distribution of preferences.
 *
 * Usage: bun scripts/load-aec-senate.ts
 */

import { Database } from "bun:sqlite";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { slugify } from "./convert-act-preferences.js";
import { insertProfileReport, readProfile } from "./load-profile-report.js";

const DATA_DIR = "raw-data/au/senate/2025";
const JURISDICTION_PATH = "au/senate";
const TERRITORIES = new Set(["Australian Capital Territory", "Northern Territory"]);

if (import.meta.main) {
	const db = new Database("data.sqlite3");
	db.run("PRAGMA foreign_keys = ON");
	await import("./init-database.js");

	db.run("DELETE FROM reports WHERE jurisdictionPath = ?", [JURISDICTION_PATH]);

	const only = process.argv[2]?.toLowerCase();
	const files = readdirSync(DATA_DIR)
		.filter((f) => f.endsWith(".json.gz"))
		.filter((f) => !only || f === `${only}.json.gz`)
		.sort();

	for (const file of files) {
		const started = performance.now();
		const profile = readProfile(join(DATA_DIR, file));
		const state = profile.electorate;
		const { result, names, totalBallots } = insertProfileReport(db, profile, {
			name: `Australian Senate 2025 - ${state}`,
			date: "2025-05-03",
			jurisdictionPath: JURISDICTION_PATH,
			jurisdictionName: "Australian Senate",
			electionPath: "2025/05",
			electionName: "2025 Federal Election",
			office: slugify(state),
			officeName: state,
			website: "https://results.aec.gov.au/31496/Website/SenateDownloadsMenu-31496-Csv.htm",
			seats: TERRITORIES.has(state) ? 2 : 6,
			dataFormat: "aec-senate-formal-preferences",
			partyName: (party) => party,
		});
		console.log(
			`${state}: ${totalBallots.toLocaleString()} ballots, quota ${result.quota}, ${result.rounds.length} rounds, ${((performance.now() - started) / 1000).toFixed(1)}s\n  elected ${result.winners.map((w) => names[w]).join(", ")}`,
		);
	}
}
