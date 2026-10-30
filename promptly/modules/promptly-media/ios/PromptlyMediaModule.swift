import AVFoundation
import ExpoModulesCore
import QuartzCore
import UIKit

// NOTE: Written against AVFoundation APIs available on iOS 16.4+ (Expo SDK 58 minimum).
// Not yet compiled in CI — see QUALITY_CHECKLIST.md "Native module verification".

struct WordTimingRecord: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
}

struct CueRecord: Record {
  @Field var startMs: Double = 0
  @Field var endMs: Double = 0
  @Field var text: String = ""
  /// One entry per space-separated token of `text`; optional.
  @Field var words: [WordTimingRecord]? = nil
}

struct CaptionStyleRecord: Record {
  @Field var fontWeight: String = "600"
  @Field var fontSizeRatio: Double = 0.052
  @Field var textColor: String = "#FFFFFF"
  @Field var backgroundColor: String? = nil
  @Field var strokeColor: String? = nil
  @Field var strokeWidthRatio: Double = 0
  @Field var uppercase: Bool = false
  @Field var highlightColor: String? = nil
  @Field var positionY: Double = 0.7
}

struct AudioSegmentRecord: Record {
  @Field var uri: String = ""
  /// Start of the segment relative to the video start; negative = audio began before the video.
  @Field var offsetMs: Double = 0
}

public final class PromptlyMediaModule: Module {
  private var sessions: [String: AVAssetExportSession] = [:]
  /// Jobs cancelled before their export session existed (asset loading is async); guarded by `lock`.
  private var cancelledJobs = Set<String>()
  private let lock = NSLock()
  /// Hardware remote keys (main thread only); see RemoteKeyResponder.swift.
  private var remoteKeys: RemoteKeyController?

  public func definition() -> ModuleDefinition {
    Name("PromptlyMedia")

    Events("onProgress", "onRemoteKey")

    Function("setRemoteKeysEnabled") { (enabled: Bool) in
      DispatchQueue.main.async { [weak self] in
        guard let self else { return }
        if enabled, self.remoteKeys == nil {
          self.remoteKeys = RemoteKeyController { [weak self] key, repeating in
            self?.sendEvent("onRemoteKey", ["key": key, "repeat": repeating])
          }
        }
        self.remoteKeys?.setEnabled(enabled)
      }
    }

    OnDestroy {
      let controller = self.remoteKeys
      DispatchQueue.main.async { controller?.setEnabled(false) }
      // JS reload / teardown: stop running exports instead of encoding for a dead runtime.
      let running = self.lock.withLock { Array(self.sessions.values) }
      running.forEach { $0.cancelExport() }
    }

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
        // atan2 yields -180...180; report 0/90/180/270 like Android.
        "rotation": (Int(angle.rounded()) + 360) % 360,
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

    AsyncFunction("muxAudio") {
      (jobId: String, videoUri: String, segments: [AudioSegmentRecord], outputUri: String) async throws -> String in
      // iOS Voice Follow "separate" strategy (DECISIONS D4): the camera recorded video only and the
      // recognizer persisted the microphone audio as WAV segments.
      return try await self.mux(jobId: jobId, video: try Self.url(videoUri), segments: segments, output: try Self.url(outputUri))
    }

    Function("cancel") { (jobId: String) in
      let session = self.lock.withLock { () -> AVAssetExportSession? in
        if let s = self.sessions[jobId] { return s }
        // Still loading the asset: runExport checks this before starting.
        self.cancelledJobs.insert(jobId)
        return nil
      }
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
    return try await runExport(jobId: jobId, session: session, output: output)
  }

  /// Video track of `video` plus the WAV segments placed on its timeline, exported as .mp4 (AAC audio).
  private func mux(jobId: String, video: URL, segments: [AudioSegmentRecord], output: URL) async throws -> String {
    let asset = AVURLAsset(url: video)
    guard let srcVideo = try await asset.loadTracks(withMediaType: .video).first else {
      throw Exception(name: "NoVideoTrack", description: "The file has no video track")
    }
    let duration = try await asset.load(.duration)
    let transform = try await srcVideo.load(.preferredTransform)

    let composition = AVMutableComposition()
    guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
      throw Exception(name: "CompositionFailed", description: "Could not create video track")
    }
    try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: srcVideo, at: .zero)
    // No video composition is used, so the export keeps the track's orientation metadata.
    videoTrack.preferredTransform = transform

