import { resolveStrokeStyle } from "../resolveStrokeStyle";

describe("resolveStrokeStyle", () => {
	it("returns solid open-tool defaults without dash or fill opacity", () => {
		expect(
			resolveStrokeStyle(
				{},
				{ fallbackColor: "black", fallbackWidth: 2 },
			),
		).toEqual({
			stroke: "black",
			strokeWidth: 2,
			strokeDasharray: undefined,
			strokeDashoffset: undefined,
			fill: "none",
			fillOpacity: undefined,
		});
	});

	it("normalizes valid dash arrays and finite dash offsets", () => {
		expect(
			resolveStrokeStyle(
				{ dashArray: [4, 2, 0], dashOffset: -3 },
				{ fallbackColor: "black", fallbackWidth: 2 },
			),
		).toMatchObject({
			strokeDasharray: "4 2 0",
			strokeDashoffset: -3,
		});
	});

	it("omits undefined empty all-zero or invalid dash arrays", () => {
		for (const dashArray of [undefined, [], [0], [0, 0], [4, Number.POSITIVE_INFINITY], [-1, 2]]) {
			expect(
				resolveStrokeStyle(
					{ dashArray },
					{ fallbackColor: "black", fallbackWidth: 2 },
				).strokeDasharray,
			).toBeUndefined();
		}
	});

	it("treats fill color none as no closed-shape fill", () => {
		expect(
			resolveStrokeStyle(
				{ fillColor: "none", fillOpacity: 0.25 },
				{ fallbackColor: "black", fallbackWidth: 1, isClosedShape: true },
			),
		).toMatchObject({
			fill: "none",
			fillOpacity: undefined,
		});
	});

	it("omits non-finite dash offsets", () => {
		expect(
			resolveStrokeStyle(
				{ dashOffset: Number.NaN },
				{ fallbackColor: "black", fallbackWidth: 2 },
			).strokeDashoffset,
		).toBeUndefined();
	});

	it("forces open tools to fill none even when fill color is present", () => {
		expect(
			resolveStrokeStyle(
				{ fillColor: "red", fillOpacity: 0.25 },
				{ fallbackColor: "black", fallbackWidth: 2 },
			),
		).toMatchObject({
			fill: "none",
			fillOpacity: undefined,
		});
	});

	it("defaults closed-shape fill opacity to one when fill is provided", () => {
		expect(
			resolveStrokeStyle(
				{ fillColor: "red" },
				{ fallbackColor: "black", fallbackWidth: 2, isClosedShape: true },
			),
		).toMatchObject({
			fill: "red",
			fillOpacity: 1,
		});
	});

	it("omits closed-shape stroke when stroke width is zero", () => {
		expect(
			resolveStrokeStyle(
				{ strokeColor: "red", strokeWidth: 0, fillColor: "blue" },
				{ fallbackColor: "black", fallbackWidth: 2, isClosedShape: true },
			),
		).toMatchObject({
			stroke: undefined,
			strokeWidth: undefined,
			fill: "blue",
			fillOpacity: 1,
		});
	});
});
