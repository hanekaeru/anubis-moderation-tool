import { Global, Module } from "@nestjs/common";
import { GuildContextService } from "./guild-context.service";

@Global()
@Module({
	providers: [GuildContextService],
	exports: [GuildContextService],
})
export class CommonModule {}
