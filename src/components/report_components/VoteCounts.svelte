<script lang="ts">
  import type {
    ICandidateVotes,
    CandidateId,
    ICandidate,
  } from "$lib/report_types";
  import type { CandidateContext } from "../candidates";
  import { getContext } from "svelte";
  import tooltip from "$lib/tooltip";

  export let candidateVotes: ICandidateVotes[];
  export let quota: number | undefined = undefined;
  export let seats: number = 1;

  const { getCandidate } = getContext("candidates") as CandidateContext;

  const isSTV = seats > 1;

  const outerHeight = 24;
  const innerHeight = 14;
  const labelSpace = 180;
  const width = 600;

  // Sort by total votes (firstRoundVotes + transferVotes) in descending order
  // But put elected candidates first, sorted by round elected
  $: sortedCandidateVotes = [...candidateVotes].sort((a, b) => {
    // Elected candidates first
    const aElected = a.roundElected !== undefined;
    const bElected = b.roundElected !== undefined;
    if (aElected && !bElected) return -1;
    if (!aElected && bElected) return 1;
    if (aElected && bElected) {
      // Sort by round elected
      return (a.roundElected ?? 0) - (b.roundElected ?? 0);
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
    fill: #aa0d0d;
  }

  .firstRound.elected {
    fill: #0a7c0a;
  }

  .transfer {
    fill: #e7ada0;
  }

  .transfer.elected {
    fill: #7dd87d;
  }

  .eliminated {
    opacity: 30%;
  }

  .quotaLine {
    stroke: #0a7c0a;
    stroke-width: 1.5;
    stroke-dasharray: 4 2;
    opacity: 0.7;
  }

  .quotaLabel {
    font-size: 9px;
    fill: #0a7c0a;
    font-weight: 600;
  }

  .electedText {
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
      fill: white;
    }

    .eliminatedText {
      fill: #aaa;
    }

    .quotaLine {
      stroke: #0c9c0c;
    }

    .quotaLabel {
      fill: #0c9c0c;
    }

    .firstRound.elected {
      fill: #0c9c0c;
    }

    .transfer.elected {
      fill: #5ec85e;
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
        Quota: {quota?.toLocaleString()}
      </text>
    {/if}

    {#each sortedCandidateVotes as votes, i}
      {@const isElected = votes.roundElected !== undefined}
      {@const isEliminated = votes.roundEliminated !== undefined}
      <g
        class={isEliminated && !isElected ? 'eliminated' : ''}
        transform={`translate(0 ${outerHeight * (i + 0.5)})`}>
        <text font-size="12" text-anchor="end" dominant-baseline="middle">
          {getCandidate(votes.candidate).name}
        </text>
        <g transform={`translate(5 ${-innerHeight / 2 - 1})`}>
          <rect
            class="firstRound"
            class:elected={isElected}
            height={innerHeight}
            width={scale * votes.firstRoundVotes}
            use:tooltip={`<strong>${getCandidate(votes.candidate).name}</strong>
            received <strong>${votes.firstRoundVotes.toLocaleString()}</strong> votes
            in the first round.`} />
          <rect
            class="transfer"
            class:elected={isElected}
            x={scale * votes.firstRoundVotes}
            height={innerHeight}
            width={scale * votes.transferVotes}
            use:tooltip={`<strong>${getCandidate(votes.candidate).name}</strong>
            received <strong>${votes.transferVotes.toLocaleString()}</strong> transfer votes.`}
            />
        </g>
        {#if isElected}
          {@const totalVotes = votes.firstRoundVotes + votes.transferVotes}
          {@const reachedQuota = quota && totalVotes >= quota}
          <text
            class="electedText"
            font-size="11"
            dominant-baseline="middle"
            text-anchor="end"
            x={width - labelSpace - 5}>
            {#if reachedQuota}
              Elected in round {votes.roundElected}
            {:else}
              Elected in round {votes.roundElected} (final)
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
        {/if}
      </g>
    {/each}
  </g>
</svg>
