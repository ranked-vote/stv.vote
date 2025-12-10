# ranked.vote Report Pipeline

A Rust-based system for processing and analyzing ranked-choice voting (RCV) election data. This pipeline converts raw ballot data from various formats into standardized reports.

## Project Structure

- `election-metadata/` - Election configuration files (committed to git)
- `reports/` - Generated election reports (committed to git)
- `archives/` - Compressed raw ballot data (committed to git via Git LFS)
- `raw-data/` - Uncompressed working directory (gitignored, extracted from archives)
- `preprocessed/` - Processed ballot data (generated, gitignored)

## Setup

1. Install dependencies:
   - Rust (latest stable)
   - Git LFS (for downloading compressed archives)

2. Clone the repository:

```bash
git clone https://github.com/ranked-vote/ranked.vote.git
cd ranked.vote
```

3. Extract election data from archives:

```bash
# From project root:
bun run report:extract

# Or from report_pipeline directory:
cd report_pipeline
./extract-from-archives.sh
```

This extracts compressed archives from `archives/` (managed by Git LFS) into the `raw-data/` working directory.

## Usage

### Processing Election Data

1. Extract raw data from archives (if not already done):

```bash
# From project root:
bun run report:extract

# Or from report_pipeline directory:
./extract-from-archives.sh
```

2. Sync raw data with metadata:

```bash
# From project root (recommended):
bun run report:sync

# Or from report_pipeline directory:
./sync.sh
```

3. Generate reports:

```bash
# From project root (recommended):
bun run report

# Or from report_pipeline directory:
./report.sh
```

Note: When run from the project root with `bun run report`, card images are automatically generated after reports are created.

## Adding Election Data

### 1. Prepare Election Metadata

Create or modify the jurisdiction metadata file in `election-metadata/` following this structure:

- US jurisdictions: `us/{state}/{city}.json` (e.g., `us/ca/sfo.json`)
- Other locations: `{country}/{region}/{city}.json`

The metadata file must specify:

- Data format (see supported formats below)
- Election date
- Offices and contests
- Loader parameters specific to the format

### 2. Prepare Raw Data

1. Create the corresponding directory structure in `raw-data/` matching your metadata path
2. Add your raw ballot data files in the correct format:
   - San Francisco (NIST SP 1500): ZIP containing CVR exports
   - Maine: Excel workbooks
   - NYC: Excel workbooks with candidate mapping
   - Dominion RCR: CSV files
   - Simple JSON: JSON files following the schema

Example structure:

```text
raw-data/
└── us/
    └── ca/
        └── sfo/
            └── 2023/
                └── 11/
                    ├── mayor/
                    │   └── cvr.zip
                    └── supervisor/
                        └── cvr.zip
```

### 3. Process and Verify

1. Run `./sync.sh` to:
   - Verify directory structure
   - Generate file hashes
   - Update metadata

2. Run `./report.sh` to:
   - Convert raw data to normalized format
   - Generate analysis reports
   - Verify data integrity

3. Check generated files:
   - Preprocessed data: `preprocessed/{jurisdiction_path}/normalized.json.gz`
   - Reports: `reports/{jurisdiction_path}/report.json`

### 4. Compress and Commit Changes

1. Compress raw data to archives:

   ```bash
   ./compress-to-archives.sh
   ```

   This creates compressed `.tar.xz` files in `archives/` from `raw-data/`.

2. Commit changes:

   ```bash
   git add election-metadata/
   git add reports/
   git add archives/
   git commit -m "Add {jurisdiction} {date} election"
   git push
   ```

   Note: Archives are managed by Git LFS and will be automatically handled when you push.

### Supported Data Formats

The pipeline supports the following data formats:

- `us_ca_sfo`: San Francisco format (legacy)
- `nist_sp_1500`: NIST SP 1500-103 standard format (used by San Francisco and others)
- `us_me`: Maine state format (Excel-based)
- `us_vt_btv`: Burlington, VT format
- `us_mn_mpls`: Minneapolis format
- `dominion_rcr`: Dominion RCV format
- `us_ny_nyc`: NYC Board of Elections format (Excel-based)
- `simple_json`: Simple JSON format for testing and small elections
- `preflib`: PrefLib ordinal preference format (TOI/SOI)

For format-specific requirements and examples, see the source code in `src/formats/`.

### NYC Data Ingestion Process

For NYC elections, follow this specific process:

