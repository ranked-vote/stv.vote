/**
 * Fractional STV tabulator using the weighted inclusive Gregory method.
 *
 * The count is expressed as immutable state transitions. Weighted ballot
 * fragments in candidate piles (plus the exhausted pile) are the sole source
 * of truth; vote totals are always derived from those piles.
 */

import type {
	CandidateId,
	ICandidateVotes,
	ITabulatorAllocation,
	ITabulatorRound,
	Transfer,
	TransferType,
} from "../src/lib/report_types.js";

export interface Ballot {
	rankings: string[];
	weight: number;
}

export interface STVResult {
	rounds: ITabulatorRound[];
	winners: CandidateId[];
	quota: number;
	candidates: string[];
	candidateVotes: ICandidateVotes[];
}

type CandidateStatus = "active" | "elected" | "eliminated";

interface BallotFragment {
	readonly rankings: readonly string[];
	readonly currentIndex: number;
	readonly weight: number;
}

interface CountState {
	readonly statuses: readonly CandidateStatus[];
	readonly piles: readonly (readonly BallotFragment[])[];
	readonly exhausted: readonly BallotFragment[];
	readonly winners: readonly CandidateId[];
	readonly transferVotes: readonly number[];
	readonly roundElected: readonly (number | undefined)[];
	readonly roundEliminated: readonly (number | undefined)[];
}

interface Transition {
	readonly state: CountState;
	readonly transfers: readonly Transfer[];
	readonly elected?: CandidateId;
	readonly eliminated?: CandidateId;
}

const EXHAUSTED = "X";
const EPSILON = 1e-9;

function sumWeights(fragments: readonly BallotFragment[]): number {
	return fragments.reduce((sum, fragment) => sum + fragment.weight, 0);
}

function totalWeight(state: CountState): number {
	return (
		state.piles.reduce((sum, pile) => sum + sumWeights(pile), 0) +
		sumWeights(state.exhausted)
	);
}

function nearlyEqual(left: number, right: number): boolean {
	return Math.abs(left - right) <= EPSILON * Math.max(1, left, right);
}

function assertConservesWeight(
	state: CountState,
	expectedWeight: number,
	context: string,
): void {
	const actualWeight = totalWeight(state);
	if (!nearlyEqual(actualWeight, expectedWeight)) {
		throw new Error(
			`${context} did not conserve ballot weight: expected ${expectedWeight}, got ${actualWeight}`,
		);
	}

	for (const [candidate, pile] of state.piles.entries()) {
		if (
			state.statuses[candidate] === "eliminated" &&
			!nearlyEqual(sumWeights(pile), 0)
		) {
			throw new Error(`${context} left weight with an eliminated candidate`);
		}
		for (const fragment of pile) {
			if (!Number.isFinite(fragment.weight) || fragment.weight < 0) {
				throw new Error(`${context} produced an invalid ballot weight`);
			}
		}
	}
}

function nextPreference(
	fragment: BallotFragment,
	startIndex: number,
	statuses: readonly CandidateStatus[],
	candidateIds: ReadonlyMap<string, CandidateId>,
): { candidate: CandidateId; index: number } | null {
	for (let index = startIndex; index < fragment.rankings.length; index++) {
		const candidate = candidateIds.get(fragment.rankings[index]);
		if (candidate !== undefined && statuses[candidate] === "active") {
			return { candidate, index };
		}
	}
	return null;
}

function appendFragment(
	piles: BallotFragment[][],
	exhausted: BallotFragment[],
	fragment: BallotFragment,
	destination: { candidate: CandidateId; index: number } | null,
): void {
	const routed = {
		...fragment,
		currentIndex: destination?.index ?? fragment.rankings.length,
	};
	if (destination) {
		piles[destination.candidate].push(routed);
	} else {
		exhausted.push(routed);
	}
}

function copyPiles(state: CountState): BallotFragment[][] {
	return state.piles.map((pile) => [...pile]);
}

