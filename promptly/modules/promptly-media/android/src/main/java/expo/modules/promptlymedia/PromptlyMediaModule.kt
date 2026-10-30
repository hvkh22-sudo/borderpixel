package expo.modules.promptlymedia

// NOTE: Written against Media3 1.11.x and Expo Modules (classic DSL).
// Not yet compiled in CI — see QUALITY_CHECKLIST.md "Native module verification".

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.ForegroundColorSpan
import androidx.annotation.OptIn
import androidx.core.os.bundleOf
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import com.google.common.collect.ImmutableList
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class WordTimingRecord : Record {
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
}

class CueRecord : Record {
  @Field val startMs: Double = 0.0
  @Field val endMs: Double = 0.0
  @Field val text: String = ""
  /** One entry per space-separated token of [text]; optional. */
  @Field val words: List<WordTimingRecord>? = null
}

class AudioSegmentRecord : Record {
  @Field val uri: String = ""
  @Field val offsetMs: Double = 0.0
}

class CaptionStyleRecord : Record {
  @Field val fontWeight: String = "600"
  @Field val fontSizeRatio: Double = 0.052
  @Field val textColor: String = "#FFFFFF"
  @Field val backgroundColor: String? = null
  @Field val strokeColor: String? = null
  @Field val strokeWidthRatio: Double = 0.0
  @Field val uppercase: Boolean = false
  @Field val highlightColor: String? = null
  @Field val positionY: Double = 0.7
}

private class ActiveExport(val transformer: Transformer, val promise: Promise, val outFile: File)

@OptIn(UnstableApi::class)
class PromptlyMediaModule : Module() {
  // Main-thread only: Transformer is bound to the Looper it was built on.
  private val exports = mutableMapOf<String, ActiveExport>()
  private val cancelledBeforeStart = mutableSetOf<String>()
  /** Set on teardown: a job still reading files off the main thread must not start afterwards. */
  @Volatile private var destroyed = false
  private val mainHandler by lazy { Handler(Looper.getMainLooper()) }
  private val context get() = requireNotNull(appContext.reactContext) { "React context unavailable" }

