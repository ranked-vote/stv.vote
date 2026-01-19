<script lang="ts">
  import type {
    ICandidateVotes,
    CandidateId,
  } from "$lib/report_types";
  import type { CandidateContext } from "../candidates";
  import { getContext } from "svelte";
  import tooltip from "$lib/tooltip";

  export let candidateVotes: ICandidateVotes[];
  export let quota: number | undefined = undefined;
  export let seats: number = 1;
  export let winners: CandidateId[] = [];

  const { getCandidate } = getContext("candidates") as CandidateContext;

  const isSTV = seats > 1;

  const outerHeight = 24;
  const innerHeight = 14;
  const labelSpace = 180;
  const width = 600;

  // Helper to check if a candidate is a winner
  const isWinner = (candidateId: CandidateId) => winners.includes(candidateId);

  // Sort by total votes (firstRoundVotes + transferVotes) in descending order
  // But put elected candidates first, sorted by round elected
  $: sortedCandidateVotes = [...candidateVotes].sort((a, b) => {
    // Elected candidates first (either by roundElected or by being in winners array)
    const aElected = a.roundElected !== undefined || isWinner(a.candidate);
    const bElected = b.roundElected !== undefined || isWinner(b.candidate);
    if (aElected && !bElected) return -1;
    if (!aElected && bElected) return 1;
    if (aElected && bElected) {
      // Sort by round elected (winners without roundElected go last among elected)
      const aRound = a.roundElected ?? Infinity;
      const bRound = b.roundElected ?? Infinity;
      return aRound - bRound;
    }
    // Then by total votes
    return (b.firstRoundVotes + b.transferVotes) - (a.firstRoundVotes + a.transferVotes);
  });

  $: maxVotes = Math.max(...sortedCandidateVotes.map((d) => d.firstRoundVotes + d.transferVotes));
  $: scale = (width - labelSpace - 15) / maxVotes;
  $: quotaX = quota ? quota * scale : null;

  $: height = outerHeight * sortedCandidateVotes.length;
</script>

<style>
  svg {
    color-scheme: light;
  }

  .firstRound {
    fill: #0d4aaa;
  }

  .firstRound.eliminated {
    fill: #a0afc5;
  }

  .transfer {
    fill: #6b9ae8;
  }

  .transfer.eliminated {
    fill: #c5cdd8;
  }

  .quotaLine {
    stroke: #0d4aaa;
    stroke-width: 1.5;
    stroke-dasharray: 4 2;
    opacity: 0.7;
  }

  .quotaLabel {
    font-size: 9px;
    fill: #0d4aaa;
    font-weight: 600;
  }

  .electedText {
    fill: #666;
  }

  .electedText.insideBar {
    fill: white;
    font-weight: 600;
    text-shadow: 0 0 3px rgba(0,0,0,0.5);
  }

  .eliminatedText {
    fill: #666;
  }

  @media (prefers-color-scheme: dark) {
    /* Make all text in SVG light colored */
    text {
      fill: #e3e3e3;
    }

    .electedText {
      fill: #aaa;
    }

    .electedText.insideBar {
      fill: white;
    }

    .eliminatedText {
      fill: #aaa;
    }

    .quotaLine {
      stroke: #4a8fff;
    }

    .quotaLabel {
      fill: #4a8fff;
    }

    .firstRound {
      fill: #4a8fff;
    }

    .firstRound.eliminated {
      fill: #5a6070;
    }

    .transfer {
      fill: #7ab0ff;
    }

    .transfer.eliminated {
      fill: #6a7080;
    }
  }
</style>

<svg width="100%" viewBox={`0 0 ${width} ${height + 20}`}>
  <g transform={`translate(${labelSpace} 10)`}>
    {#if quotaX && isSTV}
      <!-- Quota line -->
      <line
        class="quotaLine"
        x1={5 + quotaX}
        y1={-5}
        x2={5 + quotaX}
        y2={height - 5}
      />
      <text
        class="quotaLabel"
        text-anchor="end"
        x={quotaX}
        y={-2}>
        Votes needed to win: {quota?.toLocaleString()}
      </text>
    {/if}

    {#each sortedCandidateVotes as votes, i (votes.candidate)}
      {@const isElected = votes.roundElected !== undefined}
      {@const isEliminated = votes.roundEliminated !== undefined}
      {@const isWinnerCandidate = isElected || isWinner(votes.candidate)}
      <g
        transform={`translate(0 ${outerHeight * (i + 0.5)})`}>
        <text font-size="12" text-anchor="end" dominant-baseline="middle">
          {getCandidate(votes.candidate).name}
        </text>
        <g transform={`translate(5 ${-innerHeight / 2 - 1})`}>
          <rect
            class="firstRound"
            class:eliminated={!isWinnerCandidate}
            height={innerHeight}
            width={scale * votes.firstRoundVotes}
            use:tooltip={`<strong>${getCandidate(votes.candidate).name}</strong>
            received <strong>${votes.firstRoundVotes.toLocaleString()}</strong> votes
            in the first round.`} />
          <rect
            class="transfer"
            class:eliminated={!isWinnerCandidate}
            x={scale * votes.firstRoundVotes}
            height={innerHeight}
            width={scale * votes.transferVotes}
            use:tooltip={`<strong>${getCandidate(votes.candidate).name}</strong>
            received <strong>${votes.transferVotes.toLocaleString()}</strong> transfer votes.`}
            />
        </g>
        {#if isWinnerCandidate}
          {@const totalVotes = votes.firstRoundVotes + votes.transferVotes}
          {@const reachedQuota = quota && totalVotes >= quota}
          {@const hasWideBar = totalVotes >= maxVotes * 0.8}
          <text
            class="electedText"
            class:insideBar={hasWideBar}
            font-size="11"
            dominant-baseline="middle"
            text-anchor="end"
            x={width - labelSpace - 5}>
            {#if reachedQuota}
              Elected in round {votes.roundElected}
            {:else if votes.roundElected !== undefined}
              Elected in round {votes.roundElected} (final)
            {:else}
              Elected (final)
            {/if}
          </text>
        {:else if isEliminated}
          <text
            class="eliminatedText"
            font-size="11"
            dominant-baseline="middle"
            text-anchor="end"
            x={width - labelSpace - 5}>
            Eliminated in round {votes.roundEliminated}
          </text>
        {:else if isSTV}
          <!-- Candidate was neither elected nor eliminated - remaining when seats filled -->
          <text
            class="eliminatedText"
            font-size="11"
            dominant-baseline="middle"
            text-anchor="end"
            x={width - labelSpace - 5}>
            Eliminated in final round
          </text>
        {/if}
      </g>
    {/each}
  </g>
</svg>
