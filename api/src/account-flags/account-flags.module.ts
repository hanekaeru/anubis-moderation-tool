import { Module } from "@nestjs/common";
import { AccountFlagsController } from "./account-flags.controller";
import { AccountFlagsService } from "./account-flags.service";

@Module({
	controllers: [AccountFlagsController],
	providers: [AccountFlagsService],
})
export class AccountFlagsModule {}
