import type { LayeredEditorController } from '../core/layeredEditorController';
import type { Point } from '../model/document';

let nextToken = 0;

export function createZoomFeedback(controller: LayeredEditorController, view: Window) {
  let timer: number | undefined;
  let token: number | undefined;
  const clear = () => {
    view.clearTimeout(timer);
    if (token !== undefined && controller.getSnapshot('navigation').zoomFeedback?.token === token)
      controller.setNavigation({ zoomFeedback: null });
    token = undefined;
  };
  return {
    show(scale: number, point: Point) {
      view.clearTimeout(timer);
      token = ++nextToken;
      controller.setNavigation({ zoomFeedback: { scale, point, token } });
      timer = view.setTimeout(clear, 700);
    },
    clear,
  };
}
