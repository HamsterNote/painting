// Deterministic UIKit stand-ins for testing the production sampler on a host Swift toolchain.
// These do not simulate PencilKit rendering or establish device sampling evidence.
@_exported import Foundation
#if canImport(CoreGraphics)
@_exported import CoreGraphics
#endif

public enum TouchType {
  case pencil, direct
}

public struct TouchProperties: OptionSet {
  public let rawValue: Int
  public init(rawValue: Int) { self.rawValue = rawValue }
}

open class UIView: NSObject {
  public var bounds = CGRect(x: 0, y: 0, width: 100, height: 100)
  open func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {}
  open func touchesEstimatedPropertiesUpdated(_ touches: Set<UITouch>) {}
}

public final class UITouch: NSObject {
  public var timestamp: TimeInterval
  public var type: TouchType = .pencil
  public var force = 0.0
  public var maximumPossibleForce = 1.0
  public var estimatedProperties = TouchProperties(rawValue: 0)
  public var estimatedPropertiesExpectingUpdates = TouchProperties(rawValue: 0)
  public var location = CGPoint(x: 5, y: 5)

  public init(_ timestamp: TimeInterval) { self.timestamp = timestamp }
  public func preciseLocation(in view: UIView) -> CGPoint { location }
}

public final class UIEvent: NSObject {
  private let coalesced: [UITouch]
  public init(_ coalesced: [UITouch]) { self.coalesced = coalesced }
  public func coalescedTouches(for touch: UITouch) -> [UITouch]? { coalesced }
}

public final class UIDevice {
  public static let current = UIDevice()
  public let model = "host-test"
}
