import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

@Module({
	// AuthModule fournit TokenService : la revocation d'une famille de jetons
	// vit la ou vit la rotation, elle n'est pas reecrite ici.
	imports: [AuthModule],
	controllers: [SessionsController],
	providers: [SessionsService],
})
export class SessionsModule {}
