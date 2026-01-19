export type CandidateId = number;
export type Allocatee = CandidateId | "X";

// index.json

export interface IReportIndex {
  elections: IElectionIndexEntry[];
}

export interface IElectionIndexEntry {
  path: string;
  jurisdictionName: string;
  electionName: string;
  date: string;
  contests: IContestIndexEntry[];
}

export interface IContestIndexEntry {
  office: string;
  officeName: string;
  name: string;
  winner: string; // Primary winner name (for display)
  winners?: string[]; // All winner names for STV
  numCandidates: number;
  numRounds: number;
  seats?: number; // Number of seats (1 = IRV, >1 = STV)
  interesting: boolean;
  hasWriteInByName: boolean;
  winnerNotFirstRoundLeader: boolean;
}

// report.json

export interface IContestReport {
  info: IElectionInfo;
  ballotCount: number;
  candidates: ICandidate[];
  rounds: ITabulatorRound[];
  winner: CandidateId; // Primary winner (first elected or IRV winner)
  winners: CandidateId[]; // All winners for STV
  seats: number; // Number of seats (1 = IRV, >1 = STV)
  quota?: number; // Droop quota for STV
  numCandidates: number;
  totalVotes: ICandidateVotes[];
  pairwisePreferences: ICandidatePairTable;
  firstAlternate: ICandidatePairTable;
  firstFinal: ICandidatePairTable;
  rankingDistribution?: IRankingDistribution;
}

export interface IRankingDistribution {
  overallDistribution: Record<string, number>;
  candidateDistributions: Record<string, Record<string, number>>;
  totalBallots: number;
  candidateTotals: Record<string, number>;
}

export interface ICandidatePairTable {
  rows: Allocatee[];
  cols: Allocatee[];
  entries: ICandidatePairEntry[][];
}

export interface ICandidatePairEntry {
  frac: number;
  numerator: number;
  denominator: number;
}

export interface ICandidateVotes {
  candidate: CandidateId;
  firstRoundVotes: number;
  transferVotes: number;
  roundEliminated?: number;
  roundElected?: number; // Round when candidate reached quota (STV)
  surplusTransferred?: number; // Surplus votes transferred after election (STV)
}

export interface IElectionInfo {
  name: string;
  date: string;
  dataFormat: string;
  tabulation: string;
  jurisdictionPath: string;
  electionPath: string;
  office: string;
  loaderParams?: { [param: string]: string };
  jurisdictionName: string;
  officeName: string;
  electionName: string;
  website?: string;
}

export interface ICandidate {
  name: string;
  writeIn?: boolean;
  candidate_type?: string;
}

export interface ITabulatorRound {
  allocations: ITabulatorAllocation[];
  undervote: number;
  overvote: number;
  continuingBallots: number;
  transfers: Transfer[];
  electedThisRound?: CandidateId[]; // Candidates elected this round (STV)
  eliminatedThisRound?: CandidateId[]; // Candidates eliminated this round
}

export interface ITabulatorAllocation {
  allocatee: Allocatee;
  votes: number;
}

export type TransferType = "elimination" | "surplus";

export interface Transfer {
  from: CandidateId;
  to: Allocatee;
  count: number;
  type?: TransferType; // 'elimination' (default) or 'surplus' (STV)
}
