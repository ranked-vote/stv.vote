# Albany, California — November 2026

This directory contains contest-scoped NIST SP 1500-103 cast-vote records for
Albany's two proportional ranked-choice voting contests:

- Contest 102: City Council, 2 seats
- Contest 103: Board of Education, 4 seats

The files were derived without changing ballot marks from Alameda County's
November 3, 2026 JSON CVR export (`CVR_Export_20261116173643`, Post Election
Update #4, November 16, 2026). This is a preliminary release; the count was not
yet certified. Sessions and contest marks unrelated to contests 102 and 103
were removed to keep the committed source compact.

Source: <https://alamedacountyca.gov/rovresults/rcv/260>

To reproduce the filtered data from an extracted full county export:

```bash
bun scripts/filter-nist-cvr.ts /path/to/full-cvr raw-data/us/albany-ca/2026 102 103
```
