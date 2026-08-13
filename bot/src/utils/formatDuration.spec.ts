import { DurationUnit } from "@anubis/shared";
import { formatDuration } from "./formatDuration";

describe("formatDuration", () => {
	it("renvoie le libelle fixe pour une sanction permanente", () => {
		expect(formatDuration(1, DurationUnit.PERMANENT)).toBe("Permanent");
	});

	it("formate le montant et l'unite en minuscule pour une duree normale", () => {
		expect(formatDuration(16, DurationUnit.DAYS)).toBe("16 jours");
		expect(formatDuration(1, DurationUnit.HOURS)).toBe("1 heures");
	});
});
