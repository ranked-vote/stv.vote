<script lang="ts">
  import type {
    ITabulatorRound,
    ITabulatorAllocation,
    Allocatee,
    CandidateId,
    ICandidateVotes,
  } from "$lib/report_types";
  import type { CandidateContext } from "../candidates";
  import { EXHAUSTED } from "../candidates";
  import { getContext } from "svelte";
  import tooltip from "$lib/tooltip";

  export let rounds: ITabulatorRound[];
  export let totalVotes: ICandidateVotes[] = [];
  export let seats: number = 1;
  export let quota: number | undefined = undefined;

  const { getCandidate } = getContext("candidates") as CandidateContext;

  // Build maps of candidate -> round elected/eliminated
  const electedInRound = new Map<CandidateId, number>();
  const eliminatedInRound = new Map<CandidateId, number>();
  
  for (const cv of totalVotes) {
    if (cv.roundElected !== undefined) {
      electedInRound.set(cv.candidate, cv.roundElected);
    }
    if (cv.roundEliminated !== undefined) {
      eliminatedInRound.set(cv.candidate, cv.roundEliminated);
    }
  }

  // Also check rounds for electedThisRound/eliminatedThisRound fields
  rounds.forEach((round, i) => {
    if (round.electedThisRound) {
      for (const cid of round.electedThisRound) {
        if (!electedInRound.has(cid)) {
          electedInRound.set(cid, i + 1);
        }
      }
    }
    if (round.eliminatedThisRound) {
      for (const cid of round.eliminatedThisRound) {
        if (!eliminatedInRound.has(cid)) {
          eliminatedInRound.set(cid, i + 1);
        }
      }
    }
  });

  const isSTV = seats > 1;

  type NodeKey = `${number}:${string}`;

  function nodeKey(roundIndex: number, allocatee: Allocatee): NodeKey {
    return `${roundIndex}:${allocatee}`;
  }

  const outerHeight = 24;
  const width = 600;
  const roundHeight = 90;
  const voteBlockHeight = 14;
  const edgeMargin = 60;

  const candidateMargin = 20; // px

  // Sort candidates by first-round votes (highest first, leftmost)
  // Keep exhausted ("X") at the end
  const firstRoundVoteOrder = new Map<Allocatee, number>();
  rounds[0].allocations.forEach((alloc) => {
    firstRoundVoteOrder.set(alloc.allocatee, alloc.votes);
  });

  function sortAllocations(allocations: ITabulatorAllocation[]): ITabulatorAllocation[] {
    return [...allocations].sort((a, b) => {
      // Exhausted always goes last
      if (a.allocatee === EXHAUSTED) return 1;
      if (b.allocatee === EXHAUSTED) return -1;
      // Sort by first-round votes (descending)
      const aVotes = firstRoundVoteOrder.get(a.allocatee) ?? 0;
      const bVotes = firstRoundVoteOrder.get(b.allocatee) ?? 0;
      return bVotes - aVotes;
    });
  }

  const firstRoundAllocations = sortAllocations(rounds[0].allocations);
  const firstRoundNumCandidates = firstRoundAllocations.length - 1;
  const voteScale =
    (width - candidateMargin * firstRoundNumCandidates - edgeMargin - 10) /
    firstRoundAllocations.reduce((a, b) => a + b.votes, 0);

  const innerHeight = roundHeight * (rounds.length - 1) + voteBlockHeight;
  const labelSpace = 100;
  const height = 2 * labelSpace + innerHeight;

  class VoteBlock {
    constructor(
      public x: number,
      public width: number,
      public y: number,
      private allocatee: Allocatee,
      private votes: number,
      private round: number,
      private totalRoundVotes?: number
    ) {}

    roundIndex(): number {
      return this.round - 1;
    }

    nodeKey(): NodeKey {
      return nodeKey(this.roundIndex(), this.allocatee);
    }

    isExhausted(): boolean {
      return this.allocatee === EXHAUSTED;
    }

    isElected(): boolean {
      if (this.allocatee === EXHAUSTED) return false;
      const electedRound = electedInRound.get(this.allocatee as CandidateId);
      return electedRound !== undefined && electedRound <= this.round;
    }

    isEliminated(): boolean {
      if (this.allocatee === EXHAUSTED) return false;
      const eliminatedRound = eliminatedInRound.get(this.allocatee as CandidateId);
      // Show as eliminated in the round they were eliminated (their last appearance)
      return eliminatedRound !== undefined && eliminatedRound === this.round;
    }

    label(): string {
      return getCandidate(this.allocatee).name;
    }

    percentage(): number | null {
      return this.totalRoundVotes ?
        Math.round((this.votes / this.totalRoundVotes) * 1000) / 10 : null;
    }

    tooltip(): string {
      const percentage = this.percentage();
      const percentageText = percentage ? ` (${percentage}%)` : '';
      const electedRound = this.allocatee !== EXHAUSTED ? electedInRound.get(this.allocatee as CandidateId) : undefined;

      if (this.isExhausted()) {
        return `
        <strong>${this.votes.toLocaleString()}</strong> votes${percentageText}
        were exhausted
        in round <strong>${this.round}</strong>`;
      } else if (electedRound !== undefined && electedRound === this.round) {
        // Check if they actually reached quota or were elected by default
        const reachedQuota = quota && this.votes >= quota;
        const electionMethod = reachedQuota ? '' : ' (remaining seats filled)';
        return `
        <strong>${getCandidate(this.allocatee).name}</strong> was <span style="color: #0a7c0a; font-weight: bold;">ELECTED</span>${electionMethod}
        with <strong>${this.votes.toLocaleString()}</strong> votes${percentageText}
        in round <strong>${this.round}</strong>`;
      } else if (this.isElected()) {
        return `
        <strong>${getCandidate(this.allocatee).name}</strong> (elected) held
        <strong>${this.votes.toLocaleString()}</strong> votes${percentageText}
        in round <strong>${this.round}</strong>`;
      } else {
        return `
        <strong>${getCandidate(this.allocatee).name}</strong> received
        <strong>${this.votes.toLocaleString()}</strong> votes${percentageText}
        in round <strong>${this.round}</strong>`;
      }
    }
  }

  class TransferBlock {
    constructor(
      private fromCandidate: Allocatee,
      private toCandidate: Allocatee,
      private votes: number,
      private round: number,
      private fromRoundIndex: number,
      private toRoundIndex: number,
      private r1x: number,
      private r2x: number,
      private width: number,
      private r1y: number,
      private r2y: number,
      private sourceVotes?: number,
      private transferType?: string
    ) {}

    sourceKey(): NodeKey {
      return nodeKey(this.fromRoundIndex, this.fromCandidate);
    }

    targetKey(): NodeKey {
      return nodeKey(this.toRoundIndex, this.toCandidate);
    }

    isSurplusTransfer(): boolean {
      return this.transferType === 'surplus';
    }

    toPath(): string {
      let midY = (this.r1y + this.r2y) / 2;
      let width = Math.max(1, this.width);
      let { r1y, r2y, r1x, r2x } = this;
      r1x = r1x - Math.min(width - this.width, 0);
      let r1x2 = r1x + width;
      let r2x2 = r2x + width;
      return `\
            M ${r1x} ${r1y} \
            H ${r1x2} \
            C ${r1x2} ${midY} ${r2x2} ${midY} ${r2x2} ${r2y} \
            H ${r2x} \
            C ${r2x} ${midY} ${r1x} ${midY} ${r1x} ${r1y} \
            Z \
        `;
    }

    isExhaustedTransfer(): boolean {
      return this.fromCandidate === EXHAUSTED || this.toCandidate === EXHAUSTED;
    }

    tooltip(): string {
      const percentage = this.sourceVotes ?
        Math.round((this.votes / this.sourceVotes) * 1000) / 10 : null;
      const percentageText = percentage ? ` (${percentage}%)` : '';
      const transferTypeText = this.isSurplusTransfer() ? ' (surplus)' : '';

      if (this.fromCandidate === EXHAUSTED) {
        return `<strong>${this.votes.toLocaleString()}</strong> exhausted votes
        carried over into round <strong>${this.round}</strong>`;
      } else if (this.toCandidate === EXHAUSTED) {
        return `<strong>${this.votes.toLocaleString()}</strong> votes
        for <strong>${getCandidate(this.fromCandidate).name}</strong>
        became exhausted in round <strong>${this.round}</strong>${transferTypeText}`;
      } else if (this.fromCandidate === this.toCandidate) {
        return `<strong>${this.votes.toLocaleString()}</strong> votes
        for <strong>${getCandidate(this.toCandidate).name}</strong>
        carried over into round <strong>${this.round}</strong>`;
      } else {
        return `<strong>${this.votes.toLocaleString()}</strong> votes${percentageText}
        for <strong>${getCandidate(this.fromCandidate).name}</strong>
        were transferred${transferTypeText} to <strong>${
          getCandidate(this.toCandidate).name
        }</strong>
        in round <strong>${this.round}</strong>`;
      }
    }
  }

  let transfers: TransferBlock[] = [];

  type HoverState =
    | { kind: "node"; key: NodeKey }
    | { kind: "link"; index: number }
    | null;

  let hover: HoverState = null;

  type TransferMeta = {
    sourceKey: NodeKey;
    targetKey: NodeKey;
    isSurplus: boolean;
  };

  let transferMetas: TransferMeta[] = [];
  let incoming: Map<NodeKey, number[]> = new Map();
  let outgoing: Map<NodeKey, number[]> = new Map();

  let activeNodeKeys: Set<NodeKey> = new Set();
  let activeLinkIndexes: Set<number> = new Set();

  interface CandidateState {
    xOffset: number;
    width: number;
    votes: number;
    accountedIn: number;
    accountedOut: number;
  }

  let lastVotes: Map<Allocatee, CandidateState> = new Map();

  let voteBlockRows: VoteBlock[][] = rounds.map((round, i) => {
    let voteBlocks: VoteBlock[] = [];
    let curVotes: Map<Allocatee, CandidateState> = new Map();
    const sortedAllocations = sortAllocations(round.allocations);
    let numCandidates = sortedAllocations.length - 1;
    let offset =
      (firstRoundNumCandidates - numCandidates) * (candidateMargin / 2);

    // Calculate total votes for this round
    const totalRoundVotes = sortedAllocations.reduce((sum, allocation) => sum + allocation.votes, 0);
    for (let allocation of sortedAllocations) {
      let width = voteScale * allocation.votes;
      voteBlocks.push(
        new VoteBlock(
          offset,
          width,
          i * roundHeight,
          allocation.allocatee,
          allocation.votes,
          i + 1,
          totalRoundVotes
        )
      );

      let last = lastVotes.get(allocation.allocatee);
      let accountedIn = 0;
      if (last) {
        // Carryover width should be the MINIMUM of previous and current votes
        // (representing votes that stay with the candidate, not the full previous amount)
        const carryoverWidth = Math.min(last.width, width);
        const carryoverVotes = Math.min(last.votes, allocation.votes);
        
        transfers.push(
          new TransferBlock(
            allocation.allocatee,
            allocation.allocatee,
            carryoverVotes,
            i + 1,
            i - 1,
            i,
            last.xOffset,
            allocation.allocatee === "X" ? offset + width - carryoverWidth : offset,
            carryoverWidth,
            (i - 1) * roundHeight + voteBlockHeight,
            i * roundHeight,
            last.votes,
            undefined
          )
        );

        if (allocation.allocatee !== "X") {
          accountedIn = carryoverWidth;
        }
        
        // Mark the carryover portion as "accounted out" from the source
        // so surplus transfers start from the RIGHT side of the bar
        last.accountedOut += carryoverWidth;
      }

      curVotes.set(allocation.allocatee, {
        xOffset: offset,
        votes: allocation.votes,
        width,
        accountedIn,
        accountedOut: 0,
      });

      offset += width + candidateMargin;
    }

    // Compute transfers.

    for (let transfer of round.transfers) {
      let last = lastVotes.get(transfer.from);
      let cur = curVotes.get(transfer.to);

      if (!last || !cur) {
        continue;
      }

      let width = transfer.count * voteScale;

      transfers.push(
        new TransferBlock(
          transfer.from,
          transfer.to,
          transfer.count,
          i + 1,
          i - 1,
          i,
          last.xOffset + last.accountedOut,
          cur.xOffset + cur.accountedIn,
          width,
          (i - 1) * roundHeight + voteBlockHeight,
          i * roundHeight,
          last.votes,
          transfer.type
        )
      );

      last.accountedOut += width;
      cur.accountedIn += width;
    }

    lastVotes = curVotes;
    return voteBlocks;
  });

  $: {
    transferMetas = transfers.map((t) => ({
      sourceKey: t.sourceKey(),
      targetKey: t.targetKey(),
      isSurplus: t.isSurplusTransfer(),
    }));

    incoming = new Map();
    outgoing = new Map();
    for (let i = 0; i < transferMetas.length; i++) {
      const meta = transferMetas[i];
      const inArr = incoming.get(meta.targetKey);
      if (inArr) inArr.push(i);
      else incoming.set(meta.targetKey, [i]);

      const outArr = outgoing.get(meta.sourceKey);
      if (outArr) outArr.push(i);
      else outgoing.set(meta.sourceKey, [i]);
    }
  }

  function computeActiveForLink(index: number): void {
    activeNodeKeys = new Set();
    activeLinkIndexes = new Set();

    const meta = transferMetas[index];
    if (!meta) return;

    const visitedUp = new Set<NodeKey>();
    const upStack: NodeKey[] = [meta.sourceKey];
    while (upStack.length) {
      const key = upStack.pop();
      if (!key || visitedUp.has(key)) continue;
      visitedUp.add(key);
      activeNodeKeys.add(key);
      const inEdges = incoming.get(key) ?? [];
      for (const edgeIdx of inEdges) {
        activeLinkIndexes.add(edgeIdx);
        const prevKey = transferMetas[edgeIdx]?.sourceKey;
        if (prevKey) upStack.push(prevKey);
      }
    }

    const visitedDown = new Set<NodeKey>();
    const downStack: NodeKey[] = [meta.targetKey];
    while (downStack.length) {
      const key = downStack.pop();
      if (!key || visitedDown.has(key)) continue;
      visitedDown.add(key);
      activeNodeKeys.add(key);
      const outEdges = outgoing.get(key) ?? [];
      for (const edgeIdx of outEdges) {
        activeLinkIndexes.add(edgeIdx);
        const nextKey = transferMetas[edgeIdx]?.targetKey;
        if (nextKey) downStack.push(nextKey);
      }
    }

    activeLinkIndexes.add(index);
    activeNodeKeys.add(meta.sourceKey);
    activeNodeKeys.add(meta.targetKey);
  }

  function computeActiveForNode(key: NodeKey): void {
    activeNodeKeys = new Set();
    activeLinkIndexes = new Set();

    const visitedUp = new Set<NodeKey>();
    const upStack: NodeKey[] = [key];
    while (upStack.length) {
      const curKey = upStack.pop();
      if (!curKey || visitedUp.has(curKey)) continue;
      visitedUp.add(curKey);
      activeNodeKeys.add(curKey);
      const inEdges = incoming.get(curKey) ?? [];
      for (const edgeIdx of inEdges) {
        activeLinkIndexes.add(edgeIdx);
        const prevKey = transferMetas[edgeIdx]?.sourceKey;
        if (prevKey) upStack.push(prevKey);
      }
    }

    const visitedDown = new Set<NodeKey>();
    const downStack: NodeKey[] = [key];
    while (downStack.length) {
      const curKey = downStack.pop();
      if (!curKey || visitedDown.has(curKey)) continue;
      visitedDown.add(curKey);
      activeNodeKeys.add(curKey);
      const outEdges = outgoing.get(curKey) ?? [];
      for (const edgeIdx of outEdges) {
        activeLinkIndexes.add(edgeIdx);
        const nextKey = transferMetas[edgeIdx]?.targetKey;
        if (nextKey) downStack.push(nextKey);
      }
    }
  }

  $: {
    if (!hover) {
      activeNodeKeys = new Set();
      activeLinkIndexes = new Set();
    } else if (hover.kind === "link") {
      computeActiveForLink(hover.index);
    } else {
      computeActiveForNode(hover.key);
    }
  }
