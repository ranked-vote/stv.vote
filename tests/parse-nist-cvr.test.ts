import { describe, expect, test } from "bun:test";
import { parseNistCvr } from "../scripts/parse-nist-cvr";
import { tabulateFractionalSTV } from "../scripts/tabulate-stv-fractional";

const DATA_DIRECTORY = "raw-data/us/albany-ca/2024";

describe("Albany NIST CVR parser", () => {
	const contests = parseNistCvr(DATA_DIRECTORY, [85, 86]);

	test("contains only the two Albany proportional RCV contests", () => {
		expect(contests.map((contest) => contest.contestId)).toEqual([85, 86]);
	});

	test("matches the official City Council first-round basis", () => {
		const council = contests.find((contest) => contest.contestId === 85);
		expect(council).toBeDefined();
		expect(council?.seats).toBe(3);
		expect(council?.totalBallots).toBe(9758);
		expect(council?.continuingBallots).toBe(8007);
		expect(
			council?.ballots.reduce(
				(sum, ballot) => sum + (ballot.rankings.length ? ballot.count : 0),
				0,
			),
		).toBe(8007);
	});

	test("matches the official Board of Education first-round basis", () => {
		const school = contests.find((contest) => contest.contestId === 86);
		expect(school).toBeDefined();
		expect(school?.seats).toBe(2);
		expect(school?.totalBallots).toBe(9758);
		expect(school?.continuingBallots).toBe(7146);
	});

	test("conserves ballot weight through every fractional transfer", () => {
		for (const contest of contests) {
			const ballots = contest.ballots
				.filter((pattern) => pattern.rankings.length > 0)
				.flatMap((pattern) =>
					Array.from({ length: pattern.count }, () => ({
						rankings: pattern.rankings,
						weight: 1,
					})),
				);
			const result = tabulateFractionalSTV(
				ballots,
				contest.seats,
				contest.candidates,
				contest.continuingBallots,
			);

			for (const round of result.rounds) {
				const allocated = round.allocations.reduce(
					(sum, allocation) => sum + allocation.votes,
					0,
				);
				expect(allocated).toBeCloseTo(contest.continuingBallots, 6);
			}
		}
	});
});
