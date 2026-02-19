<script lang="ts">
  import { onMount } from 'svelte';

  let datasetteLoaded = false;
  let iframeRef: HTMLIFrameElement | null = null;
  let datasetteSrc: string | null = null;

  onMount(() => {
    datasetteSrc = 'https://lite.datasette.io/?url=https://stv.vote/data.sqlite3';
    datasetteLoaded = true;
  });
</script>

<svelte:head>
  <title>Database Explorer - stv.vote</title>
  <meta
    name="description"
    content="Explore the stv.vote election database using Datasette Lite"
  />
</svelte:head>

<div class="container">
  <h1>Database Explorer</h1>
  <p>
    Explore the stv.vote election database using Datasette Lite. This is a client-side SQLite
    explorer that runs entirely in your browser.
  </p>

  {#if datasetteLoaded && datasetteSrc}
    <iframe
      bind:this={iframeRef}
      src={datasetteSrc}
      style="width: 100%; height: 800px; border: 1px solid #ddd; border-radius: 4px;"
      title="Datasette Lite Database Explorer"
    ></iframe>
  {:else}
    <div class="loading">Loading Datasette Lite...</div>
  {/if}

  <div class="info">
    <h2>About this database</h2>
    <p>
      This database contains election reports, candidates, rounds, allocations, and transfer data
      for single transferable vote elections.
    </p>
    <p>
      <strong>Note:</strong> Datasette Lite downloads the entire database file to your browser. The
      initial load may take a moment depending on your connection.
    </p>
  </div>
</div>

<style>
  .container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 2rem;
  }

  h1 {
    margin-bottom: 1rem;
  }

  .info {
    margin-top: 2rem;
    padding: 1.5rem;
    background: #f5f5f5;
    border-radius: 4px;
  }

  .info h2 {
    margin-top: 0;
    font-size: 1.2em;
  }

  .loading {
    text-align: center;
    padding: 2rem;
    color: #666;
  }

  @media (prefers-color-scheme: dark) {
    .info {
      background: #2a2a2a;
    }
  }
</style>

