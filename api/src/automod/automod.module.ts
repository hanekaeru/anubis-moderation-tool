import { Module } from "@nestjs/common";
import { AutomodController } from "./automod.controller";
import { AutomodService } from "./automod.service";

@Module({
	controllers: [AutomodController],
	providers: [AutomodService],
})
export class AutomodModule {}