function addTransfer(
	counts: Map<CandidateId | typeof EXHAUSTED, number>,
	destination: CandidateId | typeof EXHAUSTED,
	weight: number,
): void {
	counts.set(destination, (counts.get(destination) ?? 0) + weight);
}

function toTransfers(
	from: CandidateId,
	type: TransferType,
	counts: ReadonlyMap<CandidateId | typeof EXHAUSTED, number>,
): Transfer[] {
	return [...counts].map(([to, count]) => ({ from, to, count, type }));
}

function initializeState(
	ballots: readonly Ballot[],
	candidateCount: number,
	candidateIds: ReadonlyMap<string, CandidateId>,
): CountState {
	const statuses = Array<CandidateStatus>(candidateCount).fill("active");
	const piles = Array.from(
		{ length: candidateCount },
		(): BallotFragment[] => [],
	);
	const exhausted: BallotFragment[] = [];

	for (const ballot of ballots) {
		const fragment: BallotFragment = {
			rankings: [...ballot.rankings],
			currentIndex: 0,
			weight: ballot.weight ?? 1,
		};
		appendFragment(
			piles,
			exhausted,
			fragment,
			nextPreference(fragment, 0, statuses, candidateIds),
		);
	}

	return {
		statuses,
		piles,
		exhausted,
		winners: [],
		transferVotes: Array(candidateCount).fill(0),
		roundElected: Array(candidateCount).fill(undefined),
		roundEliminated: Array(candidateCount).fill(undefined),
	};
}

function electCandidate(
	state: CountState,
	candidate: CandidateId,
	quota: number,
	round: number,
	seats: number,
	candidateIds: ReadonlyMap<string, CandidateId>,
): Transition {
	const sourcePile = state.piles[candidate];
	const sourceTotal = sumWeights(sourcePile);
	const surplus = sourceTotal - quota;
	const statuses = [...state.statuses];
	statuses[candidate] = "elected";
	const winners = [...state.winners, candidate];
	const roundElected = [...state.roundElected];
	roundElected[candidate] = round;

	// Once the final seat is filled no transfer is performed. Retaining the
	// complete pile keeps the terminal state conservative.
	if (surplus <= EPSILON || winners.length >= seats) {
		return {
			state: { ...state, statuses, winners, roundElected },
			transfers: [],
			elected: candidate,
		};
	}

	const transferFraction = surplus / sourceTotal;
	const piles = copyPiles(state);
	piles[candidate] = [];
	const exhausted = [...state.exhausted];
	const transferVotes = [...state.transferVotes];
	const transferCounts = new Map<CandidateId | typeof EXHAUSTED, number>();

	for (const fragment of sourcePile) {
		const transferWeight = fragment.weight * transferFraction;
		const retainedWeight = fragment.weight - transferWeight;
		piles[candidate].push({ ...fragment, weight: retainedWeight });

		if (transferWeight <= 0) continue;
		const transferred = { ...fragment, weight: transferWeight };
		const destination = nextPreference(
			transferred,
			fragment.currentIndex + 1,
			statuses,
			candidateIds,
		);
		appendFragment(piles, exhausted, transferred, destination);
		const allocatee = destination?.candidate ?? EXHAUSTED;
		addTransfer(transferCounts, allocatee, transferWeight);
		if (destination) transferVotes[destination.candidate] += transferWeight;
	}

	const nextState: CountState = {
		...state,
		statuses,
		piles,
		exhausted,
		winners,
		transferVotes,
		roundElected,
	};
	const transferred = [...transferCounts.values()].reduce(
		(sum, weight) => sum + weight,
		0,
	);
	if (!nearlyEqual(transferred, surplus)) {
		throw new Error(
			`Surplus transfer from candidate ${candidate} was ${transferred}, expected ${surplus}`,
		);
	}
	return {
		state: nextState,
		transfers: toTransfers(candidate, "surplus", transferCounts),
		elected: candidate,
	};
}

