import type { PageLoad } from "./$types";

export const load: PageLoad = async ({ fetch }) => {
  const result = await fetch("/api/reports.json");
  const index = await result.json();

  // Calculate aggregate stats
  const elections = index.elections || [];
  const totalElections = elections.length;
  const totalContests = elections.reduce(
    (sum: number, e: { contests?: unknown[] }) =>
      sum + (e.contests?.length || 0),
    0,
  );

  // Get unique jurisdictions
  const jurisdictions = new Set(
    elections.map((e: { jurisdictionName: string }) => e.jurisdictionName),
  );

  return {
    totalElections,
    totalContests,
    totalJurisdictions: jurisdictions.size,
  };
};
