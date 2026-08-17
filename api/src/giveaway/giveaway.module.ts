import { Module } from "@nestjs/common";
import { GiveawayController } from "./giveaway.controller";
import { GiveawayService } from "./giveaway.service";

@Module({
	controllers: [GiveawayController],
	providers: [GiveawayService],
})
export class GiveawayModule {}
