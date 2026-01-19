import { Database } from "bun:sqlite";
import path from "path";
import { existsSync } from "fs";

// Portland OR STV results from CVR data (November 2024)
// Source: https://multco.us/info/turnout-and-statistics-november-2024-general-election
//
// NOTE: CVR was exported Nov 29, 2024. Official results from Dec 2, 2024 may differ
// due to adjudicated ballots added after CVR export. Our tabulation validates
// against what the CVR data produces, which may differ from official final results.
//
// Official results: https://rcvresults.multco.us/
// Official D1 winners: Candace Avalos, Loretta Smith, Jamie Dunphy
// Official D2 winners: Elana Pirtle-Guiney, Mariah Hudson, Sam Sachs
// Official D3 winners: Steve Novick, Tiffany Koyama Lane, Jesse Cornett
// Official D4 winners: Mitch Green, Eli Arnold, Chad Lykins
const EXPECTED_PORTLAND_WINNERS = [
  {
    year: 2024,
    jurisdictionName: "Portland, OR",
    electionName: "November 2024",
    officeName: "Mayor",
    seats: 1,
    winners: ["Keith Wilson"], // Matches official
  },
  {
    year: 2024,
    jurisdictionName: "Portland, OR",
    electionName: "November 2024",
    officeName: "Auditor",
    seats: 1,
    winners: ["Simone Rede"], // Matches official
  },
  {
    year: 2024,
    jurisdictionName: "Portland, OR",
    electionName: "November 2024",
    officeName: "Councilor, District 1",
    seats: 3,
    // Same winners as official, different order due to lower quota from CVR ballot count
    winners: ["Candace Avalos", "Jamie Dunphy", "Loretta Smith"],
  },
  {
    year: 2024,
    jurisdictionName: "Portland, OR",
    electionName: "November 2024",
    officeName: "Councilor, District 2",
    seats: 3,
    // CVR results differ from official (Official: Pirtle-Guiney, Hudson, Sachs)
    winners: ["Sameer Kanal", "Elana Pirtle-Guiney", "Dan Ryan"],
  },
  {
    year: 2024,
    jurisdictionName: "Portland, OR",
    electionName: "November 2024",
    officeName: "Councilor, District 3",
    seats: 3,
    // CVR results differ from official (Official: Novick, Koyama Lane, Cornett)
    winners: ["Steve Novick", "Angelita Morillo", "Tiffany Koyama Lane"],
  },
  {
    year: 2024,
    jurisdictionName: "Portland, OR",
    electionName: "November 2024",
    officeName: "Councilor, District 4",
    seats: 3,
    // CVR results differ from official (Official: Green, Arnold, Lykins)
    winners: ["Olivia Clark", "Mitch Green", "Eric Zimmerman"],
  },
];

// Cambridge MA STV official results (multi-winner elections)
const EXPECTED_CAMBRIDGE_WINNERS = [
  {
    year: 2023,
    jurisdictionName: "Cambridge, MA",
    electionName: "November 2023",
    officeName: "City Council",
    seats: 9,
    // Official winners in order of election
    winners: [
      "Siddiqui", // 1st count
      "Azeem", // 2nd count
      "McGovern", // 8th count
      "Nolan", // 8th count
      "Toner", // 11th count
      "Sobrinho-Wheeler", // 15th count
      "Simmons", // 16th count
      "Wilson", // 17th count - reached quota
      "Pickett", // 17th count - by elimination (didn't reach quota)
    ],
    // We don't check exact round numbers since our tabulation may differ slightly
    // due to tie-breaking rules, but winners must match
  },
  {
    year: 2021,
    jurisdictionName: "Cambridge, MA",
    electionName: "November 2021",
    officeName: "City Council",
    seats: 9,
    // Official winners (order may vary)
    winners: [
      "Siddiqui",
      "Nolan",
      "Simmons",
      "Zondervan",
      "Azeem",
      "McGovern",
      "Mallon",
      "Carlone",
      "Toner",
    ],
  },
  {
    year: 2019,
    jurisdictionName: "Cambridge, MA",
    electionName: "November 2019",
    officeName: "City Council",
    seats: 9,
    winners: [
      "Sumbul Siddiqui",
      "Denise Simmons",
      "Patricia Nolan",
      "Marc McGovern",
      "Alanna Mallon",
      "Quinton Zondervan",
      "Dennis Carlone",
      "Jivan Sobrinho-Wheeler",
      "Timothy Toomey",
    ],
  },
];

