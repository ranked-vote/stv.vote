import { describe, expect, test } from "bun:test";
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
