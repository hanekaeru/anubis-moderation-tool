import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  Permission,
  type AppUserDto,
  type CreateAppUserResponse,
  type Paginated,
  type ResetPasswordResponse,
} from '@anubis/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import type { AuthenticatedUser } from '../common/types';
import { AppUsersService } from './app-users.service';
import {
  AppUserQueryDto,
  CreateAppUserDto,
  UpdateAppUserDto,
} from './dto/app-user.dto';

@Controller('app-users')
export class AppUsersController {
  constructor(private readonly users: AppUsersService) {}

  @Get()
  @RequirePermissions(Permission.USERS_READ)
  search(@Query() query: AppUserQueryDto): Promise<Paginated<AppUserDto>> {
    return this.users.search(query);
  }

  @Post()
  @RequirePermissions(Permission.USERS_WRITE)
  create(
    @Body() dto: CreateAppUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CreateAppUserResponse> {
    return this.users.create(dto, actor);
  }

  @Patch(':id')
  @RequirePermissions(Permission.USERS_WRITE)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAppUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AppUserDto> {
    return this.users.update(id, dto, actor);
  }

  @Post(':id/reset-password')
  @RequirePermissions(Permission.USERS_WRITE)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<ResetPasswordResponse> {
    return this.users.resetPassword(id, actor);
  }

  @Post(':id/unlock')
  @RequirePermissions(Permission.USERS_WRITE)
  unlock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<AppUserDto> {
    return this.users.unlock(id, actor);
  }
}
