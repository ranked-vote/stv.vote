/**
 * Fractional STV Tabulator
 *
 * Implements STV with fractional surplus transfers (weighted inclusive Gregory method):
 * - Threshold: Droop quota (floor(votes / (seats + 1)) + 1)
 * - When a candidate exceeds threshold, surplus is distributed proportionally
 * - Each ballot's weight is reduced by (surplus / votes) when transferred
 *
 * Used by: Portland OR (2024+)
 */

import type {
  ITabulatorRound,
  ITabulatorAllocation,
  Transfer,
  CandidateId,
  ICandidateVotes,
  TransferType,
} from "../src/lib/report_types.js";

export interface Ballot {
  rankings: string[];
  weight: number; // Current weight of this ballot (starts at 1.0)
}

export interface STVResult {
  rounds: ITabulatorRound[];
  winners: CandidateId[];
  quota: number;
  candidates: string[];
  candidateVotes: ICandidateVotes[];
}

interface BallotState {
  originalRankings: string[];
  currentIndex: number; // Index into rankings for current active choice
  weight: number; // Current weight (fractional)
}

interface CandidateState {
  index: CandidateId;
  name: string;
  votes: number; // Current vote total (can be fractional)
  status: "active" | "elected" | "eliminated";
  roundElected?: number;
  roundEliminated?: number;
  firstRoundVotes: number;
  transferVotes: number;
}

/**
 * Get the current active choice for a ballot, skipping eliminated candidates
 * Note: For Portland method, we skip eliminated but NOT elected candidates during surplus transfer
 */
function getCurrentChoice(
  ballot: BallotState,
  candidateStatus: Map<string, "active" | "elected" | "eliminated">,
  skipElected: boolean = true,
): string | null {
  while (ballot.currentIndex < ballot.originalRankings.length) {
    const choice = ballot.originalRankings[ballot.currentIndex];
    const status = candidateStatus.get(choice);

    if (status === "eliminated") {
      ballot.currentIndex++;
      continue;
    }

    if (status === "elected" && skipElected) {
      ballot.currentIndex++;
      continue;
    }

    if (status === "active" || (status === "elected" && !skipElected)) {
      return choice;
    }

    ballot.currentIndex++;
  }
  return null; // Exhausted
}

/**
 * Advance ballot to next choice
 */
function advanceToNextChoice(
  ballot: BallotState,
  candidateStatus: Map<string, "active" | "elected" | "eliminated">,
): string | null {
  ballot.currentIndex++;
  return getCurrentChoice(ballot, candidateStatus, true);
}

/**
 * Calculate Droop quota: floor(ballots / (seats + 1)) + 1
 */
export function calculateDroopQuota(
  totalBallots: number,
  seats: number,
): number {
  return Math.floor(totalBallots / (seats + 1)) + 1;
}

/**
 * Tabulate an STV election with fractional surplus transfers
 */
