/**
 * Produce a compact, contest-scoped NIST CVR dataset.
 *
 * Usage:
 *   bun scripts/filter-nist-cvr.ts <source-directory> <output-directory> <contest-id>...
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Contest = { Id: number };
type Card = { Contests?: Contest[]; [key: string]: unknown };
type Ballot = {
	Contests?: Contest[];
	Cards?: Card[];
	[key: string]: unknown;
};
type Session = {
	Original: Ballot;
	Modified?: Ballot;
	[key: string]: unknown;
};

function usage(): never {
	throw new Error(
		"Usage: bun scripts/filter-nist-cvr.ts <source-directory> <output-directory> <contest-id>...",
	);
}

const sourceDirectory = process.argv[2];
const outputDirectory = process.argv[3];
const contestIds = new Set(process.argv.slice(4).map(Number));

if (
	!sourceDirectory ||
	!outputDirectory ||
	contestIds.size === 0 ||
	[...contestIds].some(Number.isNaN)
) {
	usage();
}

function filterBallot(ballot: Ballot | undefined): Ballot | undefined {
	if (!ballot) return undefined;

	const filtered: Ballot = { ...ballot };
	if (ballot.Contests) {
		filtered.Contests = ballot.Contests.filter((contest) =>
			contestIds.has(contest.Id),
		);
	}
	if (ballot.Cards) {
		filtered.Cards = ballot.Cards.map((card) => ({
			...card,
			Contests: (card.Contests ?? []).filter((contest) =>
				contestIds.has(contest.Id),
			),
		})).filter((card) => (card.Contests?.length ?? 0) > 0);
	}
	return filtered;
}

function ballotHasTargetContest(ballot: Ballot | undefined): boolean {
	if (!ballot) return false;
	if (ballot.Contests?.some((contest) => contestIds.has(contest.Id))) {
		return true;
	}
	return (
		ballot.Cards?.some((card) =>
			card.Contests?.some((contest) => contestIds.has(contest.Id)),
		) ?? false
	);
}

const candidates = JSON.parse(
	readFileSync(join(sourceDirectory, "CandidateManifest.json"), "utf8"),
);
candidates.List = candidates.List.filter((candidate: { ContestId: number }) =>
	contestIds.has(candidate.ContestId),
);

const contests = JSON.parse(
	readFileSync(join(sourceDirectory, "ContestManifest.json"), "utf8"),
);
contests.List = contests.List.filter((contest: { Id: number }) =>
	contestIds.has(contest.Id),
);

const sessions: Session[] = [];
let electionId = "";
let version = "";

for (const filename of readdirSync(sourceDirectory).sort()) {
	if (!/^CvrExport.*\.json$/.test(filename)) continue;

	const cvr = JSON.parse(readFileSync(join(sourceDirectory, filename), "utf8"));
	electionId ||= cvr.ElectionId;
	version ||= cvr.Version;

	for (const session of cvr.Sessions as Session[]) {
		const effectiveBallot = session.Modified ?? session.Original;
		if (
			!ballotHasTargetContest(session.Original) &&
			!ballotHasTargetContest(effectiveBallot)
		) {
			continue;
		}

		sessions.push({
			...session,
			Original: filterBallot(session.Original)!,
			...(session.Modified ? { Modified: filterBallot(session.Modified) } : {}),
		});
	}
}

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
	join(outputDirectory, "CandidateManifest.json"),
	`${JSON.stringify(candidates, null, 2)}\n`,
);
writeFileSync(
	join(outputDirectory, "ContestManifest.json"),
	`${JSON.stringify(contests, null, 2)}\n`,
);
writeFileSync(
	join(outputDirectory, "CvrExport.json.gz"),
	Bun.gzipSync(
		JSON.stringify({
			Version: version,
			ElectionId: electionId,
			Sessions: sessions,
		}),
		{ level: 9 },
	),
);

console.log(
	`Wrote ${sessions.length.toLocaleString()} contest-scoped sessions for contests ${[...contestIds].join(", ")}`,
);
