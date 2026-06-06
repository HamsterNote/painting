import { render } from "@testing-library/react";
import type { DrawingStroke } from "../../components/DrawingSurface";
import { DRAWING_STROKE_SCHEMA_VERSION, type DrawingStrokeV2 } from "../../model/strokes";
import { StrokeRenderer } from "../StrokeRenderer";
import type { StrokeStyleFields } from "../resolveStrokeStyle";

type StyledStrokeV2 = DrawingStrokeV2 & StrokeStyleFields;

function renderStroke(stroke: DrawingStroke | StyledStrokeV2, isActive = false) {
	return render(
		<svg>
			<title>Test stroke</title>
			<StrokeRenderer
				stroke={stroke}
				isActive={isActive}
				fallbackColor="black"
				fallbackWidth={2}
			/>
		</svg>,
	);
}

describe("StrokeRenderer", () => {
	it("renders v1-compatible pen strokes as smoothed SVG paths", () => {
		const stroke: DrawingStroke = {
			id: "v1-pen",
			tool: "pen",
			strokeColor: "#f00",
			strokeWidth: 7,
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 10 },
			],
		};

		const { container } = renderStroke(stroke, true);
		const path = container.querySelector("path");

		expect(path?.getAttribute("d")).toBe("M 0 0 L 10 10");
		expect(path?.getAttribute("fill")).toBe("none");
		expect(path?.getAttribute("stroke")).toBe("#f00");
		expect(path?.getAttribute("stroke-width")).toBe("7");
		expect(path?.getAttribute("stroke-linecap")).toBe("round");
		expect(path?.getAttribute("stroke-linejoin")).toBe("round");
		expect(path?.getAttribute("opacity")).toBe("0.7");
	});

	it("renders pen pressure data as per-segment lines", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "pressure-pen",
			tool: "pen",
			strokeWidth: 10,
			points: [
				{ x: 0, y: 0, pressure: 0.2 },
				{ x: 10, y: 10, pressure: 0.8 },
			],
		};

		const { container } = renderStroke(stroke);
		const line = container.querySelector("line");

		expect(container.querySelector("path")).toBeNull();
		expect(line?.getAttribute("x1")).toBe("0");
		expect(line?.getAttribute("y1")).toBe("0");
		expect(line?.getAttribute("x2")).toBe("10");
		expect(line?.getAttribute("y2")).toBe("10");
		expect(line?.getAttribute("stroke-width")).toBe("8");
		expect(line?.getAttribute("stroke-linecap")).toBe("round");
		expect(line?.getAttribute("stroke-linejoin")).toBe("round");
	});

	it("renders two-point lines as line elements", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "line",
			tool: "line",
			points: [
				{ x: 1, y: 2 },
				{ x: 9, y: 10 },
			],
		};

		const { container } = renderStroke(stroke);
		const line = container.querySelector("line");

		expect(container.querySelector("path")).toBeNull();
		expect(line?.getAttribute("x1")).toBe("1");
		expect(line?.getAttribute("y1")).toBe("2");
		expect(line?.getAttribute("x2")).toBe("9");
		expect(line?.getAttribute("y2")).toBe("10");
		expect(line?.getAttribute("fill")).toBe("none");
		expect(line?.getAttribute("stroke-linecap")).toBe("round");
	});

	it("renders multi-point lines as open straight paths", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "line",
			tool: "line",
			points: [
				{ x: 1, y: 2 },
				{ x: 5, y: 6 },
				{ x: 9, y: 10 },
			],
		};

		const { container } = renderStroke(stroke);
		const path = container.querySelector("path");

		expect(container.querySelector("line")).toBeNull();
		expect(path?.getAttribute("d")).toBe("M 1 2 L 5 6 L 9 10");
		expect(path?.getAttribute("fill")).toBe("none");
		expect(path?.getAttribute("stroke-linecap")).toBe("round");
		expect(path?.getAttribute("stroke-linejoin")).toBe("round");
	});

	it("renders rectangles from first and last point bbox", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "rect",
			tool: "rect",
			fillColor: "#0f0",
			points: [
				{ x: 20, y: 30 },
				{ x: 5, y: 10 },
			],
		};

		const { container } = renderStroke(stroke);
		const rect = container.querySelector("rect");

		expect(rect?.getAttribute("x")).toBe("5");
		expect(rect?.getAttribute("y")).toBe("10");
		expect(rect?.getAttribute("width")).toBe("15");
		expect(rect?.getAttribute("height")).toBe("20");
		expect(rect?.getAttribute("fill")).toBe("#0f0");
		expect(rect?.getAttribute("fill-opacity")).toBe("1");
	});

	it("renders ellipses from first and last point bbox", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "ellipse",
			tool: "ellipse",
			points: [
				{ x: 0, y: 10 },
				{ x: 20, y: 30 },
			],
		};

		const { container } = renderStroke(stroke);
		const ellipse = container.querySelector("ellipse");

		expect(ellipse?.getAttribute("cx")).toBe("10");
		expect(ellipse?.getAttribute("cy")).toBe("20");
		expect(ellipse?.getAttribute("rx")).toBe("10");
		expect(ellipse?.getAttribute("ry")).toBe("10");
		expect(ellipse?.getAttribute("fill")).toBe("none");
	});

	it("renders polygon vertices", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "polygon",
			tool: "polygon",
			dashArray: [2, 3],
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 5, y: 10 },
			],
		};

		const { container } = renderStroke(stroke);
		const polygon = container.querySelector("polygon");

		expect(polygon?.getAttribute("points")).toBe("0,0 10,0 5,10");
		expect(polygon?.getAttribute("stroke-dasharray")).toBe("2 3");
	});

	it("renders four-point cubic bezier paths", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "bezier",
			tool: "bezier",
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 20 },
				{ x: 20, y: 20 },
			],
		};

		const { container } = renderStroke(stroke);
		const path = container.querySelector("path");

		expect(path?.getAttribute("d")).toBe("M 0 0 C 10 0 10 20 20 20");
		expect(path?.getAttribute("fill")).toBe("none");
		expect(path?.getAttribute("stroke-linecap")).toBe("round");
		expect(path?.getAttribute("stroke-linejoin")).toBe("round");
	});

	it("omits bezier output when exactly four points are not present", () => {
		const stroke: StyledStrokeV2 = {
			schemaVersion: DRAWING_STROKE_SCHEMA_VERSION,
			id: "invalid-bezier",
			tool: "bezier",
			points: [
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 20 },
			],
		};

		const { container } = renderStroke(stroke);

		expect(container.querySelector("path")).toBeNull();
	});
});
