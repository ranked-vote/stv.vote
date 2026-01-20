<script lang="ts">
  import type {
    ICandidatePairTable,
    CandidateId,
    ICandidateVotes,
  } from "$lib/report_types";
  import type { CandidateContext } from "../candidates";
  import { getContext } from "svelte";
  import { SvelteSet } from "svelte/reactivity";
  import tooltip from "$lib/tooltip";

  export let firstAlternate: ICandidatePairTable;
  export let totalVotes: ICandidateVotes[] = [];
  export let winners: CandidateId[] = [];

  const { getCandidate } = getContext("candidates") as CandidateContext;

  // SVG dimensions - use viewBox for responsive scaling
  const width = 600;
  const height = 450;
  const padding = 60;
  const nodeMinRadius = 8;
  const nodeMaxRadius = 28;

  // Cluster colors - distinct, accessible palette
  const clusterColors = [
    "#2563eb", // blue
    "#dc2626", // red
    "#16a34a", // green
    "#9333ea", // purple
    "#ea580c", // orange
    "#0891b2", // cyan
  ];

  // State
  let positions: Array<{ x: number; y: number }> = [];
  let clusterAssignments: number[] = [];
  let numClusters = 0;
  let hoveredCandidate: number | null = null; // Index into candidateRows
  
  // Filter to only include actual candidates (not exhausted "X")
  $: candidateRows = firstAlternate.rows.filter((r): r is CandidateId => r !== "X");

  // Compute similarity from first alternate data
  // Uses geometric mean of bidirectional transfer rates
  function firstAlternateToSimilarity(table: ICandidatePairTable): number[][] {
    const rows = table.rows.filter((r): r is CandidateId => r !== "X");
    const n = rows.length;
    
    // Create index map for looking up entries
    const rowIdx = new Map(table.rows.map((r, i) => [r, i]));
    const colIdx = new Map(table.cols.map((c, i) => [c, i]));
    
    const similarity: number[][] = Array.from({ length: n }, () =>
      Array(n).fill(0),
    );

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          similarity[i][j] = 1;
        } else {
          const ri = rowIdx.get(rows[i]);
          const rj = rowIdx.get(rows[j]);
          const ci = colIdx.get(rows[i]);
          const cj = colIdx.get(rows[j]);
          
          if (ri !== undefined && rj !== undefined && ci !== undefined && cj !== undefined) {
            // i→j transfer rate and j→i transfer rate
            const ijFrac = table.entries[ri]?.[cj]?.frac ?? 0;
            const jiFrac = table.entries[rj]?.[ci]?.frac ?? 0;
            // Geometric mean of bidirectional transfers
            similarity[i][j] = Math.sqrt(ijFrac * jiFrac);
          }
        }
      }
    }
    return similarity;
  }

  function similarityToDistance(similarity: number[][]): number[][] {
    const n = similarity.length;
    const distance: number[][] = Array.from({ length: n }, () =>
      Array(n).fill(0),
    );

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          distance[i][j] = 0;
        } else {
          const sim = Math.max(similarity[i][j], 0.01);
          distance[i][j] = 1 / sim;
        }
      }
    }
    return distance;
  }

  function normalizeDistances(distances: number[][]): number[][] {
    const n = distances.length;
    let maxDist = 0;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j && distances[i][j] > maxDist) {
          maxDist = distances[i][j];
        }
      }
    }

    if (maxDist === 0) return distances;

    return distances.map((row) => row.map((d) => d / maxDist));
  }

  // Classical MDS implementation
  function classicalMDS(distances: number[][]): Array<{ x: number; y: number }> {
    const n = distances.length;
    if (n < 2) {
      return distances.map(() => ({ x: 0.5, y: 0.5 }));
    }

    // Square distances
    const D2 = distances.map((row) => row.map((d) => d * d));

    // Double-centering
    const rowMeans = D2.map((row) => row.reduce((a, b) => a + b, 0) / n);
    const colMeans: number[] = [];
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += D2[i][j];
      colMeans.push(sum / n);
    }
    const grandMean = rowMeans.reduce((a, b) => a + b, 0) / n;

    const B: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        B[i][j] = -0.5 * (D2[i][j] - rowMeans[i] - colMeans[j] + grandMean);
      }
    }

    // Power iteration for top 2 eigenvectors
    const coords = powerIterationMDS(B, 2);

    // Normalize to [0, 1]
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of coords) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y);
      maxY = Math.max(maxY, c.y);
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;

    return coords.map((c) => ({
      x: (c.x - minX) / rangeX,
      y: (c.y - minY) / rangeY,
    }));
  }

  function powerIterationMDS(B: number[][], k: number): Array<{ x: number; y: number }> {
    const n = B.length;
    const maxIter = 100;
    const tol = 1e-6;

    const eigenvectors: number[][] = [];
    const eigenvalues: number[] = [];

    for (let dim = 0; dim < k; dim++) {
      // Deterministic initialization based on index and dimension
      // Using sin/cos to create orthogonal-ish starting vectors
      let v = Array.from({ length: n }, (_, i) => 
        Math.sin((i + 1) * (dim + 1) * 0.7) + Math.cos((i + 1) * (dim + 2) * 0.3)
      );

      for (const prev of eigenvectors) {
        const dot = v.reduce((sum, vi, i) => sum + vi * prev[i], 0);
        v = v.map((vi, i) => vi - dot * prev[i]);
      }

      let norm = Math.sqrt(v.reduce((sum, vi) => sum + vi * vi, 0));
      v = v.map((vi) => vi / (norm || 1));

      for (let iter = 0; iter < maxIter; iter++) {
        const Bv = B.map((row) => row.reduce((sum, bij, j) => sum + bij * v[j], 0));

        for (const prev of eigenvectors) {
          const dot = Bv.reduce((sum, bvi, i) => sum + bvi * prev[i], 0);
          for (let i = 0; i < n; i++) Bv[i] -= dot * prev[i];
        }

        norm = Math.sqrt(Bv.reduce((sum, bvi) => sum + bvi * bvi, 0));
        const vNew = Bv.map((bvi) => bvi / (norm || 1));

        const diff = v.reduce((sum, vi, i) => sum + Math.abs(vi - vNew[i]), 0);
        v = vNew;

        if (diff < tol) break;
      }

      // Normalize sign: ensure the largest magnitude element is positive
      // This prevents random flipping between runs
      const maxIdx = v.reduce((maxI, val, i, arr) => 
        Math.abs(val) > Math.abs(arr[maxI]) ? i : maxI, 0);
      if (v[maxIdx] < 0) {
        v = v.map(x => -x);
      }

      eigenvectors.push(v);
      const Bv = B.map((row) => row.reduce((sum, bij, j) => sum + bij * v[j], 0));
      eigenvalues.push(Math.sqrt(Math.abs(Bv.reduce((sum, bvi, i) => sum + bvi * v[i], 0))));
    }

    const coords: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < n; i++) {
      coords.push({
        x: eigenvectors[0][i] * eigenvalues[0],
        y: k > 1 ? eigenvectors[1][i] * eigenvalues[1] : 0,
      });
    }

    return coords;
  }

  // Hierarchical clustering with average linkage
  function hierarchicalClustering(distances: number[][], targetClusters: number): number[] {
    const n = distances.length;
    if (n <= targetClusters) {
      return Array.from({ length: n }, (_, i) => i);
    }

    const clusters: SvelteSet<number>[] = Array.from({ length: n }, (_, i) => new SvelteSet([i]));
    const active = new SvelteSet(Array.from({ length: n }, (_, i) => i));

    while (active.size > targetClusters) {
      let minDist = Infinity;
      let mergeI = -1;
      let mergeJ = -1;

      const activeArr = Array.from(active);
      for (let ii = 0; ii < activeArr.length; ii++) {
        for (let jj = ii + 1; jj < activeArr.length; jj++) {
          const i = activeArr[ii];
          const j = activeArr[jj];

          // Average linkage: use mean distance between all pairs
          let totalDist = 0;
          let pairCount = 0;
          for (const pi of clusters[i]) {
            for (const pj of clusters[j]) {
              totalDist += distances[pi][pj];
              pairCount++;
            }
          }
          const avgDist = totalDist / pairCount;

          if (avgDist < minDist) {
            minDist = avgDist;
            mergeI = i;
            mergeJ = j;
          }
        }
      }

      for (const p of clusters[mergeJ]) clusters[mergeI].add(p);
      active.delete(mergeJ);
    }

    const assignments = Array(n).fill(-1);
    let clusterIdx = 0;
    for (const i of active) {
      for (const p of clusters[i]) assignments[p] = clusterIdx;
      clusterIdx++;
    }

    return assignments;
  }

  function suggestNumClusters(n: number): number {
    // More aggressive clustering - most elections have 2-3 distinct blocs
    if (n <= 2) return 1;
    if (n <= 4) return 2;
    if (n <= 8) return 3;
    return Math.min(5, Math.ceil(n / 3));
  }

  // Compute convex hull for cluster boundary
  function convexHull(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (points.length < 3) return points;

    // Graham scan
    const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
    const lower: Array<{ x: number; y: number }> = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
        lower.pop();
      }
      lower.push(p);
    }

    const upper: Array<{ x: number; y: number }> = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
        upper.pop();
      }
      upper.push(p);
    }

    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function cross(o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  // Expand hull for visual padding
  function expandHull(hull: Array<{ x: number; y: number }>, amount: number): Array<{ x: number; y: number }> {
    if (hull.length < 3) return hull;

    // Find centroid
    const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;

    // Expand each point away from centroid
    return hull.map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      return {
        x: p.x + (dx / dist) * amount,
        y: p.y + (dy / dist) * amount,
      };
    });
  }

  // Compute 2D distance matrix from positions
  function positions2DDistances(pos: Array<{ x: number; y: number }>): number[][] {
    const n = pos.length;
    const dist: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          const dx = pos[i].x - pos[j].x;
          const dy = pos[i].y - pos[j].y;
          dist[i][j] = Math.sqrt(dx * dx + dy * dy);
        }
      }
    }
    return dist;
  }

  // Reactive computation
  $: if (firstAlternate && firstAlternate.entries.length > 0 && candidateRows.length > 1) {
    const similarity = firstAlternateToSimilarity(firstAlternate);
    const distances = similarityToDistance(similarity);
    const normalizedDist = normalizeDistances(distances);
    positions = classicalMDS(normalizedDist);
    
    // Cluster based on 2D positions, not original distances
    // This ensures visual clusters match the clustering algorithm
    const pos2DDist = positions2DDistances(positions);
    numClusters = suggestNumClusters(candidateRows.length);
    clusterAssignments = hierarchicalClustering(pos2DDist, numClusters);
  }

  // Get vote count for sizing nodes
  function getFirstRoundVotes(candidateId: CandidateId): number {
    const votes = totalVotes.find((v) => v.candidate === candidateId);
    return votes?.firstRoundVotes ?? 0;
  }

  // Compute node radius based on votes
  $: maxVotes = Math.max(...totalVotes.map((v) => v.firstRoundVotes), 1);
  
  function nodeRadius(candidateId: CandidateId): number {
    const votes = getFirstRoundVotes(candidateId);
    const frac = votes / maxVotes;
    return nodeMinRadius + frac * (nodeMaxRadius - nodeMinRadius);
  }

  // Convert normalized coords to SVG coords
  function toSvgX(x: number): number {
    return padding + x * (width - 2 * padding);
  }

  function toSvgY(y: number): number {
    return padding + y * (height - 2 * padding);
  }

  // Check if candidate is a winner
  function isWinner(candidateId: CandidateId): boolean {
    return winners.includes(candidateId);
  }

  // Get cluster hulls for background
  $: clusterHulls = (() => {
    const hulls: Array<{ points: string; color: string }> = [];
    
    for (let c = 0; c < numClusters; c++) {
      const clusterPoints: Array<{ x: number; y: number }> = [];
      for (let i = 0; i < positions.length; i++) {
        if (clusterAssignments[i] === c) {
          clusterPoints.push({
            x: toSvgX(positions[i].x),
            y: toSvgY(positions[i].y),
          });
        }
      }

      if (clusterPoints.length >= 3) {
        const hull = convexHull(clusterPoints);
        const expanded = expandHull(hull, 25);
        const pathPoints = expanded.map((p) => `${p.x},${p.y}`).join(" ");
        hulls.push({
          points: pathPoints,
          color: clusterColors[c % clusterColors.length],
        });
      }
    }

    return hulls;
  })();

  // Generate tooltip content
  function generateTooltip(candidateIdx: number): string {
    const candidateId = candidateRows[candidateIdx];
    const candidate = getCandidate(candidateId);
    const votes = getFirstRoundVotes(candidateId);
    const winnerStatus = isWinner(candidateId) 
      ? '<span style="color: #16a34a; font-weight: bold;">ELECTED</span>' 
      : '';

    // Find top second-choice candidates from firstAlternate
    const rowIdx = firstAlternate.rows.indexOf(candidateId);
    const topTransfers: Array<{ name: string; pct: number }> = [];
    
    if (rowIdx !== -1) {
      const entries = firstAlternate.entries[rowIdx];
      const colsWithFrac = firstAlternate.cols
        .map((col, i) => ({ col, frac: entries[i]?.frac ?? 0 }))
        .filter(({ col, frac }) => col !== "X" && col !== candidateId && frac > 0)
        .sort((a, b) => b.frac - a.frac)
        .slice(0, 3);
      
      for (const { col, frac } of colsWithFrac) {
        topTransfers.push({
          name: getCandidate(col as CandidateId).name,
          pct: Math.round(frac * 100),
        });
      }
    }

    const transferText = topTransfers.length > 0
      ? `<br/>Top 2nd choices: ${topTransfers.map(t => `${t.name} (${t.pct}%)`).join(", ")}`
      : "";

    return `
      <strong>${candidate.name}</strong> ${winnerStatus}<br/>
      First-round votes: <strong>${votes.toLocaleString()}</strong>${transferText}
    `;
  }

  // Handle hover (using index into candidateRows)
  function handleMouseEnter(idx: number) {
    hoveredCandidate = idx;
  }

  function handleMouseLeave() {
    hoveredCandidate = null;
  }
