import { Module } from '@nestjs/common';
import { GuildConfigController } from './guild-config.controller';
import { GuildConfigService } from './guild-config.service';

@Module({
  controllers: [GuildConfigController],
  providers: [GuildConfigService],
})
export class GuildConfigModule {}
