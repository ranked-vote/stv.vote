# 2025 Australian Senate formal preferences

Source: Australian Electoral Commission, 2025 federal election (event 31496),
"Senate formal preferences" downloads:
https://results.aec.gov.au/31496/Website/SenateDownloadsMenu-31496-Csv.htm
(`https://results.aec.gov.au/31496/Website/External/aec-senate-formalpreferences-31496-<STATE>.zip`).

Each `2025/<state>.json.gz` is built by
`bun scripts/convert-aec-senate.ts <zip>... --year 2025`. A below-the-line vote
numbering at least six candidates is used; otherwise the above-the-line vote is
used, each group standing for its candidates in ballot order. Identical
preference orders are grouped with a count.

SHA-256 of the source zips (downloaded 2026-11-22):

```
320b42fd26a45d8719efc9c54c5cc9f3d8b4370d95365b109fd2087beff1c28a  aec-senate-formalpreferences-31496-ACT.zip
0ad82e3067c0eddfdfa7df9dfc82b370d217c393f48b8c323006f936324396b0  aec-senate-formalpreferences-31496-NSW.zip
00526d34f8dd598c8453db2136de38117513b345ecadd982ce1ad1a60cc1d4fc  aec-senate-formalpreferences-31496-NT.zip
0a25d5015b7dbfcb05e3140c8a890a96aa323e1fce6c34596a384d6d87471c90  aec-senate-formalpreferences-31496-QLD.zip
f33526464953681e00cb99d1378dce5408db3962511d2f033952033d35983168  aec-senate-formalpreferences-31496-SA.zip
704b67fa2b754866086c6151694623069ce74364e3473aa1c2fd5fa812545523  aec-senate-formalpreferences-31496-TAS.zip
71cfd2168dc8295dfd33a19e321c2fe2d96edfb229d16a002e30e9d23e67aeca  aec-senate-formalpreferences-31496-VIC.zip
c8ce58e7bedcb2c0e26308adf871cc7d3d9c4cbe986b5105e4f59472f0947846  aec-senate-formalpreferences-31496-WA.zip
```
