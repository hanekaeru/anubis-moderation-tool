import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { TokenService } from "./token.service";
import { TwoFactorService } from "./two-factor.service";

@Module({
	imports: [
		PassportModule.register({ defaultStrategy: "jwt", session: false }),
		// Les secrets et durees sont passes a chaque appel via TokenService, pour
		// que la config reste validee en un seul endroit.
		JwtModule.register({}),
	],
	controllers: [AuthController],
	providers: [AuthService, TokenService, TwoFactorService, JwtStrategy],
	exports: [AuthService, TokenService, TwoFactorService],
})
export class AuthModule {}