  override fun definition() = ModuleDefinition {
    Name("PromptlyMedia")

    Events("onProgress", "onRemoteKey")

    // Hardware remote keys (PromptlyMediaPackage.kt). While enabled, forwarded keys are consumed.
    AsyncFunction("setRemoteKeysEnabled") { enabled: Boolean ->
      RemoteKeys.emitter = if (enabled) {
        { key: String, repeat: Boolean -> sendEvent("onRemoteKey", bundleOf("key" to key, "repeat" to repeat)) }
      } else {
        null
      }
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      destroyed = true
      RemoteKeys.emitter = null
      // JS reload / teardown: stop running exports (they would keep encoding for a dead runtime).
      mainHandler.post {
        exports.values.forEach {
          it.transformer.cancel()
          it.outFile.delete()
        }
        exports.clear()
      }
    }

    AsyncFunction("getVideoInfo") { uri: String ->
      val r = MediaMetadataRetriever()
      try {
        r.setDataSource(context, Uri.parse(uri))
        val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
        val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
        val rotation = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
        val duration = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
        val hasAudio = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"
        val rotated = rotation == 90 || rotation == 270
        mapOf(
          "width" to if (rotated) h else w,
          "height" to if (rotated) w else h,
          "durationMs" to duration,
          "rotation" to rotation,
          "hasAudio" to hasAudio,
        )
      } finally {
        r.release()
      }
    }

    AsyncFunction("burnInCaptions") { jobId: String, inputUri: String, outputUri: String, cues: List<CueRecord>, style: CaptionStyleRecord, promise: Promise ->
      val width = videoDisplayWidth(inputUri)
      val overlay = CaptionOverlay(cues.sortedBy { it.startMs }, style, width)
      val effects = Effects(ImmutableList.of(), ImmutableList.of<Effect>(OverlayEffect(ImmutableList.of<TextureOverlay>(overlay))))
      val item = EditedMediaItem.Builder(MediaItem.fromUri(inputUri)).setEffects(effects).build()
      // The width lookup above reads the file, so this runs on the module's background queue; the
      // Transformer itself must be built and started on the main looper.
      mainHandler.post { runTransformer(jobId, outputUri, promise) { t, path -> t.start(item, path) } }
    }

    AsyncFunction("muxAudio") { jobId: String, videoUri: String, segments: List<AudioSegmentRecord>, outputUri: String, promise: Promise ->
      val video = EditedMediaItem.Builder(MediaItem.fromUri(videoUri)).setRemoveAudio(true).build()
      val audioSeq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO))
      // Same placement rule as iOS: audio past the end of the video is dropped (otherwise the
      // longer audio sequence would extend the output past the last video frame), and a segment
      // entirely covered by earlier audio is skipped (a clip starting at/after its own end is invalid).
      // A segment whose duration cannot be read (0: unreadable, or an empty header-only WAV from a
      // recognizer restart) is skipped, as on iOS: placed untrimmed it would shift every later segment
      // by its real length and could run past the video.
      val videoMs = mediaDurationMs(videoUri)
      var cursorMs = 0.0
      var placedAudio = 0
      for (seg in segments.sortedBy { it.offsetMs }) {
        val segMs = mediaDurationMs(seg.uri)
        if (segMs <= 0) continue
        val startMs = max(cursorMs, seg.offsetMs)
        val segEndMs = seg.offsetMs + segMs
        val endMs = if (videoMs > 0) min(segEndMs, videoMs) else segEndMs
        if (endMs <= startMs) continue
        if (startMs > cursorMs) audioSeq.addGap(((startMs - cursorMs) * 1000).toLong())
        val clip = MediaItem.ClippingConfiguration.Builder()
        // Overlap / audio started before the video: drop the leading part.
        if (startMs > seg.offsetMs) clip.setStartPositionMs((startMs - seg.offsetMs).toLong())
        if (endMs < segEndMs) clip.setEndPositionMs((endMs - seg.offsetMs).toLong())
        val item = MediaItem.Builder().setUri(seg.uri).setClippingConfiguration(clip.build()).build()
        audioSeq.addItem(EditedMediaItem.Builder(item).setRemoveVideo(true).build())
        placedAudio++
        cursorMs = endMs
      }
      // Segments were given but none landed inside the video: fail instead of exporting a silent
      // take, so the caller keeps the WAVs rather than deleting audio that was never merged.
      if (segments.isNotEmpty() && placedAudio == 0) {
        promise.reject(CodedException("NoAudioPlaced", "No audio segment overlaps the video", null))
      } else {
        val videoSeq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO)).addItem(video).build()
        // A sequence must contain at least one item.
        val composition = if (placedAudio == 0) {
          Composition.Builder(videoSeq).build()
        } else {
          Composition.Builder(videoSeq, audioSeq.build()).build()
        }
        // Duration reads above happen off the main thread (one per segment); the Transformer runs on it.
        mainHandler.post { runTransformer(jobId, outputUri, promise) { t, path -> t.start(composition, path) } }
      }
    }

    AsyncFunction("extractAudioToWav") { inputUri: String, outputUri: String, sampleRate: Int ->
      extractWav(inputUri, outputUri, sampleRate)
    }

    Function("cancel") { jobId: String ->
      mainHandler.post {
        // Transformer.cancel() does not invoke the listener, so settle the promise here.
        val active = exports.remove(jobId)
        if (active != null) {
          active.transformer.cancel()
          active.outFile.delete()
          active.promise.reject(CodedException("Cancelled", "Export cancelled", null))
        } else {
          // Not started yet (still reading durations off the main thread): runTransformer drops it.
          cancelledBeforeStart.add(jobId)
        }
      }
      Unit
    }
  }

  private fun runTransformer(jobId: String, outputUri: String, promise: Promise, start: (Transformer, String) -> Unit) {
    if (cancelledBeforeStart.remove(jobId) || destroyed) {
      promise.reject(CodedException("Cancelled", "Export cancelled", null))
      return
    }
    val outFile = File(Uri.parse(outputUri).path ?: outputUri)
    outFile.parentFile?.mkdirs()
    if (outFile.exists()) outFile.delete()
    val transformer = Transformer.Builder(context)
      .setVideoMimeType(MimeTypes.VIDEO_H264)
      .setAudioMimeType(MimeTypes.AUDIO_AAC)
      .addListener(object : Transformer.Listener {
        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
          exports.remove(jobId)
          sendEvent("onProgress", bundleOf("jobId" to jobId, "progress" to 1.0))
          promise.resolve(Uri.fromFile(outFile).toString())
        }

        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
          exports.remove(jobId)
          outFile.delete()
          promise.reject(CodedException("ExportFailed", exportException.message ?: "Export failed", exportException))
        }
      })
      .build()
    exports[jobId] = ActiveExport(transformer, promise, outFile)
    try {
      start(transformer, outFile.absolutePath)
    } catch (e: RuntimeException) {
      exports.remove(jobId)
      outFile.delete()
      promise.reject(CodedException("ExportFailed", e.message ?: "Export failed to start", e))
      return
    }
    val holder = ProgressHolder()
    val poll = object : Runnable {
      override fun run() {
        val t = exports[jobId]?.transformer ?: return
        if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
          sendEvent("onProgress", bundleOf("jobId" to jobId, "progress" to holder.progress / 100.0))
        }
        mainHandler.postDelayed(this, 250)
      }
    }
    mainHandler.post(poll)
  }

  /** Container duration in ms (any media file), or 0 when it cannot be read. */
  private fun mediaDurationMs(uri: String): Double {
    val r = MediaMetadataRetriever()
    return try {
      r.setDataSource(context, Uri.parse(uri))
      r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toDoubleOrNull() ?: 0.0
    } catch (e: RuntimeException) {
      0.0
    } finally {
      r.release()
    }
  }

  private fun videoDisplayWidth(uri: String): Int {
    val r = MediaMetadataRetriever()
    return try {
      r.setDataSource(context, Uri.parse(uri))
      val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 1080
      val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 1920
      val rot = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
      if (rot == 90 || rot == 270) h else w
    } finally {
      r.release()
    }
  }

  /** Decodes the first audio track to mono 16-bit PCM WAV at [targetRate]. */
  private fun extractWav(inputUri: String, outputUri: String, targetRate: Int): Map<String, Any> {
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, Uri.parse(inputUri), null)
    } catch (e: Exception) {
      extractor.release()
      throw e
    }
    val trackIndex = (0 until extractor.trackCount).firstOrNull {
      extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
    } ?: run {
      extractor.release()
      throw CodedException("NoAudioTrack", "The recording has no audio track", null)
    }
    extractor.selectTrack(trackIndex)
    val format = extractor.getTrackFormat(trackIndex)
    val outFile = File(Uri.parse(outputUri).path ?: outputUri)
    var dataBytes = 0L
    // Every resource is released on any failure, including decoder creation/configuration.
    var decoder: MediaCodec? = null
    var decoderStarted = false
    var raf: RandomAccessFile? = null
    var complete = false
    try {
      val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
      decoder = codec
      codec.configure(format, null, null, 0)
      codec.start()
      decoderStarted = true

      var srcRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      outFile.parentFile?.mkdirs()
      val file = RandomAccessFile(outFile, "rw")
      raf = file
      file.setLength(0)
      file.write(ByteArray(44)) // header placeholder
      val resampler = LinearResampler(targetRate)
      val info = MediaCodec.BufferInfo()
      var inputDone = false
      var outputDone = false
      while (!outputDone) {
        if (!inputDone) {
          val inIdx = codec.dequeueInputBuffer(10_000)
          if (inIdx >= 0) {
            val buf = codec.getInputBuffer(inIdx)!!
            val size = extractor.readSampleData(buf, 0)
            if (size < 0) {
              codec.queueInputBuffer(inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              inputDone = true
            } else {
              codec.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
              extractor.advance()
            }
          }
        }
        val outIdx = codec.dequeueOutputBuffer(info, 10_000)
        when {
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            val f = codec.outputFormat
            srcRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          }
          outIdx >= 0 -> {
            val out = codec.getOutputBuffer(outIdx)!!
            out.position(info.offset)
            out.limit(info.offset + info.size)
            val shorts = out.order(ByteOrder.nativeOrder()).asShortBuffer()
            val frames = shorts.remaining() / channels
            val mono = ShortArray(frames)
            for (i in 0 until frames) {
              var sum = 0
              for (c in 0 until channels) sum += shorts.get(i * channels + c)
              mono[i] = (sum / channels).toShort()
            }
            val resampled = resampler.process(mono, srcRate)
            val bytes = ByteBuffer.allocate(resampled.size * 2).order(ByteOrder.LITTLE_ENDIAN)
            bytes.asShortBuffer().put(resampled)
            file.write(bytes.array())
            dataBytes += bytes.capacity()
            codec.releaseOutputBuffer(outIdx, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outputDone = true
          }
        }
      }
      writeWavHeader(file, dataBytes, targetRate)
      complete = true
    } finally {
      try { raf?.close() } catch (e: java.io.IOException) {}
      // A half-written WAV (wrong header sizes) must not be left behind for a later read.
      if (!complete) outFile.delete()
      if (decoderStarted) try { decoder?.stop() } catch (e: IllegalStateException) {}
      decoder?.release()
      extractor.release()
    }
    return mapOf(
      "uri" to Uri.fromFile(outFile).toString(),
      "sampleRate" to targetRate,
      "durationMs" to dataBytes / 2.0 / targetRate * 1000.0,
    )
  }

  private fun writeWavHeader(raf: RandomAccessFile, dataBytes: Long, rate: Int) {
    val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    h.put("RIFF".toByteArray()); h.putInt((36 + dataBytes).toInt()); h.put("WAVE".toByteArray())
    h.put("fmt ".toByteArray()); h.putInt(16); h.putShort(1); h.putShort(1)
    h.putInt(rate); h.putInt(rate * 2); h.putShort(2); h.putShort(16)
    h.put("data".toByteArray()); h.putInt(dataBytes.toInt())
    raf.seek(0)
    raf.write(h.array())
  }
}

