import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AppUsersController } from './app-users.controller';
import { AppUsersService } from './app-users.service';

@Module({
  // AuthModule fournit TokenService : desactiver ou retrograder un compte doit
  // pouvoir revoquer ses sessions immediatement.
  imports: [AuthModule],
  controllers: [AppUsersController],
  providers: [AppUsersService],
})
export class AppUsersModule {}
