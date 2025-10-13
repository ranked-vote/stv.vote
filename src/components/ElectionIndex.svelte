<script type="ts">
  import type { IElectionIndexEntry } from "../report_types";

  export let elections: IElectionIndexEntry[];

  $: filteredElections = (() => {
    const filtered = (elections || []).map(e => {
      const isNYC = e.jurisdictionName === "New York City";
      return {
        ...e,
        // Always filter out races with 1-2 candidates (not meaningful RCV races)
        // For NYC, also filter out 3-candidate races (write-in never affects outcome)
        contests: e.contests.filter(c => {
          const minCandidates = isNYC ? 3 : 2;
          return c.numCandidates > minCandidates;
        })
      };
    }).filter(e => e.contests.length > 0);
    return filtered;
  })();

  $: electionsByYear = (() => {
    let map = new Map<string, IElectionIndexEntry[]>();
    filteredElections.forEach((e) => {
      let year = e.date.substr(0, 4);
      if (!map.has(year)) {
        map.set(year, []);
      }
      map.get(year).push(e);
    });
    return map;
  })();

  $: sortedYears = [...electionsByYear].sort((a, b) => {
    // Sort years in descending order (newest first)
    return parseInt(b[0]) - parseInt(a[0]);
  });
</script>

{#each sortedYears as [year, yearElections]}
  <div class="yearSection">
    <h2>{year}</h2>
    <div class="electionSection">
      {#each yearElections as election}
        <div class="electionHeader">
          <h3>
            <strong>{election.jurisdictionName}</strong>
            {election.electionName}
          </h3>
        </div>
        {#each election.contests as contest}
          <div class="race" class:non-condorcet={contest.hasNonCondorcetWinner}>
            <a href="/report/{election.path}/{contest.office}">
              <div class="title">
                <strong>{contest.officeName}</strong>
                {contest.winner}
              </div>
              <div class="meta">
                <strong>{contest.numCandidates}</strong>
                candidates,
                <strong>{contest.numRounds}</strong>
                rounds
              </div>
            </a>
          </div>
        {/each}
      {/each}
    </div>
  </div>
{/each}