</script>

<style>
  svg {
    color-scheme: light;
  }

  /* Default: Blue for active/continuing candidates */
  .voteBlock {
    fill: #2563eb;
    cursor: pointer;
  }

  .voteBlock.exhausted {
    fill: #ccc;
  }

  /* Green for elected candidates */
  .voteBlock.elected {
    fill: #0a7c0a;
  }

  /* Red for eliminated candidates (in their final round) */
  .voteBlock.eliminated {
    fill: #dc2626;
  }

  .voteBlock.highlight {
    stroke: #111;
    stroke-width: 2;
  }

  .voteBlock.dimmed {
    opacity: 0.35;
  }

  .transfer {
    fill: #444;
    opacity: 0.2;
    mix-blend-mode: exclusion;
    cursor: pointer;
  }

  .transfer.surplus {
    fill: #0a7c0a;
    opacity: 0.3;
  }

  .transfer.highlight {
    opacity: 0.85;
    mix-blend-mode: normal;
  }

  .transfer.dimmed {
    opacity: 0.06;
  }

  .percentageText {
    font-size: 9px;
    fill: white;
    font-weight: 600;
  }

  .percentageText.exhausted {
    fill: #555;
  }

  @media (prefers-color-scheme: dark) {
    .voteBlock {
      fill: #3b82f6;
    }

    .voteBlock.exhausted {
      fill: #666;
      stroke: #999;
      stroke-width: 1;
    }

    .voteBlock.elected {
      fill: #0c9c0c;
    }

    .voteBlock.eliminated {
      fill: #ef4444;
    }

    .voteBlock.highlight {
      stroke: #fff;
    }

    .percentageText.exhausted {
      fill: white;
    }

    /* Make transfer paths more visible in dark mode */
    .transfer {
      fill: #999;
      opacity: 0.4;
      mix-blend-mode: normal;
    }

    .transfer.surplus {
      fill: #0c9c0c;
      opacity: 0.5;
    }

    .transfer.highlight {
      opacity: 0.85;
    }

    /* Make all text in SVG light colored */
    text {
      fill: #e3e3e3;
    }
  }
