import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/** Global : tous les modules metier ont besoin du meme client. */
@Global()
@Module({
	providers: [PrismaService],
	exports: [PrismaService],
})
export class PrismaModule {}
