import { PaintingBoard, type PaintingBoardProps } from '@hamster-note/painting-board';
import { Toolbar, type LayeredEditorController } from '@hamster-note/painting/layered';
import {
  ToolbarShell,
  ToolbarFileMenu,
  type ToolbarFileNavigationProps,
  type PaneToolbarLayout,
} from '@hamster-note/painting/toolbar';

/** Compile public declarations through package exports, without source aliases. */
export function ToolbarContract({
  controller,
  navigation,
  layout,
}: {
  controller: LayeredEditorController;
  navigation: ToolbarFileNavigationProps;
  layout: PaneToolbarLayout;
}) {
  const boardProps: PaintingBoardProps = { controller, ...navigation, layout };
  return (
    <>
      <PaintingBoard {...boardProps} />
      <Toolbar controller={controller} {...navigation} layout={layout} />
      <ToolbarShell layout={layout}>
        <ToolbarFileMenu {...navigation} layout={layout} />
      </ToolbarShell>
    </>
  );
}
