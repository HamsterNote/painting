import type { AffineTransform, Point } from '../model/document';
import { applyAffine, composeAffine, invertAffine } from './affine';

/** Stable page DIP dimensions; transform maps page DIP to overlay-local CSS pixels. */
export type PageGeometry = Readonly<{
  width: number;
  height: number;
  pageToSurface: AffineTransform;
}>;
export type PageCoordinateSpace = Readonly<{
  pageToSurface: AffineTransform;
  surfaceToPage: AffineTransform;
  toSurface(point: Point): Point | null;
  toPage(point: Point): Point | null;
}>;
export type PageViewportTransform = readonly [number, number, number, number, number, number];

/** pdf.js-compatible transforms. The reference is the viewport used by saved coordinates. */
export function createPageGeometry(options: {
  width: number;
  height: number;
  viewportTransform: PageViewportTransform;
  referenceTransform: PageViewportTransform;
}): PageGeometry | null {
  const fromTuple = (tuple: PageViewportTransform): AffineTransform => ({
    a: tuple?.[0],
    b: tuple?.[1],
    c: tuple?.[2],
    d: tuple?.[3],
    tx: tuple?.[4],
    ty: tuple?.[5],
  });
  const reference = invertAffine(fromTuple(options.referenceTransform));
  const pageToSurface = reference && composeAffine(fromTuple(options.viewportTransform), reference);
  if (!pageToSurface) return null;
  const geometry = { width: options.width, height: options.height, pageToSurface };
  return createPageCoordinateSpace(geometry) ? Object.freeze(geometry) : null;
}

/** Invalid/singular/overflowing geometry is rejected; no clamping or identity fallback. */
export function createPageCoordinateSpace(geometry: PageGeometry): PageCoordinateSpace | null {
  if (
    !geometry ||
    !Number.isFinite(geometry.width) ||
    geometry.width <= 0 ||
    !Number.isFinite(geometry.height) ||
    geometry.height <= 0
  )
    return null;
  const inverse = invertAffine(geometry.pageToSurface);
  if (!inverse) return null;
  const forward = invertAffine(inverse);
  if (!forward) return null;
  return Object.freeze({
    pageToSurface: forward,
    surfaceToPage: inverse,
    toSurface: (point: Point) => applyAffine(forward, point),
    toPage: (point: Point) => applyAffine(inverse, point),
  });
}

/** Snapshot per input batch; callers read current page container bounds (scroll-safe). */
export type ClientToLocal = (point: Point) => Point | null;
export type GetClientToLocal = () => ClientToLocal;
