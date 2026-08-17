import { Collection, type Guild, type VoiceState } from "discord.js";

const prismaMock = {
	voiceSession: {
		create: jest.fn(),
		findUnique: jest.fn(),
		findFirst: jest.fn(),
		findMany: jest.fn().mockResolvedValue([]),
		update: jest.fn().mockResolvedValue(undefined),
	},
	$transaction: jest.fn().mockResolvedValue([]),
};

jest.mock("../prisma", () => ({ __esModule: true, default: prismaMock }));
jest.mock("./referentiel", () => ({
	__esModule: true,
	garantirContexte: jest.fn().mockResolvedValue(true),
	upsertChannel: jest.fn().mockResolvedValue(undefined),
}));

import * as voice from "./voice";

const GUILD_ID = "guild-1";
const USER_ID = "user-1";

function etat(channelId: string | null, userId = USER_ID): VoiceState {
	return {
		id: userId,
		channelId,
		channel: channelId ? { id: channelId } : null,
		guild: { id: GUILD_ID, name: "Serveur" },
		member: { id: userId, user: { id: userId } },
	} as unknown as VoiceState;
}

function serveur(etats: VoiceState[]): Guild {
	const cache = new Collection<string, VoiceState>();
	for (const state of etats) cache.set(state.id, state);

	return {
		id: GUILD_ID,
		name: "Serveur",
		voiceStates: { cache },
	} as unknown as Guild;
}

beforeEach(() => {
	jest.clearAllMocks();
	prismaMock.voiceSession.create.mockResolvedValue({ id: 1n });
	prismaMock.voiceSession.findMany.mockResolvedValue([]);
});

describe("enregistrerMouvement", () => {
	it("ignore un changement d'etat sans changement de salon", async () => {
		// Couper son micro ou son casque declenche aussi voiceStateUpdate : aucune
		// session ne commence ni ne se termine.
		await voice.enregistrerMouvement(etat("salon-1"), etat("salon-1"));

		expect(prismaMock.voiceSession.create).not.toHaveBeenCalled();
		expect(prismaMock.voiceSession.update).not.toHaveBeenCalled();
	});

	it("ouvre une session a l'arrivee puis la ferme au depart avec sa duree", async () => {
		await voice.enregistrerMouvement(etat(null), etat("salon-1"));

		expect(prismaMock.voiceSession.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					guildId: GUILD_ID,
					userId: USER_ID,
					channelId: "salon-1",
				}),
			}),
		);

		// La session ouverte est retrouvee par le cache memoire, sans recherche.
		prismaMock.voiceSession.findUnique.mockResolvedValue({
			id: 1n,
			joinedAt: new Date(Date.now() - 120_000),
			leftAt: null,
		});

		await voice.enregistrerMouvement(etat("salon-1"), etat(null));

		expect(prismaMock.voiceSession.findFirst).not.toHaveBeenCalled();
		const [call] = prismaMock.voiceSession.update.mock.calls;
		expect(call[0].where).toEqual({ id: 1n });
		expect(call[0].data.durationSeconds).toBeGreaterThanOrEqual(119);
		expect(call[0].data.durationSeconds).toBeLessThanOrEqual(121);
	});

	it("cherche la session en base quand le cache est vide", async () => {
		prismaMock.voiceSession.findFirst.mockResolvedValue({
			id: 7n,
			joinedAt: new Date(Date.now() - 60_000),
			leftAt: null,
		});

		await voice.enregistrerMouvement(etat("salon-1"), etat(null));

		expect(prismaMock.voiceSession.findFirst).toHaveBeenCalled();
		expect(prismaMock.voiceSession.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 7n } }),
		);
	});

	it("ferme l'ancienne session et en ouvre une nouvelle a un changement de salon", async () => {
		prismaMock.voiceSession.findFirst.mockResolvedValue({
			id: 9n,
			joinedAt: new Date(Date.now() - 30_000),
			leftAt: null,
		});

		await voice.enregistrerMouvement(etat("salon-1"), etat("salon-2"));

		expect(prismaMock.voiceSession.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 9n } }),
		);
		expect(prismaMock.voiceSession.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ channelId: "salon-2" }),
			}),
		);
	});
});

describe("reconcilierSessions", () => {
	// La reconciliation journalise son bilan a chaque appel : utile au
	// demarrage du bot, pur bruit dans le journal de CI.
	let silence: jest.SpyInstance;

	beforeEach(() => {
		silence = jest.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		silence.mockRestore();
	});

	it("laisse ouverte la session d'un membre toujours dans le meme salon", async () => {
		prismaMock.voiceSession.findMany.mockResolvedValue([
			{
				id: 1n,
				userId: USER_ID,
				channelId: "salon-1",
				joinedAt: new Date(Date.now() - 600_000),
			},
		]);

		await voice.reconcilierSessions(
			serveur([etat("salon-1")]),
			new Date(Date.now() - 300_000),
		);

		expect(prismaMock.voiceSession.update).not.toHaveBeenCalled();
		expect(prismaMock.voiceSession.create).not.toHaveBeenCalled();
	});

	it("ferme au dernier battement une session laissee ouverte par l'arret", async () => {
		const joinedAt = new Date(Date.now() - 3600_000);
		const finProbable = new Date(Date.now() - 1800_000);

		prismaMock.voiceSession.findMany.mockResolvedValue([
			{ id: 1n, userId: USER_ID, channelId: "salon-1", joinedAt },
		]);

		await voice.reconcilierSessions(serveur([]), finProbable);

		const [call] = prismaMock.voiceSession.update.mock.calls;
		expect(call[0].data.leftAt).toEqual(finProbable);
		expect(call[0].data.durationSeconds).toBe(1800);
	});

	it("n'attribue jamais une fin anterieure au debut de la session", async () => {
		// Redemarrage rapide : la session a ete ouverte apres le dernier battement.
		const joinedAt = new Date(Date.now() - 60_000);
		const finProbable = new Date(Date.now() - 120_000);

		prismaMock.voiceSession.findMany.mockResolvedValue([
			{ id: 1n, userId: USER_ID, channelId: "salon-1", joinedAt },
		]);

		await voice.reconcilierSessions(serveur([]), finProbable);

		const [call] = prismaMock.voiceSession.update.mock.calls;
		expect(call[0].data.leftAt).toEqual(joinedAt);
		expect(call[0].data.durationSeconds).toBe(0);
	});

	it("ouvre une session pour un membre connecte pendant l'arret", async () => {
		await voice.reconcilierSessions(serveur([etat("salon-1", "user-2")]), new Date());

		expect(prismaMock.voiceSession.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ userId: "user-2", channelId: "salon-1" }),
			}),
		);
	});

	it("bascule de session quand le membre a change de salon pendant l'arret", async () => {
		prismaMock.voiceSession.findMany.mockResolvedValue([
			{
				id: 1n,
				userId: USER_ID,
				channelId: "salon-1",
				joinedAt: new Date(Date.now() - 600_000),
			},
		]);

		await voice.reconcilierSessions(serveur([etat("salon-2")]), new Date());

		expect(prismaMock.voiceSession.update).toHaveBeenCalledWith(
			expect.objectContaining({ where: { id: 1n } }),
		);
		expect(prismaMock.voiceSession.create).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ channelId: "salon-2" }),
			}),
		);
	});
});