</script>

<style>
  .candidate-map {
    width: 100%;
    height: auto;
    display: block;
  }

  .cluster-hull {
    opacity: 0.1;
    stroke-width: 2;
    stroke-opacity: 0.3;
  }

  .candidate-node {
    cursor: pointer;
  }

  .candidate-node circle {
    transition: filter 0.15s ease-out;
  }

  .candidate-node.hovered circle:last-child {
    filter: brightness(1.15) drop-shadow(0 0 4px rgba(0, 0, 0, 0.3));
  }

  .candidate-node.dimmed {
    opacity: 0.3;
    transition: opacity 0.15s ease-out;
  }

  .candidate-label {
    font-size: 10px;
    pointer-events: none;
    user-select: none;
  }

  .candidate-label.winner {
    font-weight: bold;
  }

  .legend {
    font-size: 11px;
  }

  @media (prefers-color-scheme: dark) {
    .candidate-label {
      fill: #e3e3e3;
    }

    .cluster-hull {
      opacity: 0.15;
    }

    .legend text {
      fill: #e3e3e3;
    }
  }
</style>

{#if firstAlternate && positions.length > 0}
<svg viewBox={`0 0 ${width} ${height}`} class="candidate-map">
  <!-- Cluster background hulls -->
  {#each clusterHulls as hull, i (i)}
    <polygon
      class="cluster-hull"
      points={hull.points}
      fill={hull.color}
      stroke={hull.color}
    />
  {/each}

  <!-- Candidate nodes -->
  {#each candidateRows as candidateId, i (candidateId)}
    {@const pos = positions[i]}
    {@const radius = nodeRadius(candidateId)}
    {@const cluster = clusterAssignments[i]}
    {@const color = clusterColors[cluster % clusterColors.length]}
    {@const winner = isWinner(candidateId)}
    {@const isHovered = hoveredCandidate === i}
    {@const dimmed = hoveredCandidate !== null && !isHovered && clusterAssignments[hoveredCandidate] !== cluster}
    
    <g
      class="candidate-node"
      class:hovered={isHovered}
      class:dimmed
      role="button"
      tabindex="0"
      transform={`translate(${toSvgX(pos.x)}, ${toSvgY(pos.y)})`}
      on:mouseenter={() => handleMouseEnter(i)}
      on:mouseleave={handleMouseLeave}
      use:tooltip={generateTooltip(i)}
    >
      <!-- Invisible larger hit area for stable hovering -->
      <circle
        r={radius + 8}
        fill="transparent"
        stroke="none"
      />
      <!-- Visible circle -->
      <circle
        r={radius}
        fill={winner ? "#16a34a" : color}
        stroke={winner ? "#0f5132" : "white"}
        stroke-width={winner ? 3 : 1.5}
      />
    </g>
  {/each}

  <!-- Labels (rendered after nodes so they're on top) -->
  {#each candidateRows as candidateId, i (candidateId)}
    {@const pos = positions[i]}
    {@const radius = nodeRadius(candidateId)}
    {@const winner = isWinner(candidateId)}
    
    <text
      class="candidate-label"
      class:winner
      x={toSvgX(pos.x)}
      y={toSvgY(pos.y) + radius + 12}
      text-anchor="middle"
      dominant-baseline="hanging"
    >
      {getCandidate(candidateId).name.split(" ").pop()}
    </text>
  {/each}

  <!-- Legend -->
  <g transform={`translate(${width - 100}, 20)`} class="legend">
    <text font-weight="bold" font-size="12">Legend</text>
    <g transform="translate(0, 18)">
      <circle r="6" fill="#16a34a" stroke="#0f5132" stroke-width="2" />
      <text x="12" dominant-baseline="middle">Elected</text>
    </g>
    <g transform="translate(0, 38)">
      <circle r="6" fill="#2563eb" stroke="white" stroke-width="1" />
      <text x="12" dominant-baseline="middle">Not elected</text>
    </g>
  </g>
</svg>
{:else}
<p>No boost matrix data available for visualization.</p>
{/if}