/** Streaming linear-interpolation resampler (adequate for speech recognition input). */
private class LinearResampler(private val targetRate: Int) {
  private var position = 0.0
  private var last: Short = 0

  fun process(input: ShortArray, srcRate: Int): ShortArray {
    if (srcRate == targetRate) return input
    val step = srcRate.toDouble() / targetRate
    // Primitive array: a boxed Short per output sample churned the GC on long takes.
    val out = ShortArray(maxOf(0, ((input.size - position) / step).toInt() + 2))
    var n = 0
    while (position < input.size) {
      val i = position.toInt()
      val frac = position - i
      val a = if (i - 1 >= 0) input[i - 1] else last
      val b = input[i]
      out[n++] = (a + (b - a) * frac).roundToInt().toShort()
      position += step
    }
    position -= input.size
    if (input.isNotEmpty()) last = input[input.size - 1]
    return if (n == out.size) out else out.copyOf(n)
  }
}

/** Draws the active cue to a bitmap; Media3 composites it over each frame. */
@OptIn(UnstableApi::class)
private class CaptionOverlay(
  private val cues: List<CueRecord>,
  private val style: CaptionStyleRecord,
  private val videoWidth: Int,
) : BitmapOverlay() {
  private val empty: Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
  // Keyed by cue index and highlighted word index (-1 = none).
  private val cache = HashMap<Pair<Int, Int>, Bitmap>()
  private val highlight: Int? = style.highlightColor?.let { parseColor(it) }

  /** Last word of the cue that has started (stays lit through pauses), or -1. */
  private fun wordIndexAt(cue: CueRecord, ms: Double): Int {
    val words = cue.words ?: return -1
    if (highlight == null || words.size != cue.text.split(" ").size) return -1
    var idx = -1
    for (i in words.indices) {
      if (words[i].startMs <= ms) idx = i else break
    }
    return idx
  }

  private fun cueIndexAt(timeUs: Long): Int {
    val ms = timeUs / 1000.0
    var lo = 0
    var hi = cues.size - 1
    while (lo <= hi) {
      val mid = (lo + hi) ushr 1
      val c = cues[mid]
      when {
        ms < c.startMs -> hi = mid - 1
        ms >= c.endMs -> lo = mid + 1
        else -> return mid
      }
    }
    return -1
  }

  override fun getBitmap(presentationTimeUs: Long): Bitmap {
    val idx = cueIndexAt(presentationTimeUs)
    if (idx < 0) return empty
    val word = wordIndexAt(cues[idx], presentationTimeUs / 1000.0)
    val key = Pair(idx, word)
    return cache.getOrPut(key) { render(cues[idx].text, word) }.also {
      // Keep memory bounded on long videos: drop bitmaps of earlier cues first.
      if (cache.size > 8) cache.keys.filter { it != key }.sortedBy { it.first }.take(cache.size - 8).forEach { k -> cache.remove(k) }
    }
  }

  private val settings = StaticOverlaySettings.Builder()
    // NDC: y = 1 is the top edge. Builder rejects values outside [-1, 1].
    .setBackgroundFrameAnchor(0f, (1 - 2 * style.positionY).toFloat().coerceIn(-1f, 1f))
    .build()

  override fun getOverlaySettings(presentationTimeUs: Long): StaticOverlaySettings = settings

  private fun render(raw: String, highlightWord: Int): Bitmap {
    val text = if (style.uppercase) raw.uppercase() else raw
    val fontSize = (videoWidth * style.fontSizeRatio).toFloat()
    // Inside apply, `style` would resolve to Paint.style; capture the caption style first.
    val captionStyle = style
    val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
      textSize = fontSize
      typeface = if (android.os.Build.VERSION.SDK_INT >= 28) {
        Typeface.create(Typeface.DEFAULT, captionStyle.fontWeight.toIntOrNull() ?: 700, false)
      } else {
        Typeface.DEFAULT_BOLD
      }
      color = parseColor(captionStyle.textColor) ?: Color.WHITE
    }
    val maxWidth = (videoWidth * 0.86f).toInt()
    val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, maxWidth)
      .setAlignment(Layout.Alignment.ALIGN_CENTER)
      .build()
    var textWidth = 0f
    for (i in 0 until layout.lineCount) textWidth = max(textWidth, layout.getLineWidth(i))
    val padH = fontSize * 0.45f
    val padV = fontSize * 0.25f
    val w = min(videoWidth, (textWidth + padH * 2).toInt() + 2)
    val h = (layout.height + padV * 2).toInt() + 2
    val bmp = Bitmap.createBitmap(max(1, w), max(1, h), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    style.backgroundColor?.let { parseColor(it) }?.let { bg ->
      val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = bg }
      canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), fontSize * 0.3f, fontSize * 0.3f, p)
    }
    canvas.save()
    canvas.translate((w - maxWidth) / 2f, padV)
    val strokeColor = style.strokeColor?.let { parseColor(it) }
    if (strokeColor != null && style.strokeWidthRatio > 0) {
      val fill = paint.color
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = (videoWidth * style.strokeWidthRatio).toFloat() * 2
      paint.strokeJoin = Paint.Join.ROUND
      paint.color = strokeColor
      layout.draw(canvas)
      paint.style = Paint.Style.FILL
      paint.color = fill
    }
    val hl = highlight
    if (hl != null && highlightWord >= 0) {
      // Fill pass with the active word coloured; the stroke pass above stays plain.
      // Same text and paint, so this layout's metrics match the stroke layout.
      val starts = text.split(" ").runningFold(0) { acc, token -> acc + token.length + 1 }
      val spanned = SpannableString(text)
      if (highlightWord < starts.size - 1) {
        val end = min(text.length, starts[highlightWord + 1] - 1)
        spanned.setSpan(ForegroundColorSpan(hl), starts[highlightWord], end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
      }
      StaticLayout.Builder.obtain(spanned, 0, spanned.length, paint, maxWidth)
        .setAlignment(Layout.Alignment.ALIGN_CENTER)
        .build()
        .draw(canvas)
    } else {
      layout.draw(canvas)
    }
    canvas.restore()
    return bmp
  }

  private fun parseColor(s: String): Int? {
    val v = s.trim()
    if (v.startsWith("rgba(")) {
      val p = v.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim().toDouble() }
      if (p.size != 4) return null
      return Color.argb((p[3] * 255).roundToInt(), p[0].toInt(), p[1].toInt(), p[2].toInt())
    }
    return try {
      if (v.length == 9) {
        // #RRGGBBAA → Android's #AARRGGBB
        Color.parseColor("#" + v.substring(7, 9) + v.substring(1, 7))
      } else {
        Color.parseColor(v)
      }
    } catch (e: IllegalArgumentException) {
      null
    }
  }
}