    var placedAudio = false
    if !segments.isEmpty {
      guard let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else {
        throw Exception(name: "CompositionFailed", description: "Could not create audio track")
      }
      // One audio track, segments in time order, never overlapping (same rule as the Android
      // implementation): `cursor` is where the audio placed so far ends on the video timeline.
      var cursor = CMTime.zero
      for seg in segments.sorted(by: { $0.offsetMs < $1.offsetMs }) {
        let audioAsset = AVURLAsset(url: try Self.url(seg.uri))
        // An unreadable segment fails the whole mux: the caller then keeps every WAV for a retry
        // instead of deleting audio that never made it into the video.
        guard let srcAudio = try await audioAsset.loadTracks(withMediaType: .audio).first else {
          throw Exception(name: "NoAudioTrack", description: "An audio segment has no audio track")
        }
        let audioDuration = try await audioAsset.load(.duration)
        let offset = CMTime(seconds: seg.offsetMs / 1000, preferredTimescale: 48_000)
        // Positive offset: insert at that time. Negative offset (audio started before the video) or
        // overlap with the previous segment: trim the head of this WAV so it starts at `at`.
        let at = CMTimeMaximum(offset, cursor)
        let skip = CMTimeSubtract(at, offset)
        // Audio past the end of the video is dropped.
        let end = CMTimeMinimum(CMTimeAdd(offset, audioDuration), duration)
        guard CMTimeCompare(end, at) > 0 else { continue }
        if CMTimeCompare(at, cursor) > 0 {
          // Gap between segments (recognizer restart): silence.
          audioTrack.insertEmptyTimeRange(CMTimeRange(start: cursor, end: at))
        }
        try audioTrack.insertTimeRange(CMTimeRange(start: skip, duration: CMTimeSubtract(end, at)), of: srcAudio, at: at)
        cursor = end
        placedAudio = true
      }
      // Segments were given but none landed inside the video: fail instead of exporting a silent
      // take, so the caller keeps the WAVs rather than deleting audio that was never merged.
      if !placedAudio {
        throw Exception(name: "NoAudioPlaced", description: "No audio segment overlaps the video")
      }
    }

