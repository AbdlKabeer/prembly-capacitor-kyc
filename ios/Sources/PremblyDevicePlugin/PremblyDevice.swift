import Foundation

@objc public class PremblyDevice: NSObject {
    @objc public func echo(_ value: String) -> String {
        print(value)
        return value
    }
}
