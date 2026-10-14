import { Module } from "@nestjs/common";
import { EsportImportService } from "./esport-import.service";
import { EsportController } from "./esport.controller";
import { EsportService } from "./esport.service";

@Module({
	controllers: [EsportController],
	providers: [EsportService, EsportImportService],
})
export class EsportModule {}
