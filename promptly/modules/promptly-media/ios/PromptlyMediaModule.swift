import AVFoundation
import ExpoModulesCore
import QuartzCore
import UIKit

// NOTE: Written against AVFoundation APIs available on iOS 16.4+ (Expo SDK 58 minimum).
// Not yet compiled in CI — see QUALITY_CHECKLIST.md "Native module verification".

struct CueRecord: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
  @Field var text: String = ""
}

struct CaptionStyleRecord: Record {
  @Field var fontWeight: String = "600"
  @Field var fontSizeRatio: Double = 0.052
  @Field var textColor: String = "#FFFFFF"
  @Field var backgroundColor: String? = nil
  @Field var strokeColor: String? = nil
  @Field var strokeWidthRatio: Double = 0
  @Field var uppercase: Bool = false
  @Field var positionY: Double = 0.7
}

public final class PromptlyMediaModule: Module {
  private var sessions: [String: AVAssetExportSession] = [:]
  private let lock = NSLock()

  public func definition() -> ModuleDefinition {
    Name("PromptlyMedia")

    Events("onProgress")

    AsyncFunction("getVideoInfo") { (uri: String) async throws -> [String: Any] in
      let asset = AVURLAsset(url: try Self.url(uri))
      guard let track = try await asset.loadTracks(withMediaType: .video).first else {
        throw Exception(name: "NoVideoTrack", description: "The file has no video track")
      }
      let (naturalSize, transform) = try await track.load(.naturalSize, .preferredTransform)
      let display = naturalSize.applying(transform)
      let duration = try await asset.load(.duration)
      let audioTracks = try await asset.loadTracks(withMediaType: .audio)
      let angle = atan2(transform.b, transform.a) * 180 / .pi
      return [
        "width": abs(display.width),
        "height": abs(display.height),
        "durationMs": CMTimeGetSeconds(duration) * 1000,
        "rotation": Int(angle.rounded()),
        "hasAudio": !audioTracks.isEmpty,
      ]
    }

    AsyncFunction("burnInCaptions") {
      (jobId: String, inputUri: String, outputUri: String, cues: [CueRecord], style: CaptionStyleRecord) async throws -> String in
      return try await self.burnIn(jobId: jobId, input: try Self.url(inputUri), output: try Self.url(outputUri), cues: cues, style: style)
    }

    AsyncFunction("extractAudioToWav") { (_: String, _: String, _: Int) async throws -> [String: Any] in
      // iOS speech recognition reads the movie directly; not needed.
      throw Exception(name: "Unsupported", description: "extractAudioToWav is Android-only")
    }

    AsyncFunction("muxAudio") { (_: String, _: String, _: [[String: Any]], _: String) async throws -> String in
      throw Exception(name: "Unsupported", description: "muxAudio is Android-only (iOS records audio with video)")
    }

    Function("cancel") { (jobId: String) in
      self.lock.lock()
      let session = self.sessions[jobId]
      self.lock.unlock()
      session?.cancelExport()
    }
  }

  private static func url(_ uri: String) throws -> URL {
    if let u = URL(string: uri), u.scheme != nil { return u }
    return URL(fileURLWithPath: uri)
  }

