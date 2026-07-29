import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { parseScotlandPreferenceProfile } from "../scripts/parse-scotland-preference-profile.js";

interface ElectionCase {
	council: string;
	electorate: number;
	path: string;
	wardName: string;
	candidates: string[];
	firstPreferences: number[];
	totalBallots: number;
}

const cases: ElectionCase[] = [
	{
		council: "Glasgow",
		electorate: 17009,
		path: "raw-data/uk/scotland/2024/glasgow/hillhead.txt",
		wardName: "11 Hillhead",
		candidates: [
			"Ruth HALL",
			"Faten HAMEED",
			"Seonad HOY",
			"Alistair MCCONNACHIE",
			"Malcolm Francis MCCONNELL",
			"Ryan MCGINLAY",
			"Daniel John O'MALLEY",
		],
		firstPreferences: [1298, 217, 1284, 133, 1015, 22, 106],
		totalBallots: 4075,
	},
	{
		council: "Angus",
		electorate: 13810,
		path: "raw-data/uk/scotland/2024/angus/arbroath-west-letham-and-friockheim.txt",
		wardName: "6 Arbroath West Letham and Friockheim",
		candidates: [
			"Jack Alistair James CRUICKSHANKS",
			"Mark David FINDLAY",
			"Mark HILTON",
			"Sandra O'SHEA",
			"Kathleen WOLF",
		],
		firstPreferences: [1682, 176, 644, 333, 1175],
		totalBallots: 4010,
	},
	{
		council: "North_Ayrshire",
		electorate: 13392,
		path: "raw-data/uk/scotland/2024/north-ayrshire/kilwinning.txt",
		wardName: "6 Kilwinning",
		candidates: [
			"IAN CHARLES GIBSON",
			"SHEILA GIBSON",
			"Mary HUME",
			"Ruby KIRKWOOD",
			"Chris LAWLER",
		],
		firstPreferences: [136, 916, 2171, 154, 619],
		totalBallots: 3996,
	},
];

describe("parseScotlandPreferenceProfile", () => {
	for (const election of cases) {
		test(election.wardName, () => {
			const ward = parseScotlandPreferenceProfile(
				resolve(election.path),
				election.council,
				election.electorate,
			);

			const firstPreferences = ward.candidates.map((candidate) =>
				ward.ballots
					.filter((ballot) => ballot.rankings[0] === candidate)
					.reduce((total, ballot) => total + ballot.count, 0),
			);

			expect(ward.wardName).toBe(election.wardName);
			expect(ward.seats).toBe(1);
			expect(ward.candidates).toEqual(election.candidates);
			expect(ward.electorate).toBe(election.electorate);
			expect(ward.totalBallots).toBe(election.totalBallots);
			expect(firstPreferences).toEqual(election.firstPreferences);
		});
	}

	test("repairs the Kilwinning PDF ligatures", () => {
		const ward = parseScotlandPreferenceProfile(
			resolve("raw-data/uk/scotland/2024/north-ayrshire/kilwinning.txt"),
			"North_Ayrshire",
			13392,
		);

		expect(ward.parties).toEqual([
			"Scottish Family Party - Putting Families First",
			"Scottish National Party (SNP)",
			"Scottish Labour Party",
			"Scottish Liberal Democrats",
			"Scottish Conservative and Unionist",
		]);
	});
});
