/**
 * Compute pairwise preference tables from ballot data
 *
 * Calculates:
 * - Pairwise preferences: fraction of voters who preferred candidate A over B
 * - First alternate: fraction of voters whose first choice was A and second was B
 * - First final: where first-choice ballots ended up after STV tabulation
 * - Ranking distribution: how many candidates voters ranked
 */

import type {
  ICandidatePairTable,
  ICandidatePairEntry,
  IRankingDistribution,
  Allocatee,
  ITabulatorRound,
  CandidateId,
} from "../src/lib/report_types.js";

export interface Ballot {
  rankings: string[];
}

export interface PairwiseResult {
  pairwisePreferences: ICandidatePairTable;
  firstAlternate: ICandidatePairTable;
  rankingDistribution: IRankingDistribution;
}

/**
 * Compute pairwise preference table
 *
 * For each pair (A, B), the entry shows the fraction of voters who ranked A
 * above B, considering only ballots that ranked at least one of them.
 */
function computePairwisePreferences(
  ballots: Ballot[],
  candidateNames: string[],
): ICandidatePairTable {
  const n = candidateNames.length;
  const nameToIndex = new Map(candidateNames.map((name, i) => [name, i]));

  // Matrix: prefersAoverB[a][b] = count of ballots preferring A over B
  const prefersAoverB: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0),
  );
  // Matrix: denominator[a][b] = count of ballots that ranked at least one of A or B
  const denominators: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(0),
  );

  for (const ballot of ballots) {
    // Build a rank map for this ballot (lower rank = higher preference)
    const rankOf = new Map<number, number>();
    for (let rank = 0; rank < ballot.rankings.length; rank++) {
      const name = ballot.rankings[rank];
      const idx = nameToIndex.get(name);
      if (idx !== undefined && !rankOf.has(idx)) {
        rankOf.set(idx, rank);
      }
    }

    // Compare all pairs
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        if (a === b) continue;

        const rankA = rankOf.get(a);
        const rankB = rankOf.get(b);

        // Only count if at least one is ranked
        if (rankA === undefined && rankB === undefined) continue;

        denominators[a][b]++;

        // A is preferred if:
        // - A is ranked and B is not, OR
        // - Both are ranked and A's rank is lower (better)
        if (rankA !== undefined) {
          if (rankB === undefined || rankA < rankB) {
            prefersAoverB[a][b]++;
          }
        }
      }
    }
  }

  // Build the table
  const rows: Allocatee[] = candidateNames.map((_, i) => i);
  const cols: Allocatee[] = candidateNames.map((_, i) => i);
  const entries: ICandidatePairEntry[][] = [];

  for (let a = 0; a < n; a++) {
    const row: ICandidatePairEntry[] = [];
    for (let b = 0; b < n; b++) {
      if (a === b) {
        // Diagonal is null/empty
        row.push({ frac: 0, numerator: 0, denominator: 0 });
      } else {
        const num = prefersAoverB[a][b];
        const denom = denominators[a][b];
        row.push({
          frac: denom > 0 ? num / denom : 0,
          numerator: num,
          denominator: denom,
        });
      }
    }
    entries.push(row);
  }

  return { rows, cols, entries };
}

/**
 * Compute first alternate table
 *
 * For each pair (A, B), the entry shows the fraction of voters whose
 * first choice was A and second choice was B (including exhausted as "X").
 */