function eliminateCandidate(
	state: CountState,
	candidate: CandidateId,
	round: number,
	candidateIds: ReadonlyMap<string, CandidateId>,
): Transition {
	const sourcePile = state.piles[candidate];
	const sourceTotal = sumWeights(sourcePile);
	const statuses = [...state.statuses];
	statuses[candidate] = "eliminated";
	const piles = copyPiles(state);
	piles[candidate] = [];
	const exhausted = [...state.exhausted];
	const transferVotes = [...state.transferVotes];
	const roundEliminated = [...state.roundEliminated];
	roundEliminated[candidate] = round;
	const transferCounts = new Map<CandidateId | typeof EXHAUSTED, number>();

	for (const fragment of sourcePile) {
		const destination = nextPreference(
			fragment,
			fragment.currentIndex + 1,
			statuses,
			candidateIds,
		);
		appendFragment(piles, exhausted, fragment, destination);
		const allocatee = destination?.candidate ?? EXHAUSTED;
		addTransfer(transferCounts, allocatee, fragment.weight);
		if (destination) transferVotes[destination.candidate] += fragment.weight;
	}

	const transferred = [...transferCounts.values()].reduce(
		(sum, weight) => sum + weight,
		0,
	);
	if (!nearlyEqual(transferred, sourceTotal)) {
		throw new Error(
			`Elimination transfer from candidate ${candidate} was ${transferred}, expected ${sourceTotal}`,
		);
	}

	return {
		state: {
			...state,
			statuses,
			piles,
			exhausted,
			transferVotes,
			roundEliminated,
		},
		transfers: toTransfers(candidate, "elimination", transferCounts),
		eliminated: candidate,
	};
}

function allocations(state: CountState): ITabulatorAllocation[] {
	const result = state.piles.flatMap((pile, candidate) =>
		state.statuses[candidate] === "eliminated"
			? []
			: [{ allocatee: candidate, votes: sumWeights(pile) }],
	);
	result.push({ allocatee: EXHAUSTED, votes: sumWeights(state.exhausted) });
	return result.sort((left, right) => {
		if (left.allocatee === EXHAUSTED) return 1;
		if (right.allocatee === EXHAUSTED) return -1;
		return right.votes - left.votes;
	});
}

function continuingWeight(state: CountState): number {
	return state.piles.reduce(
		(sum, pile, candidate) =>
			state.statuses[candidate] === "eliminated" ? sum : sum + sumWeights(pile),
		0,
	);
}

function validateInputs(
	ballots: readonly Ballot[],
	seats: number,
	candidateNames: readonly string[],
	quotaBasis: number,
): void {
	if (!Number.isInteger(seats) || seats < 1 || seats > candidateNames.length) {
		throw new Error(
			"Seats must be a positive integer no greater than candidates",
		);
	}
	if (!Number.isFinite(quotaBasis) || quotaBasis < 0) {
		throw new Error("Quota basis must be a non-negative finite number");
	}
	if (new Set(candidateNames).size !== candidateNames.length) {
		throw new Error("Candidate names must be unique");
	}
	for (const ballot of ballots) {
		if (!Number.isFinite(ballot.weight) || ballot.weight < 0) {
			throw new Error("Ballot weights must be non-negative finite numbers");
		}
	}
}

/** Calculate the Droop quota: floor(ballots / (seats + 1)) + 1. */
export function calculateDroopQuota(
	totalBallots: number,
	seats: number,
): number {
	if (!Number.isFinite(totalBallots) || totalBallots < 0) {
		throw new Error("Total ballots must be a non-negative finite number");
	}
	if (!Number.isInteger(seats) || seats < 1) {
		throw new Error("Seats must be a positive integer");
	}
	return Math.floor(totalBallots / (seats + 1)) + 1;
}

