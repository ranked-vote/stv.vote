# Albany, California — November 2024

This directory contains contest-scoped NIST SP 1500-103 cast-vote records for
Albany's two proportional ranked-choice voting contests:

- Contest 85: City Council, 3 seats
- Contest 86: Board of Education, 2 seats

The files were derived without changing ballot marks from Alameda County's
official November 5, 2024 JSON CVR export. Sessions and contest marks unrelated
to contests 85 and 86 were removed to keep the committed source compact.

Source: <https://alamedacountyca.gov/rovresults/rcv/252>

To reproduce the filtered data from an extracted full county export:

```bash
bun scripts/filter-nist-cvr.ts /path/to/full-cvr raw-data/us/albany-ca/2024 85 86
```
