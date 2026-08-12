import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateGuildConfigDto {
	@IsString()
	@MinLength(1)
	@MaxLength(50)
	configName!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(100)
	configValue!: string;

	@IsString()
	@MinLength(1)
	configDescription!: string;
}

export class UpdateGuildConfigDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(100)
	configValue?: string;

	@IsOptional()
	@IsString()
	@MinLength(1)
	configDescription?: string;
}
