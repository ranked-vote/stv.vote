<script lang="ts">
  import type {
    IContestReport,
    Allocatee,
    ICandidate,
    ICandidatePairEntry,
    ICandidatePairTable,
  } from "$lib/report_types";
  import VoteCounts from "./report_components/VoteCounts.svelte";
  import Sankey from "./report_components/Sankey.svelte";
  import CandidatePairTable from "./report_components/CandidatePairTable.svelte";
  import RankingDistribution from "./report_components/RankingDistribution.svelte";
  import Math from "./Math.svelte";
  import { EXHAUSTED } from "./candidates";

  import { onMount, setContext } from "svelte";

  export let report: IContestReport;

  // Defensive check
  $: hasReport = report && report.info && report.candidates;
  $: hasCandidates = hasReport && report.numCandidates > 0;
  $: isSTV = (report.seats ?? 1) > 1;
  $: seats = report.seats ?? 1;
  $: quota = report.quota;
  // Check if pairwise data exists (has actual entries, not just empty arrays)
  $: hasPairwiseData = report.pairwisePreferences?.entries?.length > 0 &&
    report.pairwisePreferences.entries.some(row => row.some(e => e.denominator > 0));

  function getCandidate(cid: Allocatee): ICandidate {
    if (cid == "X") {
      return { name: "Exhausted", writeIn: false };
    } else if (cid == null || cid === undefined) {
      return { name: "Unknown", writeIn: false };
    } else {
      return report.candidates[cid] || { name: "Unknown", writeIn: false };
    }
  }

  function getCandidateNameById(cid: number): string {
    const c = report.candidates[cid];
    return c ? c.name : "";
  }

  setContext("candidates", {
    getCandidate,
  });

  function formatDate(dateStr: string): string {
    let date = new Date(dateStr);
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    return `${
      months[date.getUTCMonth()]
    } ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
  }

  function getVoteCount(allocatee: Allocatee): number {
    if (allocatee === "X") {
      return 0;
    }
    const votes = report.totalVotes.find((v) => v.candidate === allocatee);
    return votes ? votes.firstRoundVotes + votes.transferVotes : 0;
  }

  function sortPairwiseTable(table: ICandidatePairTable): ICandidatePairTable {
    const voteCountMap = new Map<Allocatee, number>();
    for (const allocatee of [...table.rows, ...table.cols]) {
      if (!voteCountMap.has(allocatee)) {
        voteCountMap.set(allocatee, getVoteCount(allocatee));
      }
    }

    const sortedRows = [...table.rows].sort(
      (a, b) => voteCountMap.get(b)! - voteCountMap.get(a)!
    );
    const sortedCols = [...table.cols].sort(
      (a, b) => voteCountMap.get(b)! - voteCountMap.get(a)!
    );

    const sortedEntries: ICandidatePairEntry[][] = sortedRows.map(
      (row) => {
        const originalRowIdx = table.rows.indexOf(row);
        return sortedCols.map((col) => {
          const originalColIdx = table.cols.indexOf(col);
          return table.entries[originalRowIdx][originalColIdx];
        });
      }
    );

    return {
      rows: sortedRows,
      cols: sortedCols,
      entries: sortedEntries,
    };
  }

  // Get winner names for display
  $: winnerNames = report.winners?.map(w => getCandidate(w).name) ?? [];

  $: sortedPairwisePreferences = hasCandidates
    ? sortPairwiseTable(report.pairwisePreferences)
    : report.pairwisePreferences;
  $: sortedFirstAlternate = hasCandidates
    ? sortPairwiseTable(report.firstAlternate)
    : report.firstAlternate;
  $: sortedFirstFinal = hasCandidates
    ? sortPairwiseTable(report.firstFinal)
    : report.firstFinal;
</script>

<style>
  @media (prefers-color-scheme: dark) {
    :global(body) {
      background-color: black;
    }
  }

  .winners-list {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .winners-list li {
    margin: 0.2em 0;
  }

  .quota-info {
    font-size: 0.9em;
    color: #666;
    margin-top: 0.5em;
  }

  @media (prefers-color-scheme: dark) {
    .quota-info {
      color: #aaa;
    }
  }
</style>

{#if hasReport}
<div class="row">
  <p class="description"></p>
  <div class="electionHeader">
    <h3>
      <a href="/">stv.vote</a>
      //
      <strong>{report.info.jurisdictionName}</strong>
      {report.info.officeName}
    </h3>
  </div>
</div>

<div class="row">
  <div class="leftCol">
    <p>
      The
      {#if report.info.website}
      <a href={report.info.website}>{report.info.jurisdictionName} {report.info.electionName}</a>
      {:else}
      {report.info.jurisdictionName} {report.info.electionName}
      {/if}
      was held on
      <strong>{formatDate(report.info.date)}</strong>.
      {#if hasCandidates}
        {#if isSTV}
          <!-- STV multi-winner description -->
          <strong>{seats}</strong> seats were filled using Single Transferable Vote from
          <strong>{report.numCandidates}</strong> candidates
          {#if report.rounds && report.rounds.length > 1}
            over <strong>{report.rounds.length}</strong> rounds.
          {:else}
            in a single round.
          {/if}
        {:else}
          <!-- IRV single-winner description -->
          {#if report.winner != null}
          <strong>{getCandidate(report.winner).name}</strong>
          was the winner out of
          {:else}
          The winner could not be determined out of
          {/if}
          <strong>{report.numCandidates}</strong>&nbsp;{#if report.numCandidates == 1}candidate {:else}candidates{/if}{#if report.rounds && report.rounds.length > 1}{" "}after
            {" "}<strong>{report.rounds.length - 1}</strong>&nbsp;elimination {#if report.rounds.length == 2}round{:else}rounds{/if}.
          {:else}. No elimination rounds were necessary to determine the outcome.
          {/if}
        {/if}
      {:else}
        No candidate data available for this election.
      {/if}
    </p>

    {#if isSTV && winnerNames.length > 0}
      <p><strong>Elected candidates:</strong></p>
      <ol class="winners-list">
        {#each winnerNames as name}
          <li>{name}</li>
        {/each}
      </ol>
      {#if quota}
        <p class="quota-info">
          Droop quota: <strong>{quota.toLocaleString()}</strong> votes
          <Math formula={`\\left\\lfloor \\frac{${report.ballotCount.toLocaleString()}}{${seats} + 1} \\right\\rfloor + 1`} />
        </p>
      {/if}
    {/if}

    {#if hasCandidates && !isSTV}
      {#if report.condorcet != null && report.winner != null}
        <p>
          {#if report.winner == report.condorcet}
            <strong>{getCandidate(report.winner).name}</strong> was also the <a href="https://en.wikipedia.org/wiki/Condorcet_method">Condorcet winner</a>.
          {:else}
            <strong>{getCandidate(report.condorcet).name}</strong> was the <a href="https://en.wikipedia.org/wiki/Condorcet_method">Condorcet winner</a>, meaning that they would have won in a head-to-head matchup against <strong>{getCandidate(report.winner).name}</strong>.
          {/if}
        </p>
      {:else if report.condorcet == null && report.winner != null && report.smithSet}
        <p>
          No Condorcet winner exists; multiple candidates form a
          <a href="https://en.wikipedia.org/wiki/Condorcet_paradox">Condorcet cycle</a>:
          {report.smithSet.map(getCandidateNameById).join(", ")}. This means that among these candidates, each one would beat some others in head-to-head matchups, but no single candidate beats all others. In this situation, the winner depends on the order of eliminations in the STV process, rather than a clear preference.
        </p>
      {/if}
    {/if}
  </div>
  <div class="rightCol">
    <VoteCounts candidateVotes={report.totalVotes} {quota} {seats} />
  </div>
</div>

{#if report.rounds.length > 1}
  <div class="row">
    <div class="leftCol">
      <h2>{isSTV ? 'STV Rounds' : 'Runoff Rounds'}</h2>

      <p>
        This <a href="https://en.wikipedia.org/wiki/Sankey_diagram">Sankey diagram</a> shows the votes of each remaining candidate at each round,
        as well as the breakdown of votes transferred when each candidate was
        {#if isSTV}
          elected (surplus transfers) or eliminated.
        {:else}
          eliminated.
        {/if}
      </p>

      {#if isSTV}
        <p>
          In STV, candidates who reach the <strong>quota</strong> ({quota?.toLocaleString()} votes)
          are elected. Surplus votes above the quota are transferred to voters' next preferences.
          When no candidate reaches the quota, the candidate with the fewest votes is eliminated
          and their votes are transferred.
        </p>
      {/if}

      <p>
        Note that the tabulation (but not the winner) may differ from the official count. You
        can <a href="/discrepancies">read more about why this is</a>.
      </p>
    </div>

    <div class="rightCol">
      <Sankey rounds={report.rounds} totalVotes={report.totalVotes} {seats} {quota} />
    </div>
  </div>
{/if}

{#if report.numCandidates > 1 && hasPairwiseData}
<div class="row">
  <div class="leftCol">
    <h2>Pairwise Preferences</h2>
    <p>
      For every pair of candidates, this table shows the fraction of voters who
      preferred one to the other. A preference means that either a voter ranks a
      candidate ahead of the other, or ranks one candidate but does not list the
      other. Ballots which rank neither candidate are not counted towards the
      percent counts.
    </p>
    {#if isSTV}
      <p>
        Note: In multi-seat STV elections, pairwise preferences show overall voter
        sentiment but don't directly determine outcomes, since votes transfer
        through multiple elimination and surplus rounds.
      </p>
    {/if}
  </div>

  <div class="rightCol">
    <CandidatePairTable
      data={sortedPairwisePreferences}
      rowLabel="Preferred Candidate"
      colLabel="Less-preferred Candidate"
      generateTooltip={(row: Allocatee, col: Allocatee, entry: ICandidatePairEntry) => `
        Of the <strong>${entry.denominator.toLocaleString()}</strong> voters
        who expressed a preference, <strong>${Math.round(entry.frac * 1000) / 10}%</strong>
        (<strong>${entry.numerator.toLocaleString()}</strong>) preferred
        <strong>${getCandidate(row).name}</strong> to <strong>${getCandidate(col).name}</strong>.
      `} />
  </div>
</div>

<div class="row">
  <div class="leftCol">
    <h2>First Alternate</h2>
    <p>
      For every pair of candidates, this table shows the fraction of voters who
      ranked one candidate first ranked the other candidate second.
    </p>
  </div>

  <div class="rightCol">
    <CandidatePairTable
      generateTooltip={(row, col, entry) => (col !== EXHAUSTED ? `
        Of the <strong>${entry.denominator.toLocaleString()}</strong> voters who chose <strong>${getCandidate(row).name}</strong>
        as their first choice, <strong>${entry.numerator.toLocaleString()}</strong>
        (<strong>${Math.round(entry.frac * 1000) / 10}%</strong>)
        chose <strong>${getCandidate(col).name}</strong>
        as their second choice.
        ` : `
        Of the <strong>${entry.denominator.toLocaleString()}</strong> voters who chose <strong>${getCandidate(row).name}</strong>
        as their first choice, <strong>${entry.numerator.toLocaleString()}</strong>
        (<strong>${Math.round(entry.frac * 1000) / 10}%</strong>)
        did not rank another candidate.
       `)}
      data={sortedFirstAlternate}
      rowLabel="First Choice"
      colLabel="Second Choice" />
  </div>
</div>

{#if report.rankingDistribution && report.rankingDistribution.totalBallots > 0}
<div class="row">
  <div class="leftCol">
    <h2>Ranking Distribution</h2>
    <p>
      This shows how many candidates voters ranked, both overall and broken down by each candidate's first-choice supporters. This reveals whether some candidates attracted voters who ranked multiple candidates versus those who ranked fewer candidates.
    </p>
  </div>

  <div class="rightCol">
    <RankingDistribution
      candidates={report.candidates}
      rankingDistribution={report.rankingDistribution}
      totalVotes={report.totalVotes} />
  </div>
</div>
{/if}
{/if}<!-- end hasPairwiseData -->

{#if hasCandidates && report.rounds && report.rounds.length > 1 && hasPairwiseData}
  <div class="row">
    <div class="leftCol">
      <h2>Final Vote by First Choice</h2>
      <p>
        This table tracks which candidate ballots were ultimately allocated to,
        among ballots that ranked an eliminated candidate first.
      </p>
      {#if isSTV}
        <p>
          In STV, "final" means the candidate each ballot was counted towards
          when all seats were filled or the tabulation ended.
        </p>
      {/if}
    </div>

    <div class="rightCol">
      <CandidatePairTable
        generateTooltip={(row: Allocatee, col: Allocatee, entry: ICandidatePairEntry) => (col !== EXHAUSTED ? `
        Of the <strong>${entry.denominator.toLocaleString()}</strong> ballots that ranked <strong>${getCandidate(row).name}</strong>
        first, <strong>${entry.numerator.toLocaleString()}</strong>
        (<strong>${Math.round(entry.frac * 1000) / 10}%</strong>)
        were allocated to <strong>${getCandidate(col).name}</strong>
        in the final round.
        ` : `
        Of the <strong>${entry.denominator.toLocaleString()}</strong> ballots that ranked <strong>${getCandidate(row).name}</strong>
        first, <strong>${entry.numerator.toLocaleString()}</strong>
        (<strong>${Math.round(entry.frac * 1000) / 10}%</strong>)
        were exhausted by the final round.
        `)}
        data={sortedFirstFinal}
        rowLabel="First Round Choice"
        colLabel="Final Round Choice" />
    </div>
  </div>
{/if}
{/if}
