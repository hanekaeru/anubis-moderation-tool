import { Module } from "@nestjs/common";
import { BattlenetLinksController } from "./battlenet-links.controller";
import { BattlenetLinksService } from "./battlenet-links.service";
import { VerificationController } from "./verification.controller";
import { VerificationService } from "./verification.service";

@Module({
	controllers: [VerificationController, BattlenetLinksController],
	providers: [VerificationService, BattlenetLinksService],
	exports: [VerificationService],
})
export class VerificationModule {}
