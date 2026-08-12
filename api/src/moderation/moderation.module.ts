import { Module } from "@nestjs/common";
import {
	NotesController,
	SanctionsController,
	WarningsController,
} from "./moderation.controller";
import { NotesService } from "./notes.service";
import { SanctionsService } from "./sanctions.service";
import { WarningsService } from "./warnings.service";

/**
 * Avertissements, sanctions et notes vivent dans le meme module : ce sont trois
 * facettes du meme geste de moderation, et elles se referencent entre elles.
 */
@Module({
	controllers: [WarningsController, SanctionsController, NotesController],
	providers: [WarningsService, SanctionsService, NotesService],
	exports: [WarningsService, SanctionsService, NotesService],
})
export class ModerationModule {}
