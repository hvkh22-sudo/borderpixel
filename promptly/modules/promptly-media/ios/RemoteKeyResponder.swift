import UIKit

// Hardware remote / keyboard keys for the teleprompter (docs/architecture/remote-control.md).
//
// React Native 0.88 does not deliver hardware key events to JS on iOS (no key handling in
// RCTViewComponentView; `onKeyDown` is Android-only and behind a feature flag), so this view
// becomes first responder while the record screen listens and forwards `UIPress.key`
// (iOS 13.4+) to JS. It is a plain UIView: it does not adopt UIKeyInput, so becoming first
// responder never shows the software keyboard. Unhandled presses go to `super` (responder chain).
//
// NOTE: not compiled in CI. Written against UIKit APIs (UIPress.key, UIKeyboardHIDUsage).

final class RemoteKeyResponderView: UIView {
  /// Called on the main thread with (key name, isRepeat).
  var onKey: ((String, Bool) -> Void)?

  override var canBecomeFirstResponder: Bool { true }

  override init(frame: CGRect) {
    super.init(frame: frame)
    // Must stay true: UIKit drops press (and keyboard) events for views with user interaction
    // disabled, so pressesBegan would never fire. Zero frame means it never wins a touch hit-test.
    isUserInteractionEnabled = true
    isAccessibilityElement = false
    accessibilityElementsHidden = true
    backgroundColor = .clear
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  static func keyName(_ key: UIKey) -> String? {
    switch key.keyCode {
    case .keyboardUpArrow: return "ArrowUp"
    case .keyboardDownArrow: return "ArrowDown"
    case .keyboardLeftArrow: return "ArrowLeft"
    case .keyboardRightArrow: return "ArrowRight"
    case .keyboardPageUp: return "PageUp"
    case .keyboardPageDown: return "PageDown"
    case .keyboardSpacebar: return "Space"
    case .keyboardReturnOrEnter, .keypadEnter: return "Enter"
    default: return nil
    }
  }

  /// Presses we forward; modifier combos (Cmd+Arrow etc.) are left to the system.
  private func handled(_ press: UIPress) -> String? {
    guard let key = press.key, key.modifierFlags.intersection([.command, .control, .alternate]).isEmpty else { return nil }
    return Self.keyName(key)
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var rest = Set<UIPress>()
    for press in presses {
      if let name = handled(press) {
        onKey?(name, false)
      } else {
        rest.insert(press)
      }
    }
    if !rest.isEmpty { super.pressesBegan(rest, with: event) }
  }

  // Consume the matching phases of presses we handled so they do not reach other responders.
  override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let rest = presses.filter { handled($0) == nil }
    if !rest.isEmpty { super.pressesEnded(rest, with: event) }
  }

  override func pressesChanged(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let rest = presses.filter { handled($0) == nil }
    if !rest.isEmpty { super.pressesChanged(rest, with: event) }
  }

  override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    let rest = presses.filter { handled($0) == nil }
    if !rest.isEmpty { super.pressesCancelled(rest, with: event) }
  }
}

/// Owns the responder view while enabled. Main thread only.
final class RemoteKeyController {
  private var view: RemoteKeyResponderView?
  private var observers: [NSObjectProtocol] = []
  private let emit: (String, Bool) -> Void

  init(emit: @escaping (String, Bool) -> Void) {
    self.emit = emit
  }

  func setEnabled(_ enabled: Bool) {
    dispatchPrecondition(condition: .onQueue(.main))
    enabled ? enable() : disable()
  }

  private func enable() {
    if view == nil {
      let v = RemoteKeyResponderView(frame: .zero)
      v.onKey = { [weak self] name, repeating in self?.emit(name, repeating) }
      view = v
      // An alert or another window can take first responder; reclaim when our window is key again.
      let center = NotificationCenter.default
      observers = [
        center.addObserver(forName: UIWindow.didBecomeKeyNotification, object: nil, queue: .main) { [weak self] _ in self?.attach() },
        center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in self?.attach() },
      ]
    }
    attach()
  }

  private func disable() {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
    observers = []
    if let v = view {
      v.onKey = nil
      if v.isFirstResponder { v.resignFirstResponder() }
      v.removeFromSuperview()
    }
    view = nil
  }

  private func attach() {
    guard let v = view, let window = Self.keyWindow() else { return }
    if v.window !== window {
      v.removeFromSuperview()
      window.addSubview(v)
    }
    // Do not steal focus from a text field the user is typing in.
    if !v.isFirstResponder, !Self.textInputIsActive(in: window) {
      v.becomeFirstResponder()
    }
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  private static func textInputIsActive(in view: UIView) -> Bool {
    if view.isFirstResponder, view is UIKeyInput { return true }
    return view.subviews.contains { textInputIsActive(in: $0) }
  }

  deinit {
    observers.forEach { NotificationCenter.default.removeObserver($0) }
  }
}
