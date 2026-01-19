import Database from "better-sqlite3";
import { resolve } from "path";
import type {
  IReportIndex,
  IContestReport,
  IElectionIndexEntry,
  IContestIndexEntry,
  ICandidate,
  ICandidateVotes,
  ITabulatorRound,
  ITabulatorAllocation,
  Transfer,
  ICandidatePairTable,
  IRankingDistribution,
  Allocatee,
  TransferType,
  CandidateId,
} from "$lib/report_types";

const dbPath = resolve(process.cwd(), "data.sqlite3");

function getDatabase(): Database.Database {
  try {
    return new Database(dbPath, { readonly: true });
  } catch {
    // Return null-ish database that will return empty results
    throw new Error(`Database not found at ${dbPath}`);
  }
}

interface ReportRow {
  id: number;
  name: string;
  date: string;
  jurisdictionPath: string;
  electionPath: string;
  office: string;
  officeName: string;
  jurisdictionName: string;
  electionName: string;
  website: string | null;
  notes: string | null;
  ballotCount: number;
  path: string;
  hidden: number;
  dataFormat: string | null;
  tabulation: string | null;
  seats: number;
  quota: number | null;
  numRounds: number;
  winners: string | null;
  condorcet: number | null;
  interesting: number;
  winnerNotFirstRoundLeader: number;
  hasWriteInByName: number;
  smithSet: string | null;
  pairwisePreferences: string | null;
  firstAlternate: string | null;
  firstFinal: string | null;
  rankingDistribution: string | null;
}

interface CandidateRow {
  id: number;
  report_id: number;
  candidate_index: number;
  name: string;
  writeIn: number;
  candidate_type: string | null;
  firstRoundVotes: number;
  transferVotes: number;
  roundEliminated: number | null;
  roundElected: number | null;
  surplusTransferred: number;
  winner: number;
}

interface RoundRow {
  id: number;
  report_id: number;
  round_number: number;
  undervote: number;
  overvote: number;
  continuingBallots: number;
  electedThisRound: string | null;
  eliminatedThisRound: string | null;
}

interface AllocationRow {
  id: number;
  round_id: number;
  allocatee: string;
  votes: number;
}

interface TransferRow {
  id: number;
  round_id: number;
  from_candidate: number;
  to_allocatee: string;
  count: number;
  transfer_type: string | null;
}

function parseAllocatee(value: string): Allocatee {
  if (value === "X") return "X";
  return parseInt(value, 10);
}

export function getIndex(): IReportIndex {
  let db: Database.Database;
  try {
    db = getDatabase();
  } catch {
    // Return empty index if database doesn't exist
    return { elections: [] };
  }

  try {
    const sqlCmd = `
      SELECT
        r.*,
        COUNT(c.id) AS numCandidates
      FROM
        reports r
      LEFT JOIN
        candidates c ON r.id = c.report_id
      WHERE
        r.hidden != 1
      GROUP BY
        r.id
      ORDER BY
        r.date DESC, r.jurisdictionName ASC
    `;

    const rows = db.prepare(sqlCmd).all() as (ReportRow & {
      numCandidates: number;
    })[];

    // Group by election (path)
    const electionMap = new Map<string, IElectionIndexEntry>();

    for (const row of rows) {
      // Get all winners for STV
      const winnerRows = db
        .prepare(
          "SELECT name FROM candidates WHERE report_id = ? AND winner = 1 ORDER BY roundElected, candidate_index",
        )
        .all(row.id) as { name: string }[];

      const winnerNames = winnerRows.map((w) => w.name);

      const contest: IContestIndexEntry = {
        office: row.office,
        officeName: row.officeName,
        name: row.name,
        winner: winnerNames[0] || "No Winner",
        winners: winnerNames.length > 1 ? winnerNames : undefined,
        numCandidates: row.numCandidates,
        numRounds: row.numRounds,
        seats: row.seats > 1 ? row.seats : undefined,
        interesting: row.interesting === 1,
        hasWriteInByName: row.hasWriteInByName === 1,
        winnerNotFirstRoundLeader: row.winnerNotFirstRoundLeader === 1,
      };

      if (!electionMap.has(row.path)) {
        electionMap.set(row.path, {
          path: row.path,
          jurisdictionName: row.jurisdictionName,
          electionName: row.electionName,
          date: row.date,
          contests: [],
        });
      }

      electionMap.get(row.path)!.contests.push(contest);
    }

    // Sort contests within each election
    for (const election of electionMap.values()) {
      election.contests.sort((a, b) =>
        a.officeName.localeCompare(b.officeName),
      );
    }

    return { elections: Array.from(electionMap.values()) };
  } finally {
    db.close();
  }
}

