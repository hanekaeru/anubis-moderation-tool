import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppUsersModule } from './app-users/app-users.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PasswordChangeGuard } from './common/guards/password-change.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { loadConfiguration } from './config/configuration';
import { GuildConfigModule } from './guild-config/guild-config.module';
import { HealthModule } from './health/health.module';
import { MembersModule } from './members/members.module';
import { ModerationModule } from './moderation/moderation.module';
import { PrismaModule } from './prisma/prisma.module';
import { StatsModule } from './stats/stats.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // La config est chargee sous la cle 'app' apres validation : une variable
      // manquante fait echouer le demarrage, pas la premiere requete.
      load: [() => ({ app: loadConfiguration() })],
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    PrismaModule,
    CommonModule,
    AuditModule,
    AuthModule,
    MembersModule,
    ModerationModule,
    TicketsModule,
    StatsModule,
    AppUsersModule,
    GuildConfigModule,
    HealthModule,
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
