import { Module } from "@nestjs/common";
import {
	ModerationPointsController,
	NotesController,
	SanctionsController,
	WarningsController,
} from "./moderation.controller";
import { ModerationAttachmentsService } from "./moderation-attachments.service";
import { ModerationPointsService } from "./moderation-points.service";
import { NotesService } from "./notes.service";
import { SanctionsService } from "./sanctions.service";
import { WarningsService } from "./warnings.service";

/**
 * Avertissements, sanctions et notes vivent dans le meme module : ce sont trois
 * facettes du meme geste de moderation, et elles se referencent entre elles.
 *
 * Le bareme de points les rejoint pour la meme raison : il fixe le poids que
 * prennent avertissements et sanctions a leur creation, et le score qu'en tire
 * la fiche membre.
 */
@Module({
	controllers: [
		WarningsController,
		SanctionsController,
		NotesController,
		ModerationPointsController,
	],
	providers: [
		WarningsService,
		SanctionsService,
		NotesService,
		ModerationAttachmentsService,
		ModerationPointsService,
	],
	exports: [
		WarningsService,
		SanctionsService,
		NotesService,
		// `MembersService` en a besoin pour calculer le score d'une fiche.
		ModerationPointsService,
	],
})
export class ModerationModule {}
