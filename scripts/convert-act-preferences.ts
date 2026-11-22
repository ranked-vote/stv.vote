/**
 * Convert Elections ACT "ballot paper preference data" into compact ballot
 * profiles that load-act.ts reads.
 *
 * Elections ACT publishes one CSV per electorate (`<Electorate>Total.txt`)
 * with one row per preference: "batch","pindex","pref","pcode","ccode","rcand".
 * A ballot paper is identified by (batch, pindex); pcode/ccode identify the
 * candidate within the electorate (see candidates.txt / Candidates.txt).
 *
 * Each profile groups identical preference orders, so the output is a few MB
 * per election instead of ~50 MB of raw rows:
 *
 *   raw-data/au/act/<year>/<electorate>.json.gz
 *   { electorate, candidates: [{ name, party }], ballots: [[count, [i, ...]], ...] }
 *
 * A ballot's preferences are read in order and stop at the first missing
 * number or repeated candidate, matching how a Hare-Clark paper is counted.
 *
 * Usage: bun scripts/convert-act-preferences.ts <source-dir> <year>
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

function readCsv(path: string): string[][] {
	return readFileSync(path, "utf-8")
		.split(/\r?\n/)
		.filter((line) => line.trim() !== "")
		.slice(1)
		.map((line) => {
			const fields: string[] = [];
			const re = /"((?:[^"]|"")*)"|([^,]*)/g;
			let pos = 0;
			while (pos <= line.length) {
				re.lastIndex = pos;
				const m = re.exec(line);
				if (!m) break;
				fields.push(m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2]);
				pos = re.lastIndex + 1;
			}
			return fields;
		});
}

function findFile(dir: string, name: string): string {
	const match = readdirSync(dir).find(
		(f) => f.toLowerCase() === name.toLowerCase(),
	);
	if (!match) throw new Error(`${name} not found in ${dir}`);
	return join(dir, match);
}

/** "SMYTH, Brendan" -> "Brendan Smyth" */
export function actCandidateName(raw: string): string {
	const m = raw.match(/^([^,]+),\s*(.+)$/);
	const [last, first] = m ? [m[1], m[2]] : [raw, ""];
	const titleCase = last
		.toLowerCase()
		.replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
		.replace(/\bMc(\p{L})/gu, (_, ch) => `Mc${ch.toUpperCase()}`);
	return first ? `${first} ${titleCase}` : titleCase;
}

export function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export interface ActProfile {
	electorate: string;
	candidates: { name: string; party: string }[];
	ballots: [number, number[]][];
}

export function buildProfiles(sourceDir: string): ActProfile[] {
	const electorates = readCsv(findFile(sourceDir, "Electorates.txt"));
	const groups = readCsv(findFile(sourceDir, "Groups.txt"));
	const candidates = readCsv(findFile(sourceDir, "Candidates.txt"));

	return electorates.map(([ecode, electorate]) => {
		const partyOf = new Map(
			groups
				.filter((g) => g[0] === ecode)
				.map((g) => [g[1], g[2]] as const),
		);
		const cands = candidates.filter((c) => c[0] === ecode);
		const indexOf = new Map(cands.map((c, i) => [`${c[1]}:${c[2]}`, i]));
		const profileCandidates = cands.map((c) => ({
			name: actCandidateName(c[3]),
			party: partyOf.get(c[1]) ?? "Ungrouped",
		}));

		// Collect preferences per ballot paper.
		const papers = new Map<string, Map<number, number>>();
		const path = findFile(sourceDir, `${electorate.replace(/\s+/g, "")}Total.txt`);
		for (const [batch, pindex, pref, pcode, ccode] of readCsv(path)) {
			const candidate = indexOf.get(`${pcode}:${ccode}`);
			if (candidate === undefined) {
				throw new Error(`${electorate}: unknown candidate ${pcode}:${ccode}`);
			}
			const key = `${batch}:${pindex}`;
			let prefs = papers.get(key);
			if (!prefs) {
				prefs = new Map();
				papers.set(key, prefs);
			}
			const n = Number(pref);
			// Two candidates at the same number: keep neither (the paper stops there).
			prefs.set(n, prefs.has(n) ? -1 : candidate);
		}

		const counts = new Map<string, number>();
		for (const prefs of papers.values()) {
			const order: number[] = [];
			const seen = new Set<number>();
			for (let n = 1; prefs.has(n); n++) {
				const candidate = prefs.get(n) as number;
				if (candidate < 0 || seen.has(candidate)) break;
				seen.add(candidate);
				order.push(candidate);
			}
			if (order.length === 0) continue;
			const key = order.join(",");
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}

		const ballots: [number, number[]][] = [...counts.entries()]
			.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
			.map(([key, count]) => [count, key.split(",").map(Number)]);

		return { electorate, candidates: profileCandidates, ballots };
	});
}

if (import.meta.main) {
	const [sourceDir, year] = process.argv.slice(2);
	if (!sourceDir || !year) {
		console.error(
			"Usage: bun scripts/convert-act-preferences.ts <source-dir> <year>",
		);
		process.exit(1);
	}
	const outDir = join("raw-data/au/act", year);
	mkdirSync(outDir, { recursive: true });
	for (const profile of buildProfiles(sourceDir)) {
		const out = join(outDir, `${slugify(profile.electorate)}.json.gz`);
		const json = JSON.stringify(profile);
		writeFileSync(out, gzipSync(json, { level: 9 }));
		const papers = profile.ballots.reduce((s, [c]) => s + c, 0);
		console.log(
			`${out}: ${papers.toLocaleString()} ballots, ${profile.ballots.length.toLocaleString()} distinct orders, ${profile.candidates.length} candidates`,
		);
	}
}
