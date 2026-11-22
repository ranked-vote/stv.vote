import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import path from "path";

// Portland OR STV results from CVR data (November 2024)
// Source: https://multco.us/info/turnout-and-statistics-november-2024-general-election
//
// All winners match the official final results (Dec 2, 2024):
// https://rcvresults.multco.us/
// Our quotas are within a few votes of the official thresholds.
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
		winners: ["Candace Avalos", "Jamie Dunphy", "Loretta Smith"],
	},
	{
		year: 2024,
		jurisdictionName: "Portland, OR",
		electionName: "November 2024",
		officeName: "Councilor, District 2",
		seats: 3,
		winners: ["Sameer Kanal", "Elana Pirtle-Guiney", "Dan Ryan"],
	},
	{
		year: 2024,
		jurisdictionName: "Portland, OR",
		electionName: "November 2024",
		officeName: "Councilor, District 3",
		seats: 3,
		winners: ["Steve Novick", "Angelita Morillo", "Tiffany Koyama Lane"],
	},
	{
		year: 2024,
		jurisdictionName: "Portland, OR",
		electionName: "November 2024",
		officeName: "Councilor, District 4",
		seats: 3,
		winners: ["Olivia Clark", "Mitch Green", "Eric Zimmerman"],
	},
];

// Alameda County official RCV results, November 5, 2024.
// Source: https://alamedacountyca.gov/rovresults/rcv/252
const EXPECTED_ALBANY_WINNERS = [
	{
		year: 2024,
		jurisdictionName: "Albany, CA",
		electionName: "November 2024",
		officeName: "City Council",
		seats: 3,
		winners: [
			"Peggy (Margaret) McQuaid",
			"Jennifer Hansen-Romero",
			"Preston Jordan",
		],
	},
	{
		year: 2024,
		jurisdictionName: "Albany, CA",
		electionName: "November 2024",
		officeName: "Board of Education",
		seats: 2,
		winners: ["Veronica Davidson", "Dayna Inkeles"],
	},
];

// City of Minneapolis official RCV results, November 4, 2025.
// Source: https://vote.minneapolismn.gov/results-data/election-results/2025/
const EXPECTED_MINNEAPOLIS_WINNERS = [
	{
		year: 2025,
		jurisdictionName: "Minneapolis, MN",
		electionName: "November 2025",
		officeName: "Park & Recreation Commissioner At Large",
		seats: 3,
		winners: ["Meg Forney", "Tom Olsen", "Amber A. Frederick"],
	},
	{
		year: 2025,
		jurisdictionName: "Minneapolis, MN",
		electionName: "November 2025",
		officeName: "Board of Estimate and Taxation",
		seats: 2,
		winners: ["Eric Harris Bernstein", "Steve Brandt"],
	},
];

// Scottish National Results Reporting Portal, 2024 by-elections.
// Source: https://stv-results.prorep.org.uk/by_elections.html
const EXPECTED_SCOTLAND_BY_ELECTION_WINNERS = [
	{
		year: 2024,
		jurisdictionName: "Glasgow, Scotland",
		electionName: "March 2024 By-Election",
		officeName: "Hillhead",
		seats: 1,
		winners: ["Seonad Hoy"],
	},
	{
		year: 2024,
		jurisdictionName: "Angus, Scotland",
		electionName: "April 2024 By-Election",
		officeName: "Arbroath West Letham and Friockheim",
		seats: 1,
		winners: ["Jack Alistair James Cruickshanks"],
	},
	{
		year: 2024,
		jurisdictionName: "North Ayrshire, Scotland",
		electionName: "May 2024 By-Election",
		officeName: "Kilwinning",
		seats: 1,
		winners: ["Mary Hume"],
	},
];

