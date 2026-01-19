import { Database } from "bun:sqlite";

// Path to your SQLite database file
const db = new Database("data.sqlite3");

// Create tables for STV election data
db.exec(`
  -- Reports table stores election contest metadata
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date TEXT NOT NULL,
    jurisdictionPath TEXT NOT NULL,
    electionPath TEXT NOT NULL,
    office TEXT NOT NULL,
    officeName TEXT NOT NULL,
    jurisdictionName TEXT NOT NULL,
    electionName TEXT NOT NULL,
    website TEXT,
    notes TEXT,
    ballotCount INTEGER NOT NULL DEFAULT 0,
    path TEXT NOT NULL,
    hidden INTEGER DEFAULT 0,
    dataFormat TEXT,
    tabulation TEXT,
    -- STV-specific fields
    seats INTEGER DEFAULT 1,          -- Number of seats (1 = IRV, >1 = STV)
    quota INTEGER,                    -- Droop quota threshold
    numRounds INTEGER DEFAULT 0,
    winners TEXT,                     -- JSON array of winner candidate_indexes
    condorcet INTEGER,                -- candidate_id of condorcet winner (IRV only)
    interesting INTEGER DEFAULT 0,
    winnerNotFirstRoundLeader INTEGER DEFAULT 0,
    hasWriteInByName INTEGER DEFAULT 0,
    -- JSON fields for complex data
    smithSet TEXT,                    -- JSON array of candidate ids
    pairwisePreferences TEXT,         -- JSON object
    firstAlternate TEXT,              -- JSON object
    firstFinal TEXT,                  -- JSON object
    rankingDistribution TEXT,         -- JSON object
    UNIQUE(path, office)
  );

  -- Candidates table
  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    candidate_index INTEGER NOT NULL,  -- index in the candidates array
    name TEXT NOT NULL,
    writeIn INTEGER DEFAULT 0,
    candidate_type TEXT,
    -- Vote totals
    firstRoundVotes INTEGER DEFAULT 0,
    transferVotes INTEGER DEFAULT 0,
    roundEliminated INTEGER,
    roundElected INTEGER,              -- NEW: Round when candidate reached quota (STV)
    surplusTransferred INTEGER DEFAULT 0,  -- NEW: Surplus votes transferred after election
    winner INTEGER DEFAULT 0,
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  );

  -- Rounds table for tabulation rounds
  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    undervote INTEGER DEFAULT 0,
    overvote INTEGER DEFAULT 0,
    continuingBallots INTEGER DEFAULT 0,
    electedThisRound TEXT,             -- NEW: JSON array of candidates elected this round
    eliminatedThisRound TEXT,          -- NEW: JSON array of candidates eliminated this round
    FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
  );

  -- Allocations within each round
  CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    allocatee TEXT NOT NULL,  -- candidate_index or 'X' for exhausted
    votes INTEGER NOT NULL,
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
  );

  -- Transfers between rounds
  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL,
    from_candidate INTEGER NOT NULL,  -- candidate_index
    to_allocatee TEXT NOT NULL,       -- candidate_index or 'X' for exhausted
    count INTEGER NOT NULL,
    transfer_type TEXT DEFAULT 'elimination',  -- 'elimination' or 'surplus'
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
  );

  -- Create indexes for common queries
  CREATE INDEX IF NOT EXISTS idx_reports_path ON reports(path);
  CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(date);
  CREATE INDEX IF NOT EXISTS idx_candidates_report ON candidates(report_id);
  CREATE INDEX IF NOT EXISTS idx_rounds_report ON rounds(report_id);
  CREATE INDEX IF NOT EXISTS idx_allocations_round ON allocations(round_id);
  CREATE INDEX IF NOT EXISTS idx_transfers_round ON transfers(round_id);
`);

console.log("Database initialized successfully at data.sqlite3");
console.log(
  "Tables created: reports, candidates, rounds, allocations, transfers",
);
console.log(
  "STV fields added: seats, quota, winners, roundElected, surplusTransferred, electedThisRound, eliminatedThisRound",
);
