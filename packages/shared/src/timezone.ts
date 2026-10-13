/**
 * Calendrier a l'heure d'un fuseau donne, sans dependance.
 *
 * Le staff saisit « mardi 20h » en heure de Paris, quel que soit le fuseau du
 * navigateur ou du serveur : le dashboard, l'API et le bot doivent donc
 * convertir de la meme facon, ici, par `Intl` — present dans Node comme dans
 * le navigateur. Les dates sans heure circulent en cles `AAAA-MM-JJ`, que l'on
 * manipule en UTC pur : une date n'a pas de fuseau, seul un instant en a un.
 */

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isDateKey(value: string): boolean {
	if (!DATE_KEY.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function isTimeOfDay(value: string): boolean {
	return TIME.test(value);
}

interface Parts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const formats = new Map<string, Intl.DateTimeFormat>();

function zonedParts(instant: Date, timeZone: string): Parts {
	let format = formats.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			// `h23` plutot que `hour12: false`, qui rend « 24 » a minuit sur
			// certains moteurs.
			hourCycle: "h23",
		});
		formats.set(timeZone, format);
	}

	const parts = new Map(
		format.formatToParts(instant).map((part) => [part.type, part.value]),
	);
	const lire = (type: Intl.DateTimeFormatPartTypes) => Number(parts.get(type));
	return {
		year: lire("year"),
		month: lire("month"),
		day: lire("day"),
		hour: lire("hour"),
		minute: lire("minute"),
		second: lire("second"),
	};
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Date du jour, dans ce fuseau, de l'instant donne. */
export function zonedDateKey(instant: Date, timeZone: string): string {
	const p = zonedParts(instant, timeZone);
	return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Heure « HH:MM », dans ce fuseau, de l'instant donne. */
export function zonedTimeOfDay(instant: Date, timeZone: string): string {
	const p = zonedParts(instant, timeZone);
	return `${pad(p.hour)}:${pad(p.minute)}`;
}

export function addDaysToKey(key: string, days: number): string {
	const date = new Date(`${key}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** Jour de la semaine d'une date, lundi valant 0 (et non dimanche). */
export function weekdayOfKey(key: string): number {
	return (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** Lundi de la semaine qui contient cette date. */
export function mondayOfKey(key: string): string {
	return addDaysToKey(key, -weekdayOfKey(key));
}

/** Lundi, dans ce fuseau, de la semaine qui contient l'instant donne. */
export function zonedWeekStart(instant: Date, timeZone: string): string {
	return mondayOfKey(zonedDateKey(instant, timeZone));
}

/** Ecart, en millisecondes, entre l'heure du fuseau et UTC a cet instant. */
function offsetMs(timestamp: number, timeZone: string): number {
	const p = zonedParts(new Date(timestamp), timeZone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return asUtc - Math.floor(timestamp / 1000) * 1000;
}

/**
 * Instant correspondant a « telle date, telle heure » dans ce fuseau.
 *
 * Deux passes, parce que l'ecart depend de l'instant cherche : la premiere
 * l'estime, la seconde le corrige quand un changement d'heure separe
 * l'estimation du resultat. Une heure qui n'existe pas (2 h 30 la nuit du
 * passage a l'heure d'ete) glisse d'une heure, comme sur une horloge.
 */
export function zonedWallTimeToUtc(key: string, time: string, timeZone: string): Date {
	const [year, month, day] = key.split("-").map(Number);
	const [hour, minute] = time.split(":").map(Number);
	const naif = Date.UTC(year!, month! - 1, day!, hour!, minute!);

	let instant = naif - offsetMs(naif, timeZone);
	instant = naif - offsetMs(instant, timeZone);
	return new Date(instant);
}
