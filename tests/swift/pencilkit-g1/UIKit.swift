// Deterministic UIKit stand-ins for testing the production sampler on a host Swift toolchain.
// These do not simulate PencilKit rendering or establish device sampling evidence.
@_exported import Foundation
#if canImport(CoreGraphics)
@_exported import CoreGraphics
#endif

public enum HostTouchType: Int {
  case direct = 0, pencil = 2
}
public typealias TouchType = HostTouchType

public enum TouchPhase {
  case began, moved, stationary, ended, cancelled
}

public struct TouchProperties: OptionSet {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }
}

#if os(Linux)
public class UndoManager {}
#endif

open class UIView: NSObject {
  private var children: [UIView] = []
  public private(set) var gestureRecognizers: [UIGestureRecognizer]? = []
  public var subviews: [UIView] { children }
  public override init() { super.init() }
  public init(frame: CGRect) {
    super.init()
    self.frame = frame
  }
  public weak var superview: UIView?
  open var window: UIWindow? { superview?.window }
  public var backgroundColor: UIColor?
  public var isOpaque = true
  public func addSubview(_ view: UIView) {
    view.removeFromSuperview()
    children.append(view)
    view.superview = self
  }
  public func insertSubview(_ view: UIView, at index: Int) {
    view.removeFromSuperview()
    children.insert(view, at: index)
    view.superview = self
  }
  public func removeFromSuperview() {
    superview?.children.removeAll { $0 === self }
    superview = nil
  }
  public func isDescendant(of view: UIView) -> Bool {
    var current: UIView? = self
    while let candidate = current {
      if candidate === view { return true }
      current = candidate.superview
    }
    return false
  }
  public func addGestureRecognizer(_ recognizer: UIGestureRecognizer) {
    gestureRecognizers?.append(recognizer)
    recognizer.view = self
  }
  open var undoManager: UndoManager? { nil }
  public var bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
  public var frame = CGRect(x: 0, y: 0, width: 100, height: 100) {
    didSet { bounds.size = frame.size }
  }
  public var isHidden = false
  public var isUserInteractionEnabled = true
  public var alpha: CGFloat = 1
  open func layoutSubviews() {}
  open func didMoveToWindow() {}
  open func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    !isHidden && isUserInteractionEnabled && alpha >= 0.01 && bounds.contains(point) ? self : nil
  }
  public func convert(_ point: CGPoint, to view: UIView?) -> CGPoint {
    func origin(_ view: UIView?) -> CGPoint {
      guard let view else { return .zero }
      let parent = origin(view.superview)
      return CGPoint(x: parent.x + view.frame.minX - view.bounds.minX,
                     y: parent.y + view.frame.minY - view.bounds.minY)
    }
    let source = origin(self)
    let destination = origin(view)
    return CGPoint(x: point.x + source.x - destination.x, y: point.y + source.y - destination.y)
  }
  public func convert(_ rect: CGRect, to view: UIView?) -> CGRect {
    CGRect(origin: convert(rect.origin, to: view), size: rect.size)
  }
  open func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {}
}

open class UIWindow: UIView {
  open override var window: UIWindow? { self }
}

public struct UIColor {
  private var token = 0
  private var alpha: CGFloat = 1
  public static let clear = UIColor(token: 0, alpha: 0)
  public static let systemBlue = UIColor(token: 1, alpha: 1)
  public func withAlphaComponent(_ alpha: CGFloat) -> UIColor {
    UIColor(token: token, alpha: alpha)
  }
  public func isEqual(_ other: UIColor) -> Bool { token == other.token && alpha == other.alpha }
}

public final class UITouch: NSObject {
  public typealias TouchType = HostTouchType
  public var timestamp: TimeInterval
  public var type: TouchType = .pencil
  public var phase: TouchPhase = .began
  public var force = 0.0
  public var maximumPossibleForce = 1.0
  public var estimatedProperties = TouchProperties(rawValue: 0)
  public var estimatedPropertiesExpectingUpdates = TouchProperties(rawValue: 0)
  public var location = CGPoint(x: 5, y: 5)

  public init(_ timestamp: TimeInterval) { self.timestamp = timestamp }
  public func preciseLocation(in view: UIView) -> CGPoint {
    CGPoint(x: location.x - view.frame.minX, y: location.y - view.frame.minY)
  }
  public func location(in view: UIView) -> CGPoint { preciseLocation(in: view) }
}

public enum GestureState { case possible, failed }
open class UIGestureRecognizer: NSObject {
  public weak var view: UIView?
  public weak var delegate: AnyObject?
  public var isEnabled = true
  public var state: GestureState = .possible
  public var allowedTouchTypes: [NSNumber] = []
  public var requiresExclusiveTouchType = true
  public var cancelsTouchesInView = true
  public var delaysTouchesBegan = true
  public var delaysTouchesEnded = true
  public var ignoredTouches = Set<UITouch>()
  public init(target: Any?, action: String?) { super.init() }
  public required init?(coder: NSCoder) { super.init() }
  open func canPrevent(_ recognizer: UIGestureRecognizer) -> Bool { true }
  open func canBePrevented(by recognizer: UIGestureRecognizer) -> Bool { true }
  public func ignore(_ touch: UITouch, for event: UIEvent) { ignoredTouches.insert(touch) }
  open func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {}
  open func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {}
  open func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {}
  open func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {}
  open func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {}
}

public final class UIEvent: NSObject {
  private let coalesced: [UITouch]
  public var allTouches: Set<UITouch>? { Set(coalesced) }
  public init(_ coalesced: [UITouch]) { self.coalesced = coalesced }
  public func coalescedTouches(for touch: UITouch) -> [UITouch]? { coalesced }
}

public final class UIDevice {
  public static let current = UIDevice()
  public let model = "host-test"
}
