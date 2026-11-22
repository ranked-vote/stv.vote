/**
 * Convert AEC Senate "formal preferences" CSVs into compact ballot profiles
 * that load-aec-senate.ts reads.
 *
 * The AEC publishes one zipped CSV per state/territory with a row per formal
 * ballot paper. After six identifying columns come one column per group
 * (above the line, "A:Liberal") and one per candidate (below the line,
 * "A:SMITH Jane"; "UG:" for ungrouped candidates). Cells hold the preference
 * number, or "*" / "/" for a tick or cross counted as a 1.
 *
 * Each paper is read the way the Commonwealth Electoral Act counts it: a
 * below-the-line vote numbering at least six candidates (1-6, each once) is
 * used; otherwise the above-the-line vote is used, each group standing for
 * its candidates in ballot order. Preferences stop at the first missing or
 * repeated number. Identical preference orders are grouped with a count:
 *
 *   raw-data/au/senate/<year>/<state>.json.gz
 *   { electorate, candidates: [{ name, party }], ballots: [[count, [i, ...]], ...] }
 *
 * Usage: bun scripts/convert-aec-senate.ts <zip>... --year 2025
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import type { ActProfile } from "./convert-act-preferences.js";

const STATE_NAMES: Record<string, string> = {
	NSW: "New South Wales",
	VIC: "Victoria",
	QLD: "Queensland",
	WA: "Western Australia",
	SA: "South Australia",
	TAS: "Tasmania",
	ACT: "Australian Capital Territory",
	NT: "Northern Territory",
};

/** Minimal CSV line splitter (quoted fields may contain commas). */
export function splitCsvLine(line: string): string[] {
	const out: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (quoted) {
			if (ch === '"' && line[i + 1] === '"') {
				field += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else field += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ",") {
			out.push(field);
			field = "";
		} else field += ch;
	}
	out.push(field);
	return out;
}

