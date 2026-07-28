/**
 * Parser for NIST SP 1500-103 JSON cast-vote records.
 *
 * Supports ordinary CvrExport*.json files and gzip-compressed
 * CvrExport*.json.gz files.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { normalizeName } from "./normalize-name.js";

interface Mark {
	CandidateId: number;
	Rank: number;
	IsAmbiguous: boolean;
	IsVote: boolean;
}

interface ContestMarks {
	Id: number;
	Marks: Mark[] | string;
}

interface BallotRecord {
	Contests?: ContestMarks[];
	Cards?: Array<{ Contests?: ContestMarks[] }>;
}

interface Session {
	Original: BallotRecord;
	Modified?: BallotRecord;
}

interface CandidateManifestEntry {
	Id: number;
	ContestId: number;
	Description: string;
	Type: "Regular" | "WriteIn" | "QualifiedWriteIn";
}

interface ContestManifestEntry {
	Id: number;
	Description: string;
	VoteFor: number;
}

export interface NistBallotPattern {
	rankings: string[];
	count: number;
}

export interface NistContest {
	contestId: number;
	office: string;
	seats: number;
	candidates: string[];
	candidateTypes: Array<CandidateManifestEntry["Type"]>;
	ballots: NistBallotPattern[];
	totalBallots: number;
	continuingBallots: number;
}

function getContests(session: Session): ContestMarks[] {
	if (session.Original.Contests) return session.Original.Contests;
	const ballot = session.Modified ?? session.Original;
	return ballot.Cards?.flatMap((card) => card.Contests ?? []) ?? [];
}

function readJson(path: string): unknown {
	const content = readFileSync(path);
	return JSON.parse(
		path.endsWith(".gz")
			? gunzipSync(content).toString("utf8")
			: content.toString("utf8"),
	);
}

function normalizeCandidateName(name: string): string {
	return normalizeName(name)
		.replace(/\s+/g, " ")
		.replace(/\(([a-z])/g, (_, letter: string) => `(${letter.toUpperCase()}`)
		.trim();
}

function rankingsForContest(
	contest: ContestMarks,
	candidateNames: Map<number, string>,
): string[] {
	if (typeof contest.Marks === "string") return [];

	const marksByRank = new Map<number, Mark[]>();
	for (const mark of contest.Marks) {
		if (mark.IsAmbiguous || !mark.IsVote) {
			continue;
		}
		const marks = marksByRank.get(mark.Rank) ?? [];
		marks.push(mark);
		marksByRank.set(mark.Rank, marks);
	}

	const rankings: string[] = [];
	const seen = new Set<string>();
	for (const rank of [...marksByRank.keys()].sort((a, b) => a - b)) {
		const marks = marksByRank.get(rank)!;
		// Albany invalidates this rank and all later rankings after an overvote.
		if (marks.length > 1) break;
		const candidate = candidateNames.get(marks[0].CandidateId);
		// Unqualified write-ins do not become candidates, but later valid ranks
		// can still count unless the rank was overvoted.
		if (!candidate) continue;
		if (!seen.has(candidate)) {
			rankings.push(candidate);
			seen.add(candidate);
		}
	}
	return rankings;
}

export function parseNistCvr(
	directory: string,
	requestedContestIds?: number[],
): NistContest[] {
	const candidateManifest = readJson(
		join(directory, "CandidateManifest.json"),
	) as { List: CandidateManifestEntry[] };
	const contestManifest = readJson(join(directory, "ContestManifest.json")) as {
		List: ContestManifestEntry[];
	};
	const requested = requestedContestIds
		? new Set(requestedContestIds)
		: new Set(contestManifest.List.map((contest) => contest.Id));

	const contests = new Map<
		number,
		{
			result: NistContest;
			candidateNames: Map<number, string>;
			ballotCounts: Map<string, number>;
		}
	>();

	for (const manifestContest of contestManifest.List) {
		if (!requested.has(manifestContest.Id)) continue;
		const manifestCandidates = candidateManifest.List.filter(
			(candidate) =>
				candidate.ContestId === manifestContest.Id &&
				candidate.Type !== "WriteIn",
		);
		const candidateNames = new Map(
			manifestCandidates.map((candidate) => [
				candidate.Id,
				normalizeCandidateName(candidate.Description),
			]),
		);
		contests.set(manifestContest.Id, {
			result: {
				contestId: manifestContest.Id,
				office: manifestContest.Description.replace(/\s+\(RCV\)$/, ""),
				seats: manifestContest.VoteFor,
				candidates: [...candidateNames.values()],
				candidateTypes: manifestCandidates.map((candidate) => candidate.Type),
				ballots: [],
				totalBallots: 0,
				continuingBallots: 0,
			},
			candidateNames,
			ballotCounts: new Map(),
		});
	}

	for (const filename of readdirSync(directory).sort()) {
		if (!/^CvrExport.*\.json(?:\.gz)?$/.test(filename)) continue;
		const cvr = readJson(join(directory, filename)) as { Sessions: Session[] };
		for (const session of cvr.Sessions) {
			for (const contestMarks of getContests(session)) {
				const contest = contests.get(contestMarks.Id);
				if (!contest) continue;
				const rankings = rankingsForContest(
					contestMarks,
					contest.candidateNames,
				);
				const key = JSON.stringify(rankings);
				contest.ballotCounts.set(key, (contest.ballotCounts.get(key) ?? 0) + 1);
				contest.result.totalBallots++;
				if (rankings.length > 0) contest.result.continuingBallots++;
			}
		}
	}

	return [...contests.values()].map(({ result, ballotCounts }) => ({
		...result,
		ballots: [...ballotCounts].map(([rankings, count]) => ({
			rankings: JSON.parse(rankings),
			count,
		})),
	}));
}
