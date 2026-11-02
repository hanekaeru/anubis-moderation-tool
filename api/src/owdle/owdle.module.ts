import { Module } from "@nestjs/common";
import { OwdleController } from "./owdle.controller";
import { OwdleService } from "./owdle.service";

@Module({
	controllers: [OwdleController],
	providers: [OwdleService],
})
export class OwdleModule {}
