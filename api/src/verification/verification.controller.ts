import { Controller, Get, Query, Res } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { verificationPage } from "./verification.page";
import { VerificationService } from "./verification.service";

/**
 * Les deux seules routes de l'API ouvertes a un navigateur qui n'appartient a
 * personne du dashboard : c'est un membre Discord quelconque qui les traverse.
 *
 * Elles sont `@Public()` par necessite — le membre n'a evidemment pas de compte
 * dashboard. Ce qui les protege n'est donc pas l'authentification mais le
 * `state` : tire cote serveur, a usage unique et a duree de vie courte.
 *
 * Debit resserre a part : ces routes n'ont aucune raison d'etre appelees en
 * rafale, et un `state` court ne vaut que si on ne peut pas en essayer mille.
 */
@Controller("verification/battlenet")
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class VerificationController {
	constructor(private readonly verification: VerificationService) {}

	/**
	 * Cible du bouton Discord : valide la demande puis renvoie chez Blizzard.
	 *
	 * Ce detour par notre domaine plutot qu'un lien direct vers Blizzard tient a
	 * trois choses — la configuration du client OAuth ne vit qu'ici, un lien
	 * perime se voit dire pourquoi plutot que de finir sur une erreur Blizzard,
	 * et l'arrivant reconnait le domaine de son serveur avant de saisir quoi que
	 * ce soit.
	 */
	@Get("start")
	@Public()
	async start(
		@Query("state") state: string | undefined,
		@Res() res: Response,
	): Promise<void> {
		const resultat = await this.verification.authorizeUrlFor(state ?? "");

		if ("erreur" in resultat) {
			this.rendre(res, resultat.erreur);
			return;
		}

		res.redirect(resultat.url);
	}

	/** Retour de Blizzard, appele par le navigateur du membre. */
	@Get("callback")
	@Public()
	async callback(
		@Query("code") code: string | undefined,
		@Query("state") state: string | undefined,
		@Res() res: Response,
	): Promise<void> {
		this.rendre(res, await this.verification.handleCallback(code, state));
	}

	private rendre(
		res: Response,
		outcome: Parameters<typeof verificationPage>[0],
	): void {
		const { statut, html } = verificationPage(outcome);
		// `noindex` est deja dans la page ; l'en-tete couvre le cas ou un
		// intermediaire ne lirait que celui-la.
		res.status(statut).header("X-Robots-Tag", "noindex").type("html").send(html);
	}
}
