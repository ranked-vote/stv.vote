<script lang="ts">
	import type { PageData } from './$types';
	import ElectionIndex from '../components/ElectionIndex.svelte';

	export let data: PageData;
</script>

<svelte:head>
	<title>stv.vote: detailed reports on STV elections.</title>
	<meta name="description" content="Single Transferable Vote elections produce more data on voter preferences than pick-one elections. stv.vote runs analysis on ballot-level data and publishes reports on each election." />

	<meta property="og:title" content="stv.vote: detailed reports on STV elections" />
	<meta property="og:description" content="Single Transferable Vote elections produce more data on voter preferences than pick-one elections. stv.vote runs analysis on ballot-level data and publishes reports on each election." />
	<meta property="og:image" content="https://stv.vote/share/homepage.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:url" content="https://stv.vote/" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="stv.vote" />

	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="stv.vote: detailed reports on STV elections" />
	<meta name="twitter:description" content="Single Transferable Vote elections produce more data on voter preferences than pick-one elections. stv.vote runs analysis on ballot-level data and publishes reports on each election." />
	<meta name="twitter:image" content="https://stv.vote/share/homepage.png" />
	<meta name="twitter:url" content="https://stv.vote/" />
</svelte:head>

<div class="wide container">
<div class="row">
  <div class="leftCol">
    <div class="description">
      <h1>stv.vote</h1>:
      detailed reports on Single Transferable Vote elections.
    </div>
    <p>
      Single Transferable Vote elections produce more data on voter preferences than
      pick-one elections. <strong>stv.vote</strong> runs analysis on the
      ballot-level data and publishes reports on each election.
    </p>

    <p>
      stv.vote was created by
      <a href="https://felixsargent.com">Felix Sargent</a>.
      It is non-partisan and has received no outside funding.
    </p>

    <p>If you enjoy alternate voting systems, you may also enjoy
      <a href="https://approval.vote">approval.vote</a>,
      which is a similar project for approval voting elections.
    </p>

    <p>
      For more information, see the <a href="/about">about page</a>.
    </p>
  </div>

  <div class="rightCol">
    <ElectionIndex elections={data.elections} />
  </div>
</div>
</div>
