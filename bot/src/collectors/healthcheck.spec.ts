import { Status, type Client } from "discord.js";
import {
	HEALTHCHECK_INTERVAL_MS,
	adresseDuSignal,
	reinitialiser,
	signalerVie,
} from "./healthcheck";

const URL_SIGNAL = "https://hc-ping.com/00000000-0000-0000-0000-000000000000";

function client(status: Status = Status.Ready): Client {
	return { ws: { status } } as unknown as Client;
}

let fetchMock: jest.Mock;

beforeEach(() => {
	reinitialiser();
	fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
	global.fetch = fetchMock as unknown as typeof fetch;
	process.env.HEALTHCHECK_URL = URL_SIGNAL;
	jest.spyOn(console, "error").mockImplementation(() => {});
	jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
	delete process.env.HEALTHCHECK_URL;
	jest.restoreAllMocks();
});

describe("adresseDuSignal", () => {
	it("n'accepte qu'une adresse http(s)", () => {
		expect(adresseDuSignal(` ${URL_SIGNAL} `)).toBe(URL_SIGNAL);
		expect(adresseDuSignal("")).toBeNull();
		expect(adresseDuSignal(undefined)).toBeNull();
		expect(adresseDuSignal("hc-ping.com/abc")).toBeNull();
		expect(adresseDuSignal("ftp://exemple.org")).toBeNull();
	});
});

describe("signalerVie", () => {
	it("envoie au plus un signal toutes les cinq minutes", async () => {
		const t0 = 1_000_000;
		await signalerVie(client(), t0);
		await signalerVie(client(), t0 + 5_000);
		await signalerVie(client(), t0 + HEALTHCHECK_INTERVAL_MS);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0][0]).toBe(URL_SIGNAL);
	});

	it("se tait quand le bot n'est pas connecte a Discord", async () => {
		await signalerVie(client(Status.Reconnecting), 1_000_000);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("se tait sans adresse configuree", async () => {
		delete process.env.HEALTHCHECK_URL;
		await signalerVie(client(), 1_000_000);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("ne leve jamais, et ne journalise un echec qu'une fois", async () => {
		fetchMock.mockRejectedValue(new Error("timeout"));
		await expect(signalerVie(client(), 1_000_000)).resolves.toBeUndefined();
		await signalerVie(client(), 1_000_000 + HEALTHCHECK_INTERVAL_MS);
		expect(console.error).toHaveBeenCalledTimes(1);
	});
});
