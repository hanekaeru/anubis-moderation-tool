import { Type } from "class-transformer";
import {
	ArrayMaxSize,
	ArrayMinSize,
	IsArray,
	IsBoolean,
	IsEnum,
	IsInt,
	IsOptional,
	IsString,
	Matches,
	Max,
	MaxLength,
	Min,
	MinLength,
	ValidateIf,
} from "class-validator";
import {
	MAX_OWDLE_AFFILIATION_LABEL_LENGTH,
	MAX_OWDLE_HERO_KEY_LENGTH,
	MAX_OWDLE_HERO_NAME_LENGTH,
	MAX_OWDLE_ORIGIN_LENGTH,
	MAX_OWDLE_RELEASE_YEAR,
	MAX_OWDLE_XP_PER_WIN,
	MAX_OWDLE_XP_STEPS,
	MIN_OWDLE_RELEASE_YEAR,
	OWDLE_HERO_KEY_PATTERN,
	OwdleRegion,
	OwdleRole,
	OwdleSpecies,
	OwdleSubRole,
} from "@anubis/shared";

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Champs communs a la creation et a la modification.
 *
 * La coherence role / sous-role ne se verifie pas ici : en modification, l'un
 * des deux peut manquer et se lit alors sur la fiche existante. C'est le
 * service qui la tranche, sur la fiche complete.
 */
export class UpdateOwdleHeroDto {
	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(MAX_OWDLE_HERO_NAME_LENGTH)
	name?: string;

	@IsOptional()
	@IsEnum(OwdleRole)
	role?: OwdleRole;

	@IsOptional()
	@IsEnum(OwdleSubRole)
	subRole?: OwdleSubRole;

	@IsOptional()
	@IsEnum(OwdleSpecies)
	species?: OwdleSpecies;

	@IsOptional()
	@IsString()
	@MinLength(1)
	@MaxLength(MAX_OWDLE_ORIGIN_LENGTH)
	origin?: string;

	@IsOptional()
	@IsEnum(OwdleRegion)
	region?: OwdleRegion;

	/** Existence verifiee par le service : la liste vit en base. */
	@IsOptional()
	@IsString()
	@MaxLength(MAX_OWDLE_HERO_KEY_LENGTH)
	affiliationKey?: string;

	@IsOptional()
	@Type(() => Number)
	@IsInt()
	@Min(MIN_OWDLE_RELEASE_YEAR)
	@Max(MAX_OWDLE_RELEASE_YEAR)
	releaseYear?: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class CreateOwdleHeroDto {
	@IsString()
	@MaxLength(MAX_OWDLE_HERO_KEY_LENGTH)
	@Matches(OWDLE_HERO_KEY_PATTERN, {
		message: "La clé ne contient que des minuscules, des chiffres et des tirets.",
	})
	key!: string;

	@IsString()
	@MinLength(1)
	@MaxLength(MAX_OWDLE_HERO_NAME_LENGTH)
	name!: string;

	@IsEnum(OwdleRole)
	role!: OwdleRole;

	@IsEnum(OwdleSubRole)
	subRole!: OwdleSubRole;

	@IsEnum(OwdleSpecies)
	species!: OwdleSpecies;

	@IsString()
	@MinLength(1)
	@MaxLength(MAX_OWDLE_ORIGIN_LENGTH)
	origin!: string;

	@IsEnum(OwdleRegion)
	region!: OwdleRegion;

	@IsString()
	@MaxLength(MAX_OWDLE_HERO_KEY_LENGTH)
	affiliationKey!: string;

	@Type(() => Number)
	@IsInt()
	@Min(MIN_OWDLE_RELEASE_YEAR)
	@Max(MAX_OWDLE_RELEASE_YEAR)
	releaseYear!: number;

	@IsOptional()
	@IsBoolean()
	enabled?: boolean;
}

export class UpdateOwdleConfigDto {
	// `null` revient au salon de la partie, comme `/owdle_salon` sans option.
	@IsOptional()
	@ValidateIf((_, value) => value !== null)
	@Matches(SNOWFLAKE)
	channelId?: string | null;

	/**
	 * Remplace en bloc. Au moins une valeur : un bareme vide se lirait comme
	 * « rien a gagner » sans que personne l'ait choisi — mettre des zeros le
	 * dit explicitement.
	 */
	@IsOptional()
	@IsArray()
	@ArrayMinSize(1, { message: "Le barème doit compter au moins une ligne." })
	@ArrayMaxSize(MAX_OWDLE_XP_STEPS)
	@IsInt({ each: true })
	@Min(0, { each: true })
	@Max(MAX_OWDLE_XP_PER_WIN, { each: true })
	xpByGuesses?: number[];
}

export class SaveOwdleAffiliationDto {
	@IsString()
	@MinLength(1)
	@MaxLength(MAX_OWDLE_AFFILIATION_LABEL_LENGTH)
	label!: string;
}
