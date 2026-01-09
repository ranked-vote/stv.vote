<script lang="ts">
	import type { PageData } from './$types';
	import ElectionIndex from '../components/ElectionIndex.svelte';

	export let data: PageData;
</script>

<svelte:head>
	<title>stv.vote: detailed reports on STV elections.</title>
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
