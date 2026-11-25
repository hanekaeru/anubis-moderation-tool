import type { ConfigService } from "@nestjs/config";
import type { AppConfig } from "../config/configuration";
import type { PrismaService } from "../prisma/prisma.service";
import { HealthcheckPingService } from "./healthcheck-ping.service";

const URL_SIGNAL = "https://hc-ping.com/00000000-0000-0000-0000-000000000000";

function makeService(healthcheckUrl: string, baseOk = true) {
	const prisma = {
		$queryRaw: baseOk ? jest.fn().mockResolvedValue([1]) : jest.fn().mockRejectedValue(new Error("down")),
	};
	const config = { get: () => ({ healthcheckUrl }) } as unknown as ConfigService<{ app: AppConfig }, true>;
	return { service: new HealthcheckPingService(prisma as unknown as PrismaService, config), prisma };
}

let fetchMock: jest.Mock;

beforeEach(() => {
	fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
	global.fetch = fetchMock as unknown as typeof fetch;
});

describe("HealthcheckPingService", () => {
	it("signale quand la base repond", async () => {
		const { service } = makeService(URL_SIGNAL);
		await service.signaler();
		expect(fetchMock.mock.calls[0][0]).toBe(URL_SIGNAL);
	});

	it("se tait quand la base ne repond pas : c'est le silence qui alerte", async () => {
		const { service } = makeService(URL_SIGNAL, false);
		jest.spyOn((service as any).logger, "error").mockImplementation(() => {});
		await expect(service.signaler()).resolves.toBeUndefined();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("ne fait rien sans adresse, ni avec une adresse invalide", async () => {
		await makeService("").service.signaler();
		await makeService("hc-ping.com/abc").service.signaler();
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
