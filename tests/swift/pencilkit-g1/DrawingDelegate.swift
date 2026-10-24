// Gesture forwarding is compiled against UIKit by the Darwin SDK check, not this host fixture.
import UIKit

final class PencilkitDemoDrawingDelegate: NSObject {
  weak var original: AnyObject?
  weak var hostedDOMView: UIView?
  var accepts: (UITouch) -> Bool = { _ in false }
}
