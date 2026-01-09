import type { ICandidateVotes, Allocatee, ICandidate } from "$lib/report_types";

export interface CandidateContext {
    getCandidate: (c: Allocatee) => ICandidate
}

export const EXHAUSTED: Allocatee = 'X';