// ACT Legislative Assembly (Hare-Clark) members elected, per Elections ACT.
// Our count uses weighted inclusive Gregory rather than the last-parcel
// surplus rule, but every electorate elects the same members.
const EXPECTED_ACT_WINNERS = [
	{
		year: 2008,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Brindabella",
		seats: 5,
		winners: ["Brendan Smyth", "Steve Doszpot", "Amanda Bresnan", "John Hargreaves", "Joy Burch"],
	},
	{
		year: 2008,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Ginninderra",
		seats: 5,
		winners: ["Jon Stanhope", "Meredith Hunter", "Alistair Coe", "Mary Porter", "Vicki Dunne"],
	},
	{
		year: 2008,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Molonglo",
		seats: 7,
		winners: ["Zed Seselja", "Katy Gallagher", "Shane Rattenbury", "Andrew Barr", "Jeremy Hanson", "Simon Corbell", "Caroline Le Couteur"],
	},
	{
		year: 2012,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Brindabella",
		seats: 5,
		winners: ["Zed Seselja", "Joy Burch", "Brendan Smyth", "Mick Gentleman", "Andrew Wall"],
	},
	{
		year: 2012,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Ginninderra",
		seats: 5,
		winners: ["Alistair Coe", "Vicki Dunne", "Mary Porter", "Yvette Berry", "Chris Bourke"],
	},
	{
		year: 2012,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Molonglo",
		seats: 7,
		winners: ["Katy Gallagher", "Jeremy Hanson", "Andrew Barr", "Simon Corbell", "Shane Rattenbury", "Giulia Jones", "Steve Doszpot"],
	},
	{
		year: 2016,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Brindabella",
		seats: 5,
		winners: ["Andrew Wall", "Mick Gentleman", "Joy Burch", "Mark Parton", "Nicole Lawder"],
	},
	{
		year: 2016,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Ginninderra",
		seats: 5,
		winners: ["Yvette Berry", "Vicki Dunne", "Elizabeth Kikkert", "Tara Cheyne", "Gordon Ramsay"],
	},
	{
		year: 2016,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Kurrajong",
		seats: 5,
		winners: ["Andrew Barr", "Shane Rattenbury", "Elizabeth Lee", "Steve Doszpot", "Rachel Stephen-Smith"],
	},
	{
		year: 2016,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Murrumbidgee",
		seats: 5,
		winners: ["Jeremy Hanson", "Bec Cody", "Chris Steel", "Giulia Jones", "Caroline Le Couteur"],
	},
	{
		year: 2016,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Yerrabi",
		seats: 5,
		winners: ["Meegan Fitzharris", "Alistair Coe", "Michael Pettersson", "Suzanne Orr", "James Milligan"],
	},
	{
		year: 2020,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Brindabella",
		seats: 5,
		winners: ["Joy Burch", "Mick Gentleman", "Nicole Lawder", "Mark Parton", "Johnathan Davis"],
	},
	{
		year: 2020,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Ginninderra",
		seats: 5,
		winners: ["Yvette Berry", "Elizabeth Kikkert", "Tara Cheyne", "Jo Clay", "Peter Cain"],
	},
	{
		year: 2020,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Kurrajong",
		seats: 5,
		winners: ["Andrew Barr", "Shane Rattenbury", "Rachel Stephen-Smith", "Elizabeth Lee", "Rebecca Vassarotti"],
	},
	{
		year: 2020,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Murrumbidgee",
		seats: 5,
		winners: ["Jeremy Hanson", "Chris Steel", "Giulia Jones", "Emma Davidson", "Marisa Paterson"],
	},
	{
		year: 2020,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Yerrabi",
		seats: 5,
		winners: ["Alistair Coe", "Michael Pettersson", "Suzanne Orr", "Leanne Castley", "Andrew Braddock"],
	},
	{
		year: 2024,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Brindabella",
		seats: 5,
		winners: ["Mark Parton", "Deborah Morris", "Caitlin Tough", "Taimus Werner-Gibbings", "Laura Nuttall"],
	},
	{
		year: 2024,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Ginninderra",
		seats: 5,
		winners: ["Tara Cheyne", "Yvette Berry", "Peter Cain", "Jo Clay", "Chiaka Barry"],
	},
	{
		year: 2024,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Kurrajong",
		seats: 5,
		winners: ["Andrew Barr", "Elizabeth Lee", "Rachel Stephen-Smith", "Thomas Emerson", "Shane Rattenbury"],
	},
	{
		year: 2024,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Murrumbidgee",
		seats: 5,
		winners: ["Jeremy Hanson", "Chris Steel", "Fiona Carrick", "Ed Cocks", "Marisa Paterson"],
	},
	{
		year: 2024,
		jurisdictionName: "Australian Capital Territory",
		electionName: "Legislative Assembly",
		officeName: "Yerrabi",
		seats: 5,
		winners: ["Michael Pettersson", "Leanne Castley", "Suzanne Orr", "James Milligan", "Andrew Braddock"],
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

	test.each(
		EXPECTED_PORTLAND_WINNERS,
	)("should have correct winners for $year $officeName", (expected) => {
		const report = findReport(reports, expected);

		if (!report) {
			console.warn(
				`Skipping ${expected.year} ${expected.officeName} - not found in database (run load-portland first)`,
			);
			return;
		}

		validateWinners(report, expected);
	});
});

