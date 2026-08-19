/**
 * Appels a Battle.net, isoles du reste pour que le service n'ait a connaitre
 * ni les URL de Blizzard ni la forme de ses reponses.
 *
 * Aucun jeton n'est conserve : le flux ne sert qu'a lire une fois `/userinfo`,
 * juste apres l'echange du code. Ne rien garder est le choix le plus sur — il
 * n'y a alors aucun jeton Blizzard a faire fuiter, et rien a rafraichir.
 */

/** Hote global. Les hotes regionaux (`us`, `eu`) acceptent les memes comptes. */
const BATTLENET_HOST = "https://oauth.battle.net";

export const BATTLENET_AUTHORIZE_URL = `${BATTLENET_HOST}/authorize`;
const BATTLENET_TOKEN_URL = `${BATTLENET_HOST}/token`;
const BATTLENET_USERINFO_URL = `${BATTLENET_HOST}/userinfo`;

/**
 * Aucun scope n'est demande.
 *
 * Sans scope, `/userinfo` rend deja `sub` et `battletag` — tout ce dont la
 * verification a besoin. Demander `wow.profile` ou `sc2.profile` ferait
 * afficher a Blizzard un ecran de consentement plus intimidant pour une donnee
 * qu'on n'utiliserait pas.
 */
const BATTLENET_SCOPE = "";

/** Delai au-dela duquel on renonce, plutot que de laisser le navigateur pendre. */
const TIMEOUT_MS = 10_000;

export interface BattlenetUserInfo {
	/** Identifiant stable du compte. C'est lui qui porte l'unicite. */
	sub: string;
	battletag: string;
}

export class BattlenetError extends Error {
	constructor(
		message: string,
		readonly cause?: unknown,
	) {
		super(message);
		this.name = "BattlenetError";
	}
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

export function buildAuthorizeUrl(options: {
	clientId: string;
	redirectUri: string;
	state: string;
}): string {
	const params = new URLSearchParams({
		client_id: options.clientId,
		redirect_uri: options.redirectUri,
		response_type: "code",
		state: options.state,
	});

	if (BATTLENET_SCOPE) params.set("scope", BATTLENET_SCOPE);

	return `${BATTLENET_AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Echange le code contre un jeton, puis lit `/userinfo`.
 *
 * Les identifiants du client passent par l'authentification HTTP Basic, la
 * forme attendue par Blizzard — les mettre dans le corps de la requete
 * fonctionne aussi, mais laisse le secret dans les journaux d'acces des
 * intermediaires.
 */
export async function exchangeCodeForUserInfo(options: {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	code: string;
}): Promise<BattlenetUserInfo> {
	const basic = Buffer.from(
		`${options.clientId}:${options.clientSecret}`,
	).toString("base64");

	let tokenResponse: Response;
	try {
		tokenResponse = await fetchWithTimeout(BATTLENET_TOKEN_URL, {
			method: "POST",
			headers: {
				Authorization: `Basic ${basic}`,
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: options.code,
				redirect_uri: options.redirectUri,
			}).toString(),
		});
	} catch (err) {
		throw new BattlenetError("Battle.net injoignable.", err);
	}

	if (!tokenResponse.ok) {
		throw new BattlenetError(
			`Échange du code refusé par Battle.net (${tokenResponse.status}).`,
		);
	}

	const token = (await tokenResponse.json()) as { access_token?: unknown };
	if (typeof token.access_token !== "string" || !token.access_token) {
		throw new BattlenetError("Réponse de Battle.net sans jeton d'accès.");
	}

	let userResponse: Response;
	try {
		userResponse = await fetchWithTimeout(BATTLENET_USERINFO_URL, {
			headers: { Authorization: `Bearer ${token.access_token}` },
		});
	} catch (err) {
		throw new BattlenetError("Battle.net injoignable.", err);
	}

	if (!userResponse.ok) {
		throw new BattlenetError(
			`Lecture du compte refusée par Battle.net (${userResponse.status}).`,
		);
	}

	const info = (await userResponse.json()) as {
		sub?: unknown;
		battletag?: unknown;
	};

	// `sub` est ce qui porte l'unicite : sans lui, rien ne garantit qu'on ne
	// lie pas deux fois le meme compte Blizzard. Mieux vaut refuser.
	if (typeof info.sub !== "string" || !info.sub) {
		throw new BattlenetError("Réponse de Battle.net sans identifiant de compte.");
	}

	return {
		sub: info.sub,
		// Un compte sans BattleTag ne devrait pas exister, mais la verification
		// n'a pas a echouer pour un champ d'affichage.
		battletag:
			typeof info.battletag === "string" && info.battletag
				? info.battletag
				: "—",
	};
}
