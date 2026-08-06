import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { TicketPriority, TicketStatus } from '@anubis/shared';
import { PaginationDto } from '../../common/dto/pagination.dto';

const SNOWFLAKE = /^\d{17,20}$/;

export class TicketQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(Object.values(TicketStatus))
  status?: TicketStatus;

  @IsOptional()
  @IsIn(Object.values(TicketPriority))
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @IsOptional()
  @Matches(SNOWFLAKE)
  assigneeId?: string;

  @IsOptional()
  @Matches(SNOWFLAKE)
  openerId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsIn(['openedAt', 'closedAt', 'priority', 'number'])
  sortBy: 'openedAt' | 'closedAt' | 'priority' | 'number' = 'openedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc';
}

export class UpdateTicketDto {
  @IsOptional()
  @IsIn(Object.values(TicketStatus))
  status?: TicketStatus;

  @IsOptional()
  @IsIn(Object.values(TicketPriority))
  priority?: TicketPriority;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  // `null` est une valeur utile ici : elle desassigne le ticket.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(SNOWFLAKE)
  assigneeId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  closeReason?: string;
}

export class AddTicketNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}
