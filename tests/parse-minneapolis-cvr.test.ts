import { describe, expect, test } from "bun:test";
import { parseMinneapolisCSV } from "../scripts/parse-minneapolis-csv.js";

const DATA_DIR = "raw-data/us/minneapolis-mn/2025";

describe("Minneapolis CVR parser", () => {
	test("reproduces the official Park Board first-choice totals", () => {
		const result = parseMinneapolisCSV(
			`${DATA_DIR}/park-board-at-large.csv.gz`,
		);
		const totals = new Map<string, number>();
		for (const ballot of result.ballots) {
			const first = ballot.rankings[0];
			totals.set(first, (totals.get(first) ?? 0) + ballot.count);
		}

		expect(result.totalBallots).toBe(147_702);
		expect(result.countableBallots).toBe(113_348);
		expect(Object.fromEntries(totals)).toEqual({
			"Adam Schneider": 7_083,
			"Amber A. Frederick": 17_056,
			"Averi M. Turner": 6_118,
			"Mary McKelvey": 12_116,
			"Matthew Dowgwillo": 7_112,
			"Meg Forney": 25_368,
			"Michael Wilson": 15_291,
			"Tom Olsen": 22_796,
			"Undeclared write-ins": 408,
		});
	});

	test("reproduces the official Board of Estimate first-choice totals", () => {
		const result = parseMinneapolisCSV(
			`${DATA_DIR}/board-of-estimate-and-taxation.csv.gz`,
		);
		const totals = new Map<string, number>();
		for (const ballot of result.ballots) {
			const first = ballot.rankings[0];
			totals.set(first, (totals.get(first) ?? 0) + ballot.count);
		}

		expect(result.totalBallots).toBe(147_702);
		expect(result.countableBallots).toBe(106_682);
		expect(Object.fromEntries(totals)).toEqual({
			"Bob Fine": 27_445,
			"Eric Harris Bernstein": 42_829,
			"Steve Brandt": 35_911,
			"Undeclared write-ins": 497,
		});
	});
});