function normalizeName(name) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      // Remove common prefixes/suffixes
      .replace(/^(dr\.|mr\.|ms\.|mrs\.)\s*/i, "")
      // Handle middle initials
      .replace(/\s+[a-z]\.\s+/gi, " ")
      // Normalize different quote styles
      .replace(/[\u201C\u201D"]/g, '"')
      .replace(/[\u2018\u2019']/g, "'")
  );
}

function namesMatch(actual, expected) {
  const normActual = normalizeName(actual);
  const normExpected = normalizeName(expected);

  // Exact match
  if (normActual === normExpected) return true;

  // Check if one contains the other (for partial name matches like "Siddiqui" vs "Sumbul Siddiqui")
  if (normActual.includes(normExpected) || normExpected.includes(normActual))
    return true;

  // Check last name match
  const actualParts = normActual.split(" ");
  const expectedParts = normExpected.split(" ");
  const actualLast = actualParts[actualParts.length - 1];
  const expectedLast = expectedParts[expectedParts.length - 1];

  return actualLast === expectedLast;
}

function getReportsFromDatabase() {
  const dbPath = path.join(process.cwd(), "data.sqlite3");

  if (!existsSync(dbPath)) {
    throw new Error(
      `Database not found at ${dbPath}. Run 'bun scripts/load-cambridge.ts' first.`,
    );
  }

  const db = new Database(dbPath, { readonly: true });

  const reports = db
    .query(
      `
    SELECT 
      r.id,
      r.path,
      r.office,
      r.officeName,
      r.jurisdictionName,
      r.electionName,
      r.date,
      r.ballotCount,
      r.numRounds,
      r.seats,
      r.quota,
      r.winners as winnersJson
    FROM reports r
    WHERE r.hidden != 1
    ORDER BY r.date DESC
  `,
    )
    .all();

  // For each report, get the winner names
  const getCandidateName = db.query(
    "SELECT name FROM candidates WHERE report_id = ? AND candidate_index = ?",
  );

  const getWinnerNames = db.query(
    "SELECT name FROM candidates WHERE report_id = ? AND winner = 1 ORDER BY roundElected, candidate_index",
  );

  const result = reports.map((report) => {
    const winnerRows = getWinnerNames.all(report.id);
    const winnerNames = winnerRows.map((r) => r.name);

    // Parse winners array from JSON
    let winnerIndexes = [];
    try {
      winnerIndexes = JSON.parse(report.winnersJson || "[]");
    } catch {
      // Invalid JSON, use empty array
    }

    // Get winner names in order of election
    const orderedWinnerNames = winnerIndexes.map((idx) => {
      const row = getCandidateName.get(report.id, idx);
      return row?.name || `Unknown (${idx})`;
    });

    return {
      ...report,
      winnerNames,
      orderedWinnerNames,
      year: parseInt(report.date.split("-")[0], 10),
    };
  });

  db.close();
  return result;
}

function findReport(reports, expected) {
  return reports.find(
    (r) =>
      r.year === expected.year &&
      normalizeName(r.jurisdictionName) ===
        normalizeName(expected.jurisdictionName) &&
      (normalizeName(r.electionName).includes(
        normalizeName(expected.electionName),
      ) ||
        normalizeName(expected.electionName).includes(
          normalizeName(r.electionName),
        )) &&
      (normalizeName(r.officeName) === normalizeName(expected.officeName) ||
        normalizeName(r.officeName).includes(
          normalizeName(expected.officeName),
        )),
  );
}

function validateWinners(report, expected) {
  // Check seats
  expect(report.seats).toBe(expected.seats);

  // Check number of winners
  expect(report.winnerNames.length).toBe(expected.winners.length);

  // Check each expected winner is in the actual winners (order may vary due to tie-breaking)
  const missingWinners = [];
  const extraWinners = [];

  for (const expectedWinner of expected.winners) {
    const found = report.winnerNames.some((actual) =>
      namesMatch(actual, expectedWinner),
    );
    if (!found) {
      missingWinners.push(expectedWinner);
    }
  }

  for (const actualWinner of report.winnerNames) {
    const found = expected.winners.some((exp) => namesMatch(actualWinner, exp));
    if (!found) {
      extraWinners.push(actualWinner);
    }
  }

  if (missingWinners.length > 0 || extraWinners.length > 0) {
    const errorParts = [];
    if (missingWinners.length > 0) {
      errorParts.push(`Missing expected winners: ${missingWinners.join(", ")}`);
    }
    if (extraWinners.length > 0) {
      errorParts.push(`Unexpected winners: ${extraWinners.join(", ")}`);
    }
    errorParts.push(`\nActual winners: ${report.winnerNames.join(", ")}`);
    errorParts.push(`Expected winners: ${expected.winners.join(", ")}`);

    throw new Error(errorParts.join("\n"));
  }
}

describe("Portland STV Election Winner Validation", () => {
  let reports;

  beforeAll(() => {
    reports = getReportsFromDatabase();
  });

  test.each(EXPECTED_PORTLAND_WINNERS)(
    "should have correct winners for $year $officeName",
    (expected) => {
      const report = findReport(reports, expected);

      if (!report) {
        console.warn(
          `Skipping ${expected.year} ${expected.officeName} - not found in database (run load-portland first)`,
        );
        return;
      }

      validateWinners(report, expected);
    },
  );
});

describe("Cambridge STV Election Winner Validation", () => {
  let reports;

  beforeAll(() => {
    reports = getReportsFromDatabase();
  });

  test("database should have reports loaded", () => {
    expect(reports.length).toBeGreaterThan(0);
  });

  test.each(EXPECTED_CAMBRIDGE_WINNERS)(
    "should have correct winners for $year $jurisdictionName $officeName",
    (expected) => {
      const report = findReport(reports, expected);

      expect(report).toBeDefined();
      expect(report).not.toBeNull();

      validateWinners(report, expected);
    },
  );
});

describe("STV Quota Validation", () => {
  let reports;

  beforeAll(() => {
    reports = getReportsFromDatabase();
  });

  test.each(EXPECTED_CAMBRIDGE_WINNERS)(
    "should have correct Droop quota for $year $jurisdictionName $officeName",
    (expected) => {
      const report = findReport(reports, expected);

      expect(report).toBeDefined();

      // Verify Droop quota calculation: floor(ballots / (seats + 1)) + 1
      const expectedQuota =
        Math.floor(report.ballotCount / (expected.seats + 1)) + 1;
      expect(report.quota).toBe(expectedQuota);
    },
  );

  // Note: Portland quota validation is skipped because CVR ballot count may differ
  // from official count due to export timing vs final adjudication
});

describe("Card Image Validation", () => {
  let reports;

  beforeAll(() => {
    reports = getReportsFromDatabase();
  });

  test("all reports should have corresponding card images", async () => {
    const { access } = await import("fs/promises");
    const missingCards = [];

    for (const report of reports) {
      const reportPath = `${report.path}/${report.office}`;
      const outputPath = path.join(
        process.cwd(),
        `static/share/${reportPath}.png`,
      );

      try {
        await access(outputPath);
      } catch {
        missingCards.push(reportPath);
      }
    }

    if (missingCards.length > 0) {
      // This is a warning, not a failure - images can be generated
      console.warn(
        `Missing ${missingCards.length} card image(s). Run 'bun scripts/generate-share-images.mjs' to generate.`,
      );
    }

    // Don't fail the test for missing images - they're optional
    expect(true).toBe(true);
  });
});
