import { describe, expect, test } from "bun:test";
import {
	aecCandidateName,
	sequence,
	splitCsvLine,
} from "../scripts/convert-aec-senate";
import { actCandidateName } from "../scripts/convert-act-preferences";
import { partyName } from "../scripts/load-act";

describe("ACT names", () => {
	test("flips and title-cases candidate surnames", () => {
		expect(actCandidateName("SMYTH, Brendan")).toBe("Brendan Smyth");
		expect(actCandidateName("STEPHEN-SMITH, Rachel")).toBe(
			"Rachel Stephen-Smith",
		);
		expect(actCandidateName("LE COUTEUR, Caroline")).toBe(
			"Caroline Le Couteur",
		);
		expect(actCandidateName("O'CONNOR, Kim")).toBe("Kim O'Connor");
		expect(actCandidateName("McKAY, Sam")).toBe("Sam McKay");
	});

	test("formats party names", () => {
		expect(partyName("THE ACT GREENS")).toBe("The ACT Greens");
		expect(partyName("INDEPENDENTS FOR CANBERRA")).toBe(
			"Independents for Canberra",
		);
		expect(partyName("LABOUR DLP")).toBe("Labour DLP");
	});
});

describe("AEC Senate parsing", () => {
	test("formats candidate names", () => {
		expect(aecCandidateName("McKIM Nick")).toBe("Nick McKim");
		expect(aecCandidateName("O'DONNELL Saxon")).toBe("Saxon O'Donnell");
		expect(aecCandidateName("HANSON-YOUNG Sarah")).toBe("Sarah Hanson-Young");
		expect(aecCandidateName("NAMPIJINPA PRICE Jacinta")).toBe(
			"Jacinta Nampijinpa Price",
		);
	});

	test("reads preferences in order and stops at a gap or repeat", () => {
		expect(sequence(["2", "", "1", "3"])).toEqual([2, 0, 3]);
		expect(sequence(["1", "2", "4"])).toEqual([0, 1]);
		expect(sequence(["1", "2", "2", "3"])).toEqual([0]);
		expect(sequence(["", "*"])).toEqual([1]);
	});

	test("splits quoted CSV fields", () => {
		expect(splitCsvLine('A:Liberal,"L:Shooters, Fishers and Farmers Party",')).toEqual([
			"A:Liberal",
			"L:Shooters, Fishers and Farmers Party",
			"",
		]);
	});
});
