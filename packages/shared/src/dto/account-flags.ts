import { AccountFlagType } from "../enums";
import { IsoDateString, PaginationQuery, Snowflake } from "./common";
import { MemberRef } from "./moderation";

export interface AccountFlagDto {
	id: string;
	guildId: Snowflake;
	member: MemberRef;
	type: AccountFlagType;
	details: Record<string, unknown> | null;
	createdAt: IsoDateString;
	reviewedAt: IsoDateString | null;
	reviewedBy: string | null;
}

export interface AccountFlagSearchQuery extends PaginationQuery {
	userId?: Snowflake;
	/** Non renseigne = tous ; true = deja traites ; false = a traiter. */
	reviewed?: boolean;
}