1. **Download Data from NYC BOE**:
   - Visit the [NYC Board of Elections results page](https://www.vote.nyc/page/election-results-summary-2023)
   - Download the Excel files for the election (typically named like `2023P1V1_ELE.xlsx`, `2023P_CandidacyID_To_Name.xlsx`, etc.)

2. **Create Directory Structure**:

   ```bash
   mkdir -p raw-data/us/ny/nyc/2023/06
   ```

3. **Add Raw Data Files**:
   - Place all Excel files in `raw-data/us/ny/nyc/2023/06/`
   - Files typically include:
     - `2023P_CandidacyID_To_Name.xlsx` - Candidate mapping file
     - `2023P1V1_ELE.xlsx`, `2023P1V1_EAR.xlsx`, `2023P1V1_OTH.xlsx` - Round 1 data
     - `2023P2V1_ELE.xlsx`, `2023P2V1_EAR.xlsx`, `2023P2V1_OTH.xlsx` - Round 2 data
     - Additional rounds as needed

4. **Update Election Metadata**:
   - Edit `election-metadata/us/ny/nyc.json`
   - Add the new election entry with:
     - Election date and name
     - Contest definitions for all offices (Mayor, Comptroller, Public Advocate, Borough Presidents, Council Members)
     - Loader parameters specifying the candidate file and CVR pattern
     - File hashes (see next step)

5. **Generate File Hashes**:

   ```bash
   cd raw-data/us/ny/nyc/2023/06
   mkdir -p hashfiles
   for file in *.xlsx; do
     certutil -hashfile "$file" SHA256 > "hashfiles/${file}_SHA256.txt"
   done
   ```

   Extract SHA256 hashes and update the `files` section in `election-metadata/us/ny/nyc.json` with filename-to-hash mappings.

6. **Process Data**:

   ```bash
   # From project root (recommended):
   bun run report:sync    # Verify metadata and file hashes
   bun run report         # Generate reports and card images

   # Or from report_pipeline directory:
   ./sync.sh    # Verify metadata and file hashes
   ./report.sh  # Generate reports and card images
   ```

7. **Compress and Commit**:
   ```bash
   ./compress-to-archives.sh
   git add archives/us/ny/nyc/2023/06/
   git add reports/us/ny/nyc/2023/06/
   git commit -m "Add NYC June 2023 election"
   git push
   ```

The NYC format uses Excel workbooks with specific naming patterns that the loader recognizes automatically based on the `cvrPattern` specified in the metadata.

## Data Flow

1. Compressed archives (Git LFS) → `archives/` (committed to git)
2. Extract archives → `raw-data/` (working directory, gitignored)
3. Processing pipeline converts to standardized format → `preprocessed/` (generated)
4. Report generation creates detailed analysis → `reports/` (committed to git)
5. Web interface displays results

## Managing Archives

### Extracting Data

To extract compressed archives into the working directory:

```bash
./extract-from-archives.sh
```

This reads `.tar.xz` files from `archives/` and extracts them to `raw-data/`.

### Compressing Data

To compress raw data into archives for git:

```bash
./compress-to-archives.sh
```

This creates compressed `.tar.xz` files in `archives/` from `raw-data/`. The script:

- Only archives files referenced in election metadata
- Uses parallel compression for performance
- Skips files that haven't changed
- Excludes PDFs and other unnecessary files

Archives are managed by Git LFS and should be committed to the repository.

## License

Website content and generated reports may be freely distributed with attribution under the CC-BY license.

## Analysis Tools

For analyzing large Excel files (especially NYC Board of Elections data), we recommend using the [`sxl`](https://github.com/ktr/sxl) Python library instead of pandas or openpyxl. The `sxl` library uses streaming parsing to handle very large Excel files without loading them entirely into memory, providing much better performance characteristics.

### Installing sxl

```bash
pip install sxl
```

### Example Usage

```python
from sxl import Workbook

# Open a large Excel file efficiently
wb = Workbook("path/to/large_file.xlsx")
ws = wb.sheets['Sheet1']  # Access sheet by name or index

# Stream through rows without loading entire file into memory
for row in ws.rows:
    print(row)

# Or just examine the first few rows
head = ws.head(10)
print(head)
```

This is particularly beneficial when working with NYC election data files, which can be very large and contain hundreds of thousands of ballots.

## Contributing

This is an open source project. For more information about contributing, please see the [about page](https://ranked.vote/about).

## Author

Created and maintained by [Paul Butler](https://paulbutler.org) and [Felix Sargent](https://felixsargent.com).
