import { Module } from "@nestjs/common";
import { RaidController } from "./raid.controller";
import { RaidService } from "./raid.service";

@Module({
	controllers: [RaidController],
	providers: [RaidService],
})
export class RaidModule {}