  private func burnIn(jobId: String, input: URL, output: URL, cues: [CueRecord], style: CaptionStyleRecord) async throws -> String {
    let asset = AVURLAsset(url: input)
    guard let srcVideo = try await asset.loadTracks(withMediaType: .video).first else {
      throw Exception(name: "NoVideoTrack", description: "The file has no video track")
    }
    let duration = try await asset.load(.duration)
    let (naturalSize, transform) = try await srcVideo.load(.naturalSize, .preferredTransform)

    let composition = AVMutableComposition()
    let range = CMTimeRange(start: .zero, duration: duration)
    guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      throw Exception(name: "CompositionFailed", description: "Could not create video track")
    }
    try videoTrack.insertTimeRange(range, of: srcVideo, at: .zero)
    for srcAudio in try await asset.loadTracks(withMediaType: .audio) {
      if let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
        try audioTrack.insertTimeRange(range, of: srcAudio, at: .zero)
      }
    }

    // Render size in display orientation.
    let displayRect = CGRect(origin: .zero, size: naturalSize).applying(transform)
    let renderSize = CGSize(width: abs(displayRect.width), height: abs(displayRect.height))

    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = range
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: videoTrack)
    // Normalise the transform so the rotated frame sits at the origin.
    var t = transform
    t.tx -= displayRect.origin.x
    t.ty -= displayRect.origin.y
    layerInstruction.setTransform(t, at: .zero)
    instruction.layerInstructions = [layerInstruction]

    let videoComposition = AVMutableVideoComposition()
    videoComposition.renderSize = renderSize
    let fps = (try? await srcVideo.load(.nominalFrameRate)) ?? 30
    videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(24, min(60, fps.rounded()))))
    videoComposition.instructions = [instruction]

    let parent = CALayer()
    parent.frame = CGRect(origin: .zero, size: renderSize)
    let videoLayer = CALayer()
    videoLayer.frame = parent.frame
    parent.addSublayer(videoLayer)
    for cue in cues {
      parent.addSublayer(Self.captionLayer(cue: cue, style: style, renderSize: renderSize, duration: CMTimeGetSeconds(duration)))
    }
    // Core Animation's origin is bottom-left in the export context.
    parent.isGeometryFlipped = true
    videoComposition.animationTool = AVVideoCompositionCoreAnimationTool(postProcessingAsVideoLayer: videoLayer, in: parent)

    if FileManager.default.fileExists(atPath: output.path) {
      try FileManager.default.removeItem(at: output)
    }
    guard let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
      throw Exception(name: "ExportUnavailable", description: "Export session could not be created")
    }
    session.videoComposition = videoComposition
    session.outputURL = output
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true

    lock.lock()
    sessions[jobId] = session
    lock.unlock()
    defer {
      lock.lock()
      sessions[jobId] = nil
      lock.unlock()
    }

    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { [weak self, weak session] in
      guard let session else { return }
      self?.sendEvent("onProgress", ["jobId": jobId, "progress": Double(session.progress)])
    }
    timer.resume()
    await session.export()
    timer.cancel()

    switch session.status {
    case .completed:
      sendEvent("onProgress", ["jobId": jobId, "progress": 1.0])
      return output.absoluteString
    case .cancelled:
      try? FileManager.default.removeItem(at: output)
      throw Exception(name: "Cancelled", description: "Export cancelled")
    default:
      try? FileManager.default.removeItem(at: output)
      throw Exception(name: "ExportFailed", description: session.error?.localizedDescription ?? "Unknown export error")
    }
  }

  private static func captionLayer(cue: CueRecord, style: CaptionStyleRecord, renderSize: CGSize, duration: Double) -> CALayer {
    let text = style.uppercase ? cue.text.uppercased() : cue.text
    let fontSize = renderSize.width * CGFloat(style.fontSizeRatio)
    let weight: UIFont.Weight = style.fontWeight == "900" ? .black : style.fontWeight == "800" ? .heavy : .semibold
    let font = UIFont.systemFont(ofSize: fontSize, weight: weight)
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    var attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: UIColor(hex: style.textColor) ?? .white,
      .paragraphStyle: paragraph,
    ]
    if let stroke = style.strokeColor, style.strokeWidthRatio > 0 {
      attributes[.strokeColor] = UIColor(hex: stroke) ?? .black
      // Negative width = stroke + fill. Expressed as a percentage of font size.
      attributes[.strokeWidth] = -(style.strokeWidthRatio / style.fontSizeRatio) * 100
    }
    let attributed = NSAttributedString(string: text, attributes: attributes)
    let maxWidth = renderSize.width * 0.86
    let bounds = attributed.boundingRect(with: CGSize(width: maxWidth, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin], context: nil).integral
    let padH = fontSize * 0.45
    let padV = fontSize * 0.25
    let boxSize = CGSize(width: bounds.width + padH * 2, height: bounds.height + padV * 2)

    let container = CALayer()
    container.frame = CGRect(
      x: (renderSize.width - boxSize.width) / 2,
      y: renderSize.height * CGFloat(style.positionY) - boxSize.height / 2,
      width: boxSize.width,
      height: boxSize.height)
    if let bg = style.backgroundColor, let color = UIColor(hex: bg) {
      container.backgroundColor = color.cgColor
      container.cornerRadius = fontSize * 0.3
    }
    let textLayer = CATextLayer()
    textLayer.string = attributed
    textLayer.isWrapped = true
    textLayer.alignmentMode = .center
    textLayer.contentsScale = 2
    textLayer.frame = CGRect(x: padH, y: padV, width: bounds.width, height: bounds.height)
    container.addSublayer(textLayer)

    // Visible only between cue start and end.
    container.opacity = 0
    let show = CAKeyframeAnimation(keyPath: "opacity")
    let total = max(duration, cue.endMs / 1000)
    let start = cue.startMs / 1000 / total
    let end = cue.endMs / 1000 / total
    show.values = [0, 1, 1, 0]
    show.keyTimes = [NSNumber(value: start), NSNumber(value: start), NSNumber(value: end), NSNumber(value: end)]
    show.calculationMode = .discrete
    show.duration = total
    show.beginTime = AVCoreAnimationBeginTimeAtZero
    show.isRemovedOnCompletion = false
    show.fillMode = .both
    container.add(show, forKey: "visibility")
    return container
  }
}

extension UIColor {
  /// Accepts #RRGGBB, #RRGGBBAA and rgba(r,g,b,a).
  convenience init?(hex: String) {
    let s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("rgba(") {
      let parts = s.dropFirst(5).dropLast().split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) ?? 0 }
      guard parts.count == 4 else { return nil }
      self.init(red: parts[0] / 255, green: parts[1] / 255, blue: parts[2] / 255, alpha: parts[3])
      return
    }
    var h = s.hasPrefix("#") ? String(s.dropFirst()) : s
    if h.count == 6 { h += "FF" }
    guard h.count == 8, let v = UInt64(h, radix: 16) else { return nil }
    self.init(
      red: CGFloat((v >> 24) & 0xFF) / 255,
      green: CGFloat((v >> 16) & 0xFF) / 255,
      blue: CGFloat((v >> 8) & 0xFF) / 255,
      alpha: CGFloat(v & 0xFF) / 255)
  }
}