    try? FileManager.default.createDirectory(at: output.deletingLastPathComponent(), withIntermediateDirectories: true)
    if FileManager.default.fileExists(atPath: output.path) {
      try FileManager.default.removeItem(at: output)
    }
    // Preset choice: the recognizer writes LPCM (float32) WAV and the MP4 container cannot carry
    // LPCM, so AVAssetExportPresetPassthrough cannot produce an .mp4 once audio is added (the
    // export fails); AVAssetExportPresetAppleM4A would drop the video. HighestQuality is the stock
    // preset that encodes the audio to AAC inside an .mp4. Its cost is a high-bitrate re-encode of
    // the video (export time + slight generation loss); device test VF-01b measures it. With no
    // audio placed there is nothing to encode, so the video is copied as-is with Passthrough.
    let preset = placedAudio ? AVAssetExportPresetHighestQuality : AVAssetExportPresetPassthrough
    guard let session = AVAssetExportSession(asset: composition, presetName: preset) else {
      throw Exception(name: "ExportUnavailable", description: "Export session could not be created")
    }
    session.outputURL = output
    session.outputFileType = .mp4
    session.shouldOptimizeForNetworkUse = true
    return try await runExport(jobId: jobId, session: session, output: output)
  }

  /// Runs an export with onProgress events and cancel(jobId) support; returns the output URL string.
  private func runExport(jobId: String, session: AVAssetExportSession, output: URL) async throws -> String {
    // NSLock.lock() is unavailable from async contexts; withLock is not.
    let cancelledEarly = lock.withLock { () -> Bool in
      if cancelledJobs.remove(jobId) != nil { return true }
      sessions[jobId] = session
      return false
    }
    if cancelledEarly {
      throw Exception(name: "Cancelled", description: "Export cancelled")
    }
    defer { lock.withLock { sessions[jobId] = nil } }

    let box = ExportSessionBox(session: session)
    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now(), repeating: .milliseconds(250))
    timer.setEventHandler { [weak self] in
      self?.sendEvent("onProgress", ["jobId": jobId, "progress": Double(box.session.progress)])
    }
    timer.resume()
    // Same pattern as expo-media-library: avoids the iOS 18-only export(to:as:) and Sendable issues of export() async.
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      box.session.exportAsynchronously { continuation.resume() }
    }
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
    // The render size is already in pixels: a scale of 2 drew every caption layer at 4x the pixels.
    textLayer.contentsScale = 1
    textLayer.frame = CGRect(x: padH, y: padV, width: bounds.width, height: bounds.height)
    container.addSublayer(textLayer)

    let total = max(duration, cue.endMs / 1000)
    // Word highlight: one overlay per word, same string and frame as the base
    // layer, with every glyph clear except that word. Identical layout keeps
    // the coloured word exactly on top of the base word.
    let tokens = text.components(separatedBy: " ")
    if let hex = style.highlightColor, let highlight = UIColor(hex: hex), let words = cue.words, words.count == tokens.count {
      var location = 0
      for (i, token) in tokens.enumerated() {
        let range = NSRange(location: location, length: (token as NSString).length)
        location += range.length + 1
        let marked = NSMutableAttributedString(attributedString: attributed)
        let whole = NSRange(location: 0, length: marked.length)
        marked.addAttribute(.foregroundColor, value: UIColor.clear, range: whole)
        if attributes[.strokeColor] != nil { marked.addAttribute(.strokeColor, value: UIColor.clear, range: whole) }
        marked.addAttribute(.foregroundColor, value: highlight, range: range)
        if let stroke = attributes[.strokeColor] { marked.addAttribute(.strokeColor, value: stroke, range: range) }
        let wordLayer = CATextLayer()
        wordLayer.string = marked
        wordLayer.isWrapped = true
        wordLayer.alignmentMode = .center
        wordLayer.contentsScale = 1
        wordLayer.frame = textLayer.frame
        // Lit from this word's start until the next word starts (no flicker in pauses).
        let from = min(max(words[i].startMs, cue.startMs), cue.endMs)
        let to = i + 1 < words.count ? min(max(words[i + 1].startMs, from), cue.endMs) : cue.endMs
        if to > from {
          Self.showOnly(wordLayer, fromMs: from, toMs: to, total: total)
          container.addSublayer(wordLayer)
        }
      }
    }

    // Visible only between cue start and end.
    Self.showOnly(container, fromMs: cue.startMs, toMs: cue.endMs, total: total)
    return container
  }

  private static func showOnly(_ layer: CALayer, fromMs: Double, toMs: Double, total: Double) {
    layer.opacity = 0
    guard total > 0 else { return }
    let show = CAKeyframeAnimation(keyPath: "opacity")
    // Discrete mode: keyTimes runs 0...1 with one more entry than values, and
    // must be non-decreasing. Clamp so negative or inverted cue times (bad data)
    // cannot produce an invalid animation.
    let start = min(max(fromMs / 1000 / total, 0), 1)
    let end = min(max(toMs / 1000 / total, start), 1)
    show.values = [0, 1, 0]
    show.keyTimes = [0, NSNumber(value: start), NSNumber(value: end), 1]
    show.calculationMode = .discrete
    show.duration = total
    show.beginTime = AVCoreAnimationBeginTimeAtZero
    show.isRemovedOnCompletion = false
    show.fillMode = .both
    layer.add(show, forKey: "visibility")
  }
}

private struct ExportSessionBox: @unchecked Sendable {
  let session: AVAssetExportSession
}

fileprivate extension UIColor {
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
