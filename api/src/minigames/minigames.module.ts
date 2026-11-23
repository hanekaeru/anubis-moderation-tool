import { Module } from "@nestjs/common";
import { MinigamesController } from "./minigames.controller";
import { MinigamesService } from "./minigames.service";

@Module({
	controllers: [MinigamesController],
	providers: [MinigamesService],
})
export class MinigamesModule {}
