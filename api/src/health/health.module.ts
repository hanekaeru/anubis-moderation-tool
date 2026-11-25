import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthcheckPingService } from "./healthcheck-ping.service";

@Module({ controllers: [HealthController], providers: [HealthcheckPingService] })
export class HealthModule {}
