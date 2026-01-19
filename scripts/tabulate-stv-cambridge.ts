/**
 * Cambridge STV Tabulator (Whole Vote Transfer)
 *
 * Implements STV with whole vote surplus transfers:
 * - Droop quota: floor(votes / (seats + 1)) + 1
 * - Whole vote surplus transfers (Gregory method)
 * - Deterministic ballot selection for surplus (for reproducibility)
 *
 * Used by: Cambridge MA, Scotland
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
  weight?: number; // For weighted transfers (future use)
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
  weight: number;
}

interface CandidateState {
  index: CandidateId;
  name: string;
  votes: number;
  status: "active" | "elected" | "eliminated";
  roundElected?: number;
  roundEliminated?: number;
  firstRoundVotes: number;
  transferVotes: number;
}

/**
 * Get the current active choice for a ballot, skipping eliminated/elected candidates
 */
function getCurrentChoice(
  ballot: BallotState,
  candidateStatus: Map<string, "active" | "elected" | "eliminated">,
): string | null {
  while (ballot.currentIndex < ballot.originalRankings.length) {
    const choice = ballot.originalRankings[ballot.currentIndex];
    const status = candidateStatus.get(choice);
    // Only count if candidate is still active (not elected or eliminated)
    if (status === "active") {
      return choice;
    }
    ballot.currentIndex++;
  }
  return null; // Exhausted
}

/**
 * Advance ballot to next choice, returning the new choice or null if exhausted
 */
function advanceToNextChoice(
  ballot: BallotState,
  candidateStatus: Map<string, "active" | "elected" | "eliminated">,
): string | null {
  ballot.currentIndex++;
  return getCurrentChoice(ballot, candidateStatus);
}

/**
 * Calculate Droop quota
 */
export function calculateDroopQuota(
  totalBallots: number,
  seats: number,
): number {
  return Math.floor(totalBallots / (seats + 1)) + 1;
}

/**
 * Tabulate an STV election
 */
