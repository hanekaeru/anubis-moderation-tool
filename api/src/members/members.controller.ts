import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  Permission,
  type MemberDetail,
  type MemberListItem,
  type Paginated,
  type RoleSummary,
  type TimelineEntry,
} from '@anubis/shared';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { SnowflakeParam } from '../common/pipes/snowflake.pipe';
import { MemberQueryDto, TimelineQueryDto } from './dto/member-query.dto';
import { MembersService } from './members.service';

@Controller('members')
@RequirePermissions(Permission.MEMBERS_READ)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  search(@Query() query: MemberQueryDto): Promise<Paginated<MemberListItem>> {
    return this.members.search(query);
  }

  /** Declare avant :userId, sinon "roles" serait pris pour un identifiant. */
  @Get('roles')
  listRoles(): Promise<RoleSummary[]> {
    return this.members.listRoles();
  }

  @Get(':userId')
  findOne(@Param('userId', SnowflakeParam) userId: string): Promise<MemberDetail> {
    return this.members.findOne(userId);
  }

  @Get(':userId/timeline')
  timeline(
    @Param('userId', SnowflakeParam) userId: string,
    @Query() query: TimelineQueryDto,
  ): Promise<Paginated<TimelineEntry>> {
    return this.members.timeline(userId, query);
  }
}
