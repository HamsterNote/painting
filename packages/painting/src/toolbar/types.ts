/** Host-resolved metadata only; keys are canonical storage identities, never display names. */
export type ToolbarFile = Readonly<{
  key: string;
  storageId: string;
  path: string;
  displayName: string;
  resolvedFormat: string;
}>;

export type ToolbarFileRequest = Readonly<{
  fileKey: string;
  paneId: string;
  requestId: string;
}>;

export type ToolbarRequestResult =
  { status: 'success' } | { status: 'cancelled' } | { status: 'failed'; message: string };

export type ToolbarFileNavigationProps = {
  files?: readonly ToolbarFile[];
  currentFileKey?: string;
  paneId?: string;
  busy?: boolean;
  onSelectFile?: (request: ToolbarFileRequest) => Promise<ToolbarRequestResult>;
  /** The host owns removal confirmation, save barriers and the resulting list. */
  onRequestRemove?: (request: ToolbarFileRequest) => Promise<ToolbarRequestResult>;
};

/** All dimensions are CSS pixels. Insets and headerContentInset share the pane origin. */
export type PaneToolbarLayout = Readonly<{
  edge: 'top' | 'bottom';
  insets: Readonly<{ top: number; bottom: number; left: number; right: number }>;
  /** Effective top obstruction from the pane origin; overlaps safe top (use max, not sum). */
  headerContentInset: number;
  /** Optional visible pane rectangle in viewport coordinates, further clipped to the viewport. */
  bounds?: Readonly<{ left: number; top: number; width: number; height: number }>;
}>;

/** Actual content reservation, including the toolbar, gap and effective inset. */
export type ToolbarOccupiedSpace = Readonly<{ top: number; bottom: number }>;
