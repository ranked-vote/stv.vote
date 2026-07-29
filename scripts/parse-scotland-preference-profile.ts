/**
 * Parse an official Scottish eCount preference profile.
 *
 * Format:
 * - Line 1: candidate count and seat count
 * - Ballot lines: count, ranked candidate numbers, and a zero terminator
 * - A line containing only zero
 * - Candidate name and affiliation pairs
 * - Ward name
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type {
	ScotlandBallot,
	ScotlandWardData,
} from "./parse-scotland-ballots.js";

function cleanProfileText(value: string): string {
	return value.replaceAll("\u{1001ab}", "tti").replaceAll("\u{10019f}", "ti");
}

function parseQuotedPair(line: string): [string, string] {
	const match = line.match(/^"([^"]*)" "([^"]*)"$/);
	if (!match) {
		throw new Error(`Invalid candidate line: ${line}`);
	}
	return [cleanProfileText(match[1]), cleanProfileText(match[2])];
}

export function parseScotlandPreferenceProfile(
	filepath: string,
	councilName: string,
	electorate: number,
): ScotlandWardData {
	const lines = readFileSync(filepath, "utf-8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);

	const header = lines[0].split(/\s+/).map(Number);
	const [candidateCount, seats] = header;
	if (
		header.length !== 2 ||
		!Number.isInteger(candidateCount) ||
		!Number.isInteger(seats)
	) {
		throw new Error(`Invalid preference profile header: ${lines[0]}`);
	}

	const separatorIndex = lines.indexOf("0", 1);
	if (separatorIndex < 0) {
		throw new Error("Preference profile has no ballot separator");
	}

	const candidateLines = lines.slice(
		separatorIndex + 1,
		separatorIndex + 1 + candidateCount,
	);
	if (candidateLines.length !== candidateCount) {
		throw new Error(
			`Expected ${candidateCount} candidates, found ${candidateLines.length}`,
		);
	}

	const candidateEntries = candidateLines.map(parseQuotedPair);
	const candidates = candidateEntries.map(([name]) => name);
	const parties = candidateEntries.map(([, party]) => party);

	const wardLine = lines[separatorIndex + 1 + candidateCount];
	const wardMatch = wardLine?.match(/^"([^"]*)"$/);
	if (!wardMatch) {
		throw new Error(`Invalid ward line: ${wardLine}`);
	}
	const wardName = cleanProfileText(wardMatch[1]).replace(
		/^Ward\s+0*(\d+)\s*-?\s*/i,
		"$1 ",
	);

	const ballots: ScotlandBallot[] = [];
	let totalBallots = 0;

	for (const line of lines.slice(1, separatorIndex)) {
		const values = line.split(/\s+/).map(Number);
		const count = values[0];
		const candidateIds = values.slice(1, -1);

		if (
			!Number.isInteger(count) ||
			count <= 0 ||
			values.at(-1) !== 0 ||
			candidateIds.some(
				(candidateId) =>
					!Number.isInteger(candidateId) ||
					candidateId < 1 ||
					candidateId > candidateCount,
			)
		) {
			throw new Error(`Invalid ballot line: ${line}`);
		}

		ballots.push({
			count,
			rankings: candidateIds.map((candidateId) => candidates[candidateId - 1]),
		});
		totalBallots += count;
	}

	const wardSlug = basename(filepath, ".txt")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

	return {
		wardName,
		seats,
		candidates,
		parties,
		ballots,
		totalBallots,
		electorate,
		councilName,
		wardSlug,
	};
}