</style>

<svg width="100%" viewBox={`0 0 ${width} ${height}`}>
  {#each rounds as _, i}
    <text dominant-baseline="middle" font-size="10" y={i * roundHeight + labelSpace + voteBlockHeight / 2}>Round {i+1}</text>
  {/each}
  <g transform={`translate(${edgeMargin} ${labelSpace})`}>
    {#each voteBlockRows[0] as voteBlock}
      <g
        transform={`translate(${voteBlock.x + voteBlock.width / 2} -10)`}
        on:pointerenter={() => (hover = { kind: "node", key: voteBlock.nodeKey() })}
        on:pointerleave={() => (hover = null)}>
        <text font-size="12" dominant-baseline="middle" transform="rotate(-90)">
          {voteBlock.label()}
        </text>
      </g>
    {/each}

    {#each voteBlockRows as voteBlockRow}
      {#each voteBlockRow as voteBlock}
        <rect
          use:tooltip={voteBlock.tooltip()}
          class="voteBlock"
          class:exhausted={voteBlock.isExhausted()}
          class:elected={voteBlock.isElected()}
          class:eliminated={voteBlock.isEliminated()}
          class:highlight={activeNodeKeys.has(voteBlock.nodeKey())}
          class:dimmed={hover !== null && !activeNodeKeys.has(voteBlock.nodeKey())}
          y={voteBlock.y}
          x={voteBlock.x}
          width={Math.max(1, voteBlock.width)}
          height={voteBlockHeight}
          on:pointerenter={() => (hover = { kind: "node", key: voteBlock.nodeKey() })}
          on:pointerleave={() => (hover = null)} />
        {#if voteBlock.percentage() !== null && voteBlock.width > 20}
          <text
            class="percentageText {voteBlock.isExhausted() ? 'exhausted' : ''}"
            x={voteBlock.x + voteBlock.width / 2}
            y={voteBlock.y + voteBlockHeight / 2}
            dominant-baseline="middle"
            text-anchor="middle">
            {voteBlock.percentage()}%
          </text>
        {/if}
      {/each}
    {/each}

    {#each transfers as transfer, i}
      <path
        use:tooltip={transfer.tooltip()}
        class="transfer"
        class:surplus={transfer.isSurplusTransfer()}
        class:highlight={activeLinkIndexes.has(i)}
        class:dimmed={hover !== null && !activeLinkIndexes.has(i)}
        d={transfer.toPath()}
        on:pointerenter={() => (hover = { kind: "link", index: i })}
        on:pointerleave={() => (hover = null)} />
    {/each}

    {#each voteBlockRows[voteBlockRows.length - 1] as voteBlock}
      <g
        transform={`translate(${voteBlock.x + voteBlock.width / 2} ${innerHeight + 10})`}
        on:pointerenter={() => (hover = { kind: "node", key: voteBlock.nodeKey() })}
        on:pointerleave={() => (hover = null)}>
        <text
          font-size="12"
          dominant-baseline="middle"
          text-anchor="end"
          transform="rotate(-90)">
          {voteBlock.label()}
        </text>
      </g>
    {/each}
  </g>
</svg>
