import { describe, expect, test } from "bun:test";
import {
	type Ballot,
	calculateDroopQuota,
	tabulateFractionalSTV,
} from "../scripts/tabulate-stv-fractional";

const totalAllocated = (round: { allocations: { votes: number }[] }): number =>
	round.allocations.reduce((sum, allocation) => sum + allocation.votes, 0);

describe("fractional STV tabulator", () => {
	test("performs an exact weighted-inclusive surplus transfer", () => {
		const ballots: Ballot[] = [
			...Array.from({ length: 4 }, () => ({
				rankings: ["A", "B"],
				weight: 1,
			})),
			...Array.from({ length: 2 }, () => ({
				rankings: ["B", "A"],
				weight: 1,
			})),
			{ rankings: ["C", "B"], weight: 1 },
		];

		const result = tabulateFractionalSTV(ballots, 2, ["A", "B", "C"]);

		expect(result.quota).toBe(3);
		expect(result.winners).toEqual([0, 1]);
		expect(result.rounds[0].transfers).toEqual([
			{ from: 0, to: 1, count: 1, type: "surplus" },
		]);
		expect(result.rounds[1].allocations).toContainEqual({
			allocatee: 0,
			votes: 3,
		});
		expect(result.rounds[1].allocations).toContainEqual({
			allocatee: 1,
			votes: 3,
		});
	});

	test("keeps exhausted surplus separate while conserving all weight", () => {
		const ballots: Ballot[] = [
			...Array.from({ length: 4 }, () => ({
				rankings: ["A"],
				weight: 1,
			})),
			...Array.from({ length: 2 }, () => ({
				rankings: ["B"],
				weight: 1,
			})),
			{ rankings: ["C", "B"], weight: 1 },
		];

		const result = tabulateFractionalSTV(ballots, 2, ["A", "B", "C"]);

		expect(result.rounds[0].transfers).toEqual([
			{ from: 0, to: "X", count: 1, type: "surplus" },
		]);
		for (const round of result.rounds) {
			expect(totalAllocated(round)).toBeCloseTo(7, 10);
		}
	});

	test("uses total ballot weight—not array length—for the default quota", () => {
		const ballots = [
			{ rankings: ["A"], weight: 3 },
			{ rankings: ["B"], weight: 2 },
		];
		expect(tabulateFractionalSTV(ballots, 1, ["A", "B"]).quota).toBe(3);
	});

	test("breaks equal-vote ties deterministically by candidate name", () => {
		const result = tabulateFractionalSTV(
			[
				{ rankings: ["Zed"], weight: 1 },
				{ rankings: ["Amy"], weight: 1 },
				{ rankings: ["Mo"], weight: 2 },
			],
			1,
			["Zed", "Amy", "Mo"],
		);
		expect(result.rounds[0].eliminatedThisRound).toEqual([1]);
	});

	test("rejects invalid count definitions", () => {
		expect(() => tabulateFractionalSTV([], 0, ["A"])).toThrow();
		expect(() => tabulateFractionalSTV([], 2, ["A"])).toThrow();
		expect(() => tabulateFractionalSTV([], 1, ["A", "A"])).toThrow();
		expect(() =>
			tabulateFractionalSTV([{ rankings: ["A"], weight: Number.NaN }], 1, [
				"A",
			]),
		).toThrow();
		expect(() => calculateDroopQuota(-1, 1)).toThrow();
	});

	test("satisfies accounting laws across seeded generated elections", () => {
		let seed = 0x5eed1234;
		const random = (): number => {
			seed = (1664525 * seed + 1013904223) >>> 0;
			return seed / 2 ** 32;
		};

		for (let election = 0; election < 100; election++) {
			const candidateCount = 3 + Math.floor(random() * 5);
			const candidates = Array.from(
				{ length: candidateCount },
				(_, candidate) => `Candidate ${candidate}`,
			);
			const seats = 1 + Math.floor(random() * (candidateCount - 1));
			const ballots: Ballot[] = Array.from(
				{ length: 5 + Math.floor(random() * 45) },
				() => {
					const rankings = [...candidates];
					for (let index = rankings.length - 1; index > 0; index--) {
						const swap = Math.floor(random() * (index + 1));
						[rankings[index], rankings[swap]] = [
							rankings[swap],
							rankings[index],
						];
					}
					rankings.length = Math.floor(random() * (candidateCount + 1));
					return { rankings, weight: 0.25 + Math.floor(random() * 8) / 4 };
				},
			);
			const inputSnapshot = structuredClone(ballots);
			const expectedTotal = ballots.reduce(
				(sum, ballot) => sum + ballot.weight,
				0,
			);

			const first = tabulateFractionalSTV(ballots, seats, candidates);
			const second = tabulateFractionalSTV(ballots, seats, candidates);

			expect(first).toEqual(second);
			expect(ballots).toEqual(inputSnapshot);
			expect(new Set(first.winners).size).toBe(first.winners.length);
			expect(first.winners).toHaveLength(seats);

			for (const round of first.rounds) {
				expect(totalAllocated(round)).toBeCloseTo(expectedTotal, 8);
				const transferTotal = round.transfers.reduce(
					(sum, transfer) => sum + transfer.count,
					0,
				);
				const source = round.transfers[0]?.from;
				if (source === undefined) {
					expect(transferTotal).toBe(0);
					continue;
				}

				expect(
					round.transfers.every((transfer) => transfer.from === source),
				).toBe(true);
				const sourceVotes =
					round.allocations.find(
						(allocation) => allocation.allocatee === source,
					)?.votes ?? 0;
				if (round.electedThisRound) {
					expect(transferTotal).toBeCloseTo(sourceVotes - first.quota, 8);
				} else {
					expect(transferTotal).toBeCloseTo(sourceVotes, 8);
				}
			}
		}
	});
});
