/**
 * Parse Minneapolis ranked-choice cast vote records.
 *
 * The 2025 exports contain one row per ballot, three choice columns, and a
 * Count column. Minneapolis treats the literal "undervote" and "overvote"
 * values as empty rankings, so later named choices move up.
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { parse } from "csv-parse/sync";

export interface MinneapolisBallot {
	rankings: string[];
	count: number;
}

export interface MinneapolisParseResult {
	ballots: MinneapolisBallot[];
	candidates: string[];
	totalBallots: number;
	countableBallots: number;
}

const NON_CANDIDATE_MARKS = new Set(["", "undervote", "overvote"]);

export function parseMinneapolisCSV(filePath: string): MinneapolisParseResult {
	const compressed = readFileSync(filePath);
	const records = parse(gunzipSync(compressed), {
		bom: true,
		columns: true,
		skip_empty_lines: true,
		trim: true,
	}) as Record<string, string>[];

	if (records.length === 0) {
		return {
			ballots: [],
			candidates: [],
			totalBallots: 0,
			countableBallots: 0,
		};
	}

	const choiceColumns = Object.keys(records[0]).filter((column) =>
		/^\d+(?:st|nd|rd|th) Choice /.test(column),
	);
	if (choiceColumns.length === 0) {
		throw new Error(`No ranked-choice columns found in ${filePath}`);
	}

	const candidates = new Set<string>();
	const patterns = new Map<string, MinneapolisBallot>();
	let totalBallots = 0;
	let countableBallots = 0;

	for (const record of records) {
		const count = Number(record.Count);
		if (!Number.isSafeInteger(count) || count < 1) {
			throw new Error(`Invalid Count value "${record.Count}" in ${filePath}`);
		}
		totalBallots += count;

		const rankings = choiceColumns
			.map((column) => record[column]?.trim() ?? "")
			.filter((choice) => !NON_CANDIDATE_MARKS.has(choice.toLowerCase()))
			.map((choice) => (choice === "UWI" ? "Undeclared write-ins" : choice));

		// A repeated candidate does not create another usable preference.
		const uniqueRankings = rankings.filter(
			(candidate, index) => rankings.indexOf(candidate) === index,
		);
		for (const candidate of uniqueRankings) candidates.add(candidate);
		if (uniqueRankings.length === 0) continue;

		countableBallots += count;
		const key = JSON.stringify(uniqueRankings);
		const existing = patterns.get(key);
		if (existing) {
			existing.count += count;
		} else {
			patterns.set(key, { rankings: uniqueRankings, count });
		}
	}

	return {
		ballots: [...patterns.values()],
		candidates: [...candidates].sort(),
		totalBallots,
		countableBallots,
	};
}
