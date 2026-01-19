<svelte:head>
	<title>About stv.vote</title>
</svelte:head>

<div class="container">
<div class="description">
  <h1><a href="/">stv.vote</a></h1>
</div>

<p>
  <a href="https://en.wikipedia.org/wiki/Single_transferable_vote">
    Single Transferable Vote elections
  </a>
  produce a lot of data about voter preferences. Typically, this information is
  made available by election boards in specialized file formats and requires
  processing to interpret. The purpose of stv.vote is to increase transparency into these
  elections by creating detailed and intuitive reports about them.
</p>

<p>
  All reports are generated from the raw ballot data, rather than using the
  official tabulation. As a result, the reports also serve as an independent
  tabulation of the results that can be reproduced using <a href="https://github.com/ranked-vote/stv.vote">published source code</a>.
</p>

<h2 id="how-stv-works">How STV Works</h2>

<p>
  In Single Transferable Vote (STV) elections, voters rank candidates in order of preference.
  The goal is to elect multiple candidates who represent a broad range of voter preferences.
</p>

<p>
  The process works as follows:
</p>

<ul>
  <li>
    A <strong>quota</strong> (votes needed to win) is calculated based on the number of seats
    and total ballots. This ensures that each elected candidate represents roughly the same
    proportion of voters.
  </li>
  <li>
    Candidates who reach the quota are elected. When a candidate exceeds the quota, their
    surplus votes are transferred to voters' next preferences.
  </li>
  <li>
    When no candidate reaches the quota, the candidate with the fewest votes is eliminated,
    and their votes are transferred to voters' next preferences.
  </li>
  <li>
    This process continues until all seats are filled.
  </li>
</ul>

<p>
  This system allows voters to support their preferred candidates without worrying about
  "wasting" their vote, since their ballot can be transferred to other candidates if their
  first choice is eliminated or has already won, as long as 
</p>

<h2 id="understanding-discrepancies">Understanding Discrepancies</h2>

<p>
  All of the analysis that goes into stv.vote reports is based only
  on ballot-level data. This includes the STV tabulation, which backs
  the "Runoff Rounds" section.
</p>

<p>
  In some cases, these tabulations don't match the official tabulations.
  There are two main reasons for this. First, there are multiple ways to
  tabulate an STV election. The main decisions are:
</p>

<ul>
  <li>
    Whether you remove a single candidate on each round, or all remaining
    candidates who are mathematically unable to win.
  </li>
  <li>
    Whether you stop eliminations when it is clear that one candidate has
    won, or whether you continue eliminating until only two candidates remain.
  </li>
</ul>

<p>
  These result in the same winner, but the count at each round may differ.
  For consistency and information density, we tabulate all elections the same
  way: all candidates who are unable to win are removed at each round, and
  we continue until two candidates remain.
</p>

<p>
  Another source of discrepancies is the handling of undervotes/overvotes and
  write-ins.
  To the extent possible, we follow the statutes in the relevant jurisdiction
  in order to treat ballots the same way that the elections
  board does. But statutes aren't code, so there are sometimes cases
  where there are ambiguities around edge cases. In particular, the treatment
  of write-in candidates can be a complicating factor, because many jurisdictions
  replace them with a generic "write in" dummy candidate, which does not always
  reflect how they are treated in the official tabulation.
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

<h2>Learning More</h2>

<p>
  To learn more about social choice theory and voting methods, check out
  <a href="https://ncase.me/ballot">Nicky Case's "Build a Better Ballot"</a>,
  an interactive guide to voting methods, and the
  <a href="https://electionscience.org">Center for Election Science</a>,
  which promotes evidence-based voting methods.
</p>

<h2>Contributing</h2>

<p>
  Contributions are welcome! The project is open source and available on
  <a href="https://github.com/ranked-vote/stv.vote">GitHub</a>. Please feel free to
  open issues, submit pull requests, or reach out with questions.
</p>

<h2>License</h2>

<p>
  This website and the data pipeline behind it (including the tabulator) are
  <a href="https://github.com/ranked-vote/stv.vote">open source</a> and liberally licensed. Website content and generated reports may
  be freely distributed with attribution under the <a href="https://creativecommons.org/licenses/by/2.0/">CC-BY</a> license.
</p>

<h2>Colophon</h2>

<p>
  The font is <a href="https://github.com/adobe-fonts/source-sans-pro">Source Sans Pro</a>.
</p>
</div>
