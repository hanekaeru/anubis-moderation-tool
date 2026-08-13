import { PaginationDto, paginate } from "./pagination.dto";

function pagination(page: number, pageSize: number): PaginationDto {
	const dto = new PaginationDto();
	dto.page = page;
	dto.pageSize = pageSize;
	return dto;
}

describe("PaginationDto", () => {
	it("calcule skip et take a partir de page/pageSize", () => {
		const dto = pagination(3, 20);
		expect(dto.skip).toBe(40);
		expect(dto.take).toBe(20);
	});
});

describe("paginate", () => {
	it("arrondit pageCount au superieur", () => {
		const result = paginate(["a", "b"], 21, pagination(1, 20));
		expect(result.pageCount).toBe(2);
	});

	it("garde un pageCount minimum de 1 meme sans resultat", () => {
		const result = paginate([], 0, pagination(1, 20));
		expect(result.pageCount).toBe(1);
	});

	it("reporte page, pageSize, items et total tels quels", () => {
		const items = ["a", "b", "c"];
		const result = paginate(items, 3, pagination(2, 10));

		expect(result).toEqual({
			items,
			total: 3,
			page: 2,
			pageSize: 10,
			pageCount: 1,
		});
	});
});