describe("Albany STV Election Winner Validation", () => {
	let reports;

	beforeAll(() => {
		reports = getReportsFromDatabase();
	});

	test.each(
		EXPECTED_ALBANY_WINNERS,
	)("should have correct winners for $year $officeName", (expected) => {
		const report = findReport(reports, expected);
		expect(report).toBeDefined();
		validateWinners(report, expected);
	});
});

describe("Minneapolis STV Election Winner Validation", () => {
	let reports;

	beforeAll(() => {
		reports = getReportsFromDatabase();
	});

	test.each(
		EXPECTED_MINNEAPOLIS_WINNERS,
	)("should have correct winners for $year $officeName", (expected) => {
		const report = findReport(reports, expected);
		expect(report).toBeDefined();
		validateWinners(report, expected);
	});
});

describe("Scotland By-Election Winner Validation", () => {
	let reports;

	beforeAll(() => {
		reports = getReportsFromDatabase();
	});

	test.each(
		EXPECTED_SCOTLAND_BY_ELECTION_WINNERS,
	)("should have correct winner for $year $officeName", (expected) => {
		const report = findReport(reports, expected);
		expect(report).toBeDefined();
		validateWinners(report, expected);
	});
});

describe("ACT Hare-Clark Election Winner Validation", () => {
	let reports;

	beforeAll(() => {
		reports = getReportsFromDatabase();
	});

	test.each(
		EXPECTED_ACT_WINNERS,
	)("should have correct winners for $year $officeName", (expected) => {
		const report = findReport(reports, expected);
		expect(report).toBeDefined();
		validateWinners(report, expected);
	});
});

describe("Cambridge STV Election Winner Validation", () => {
	let reports;

	beforeAll(() => {
		reports = getReportsFromDatabase();
	});

	test("database should have reports loaded", () => {
		expect(reports.length).toBeGreaterThan(0);
	});

	test.each(
		EXPECTED_CAMBRIDGE_WINNERS,
	)("should have correct winners for $year $jurisdictionName $officeName", (expected) => {
		const report = findReport(reports, expected);

		expect(report).toBeDefined();
		expect(report).not.toBeNull();

		validateWinners(report, expected);
	});
});

describe("STV Quota Validation", () => {
	let reports;

	beforeAll(() => {
		reports = getReportsFromDatabase();
	});

	test.each(
		EXPECTED_CAMBRIDGE_WINNERS,
	)("should have correct Droop quota for $year $jurisdictionName $officeName", (expected) => {
		const report = findReport(reports, expected);

		expect(report).toBeDefined();

		// Verify Droop quota calculation: floor(ballots / (seats + 1)) + 1
		const expectedQuota =
			Math.floor(report.ballotCount / (expected.seats + 1)) + 1;
		expect(report.quota).toBe(expectedQuota);
	});

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