export function getReport(path: string): IContestReport | null {
  let db: Database.Database;
  try {
    db = getDatabase();
  } catch {
    return null;
  }

  try {
    const pathParts = path.split("/");
    const office = pathParts[pathParts.length - 1];
    const electionPath = pathParts.slice(0, -1).join("/");

    const reportRow = db
      .prepare("SELECT * FROM reports WHERE path = ? AND office = ?")
      .get(electionPath, office) as ReportRow | undefined;

    if (!reportRow) {
      return null;
    }

    // Get candidates
    const candidateRows = db
      .prepare(
        "SELECT * FROM candidates WHERE report_id = ? ORDER BY candidate_index",
      )
      .all(reportRow.id) as CandidateRow[];

    const candidates: ICandidate[] = candidateRows.map((row) => ({
      name: row.name,
      writeIn: row.writeIn === 1,
      candidate_type: row.candidate_type || undefined,
    }));

    const totalVotes: ICandidateVotes[] = candidateRows.map((row) => ({
      candidate: row.candidate_index,
      firstRoundVotes: row.firstRoundVotes,
      transferVotes: row.transferVotes,
      roundEliminated: row.roundEliminated || undefined,
      roundElected: row.roundElected || undefined,
      surplusTransferred: row.surplusTransferred || undefined,
    }));

    // Get rounds
    const roundRows = db
      .prepare("SELECT * FROM rounds WHERE report_id = ? ORDER BY round_number")
      .all(reportRow.id) as RoundRow[];

    const rounds: ITabulatorRound[] = roundRows.map((roundRow) => {
      const allocationRows = db
        .prepare("SELECT * FROM allocations WHERE round_id = ?")
        .all(roundRow.id) as AllocationRow[];

      const transferRows = db
        .prepare("SELECT * FROM transfers WHERE round_id = ?")
        .all(roundRow.id) as TransferRow[];

      const allocations: ITabulatorAllocation[] = allocationRows.map((a) => ({
        allocatee: parseAllocatee(a.allocatee),
        votes: a.votes,
      }));

      const transfers: Transfer[] = transferRows.map((t) => ({
        from: t.from_candidate,
        to: parseAllocatee(t.to_allocatee),
        count: t.count,
        type: (t.transfer_type as TransferType) || undefined,
      }));

      // Parse JSON arrays for elected/eliminated this round
      const electedThisRound: CandidateId[] | undefined =
        roundRow.electedThisRound
          ? JSON.parse(roundRow.electedThisRound)
          : undefined;
      const eliminatedThisRound: CandidateId[] | undefined =
        roundRow.eliminatedThisRound
          ? JSON.parse(roundRow.eliminatedThisRound)
          : undefined;

      return {
        allocations,
        undervote: roundRow.undervote,
        overvote: roundRow.overvote,
        continuingBallots: roundRow.continuingBallots,
        transfers,
        electedThisRound,
        eliminatedThisRound,
      };
    });

    // Parse JSON fields
    const pairwisePreferences: ICandidatePairTable =
      reportRow.pairwisePreferences
        ? JSON.parse(reportRow.pairwisePreferences)
        : { rows: [], cols: [], entries: [] };
    const firstAlternate: ICandidatePairTable = reportRow.firstAlternate
      ? JSON.parse(reportRow.firstAlternate)
      : { rows: [], cols: [], entries: [] };
    const firstFinal: ICandidatePairTable = reportRow.firstFinal
      ? JSON.parse(reportRow.firstFinal)
      : { rows: [], cols: [], entries: [] };
    const rankingDistribution: IRankingDistribution | undefined =
      reportRow.rankingDistribution
        ? JSON.parse(reportRow.rankingDistribution)
        : undefined;

    // Parse winners array
    const winnersArray: CandidateId[] = reportRow.winners
      ? JSON.parse(reportRow.winners)
      : [];

    const report: IContestReport = {
      info: {
        name: reportRow.name,
        date: reportRow.date,
        dataFormat: reportRow.dataFormat || "unknown",
        tabulation: reportRow.tabulation || "unknown",
        jurisdictionPath: reportRow.jurisdictionPath,
        electionPath: reportRow.electionPath,
        office: reportRow.office,
        jurisdictionName: reportRow.jurisdictionName,
        officeName: reportRow.officeName,
        electionName: reportRow.electionName,
        website: reportRow.website || undefined,
      },
      ballotCount: reportRow.ballotCount,
      candidates,
      rounds,
      winner: winnersArray[0] ?? 0,
      winners: winnersArray,
      seats: reportRow.seats,
      quota: reportRow.quota ?? undefined,
      numCandidates: candidates.length,
      totalVotes,
      pairwisePreferences,
      firstAlternate,
      firstFinal,
      rankingDistribution,
    };

    return report;
  } finally {
    db.close();
  }
}
