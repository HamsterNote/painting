import type { DrawingSurfaceVirtualPaperOptions } from './virtualPaperOptions';

export function isVirtualPaperEnabled(
  virtualPaper?: boolean | DrawingSurfaceVirtualPaperOptions
): boolean {
  if (virtualPaper === true) {
    return true;
  }

  if (virtualPaper === false || virtualPaper === undefined) {
    return false;
  }

  return virtualPaper.enabled !== false;
}
