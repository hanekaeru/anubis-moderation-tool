import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import { isSnowflake } from "@anubis/shared";

/**
 * Valide qu'un parametre de route est bien un identifiant Discord.
 *
 * Sans cela, une valeur arbitraire descend jusqu'a la requete SQL et produit
 * une erreur obscure plutot qu'un 400 explicite.
 */
@Injectable()
export class SnowflakePipe implements PipeTransform<string, string> {
	transform(value: string): string {
		if (!isSnowflake(value)) {
			throw new BadRequestException(
				`"${value}" n est pas un identifiant Discord valide.`,
			);
		}
		return value;
	}
}

export const SnowflakeParam = new SnowflakePipe();
