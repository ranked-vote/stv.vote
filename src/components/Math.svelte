<script lang="ts">
  import katex from 'katex';

  export let formula: string;
  export let displayMode: boolean = false;

  let html = '';

  $: {
    try {
      html = katex.renderToString(formula, {
        throwOnError: false,
        displayMode,
      });
    } catch (e) {
      html = formula;
    }
  }
</script>

<svelte:head>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.27/dist/katex.min.css" />
</svelte:head>

<span class="math" class:display={displayMode}>{@html html}</span>

<style>
  .math {
    font-size: 1em;
  }
  .math.display {
    display: block;
    text-align: center;
    margin: 0.5em 0;
  }
</style>
