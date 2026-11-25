<script lang="ts">
  import type {
    IContestReport,
    Allocatee,
    ICandidate,
    ICandidatePairEntry,
    ICandidatePairTable,
  } from "#lib/report_types";
  import VoteCounts from "./report_components/VoteCounts.svelte";
  import Sankey from "./report_components/Sankey.svelte";
  import CandidateRankCounts from "./report_components/CandidateRankCounts.svelte";
  import CandidatePairTable from "./report_components/CandidatePairTable.svelte";
  import CandidateMap from "./report_components/CandidateMap.svelte";
  import _RankingDistribution from "./report_components/RankingDistribution.svelte";
  import MathFormula from "./Math.svelte";
  import { EXHAUSTED } from "./candidates";

  import { setContext } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { resolve } from "$app/paths";

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
    const voteCountMap = new SvelteMap<Allocatee, number>();
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
  $: _sortedFirstFinal = hasCandidates
    ? sortPairwiseTable(report.firstFinal)
    : report.firstFinal;
</script>

<style>
  .winners-list {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .winners-list li {
    margin: 0.2em 0;
  }

  .quota-info {
    font-size: var(--text-small);
    color: var(--muted);
    max-width: 100%;
    overflow-x: auto;
    margin-top: 0.5em;
  }

  .reportHeader { margin-bottom: var(--space-12); }
  .breadcrumb { margin: 0 0 var(--space-2); font-size: var(--text-small); color: var(--muted); }
  .visualization { overflow-x: auto; max-width: 100%; }
  .visualization:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>

{#if hasReport}
<header class="reportHeader">
  <p class="breadcrumb"><a href={resolve("/")}>stv.vote</a> / {report.info.jurisdictionName}</p>
  <h1>{report.info.officeName}</h1>
</header>

<div class="row">
  <div class="leftCol">
    <p>
      The
      {#if report.info.website}
      <a href={report.info.website} rel="external">{report.info.jurisdictionName} {report.info.electionName}</a>
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
          <strong>{report.numCandidates}</strong>&nbsp;{#if report.numCandidates == 1}candidate {:else}candidates{/if}{#if report.rounds && report.rounds.length > 1} after
            <strong>{report.rounds.length - 1}</strong>&nbsp;elimination {#if report.rounds.length == 2}round{:else}rounds{/if}.
          {:else}. No elimination rounds were necessary to determine the outcome.
          {/if}
        {/if}
      {:else}
        No candidate data available for this election.
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

    {#if isSTV && winnerNames.length > 0}
      <p><strong>Elected candidates:</strong></p>
      <ol class="winners-list">
        {#each winnerNames as name, i (i)}
          <li>{name}</li>
        {/each}
      </ol>
      {#if quota}
        <p class="quota-info">
          Votes needed to win: <strong>{quota.toLocaleString()}</strong> votes
          <MathFormula formula={`\\left\\lfloor \\frac{${report.ballotCount.toLocaleString()}}{${seats} + 1} \\right\\rfloor + 1`} />
        </p>
      {/if}
    {/if}

  </div>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus and scroll wide diagrams and tables.) -->
  <div class="rightCol visualization" role="region" aria-label="Vote totals" tabindex="0">
    <VoteCounts candidateVotes={report.totalVotes} {quota} {seats} winners={report.winners} />
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

      <p>
        Note that the tabulation (but not the winner) may differ from the official count. You
        can <a href={resolve("/about#understanding-discrepancies")}>read more about why this is</a>.
      </p>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus and scroll wide diagrams and tables.) -->
    <div class="rightCol visualization" role="region" aria-label="Vote transfers by round" tabindex="0">
      <Sankey rounds={report.rounds} totalVotes={report.totalVotes} {quota} />
    </div>
  </div>
{/if}

{#if report.firstAlternate && report.firstAlternate.entries.length > 2}
  <div class="row">
    <div class="leftCol">
      <h2>Candidate Clustering</h2>

      <p>
        This visualization shows candidates positioned based on <strong>second-choice transfers</strong>.
        Candidates whose voters frequently rank each other appear closer together, forming natural "clusters" or voting blocs.
      </p>

      <p>
        Distance is based on the <strong>First Alternate</strong> table below — if voters who rank
        candidate A first often rank candidate B second (and vice versa), they'll appear close together.
        {#if isSTV}
          In STV, proportional representation means winners should be distributed across
          different clusters, representing diverse voter preferences.
        {/if}
      </p>

      <p>
        Circle size indicates first-round vote share. Green circles are elected candidates.
        Hover over candidates to see their top second-choice transfers.
      </p>
    </div>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus and scroll wide diagrams and tables.) -->
    <div class="rightCol visualization" role="region" aria-label="Candidate clustering" tabindex="0">
      <CandidateMap
        firstAlternate={report.firstAlternate}
        totalVotes={report.totalVotes}
        winners={report.winners}
      />
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

  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus and scroll wide diagrams and tables.) -->
  <div class="rightCol visualization" role="region" aria-label="Pairwise preferences" tabindex="0">
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
      Among voters who ranked the row candidate first, this table shows the fraction
      who ranked the column candidate second.
    </p>
  </div>

  <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to focus and scroll wide diagrams and tables.) -->
  <div class="rightCol visualization" role="region" aria-label="First alternate preferences" tabindex="0">
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

<!-- Hidden: Ranking Distribution and Final Vote by First Choice sections (not working) -->
{/if}<!-- end hasPairwiseData -->
{/if}

{#if report.rankingDistribution?.rankCounts}
  <div class="row">
    <div class="leftCol">
      <h2>Votes by Rank</h2>
      <p>Counts of how often each candidate appeared at each position in the ballot rankings used for this report.</p>
    </div>
    <div class="rightCol">
      <CandidateRankCounts candidates={report.candidates} rankCounts={report.rankingDistribution.rankCounts} />
    </div>
  </div>
{/if}