export function tabulateFractionalSTV(
  ballots: Ballot[],
  seats: number,
  candidateNames: string[],
  totalBallotsForQuota?: number, // Optional: total ballots including undervotes for quota calculation
): STVResult {
  // Use provided total or count of ballots with rankings
  const quotaBasis = totalBallotsForQuota ?? ballots.length;
  const quota = calculateDroopQuota(quotaBasis, seats);
  const rounds: ITabulatorRound[] = [];
  const winners: CandidateId[] = [];

  // Initialize candidate states
  const candidateMap = new Map<string, CandidateState>();
  const candidateStatus = new Map<
    string,
    "active" | "elected" | "eliminated"
  >();

  for (let i = 0; i < candidateNames.length; i++) {
    const name = candidateNames[i];
    candidateMap.set(name, {
      index: i,
      name,
      votes: 0,
      status: "active",
      firstRoundVotes: 0,
      transferVotes: 0,
    });
    candidateStatus.set(name, "active");
  }

  // Initialize ballot states - each ballot starts with weight 1.0
  const ballotStates: BallotState[] = ballots.map((b) => ({
    originalRankings: b.rankings,
    currentIndex: 0,
    weight: b.weight ?? 1.0,
  }));

  // Track which ballots are assigned to which candidate
  const candidateBallots = new Map<string, BallotState[]>();
  for (const name of candidateNames) {
    candidateBallots.set(name, []);
  }
  const exhaustedBallots: BallotState[] = [];
  let exhaustedVotes = 0;

  // Initial allocation (first preferences)
  for (const ballot of ballotStates) {
    const choice = getCurrentChoice(ballot, candidateStatus, false);
    if (choice) {
      candidateBallots.get(choice)!.push(ballot);
      const state = candidateMap.get(choice)!;
      state.votes += ballot.weight;
      state.firstRoundVotes += ballot.weight;
    } else {
      exhaustedBallots.push(ballot);
      exhaustedVotes += ballot.weight;
    }
  }

  let roundNumber = 1;
  const maxRounds = candidateNames.length * 3; // Safety limit

  while (winners.length < seats && roundNumber <= maxRounds) {
    // Count active candidates
    const activeCandidates = Array.from(candidateMap.values()).filter(
      (c) => c.status === "active",
    );

    if (activeCandidates.length === 0) break;

    // Record round allocations (before any transfers)
    const allocations: ITabulatorAllocation[] = [];
    for (const candidate of candidateMap.values()) {
      if (candidate.status === "active" || candidate.status === "elected") {
        allocations.push({
          allocatee: candidate.index,
          votes: candidate.votes, // Keep fractional
        });
      }
    }
    // Add exhausted
    allocations.push({
      allocatee: "X",
      votes: exhaustedVotes,
    });

    // Sort allocations by votes descending (for display)
    allocations.sort((a, b) => {
      if (a.allocatee === "X") return 1;
      if (b.allocatee === "X") return -1;
      return b.votes - a.votes;
    });

    const transfers: Transfer[] = [];
    const electedThisRound: CandidateId[] = [];
    const eliminatedThisRound: CandidateId[] = [];

    // Check for candidates at or above quota
    const overQuota = activeCandidates
      .filter((c) => c.votes >= quota)
      .sort((a, b) => b.votes - a.votes); // Highest first

    if (overQuota.length > 0) {
      // Elect the highest candidate and transfer surplus
      const elected = overQuota[0];

      elected.status = "elected";
      elected.roundElected = roundNumber;
      candidateStatus.set(elected.name, "elected");
      winners.push(elected.index);
      electedThisRound.push(elected.index);

      // Calculate surplus
      const surplus = elected.votes - quota;

      if (surplus > 0 && winners.length < seats) {
        // Transfer fraction = surplus / elected.votes
        const transferFraction = surplus / elected.votes;

        // Get all ballots currently assigned to elected candidate
        const ballotPile = candidateBallots.get(elected.name)!;
        const transferCounts = new Map<string | "X", number>();
        const ballotsToReassign: {
          ballot: BallotState;
          newChoice: string | null;
        }[] = [];

        // For each ballot, find next choice and calculate transfer
        for (const ballot of ballotPile) {
          // Reduce ballot weight by transfer fraction
          const transferWeight = ballot.weight * transferFraction;
          ballot.weight = ballot.weight - transferWeight;

          // Find next preference (skip elected candidates)
          const savedIndex = ballot.currentIndex;
          ballot.currentIndex++; // Move past current (elected) candidate
          const nextChoice = getCurrentChoice(ballot, candidateStatus, true);

          if (nextChoice) {
            ballotsToReassign.push({ ballot, newChoice: nextChoice });
            transferCounts.set(
              nextChoice,
              (transferCounts.get(nextChoice) || 0) + transferWeight,
            );

            // Update candidate vote totals
            const nextState = candidateMap.get(nextChoice)!;
            nextState.votes += transferWeight;
            nextState.transferVotes += transferWeight;
          } else {
            // Exhausted
            ballot.currentIndex = savedIndex; // Keep ballot with elected candidate
            transferCounts.set(
              "X",
              (transferCounts.get("X") || 0) + transferWeight,
            );
            exhaustedVotes += transferWeight;
          }
        }

        // Move ballots to new piles (keeping a copy with elected for potential future transfers)
        for (const { ballot, newChoice } of ballotsToReassign) {
          if (newChoice) {
            candidateBallots.get(newChoice)!.push(ballot);
          }
        }

        // Record transfers
        for (const [to, count] of transferCounts) {
          const toAllocatee = to === "X" ? "X" : candidateMap.get(to)!.index;
          transfers.push({
            from: elected.index,
            to: toAllocatee,
            count: count,
            type: "surplus" as TransferType,
          });
        }
      }

      // Set elected candidate to quota votes
      elected.votes = quota;
    } else {
      // No one at quota - eliminate lowest
      const lowestVotes = Math.min(...activeCandidates.map((c) => c.votes));
      const lowestCandidates = activeCandidates.filter(
        (c) => Math.abs(c.votes - lowestVotes) < 0.0001,
      );

      // Tie-breaker: use the one that appears first alphabetically (deterministic)
      lowestCandidates.sort((a, b) => a.name.localeCompare(b.name));
      const eliminated = lowestCandidates[0];

      eliminated.status = "eliminated";
      eliminated.roundEliminated = roundNumber;
      candidateStatus.set(eliminated.name, "eliminated");
      eliminatedThisRound.push(eliminated.index);

      // Transfer all ballots from eliminated candidate at their current weight
      const ballotPile = candidateBallots.get(eliminated.name)!;
      const transferCounts = new Map<string | "X", number>();

      for (const ballot of ballotPile) {
        const nextChoice = advanceToNextChoice(ballot, candidateStatus);
        if (nextChoice) {
          candidateBallots.get(nextChoice)!.push(ballot);
          const state = candidateMap.get(nextChoice)!;
          state.votes += ballot.weight;
          state.transferVotes += ballot.weight;
          transferCounts.set(
            nextChoice,
            (transferCounts.get(nextChoice) || 0) + ballot.weight,
          );
        } else {
          exhaustedBallots.push(ballot);
          exhaustedVotes += ballot.weight;
          transferCounts.set(
            "X",
            (transferCounts.get("X") || 0) + ballot.weight,
          );
        }
      }

      // Record transfers
      for (const [to, count] of transferCounts) {
        const toAllocatee = to === "X" ? "X" : candidateMap.get(to)!.index;
        transfers.push({
          from: eliminated.index,
          to: toAllocatee,
          count: count,
          type: "elimination" as TransferType,
        });
      }

      candidateBallots.set(eliminated.name, []);
      eliminated.votes = 0;
    }

    // Calculate continuing ballots
    const continuingVotes = Array.from(candidateMap.values())
      .filter((c) => c.status === "active" || c.status === "elected")
      .reduce((sum, c) => sum + c.votes, 0);

    // Create round record
    rounds.push({
      allocations,
      undervote: 0,
      overvote: 0,
      continuingBallots: Math.round(continuingVotes),
      transfers,
      electedThisRound:
        electedThisRound.length > 0 ? electedThisRound : undefined,
      eliminatedThisRound:
        eliminatedThisRound.length > 0 ? eliminatedThisRound : undefined,
    });

    roundNumber++;

    // Check if remaining active candidates can fill remaining seats
    const remaining = Array.from(candidateMap.values()).filter(
      (c) => c.status === "active",
    );
    if (remaining.length <= seats - winners.length && remaining.length > 0) {
      // Elect remaining candidates in order of current votes (highest first)
      remaining.sort((a, b) => b.votes - a.votes);
      for (const c of remaining) {
        if (winners.length >= seats) break;
        c.status = "elected";
        c.roundElected = roundNumber;
        candidateStatus.set(c.name, "elected");
        winners.push(c.index);
      }

      // Record final round
      const finalAllocations: ITabulatorAllocation[] = [];
      for (const candidate of candidateMap.values()) {
        if (candidate.status === "elected") {
          finalAllocations.push({
            allocatee: candidate.index,
            votes: candidate.votes,
          });
        }
      }
      finalAllocations.push({
        allocatee: "X",
        votes: exhaustedVotes,
      });
      finalAllocations.sort((a, b) => {
        if (a.allocatee === "X") return 1;
        if (b.allocatee === "X") return -1;
        return b.votes - a.votes;
      });

      rounds.push({
        allocations: finalAllocations,
        undervote: 0,
        overvote: 0,
        continuingBallots: Math.round(continuingVotes),
        transfers: [],
        electedThisRound: remaining.map((c) => c.index),
      });

      break;
    }
  }

  // Build candidate votes summary
  const candidateVotes: ICandidateVotes[] = Array.from(
    candidateMap.values(),
  ).map((c) => ({
    candidate: c.index,
    firstRoundVotes: c.firstRoundVotes,
    transferVotes: c.transferVotes,
    roundEliminated: c.roundEliminated,
    roundElected: c.roundElected,
  }));

  return {
    rounds,
    winners,
    quota,
    candidates: candidateNames,
    candidateVotes,
  };
}

// CLI for testing
if (import.meta.main) {
  console.log("Portland STV Tabulator loaded");
}