/** "McKIM Nick" -> "Nick McKim", "O'DONNELL Saxon" -> "Saxon O'Donnell" */
export function aecCandidateName(raw: string): string {
	const words = raw.trim().split(/\s+/);
	let split = 0;
	while (
		split < words.length &&
		words[split] === words[split].toUpperCase() &&
		/\p{Lu}/u.test(words[split])
	)
		split++;
	// Surnames like "McKIM" have a lowercase letter; take at least one word.
	if (split === 0) split = 1;
	const surname = words
		.slice(0, split)
		.join(" ")
		.toLowerCase()
		.replace(/(^|[\s'-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
		.replace(/\bMc(\p{L})/gu, (_, ch) => `Mc${ch.toUpperCase()}`);
	const given = words.slice(split).join(" ");
	return given ? `${given} ${surname}` : surname;
}

function preference(cell: string): number | null {
	const v = cell.trim();
	if (v === "") return null;
	if (v === "*" || v === "/") return 1;
	const n = Number(v);
	return Number.isInteger(n) && n > 0 ? n : null;
}

/** Read preferences 1, 2, 3... over `cells`; stop at a gap or a repeat. */
export function sequence(cells: string[]): number[] {
	const at = new Map<number, number>();
	const repeated = new Set<number>();
	cells.forEach((cell, i) => {
		const n = preference(cell);
		if (n === null) return;
		if (at.has(n)) repeated.add(n);
		else at.set(n, i);
	});
	const order: number[] = [];
	for (let n = 1; at.has(n) && !repeated.has(n); n++) {
		order.push(at.get(n) as number);
	}
	return order;
}

/** Yield the lines of a byte stream (handles CRLF). */
async function* readLines(stream: ReadableStream<Uint8Array>) {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of stream) {
		buffer += decoder.decode(chunk, { stream: true });
		let newline = buffer.indexOf("\n");
		while (newline >= 0) {
			const line = buffer.slice(0, newline).replace(/\r$/, "");
			buffer = buffer.slice(newline + 1);
			if (line !== "") yield line;
			newline = buffer.indexOf("\n");
		}
	}
	buffer += decoder.decode();
	if (buffer.trim() !== "") yield buffer.replace(/\r$/, "");
}

async function convert(zipPath: string): Promise<ActProfile> {
	const code = basename(zipPath).match(/-([A-Z]+)\.zip$/)?.[1];
	if (!code || !STATE_NAMES[code]) throw new Error(`Unknown state: ${zipPath}`);

	const unzip = Bun.spawn(["unzip", "-p", zipPath], { stdout: "pipe" });

	let header: string[] | null = null;
	let groupCols = 0;
	let candidates: { name: string; party: string }[] = [];
	let groupMembers: number[][] = [];
	const counts = new Map<string, number>();
	let papers = 0;
	let btlUsed = 0;

	for await (const line of readLines(unzip.stdout)) {
		if (!header) {
			header = splitCsvLine(line).slice(6);
			const groups = header.filter((h, i) => {
				// Group columns come first; candidate columns repeat a group letter.
				const letter = h.split(":")[0];
				return header?.findIndex((x) => x.split(":")[0] === letter) === i;
			});
			// The first column whose letter was already seen starts the candidates.
			groupCols = header.findIndex((h, i) =>
				header?.slice(0, i).some((x) => x.split(":")[0] === h.split(":")[0]),
			);
			if (groupCols < 0 || groupCols > groups.length) {
				throw new Error(`${code}: could not find group columns`);
			}
			const groupNames = new Map(
				header.slice(0, groupCols).map((h) => {
					const [letter, ...rest] = h.split(":");
					return [letter, rest.join(":").trim()];
				}),
			);
			candidates = header.slice(groupCols).map((h) => {
				const [letter, ...rest] = h.split(":");
				const party =
					letter === "UG"
						? "Ungrouped"
						: groupNames.get(letter) || `Group ${letter}`;
				return { name: aecCandidateName(rest.join(":")), party };
			});
			groupMembers = header.slice(0, groupCols).map((h) => {
				const letter = h.split(":")[0];
				return header
					?.slice(groupCols)
					.flatMap((c, i) => (c.split(":")[0] === letter ? [i] : []));
			}) as number[][];
			continue;
		}

		const cells = splitCsvLine(line).slice(6);
		papers++;
		let order = sequence(cells.slice(groupCols));
		if (order.length >= 6) {
			btlUsed++;
		} else {
			order = sequence(cells.slice(0, groupCols)).flatMap(
				(g) => groupMembers[g],
			);
		}
		if (order.length === 0) continue;
		const key = order.join(",");
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const counted = [...counts.values()].reduce((s, c) => s + c, 0);
	console.log(
		`${code}: ${papers.toLocaleString()} papers, ${counted.toLocaleString()} counted, ${btlUsed.toLocaleString()} below the line, ${counts.size.toLocaleString()} distinct orders, ${candidates.length} candidates`,
	);

	const ballots: [number, number[]][] = [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
		.map(([key, count]) => [count, key.split(",").map(Number)]);
	return { electorate: STATE_NAMES[code], candidates, ballots };
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const yearAt = args.indexOf("--year");
	const year = yearAt >= 0 ? args[yearAt + 1] : undefined;
	const zips = args.filter((a, i) => i !== yearAt && i !== yearAt + 1);
	if (!year || zips.length === 0) {
		console.error("Usage: bun scripts/convert-aec-senate.ts <zip>... --year 2025");
		process.exit(1);
	}
	const outDir = join("raw-data/au/senate", year);
	mkdirSync(outDir, { recursive: true });
	for (const zip of zips) {
		const profile = await convert(zip);
		const code = basename(zip).match(/-([A-Z]+)\.zip$/)?.[1]?.toLowerCase();
		writeFileSync(
			join(outDir, `${code}.json.gz`),
			gzipSync(JSON.stringify(profile), { level: 9 }),
		);
	}
}
