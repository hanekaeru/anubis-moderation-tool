import {
	IsBoolean,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
} from "class-validator";

/**
 * Le gabarit doit contenir `{index}` : sans lui, tous les salons d'un meme
 * salon de creation porteraient le meme nom et deviendraient indiscernables
 * dans la liste vocale de Discord.
 */
const NAME_PATTERN = /\{index\}/;

export class CreateVoiceHubDto {
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	name!: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Matches(NAME_PATTERN, {
		message: "namePattern doit contenir {index}.",
	})
	namePattern?: string;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(99)
	userLimit?: number;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class UpdateVoiceHubDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	name?: string;

	@IsOptional()
	@IsString()
	@MaxLength(100)
	@Matches(NAME_PATTERN, {
		message: "namePattern doit contenir {index}.",
	})
	namePattern?: string;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(99)
	userLimit?: number;

	@IsOptional()
	@IsInt()
	@Min(0)
	@Max(1000)
	position?: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}
