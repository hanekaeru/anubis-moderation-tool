import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  AppUserRole,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from '@anubis/shared';
import { PaginationDto, ToBoolean } from '../../common/dto/pagination.dto';

export class CreateAppUserDto {
  @IsString()
  @MinLength(USERNAME_MIN_LENGTH)
  @MaxLength(USERNAME_MAX_LENGTH)
  @Matches(new RegExp(USERNAME_PATTERN), {
    message:
      'L identifiant ne peut contenir que des lettres, chiffres, points, tirets et underscores.',
  })
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName!: string;

  @IsIn(Object.values(AppUserRole))
  role!: AppUserRole;

  /** Omis, l'API genere un mot de passe et le renvoie une seule fois. */
  @IsOptional()
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, {
    message: `Le mot de passe doit faire au moins ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{17,20}$/)
  discordUserId?: string | null;
}

export class UpdateAppUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsIn(Object.values(AppUserRole))
  role?: AppUserRole;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Matches(/^\d{17,20}$/)
  discordUserId?: string | null;
}

export class AppUserQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(Object.values(AppUserRole))
  role?: AppUserRole;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
