// Only the Expo event/view boundary is replaced; the production view is compiled unchanged.
import UIKit

public final class AppContext {}

open class ExpoView: UIView {
  public required init(appContext: AppContext? = nil) { super.init(frame: .zero) }
  public required init?(coder: NSCoder) { fatalError("not used by tests") }
  open func mountChildComponentView(_ childComponentView: UIView, index: Int) {}
  open func unmountChildComponentView(_ childComponentView: UIView, index: Int) {}
}

public final class EventDispatcher {
  public var events: [[String: Any]] = []
  public init() {}
  public func callAsFunction(_ event: [String: Any]) { events.append(event) }
}