function computeFirstAlternate(
  ballots: Ballot[],
  candidateNames: string[],
): ICandidatePairTable {
  const n = candidateNames.length;
  const nameToIndex = new Map(candidateNames.map((name, i) => [name, i]));

  // Count first choice totals
  const firstChoiceCounts = Array(n).fill(0);
  // secondChoice[a][b] = count of ballots with first=A, second=B
  const secondChoice: number[][] = Array.from({ length: n }, () =>
    Array(n + 1).fill(0),
  ); // +1 for exhausted

  for (const ballot of ballots) {
    if (ballot.rankings.length === 0) continue;

    const first = nameToIndex.get(ballot.rankings[0]);
    if (first === undefined) continue;

    firstChoiceCounts[first]++;

    if (ballot.rankings.length > 1) {
      const second = nameToIndex.get(ballot.rankings[1]);
      if (second !== undefined) {
        secondChoice[first][second]++;
      } else {
        // Unknown second choice treated as exhausted
        secondChoice[first][n]++; // n = exhausted index
      }
    } else {
      // No second choice = exhausted
      secondChoice[first][n]++;
    }
  }

  // Build the table (rows = first choice, cols = second choice including X)
  const rows: Allocatee[] = candidateNames.map((_, i) => i);
  const cols: Allocatee[] = [...candidateNames.map((_, i) => i), "X" as const];
  const entries: ICandidatePairEntry[][] = [];

  for (let a = 0; a < n; a++) {
    const row: ICandidatePairEntry[] = [];
    const denom = firstChoiceCounts[a];

    for (let b = 0; b <= n; b++) {
      if (a === b && b < n) {
        // Can't have same first and second choice
        row.push({ frac: 0, numerator: 0, denominator: 0 });
      } else {
        const num = secondChoice[a][b];
        row.push({
          frac: denom > 0 ? num / denom : 0,
          numerator: num,
          denominator: denom,
        });
      }
    }
    entries.push(row);
  }

  return { rows, cols, entries };
}

/**
 * Compute first-final table based on STV rounds
 *
 * For each pair (A, B), shows where ballots that ranked A first ended up
 * in the final round (including exhausted as "X").
 */
export function computeFirstFinal(
  ballots: Ballot[],
  candidateNames: string[],
  rounds: ITabulatorRound[],
): ICandidatePairTable {
  const n = candidateNames.length;
  const nameToIndex = new Map(candidateNames.map((name, i) => [name, i]));

  // Track final allocation for each ballot
  const firstChoiceCounts = Array(n).fill(0);
  // finalAllocation[first][final] where final can be 0..n-1 or n (exhausted)
  const finalAllocation: number[][] = Array.from({ length: n }, () =>
    Array(n + 1).fill(0),
  );

  // Determine which candidates were eliminated/elected
  const eliminated = new Set<CandidateId>();
  const elected = new Set<CandidateId>();

  for (const round of rounds) {
    if (round.eliminatedThisRound) {
      for (const c of round.eliminatedThisRound) eliminated.add(c);
    }
    if (round.electedThisRound) {
      for (const c of round.electedThisRound) elected.add(c);
    }
  }

  // For each ballot, simulate where it ends up
  for (const ballot of ballots) {
    if (ballot.rankings.length === 0) continue;

    const firstIdx = nameToIndex.get(ballot.rankings[0]);
    if (firstIdx === undefined) continue;

    firstChoiceCounts[firstIdx]++;

    // Find the final active candidate on this ballot
    let finalIdx: number | null = null;
    for (const name of ballot.rankings) {
      const idx = nameToIndex.get(name);
      if (idx === undefined) continue;

      // A ballot is "with" a candidate if they weren't eliminated
      if (!eliminated.has(idx)) {
        finalIdx = idx;
        break;
      }
    }

    if (finalIdx !== null) {
      finalAllocation[firstIdx][finalIdx]++;
    } else {
      // Exhausted
      finalAllocation[firstIdx][n]++;
    }
  }

  // Build the table
  const rows: Allocatee[] = candidateNames.map((_, i) => i);
  const cols: Allocatee[] = [...candidateNames.map((_, i) => i), "X" as const];
  const entries: ICandidatePairEntry[][] = [];

  for (let a = 0; a < n; a++) {
    const row: ICandidatePairEntry[] = [];
    const denom = firstChoiceCounts[a];

    for (let b = 0; b <= n; b++) {
      const num = finalAllocation[a][b];
      row.push({
        frac: denom > 0 ? num / denom : 0,
        numerator: num,
        denominator: denom,
      });
    }
    entries.push(row);
  }

  return { rows, cols, entries };
}