export function tabulateSTV(
  ballots: Ballot[],
  seats: number,
  candidateNames: string[],
): STVResult {
  const quota = calculateDroopQuota(ballots.length, seats);
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

  // Initialize ballot states
  const ballotStates: BallotState[] = ballots.map((b) => ({
    originalRankings: b.rankings,
    currentIndex: 0,
    weight: b.weight ?? 1,
  }));

  // Track which ballots are assigned to which candidate
  const candidateBallots = new Map<string, BallotState[]>();
  for (const name of candidateNames) {
    candidateBallots.set(name, []);
  }
  const exhaustedBallots: BallotState[] = [];

  // Initial allocation (first preferences)
  for (const ballot of ballotStates) {
    const choice = getCurrentChoice(ballot, candidateStatus);
    if (choice) {
      candidateBallots.get(choice)!.push(ballot);
      const state = candidateMap.get(choice)!;
      state.votes += ballot.weight;
      state.firstRoundVotes += ballot.weight;
    } else {
      exhaustedBallots.push(ballot);
    }
  }

  let roundNumber = 1;
  const maxRounds = candidateNames.length * 2; // Safety limit

  while (winners.length < seats && roundNumber <= maxRounds) {
    // Count active candidates
    const activeCandidates = Array.from(candidateMap.values()).filter(
      (c) => c.status === "active",
    );

    if (activeCandidates.length === 0) break;

    // Record round allocations
    const allocations: ITabulatorAllocation[] = [];
    for (const candidate of candidateMap.values()) {
      if (candidate.status === "active" || candidate.status === "elected") {
        allocations.push({
          allocatee: candidate.index,
          votes: Math.round(candidate.votes),
        });
      }
    }
    // Add exhausted
    allocations.push({
      allocatee: "X",
      votes: exhaustedBallots.length,
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
      // Elect candidates and transfer surplus
      for (const elected of overQuota) {
        if (winners.length >= seats) break;

        elected.status = "elected";
        elected.roundElected = roundNumber;
        candidateStatus.set(elected.name, "elected");
        winners.push(elected.index);
        electedThisRound.push(elected.index);

        // Calculate surplus
        const surplus = Math.round(elected.votes - quota);

        if (surplus > 0 && winners.length < seats) {
          // Transfer surplus ballots
          const ballotPile = candidateBallots.get(elected.name)!;

          // For Cambridge method: take ballots from the top of the pile
          // (last received, i.e., transfer ballots)
          const transferBallots = ballotPile.slice(0, surplus);
          const keepBallots = ballotPile.slice(surplus);

          candidateBallots.set(elected.name, keepBallots);

          // Transfer each ballot to next choice
          const transferCounts = new Map<string | "X", number>();

          for (const ballot of transferBallots) {
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
              from: elected.index,
              to: toAllocatee,
              count: Math.round(count),
              type: "surplus" as TransferType,
            });
          }
        }

        // Set elected candidate to quota votes
        elected.votes = quota;
      }
    } else {
      // No one at quota - eliminate lowest
      const lowestVotes = Math.min(...activeCandidates.map((c) => c.votes));
      const lowestCandidates = activeCandidates.filter(
        (c) => c.votes === lowestVotes,
      );

      // Tie-breaker: use the one that appears first alphabetically (deterministic)
      lowestCandidates.sort((a, b) => a.name.localeCompare(b.name));
      const eliminated = lowestCandidates[0];

      eliminated.status = "eliminated";
      eliminated.roundEliminated = roundNumber;
      candidateStatus.set(eliminated.name, "eliminated");
      eliminatedThisRound.push(eliminated.index);

      // Transfer all ballots from eliminated candidate
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
          count: Math.round(count),
          type: "elimination" as TransferType,
        });
      }

      candidateBallots.set(eliminated.name, []);
      eliminated.votes = 0;
    }

    // Calculate continuing ballots
    const continuingBallots = ballots.length - exhaustedBallots.length;

    // Create round record
    rounds.push({
      allocations,
      undervote: 0, // Not tracked at ballot level
      overvote: 0, // Not tracked at ballot level
      continuingBallots,
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
    if (remaining.length <= seats - winners.length) {
      // Elect remaining candidates
      for (const c of remaining) {
        if (winners.length >= seats) break;
        c.status = "elected";
        c.roundElected = roundNumber;
        candidateStatus.set(c.name, "elected");
        winners.push(c.index);
      }
      break;
    }
  }

  // Build candidate votes summary
  const candidateVotes: ICandidateVotes[] = Array.from(
    candidateMap.values(),
  ).map((c) => ({
    candidate: c.index,
    firstRoundVotes: Math.round(c.firstRoundVotes),
    transferVotes: Math.round(c.transferVotes),
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
  // Simple test
  const testBallots: Ballot[] = [
    { rankings: ["A", "B", "C"] },
    { rankings: ["A", "C", "B"] },
    { rankings: ["B", "A", "C"] },
    { rankings: ["B", "C", "A"] },
    { rankings: ["C", "A", "B"] },
    { rankings: ["C", "B", "A"] },
    { rankings: ["A", "B"] },
    { rankings: ["A", "C"] },
    { rankings: ["B", "A"] },
    { rankings: ["B", "C"] },
  ];

  const result = tabulateSTV(testBallots, 2, ["A", "B", "C"]);

  console.log(`Quota: ${result.quota}`);
  console.log(
    `Winners: ${result.winners.map((w) => result.candidates[w]).join(", ")}`,
  );
  console.log(`\nRounds: ${result.rounds.length}`);

  for (let i = 0; i < result.rounds.length; i++) {
    const round = result.rounds[i];
    console.log(`\n--- Round ${i + 1} ---`);
    console.log("Allocations:");
    for (const alloc of round.allocations) {
      const name =
        alloc.allocatee === "X"
          ? "Exhausted"
          : result.candidates[alloc.allocatee];
      console.log(`  ${name}: ${alloc.votes}`);
    }
    if (round.electedThisRound?.length) {
      console.log(
        `Elected: ${round.electedThisRound.map((w) => result.candidates[w]).join(", ")}`,
      );
    }
    if (round.eliminatedThisRound?.length) {
      console.log(
        `Eliminated: ${round.eliminatedThisRound.map((w) => result.candidates[w]).join(", ")}`,
      );
    }
    if (round.transfers.length > 0) {
      console.log("Transfers:");
      for (const t of round.transfers) {
        const from = result.candidates[t.from];
        const to = t.to === "X" ? "Exhausted" : result.candidates[t.to];
        console.log(`  ${from} -> ${to}: ${t.count} (${t.type})`);
      }
    }
  }
}