export function tabulateFractionalSTV(
	ballots: Ballot[],
	seats: number,
	candidateNames: string[],
	totalBallotsForQuota?: number,
): STVResult {
	const quotaBasis =
		totalBallotsForQuota ??
		ballots.reduce((sum, ballot) => sum + (ballot.weight ?? 1), 0);
	validateInputs(ballots, seats, candidateNames, quotaBasis);
	const quota = calculateDroopQuota(quotaBasis, seats);
	const candidateIds = new Map(
		candidateNames.map((name, candidate) => [name, candidate]),
	);
	let state = initializeState(ballots, candidateNames.length, candidateIds);
	const initialWeight = totalWeight(state);
	const firstRoundVotes = state.piles.map(sumWeights);
	const rounds: ITabulatorRound[] = [];

	assertConservesWeight(state, initialWeight, "Initial allocation");

	for (let round = 1; state.winners.length < seats; round++) {
		if (round > candidateNames.length * 2) {
			throw new Error("Tabulation exceeded its maximum possible round count");
		}

		const active = state.statuses.flatMap((status, candidate) =>
			status === "active" ? [candidate] : [],
		);
		if (active.length === 0) break;

		const before = allocations(state);
		const overQuota = active
			.filter((candidate) => sumWeights(state.piles[candidate]) >= quota)
			.sort(
				(left, right) =>
					sumWeights(state.piles[right]) - sumWeights(state.piles[left]) ||
					candidateNames[left].localeCompare(candidateNames[right]),
			);

		const transition =
			overQuota.length > 0
				? electCandidate(state, overQuota[0], quota, round, seats, candidateIds)
				: eliminateCandidate(
						state,
						[...active].sort(
							(left, right) =>
								sumWeights(state.piles[left]) -
									sumWeights(state.piles[right]) ||
								candidateNames[left].localeCompare(candidateNames[right]),
						)[0],
						round,
						candidateIds,
					);

		state = transition.state;
		assertConservesWeight(state, initialWeight, `Round ${round}`);
		rounds.push({
			allocations: before,
			undervote: 0,
			overvote: 0,
			continuingBallots: Math.round(continuingWeight(state)),
			transfers: [...transition.transfers],
			electedThisRound:
				transition.elected === undefined ? undefined : [transition.elected],
			eliminatedThisRound:
				transition.eliminated === undefined
					? undefined
					: [transition.eliminated],
		});

		const remaining = state.statuses.flatMap((status, candidate) =>
			status === "active" ? [candidate] : [],
		);
		const openSeats = seats - state.winners.length;
		if (remaining.length > 0 && remaining.length <= openSeats) {
			const elected = [...remaining].sort(
				(left, right) =>
					sumWeights(state.piles[right]) - sumWeights(state.piles[left]) ||
					candidateNames[left].localeCompare(candidateNames[right]),
			);
			const statuses = [...state.statuses];
			const roundElected = [...state.roundElected];
			for (const candidate of elected) {
				statuses[candidate] = "elected";
				roundElected[candidate] = round + 1;
			}
			state = {
				...state,
				statuses,
				roundElected,
				winners: [...state.winners, ...elected],
			};
			assertConservesWeight(state, initialWeight, `Final round ${round + 1}`);
			rounds.push({
				allocations: allocations(state),
				undervote: 0,
				overvote: 0,
				continuingBallots: Math.round(continuingWeight(state)),
				transfers: [],
				electedThisRound: elected,
			});
		}
	}

	return {
		rounds,
		winners: [...state.winners],
		quota,
		candidates: [...candidateNames],
		candidateVotes: candidateNames.map((_, candidate) => ({
			candidate,
			firstRoundVotes: firstRoundVotes[candidate],
			transferVotes: state.transferVotes[candidate],
			roundEliminated: state.roundEliminated[candidate],
			roundElected: state.roundElected[candidate],
		})),
	};
}

if (import.meta.main) {
	console.log("Fractional STV tabulator loaded");
}
