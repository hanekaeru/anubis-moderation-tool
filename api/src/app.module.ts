import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AccountFlagsModule } from "./account-flags/account-flags.module";
import { AccountModule } from "./account/account.module";
import { AppUsersModule } from "./app-users/app-users.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { AutomodModule } from "./automod/automod.module";
import { CommonModule } from "./common/common.module";
import { EmbedsModule } from "./embeds/embeds.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PasswordChangeGuard } from "./common/guards/password-change.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { loadConfiguration } from "./config/configuration";
import { GiveawayModule } from "./giveaway/giveaway.module";
import { GuildConfigModule } from "./guild-config/guild-config.module";
import { HealthModule } from "./health/health.module";
import { MembersModule } from "./members/members.module";
import { ModerationModule } from "./moderation/moderation.module";
import { PrismaModule } from "./prisma/prisma.module";
import { QuarantineModule } from "./quarantine/quarantine.module";
import { RaidModule } from "./raid/raid.module";
import { RolePermissionsModule } from "./role-permissions/role-permissions.module";
import { SessionsModule } from "./sessions/sessions.module";
import { StatsModule } from "./stats/stats.module";
import { StatusModule } from "./status/status.module";
import { TicketsModule } from "./tickets/tickets.module";
import { VerificationModule } from "./verification/verification.module";
import { VoiceModule } from "./voice/voice.module";
import { WelcomeModule } from "./welcome/welcome.module";
import { WikiModule } from "./wiki/wiki.module";
import { XpModule } from "./xp/xp.module";

@Module({
	imports: [
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			// La config est chargee sous la cle 'app' apres validation : une variable
			// manquante fait echouer le demarrage, pas la premiere requete.
			load: [() => ({ app: loadConfiguration() })],
		}),
		ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),
		ScheduleModule.forRoot(),
		PrismaModule,
		CommonModule,
		AuditModule,
		// Avant AuthModule : sa strategie JWT resout les permissions par ce
		// service a chaque requete.
		RolePermissionsModule,
		AuthModule,
		MembersModule,
		ModerationModule,
		TicketsModule,
		StatsModule,
		AppUsersModule,
		GuildConfigModule,
		HealthModule,
		AutomodModule,
		RaidModule,
		QuarantineModule,
		AccountFlagsModule,
		AccountModule,
		StatusModule,
		VerificationModule,
		VoiceModule,
		WikiModule,
		GiveawayModule,
		SessionsModule,
		EmbedsModule,
		XpModule,
		WelcomeModule,
	],
	providers: [
		// L'ordre compte : on limite le debit, puis on authentifie, puis on
		// verifie les permissions.
		{ provide: APP_GUARD, useClass: ThrottlerGuard },
		{ provide: APP_GUARD, useClass: JwtAuthGuard },
		// Apres l'authentification (il lui faut le compte) et avant les
		// permissions : un mot de passe provisoire ferme l'API quels que soient
		// les droits du compte.
		{ provide: APP_GUARD, useClass: PasswordChangeGuard },
		{ provide: APP_GUARD, useClass: PermissionsGuard },
	],
})
export class AppModule {}