/**
 * Compute ranking distribution
 *
 * Shows how many candidates voters ranked, both overall and by first choice.
 */
function computeRankingDistribution(
  ballots: Ballot[],
  candidateNames: string[],
): IRankingDistribution {
  const nameToIndex = new Map(candidateNames.map((name, i) => [name, i]));

  // Overall distribution: count of ballots with N rankings
  const overallDistribution: Record<string, number> = {};
  // Per-candidate: for ballots with candidate X as first choice
  const candidateDistributions: Record<string, Record<string, number>> = {};
  const candidateTotals: Record<string, number> = {};

  // Initialize
  for (const name of candidateNames) {
    candidateDistributions[name] = {};
    candidateTotals[name] = 0;
  }

  for (const ballot of ballots) {
    // Count unique valid rankings (some may have duplicates or invalid names)
    const uniqueValid = new Set<number>();
    for (const name of ballot.rankings) {
      const idx = nameToIndex.get(name);
      if (idx !== undefined) {
        uniqueValid.add(idx);
      }
    }

    const count = uniqueValid.size;
    if (count === 0) continue;

    const countStr = String(count);
    overallDistribution[countStr] = (overallDistribution[countStr] || 0) + 1;

    // Track by first choice
    const first = ballot.rankings[0];
    if (first && candidateDistributions[first]) {
      candidateDistributions[first][countStr] =
        (candidateDistributions[first][countStr] || 0) + 1;
      candidateTotals[first]++;
    }
  }

  return {
    overallDistribution,
    candidateDistributions,
    totalBallots: ballots.length,
    candidateTotals,
  };
}

/**
 * Compute all pairwise tables from ballot data
 */
export function computePairwiseTables(
  ballots: Ballot[],
  candidateNames: string[],
  rounds?: ITabulatorRound[],
): PairwiseResult & { firstFinal?: ICandidatePairTable } {
  const pairwisePreferences = computePairwisePreferences(
    ballots,
    candidateNames,
  );
  const firstAlternate = computeFirstAlternate(ballots, candidateNames);
  const rankingDistribution = computeRankingDistribution(
    ballots,
    candidateNames,
  );

  const result: PairwiseResult & { firstFinal?: ICandidatePairTable } = {
    pairwisePreferences,
    firstAlternate,
    rankingDistribution,
  };

  // Only compute firstFinal if we have round data
  if (rounds && rounds.length > 0) {
    result.firstFinal = computeFirstFinal(ballots, candidateNames, rounds);
  }

  return result;
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

  const candidates = ["A", "B", "C"];
  const result = computePairwiseTables(testBallots, candidates);

  console.log("Pairwise Preferences:");
  console.log("Rows:", result.pairwisePreferences.rows);
  console.log("Cols:", result.pairwisePreferences.cols);
  for (let i = 0; i < candidates.length; i++) {
    const row = result.pairwisePreferences.entries[i];
    console.log(
      `  ${candidates[i]}: ${row.map((e) => (e.frac * 100).toFixed(1) + "%").join(", ")}`,
    );
  }

  console.log("\nFirst Alternate:");
  for (let i = 0; i < candidates.length; i++) {
    const row = result.firstAlternate.entries[i];
    const labels = [...candidates, "X"];
    console.log(
      `  ${candidates[i]}: ${row.map((e, j) => `${labels[j]}:${(e.frac * 100).toFixed(0)}%`).join(", ")}`,
    );
  }

  console.log("\nRanking Distribution:");
  console.log(`  Total: ${result.rankingDistribution.totalBallots}`);
  console.log(`  Overall:`, result.rankingDistribution.overallDistribution);
  for (const [name, dist] of Object.entries(
    result.rankingDistribution.candidateDistributions,
  )) {
    console.log(`  ${name} supporters:`, dist);
  }
}
