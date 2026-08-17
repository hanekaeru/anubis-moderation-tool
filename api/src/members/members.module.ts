import { Module } from "@nestjs/common";
import { ModerationModule } from "../moderation/moderation.module";
import { MembersController } from "./members.controller";
import { MembersService } from "./members.service";

@Module({
	// La fiche membre affiche un score de moderation : elle a besoin du bareme
	// pour situer le total par rapport aux seuils du serveur.
	imports: [ModerationModule],
	controllers: [MembersController],
	providers: [MembersService],
	exports: [MembersService],
})
export class MembersModule {}
