import { Module } from "@nestjs/common";
import { WelcomeController } from "./welcome.controller";
import { WelcomeService } from "./welcome.service";

@Module({
	controllers: [WelcomeController],
	providers: [WelcomeService],
})
export class WelcomeModule {}
