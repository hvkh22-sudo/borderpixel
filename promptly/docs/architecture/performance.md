# Performance

Measured in Node/Jest (no device available): Jest 29 + jest-expo, React 19 dev build, the
`test-renderer` host renderer, x86 container. Absolute numbers are **not** device numbers: Hermes on
a phone is slower than V8 for tight loops, and the test renderer does no native text layout. Use
them for ratios and complexity, not frame budgets. Everything marked "device" below still needs
profiling on real iOS and Android hardware.

## 1. Teleprompter with very long scripts

Test script: 10,000 words, 250 paragraphs of 40 words separated by blank lines (70,500 chars).

### Before
One `<Text>` with two nested spans (spoken / unspoken). Every Voice Follow update changes
`highlightCharOffset`, so:

- React re-renders the Teleprompter and replaces both span strings: the whole 70,500-char script
  goes to native again on every update.
- Fabric (RN 0.88 `ParagraphShadowNode::layout`) rebuilds the attributed string and, because the
  node has `onTextLayout`, calls `measureLines` on the **whole** script. The text measure cache key
  includes fragment strings (`areAttributedStringFragmentsEquivalentLayoutWise`), so moving the
  span boundary misses the cache and the whole text is re-measured.
- The JS `onTextLayout` callback does **not** fire for each highlight change in practice:
  `ParagraphEventEmitter::onTextLayout` drops the event when the line measurements (text + frames)
  are equal to the previous ones, and moving an opacity-only boundary does not change lines. So
  the JS `buildLineIndex` + `setState` ran only on real re-layouts. The cost was native.
- JS line index cost is not the bottleneck: `buildLineIndex` on 5,000 lines = 0.12–0.21 ms,
  `lineForChar` (binary search) ≈ 0.1 µs, tap lookup (linear `findIndex`) ≈ 0.02 ms.

### After
- `splitScript` splits at newlines; each hard line is a memoized `ScriptChunk` (`<Text>` with its
  own `onLayout` → y and `onTextLayout` → lines). Chunks are grouped into memoized blocks of 32 so
  per-update reconciliation is ~(blocks + 32) shallow prop checks, not one per chunk.
- Each chunk gets its spoken length clamped to `[0, text.length]`, so only the chunk(s) whose
  boundary moved get new props. `textStyle` and the layout callbacks are stable.
- `buildChunkedLineIndex` merges chunk layouts (chunk y + line y; line starts = chunk start +
  cumulative line text length) into the same `LineIndex` as before. `scrollOffsetForChar`,
  `jumpToChar`, mirroring (`scaleX` on the content view), RTL (`writingDirection`/`textAlign` per
  chunk, direction still from the whole script), reading guide and tap-to-resync are unchanged.
  Tap lookup is now a binary search (`lineAtY`). Chunk reports in one native batch are coalesced
  into a single rebuild (`setTimeout 0`), and React state only holds `contentHeight`.

### Numbers (Jest, 300 follow updates of 30 chars each)
| | Before | After |
|---|---|---|
| Script chunks re-rendered per update | 1 (= whole script) | ≤ 2 of 499 (asserted in `Teleprompter.render.test.tsx`) |
| Text sent to native and re-measured per update | 70,500 chars | one or two paragraphs (~280–560 chars), ~125× less |
| React commit per update (Profiler `actualDuration`, dev build) | 0.56 ms avg | 1.6 ms avg (p95 3 ms) |
| Initial mount (dev build) | 5 ms | 29 ms (499 `<Text>` nodes) |
| Same script as **one** 10k-word paragraph | 0.82 ms | 0.97 ms (no gain: one chunk) |

The JS side gets a bit more expensive (block/chunk memo checks, more host nodes at mount) in
exchange for removing the whole-script native re-measure per update, which Jest cannot measure.

### Still needs device profiling
- Native cost per update before/after (Instruments Time Profiler / Android Studio CPU profiler on
  `measureLines` and text layout) and UI-thread frame drops while gliding.
- Visual parity: separate `<Text>` per line vs one `<Text>` (blank line height, first-line
  baseline, Android `includeFontPadding`), RTL scripts and mirrored mode.
- Mount time of ~500 `<Text>` nodes on low-end Android.
- A single huge paragraph still re-measures entirely; splitting inside a paragraph would change line
  breaks. If that matters on device, the next step is an overlay band for the highlight (no
  re-style) or windowing chunks around the viewport.

### Timed-mode fix found during the pass
Restart / tap-to-jump / nudge started `withTiming` on `offset`, but the frame callback wrote
`offset.value` on the next frame, which cancels the animation. Now `animateTo` sets an `animating`
flag (cleared in the completion callback, generation-checked) and `timedStep` skips the
frame increment while it is set (unit-tested in `scrollModel.test.ts`).

## 2. Voice Follow aligner

Test: 10,000-word script (1,500-word vocabulary), `ScriptAligner.update` per hypothesis.

| Case | Before | After |
|---|---|---|
| Unrelated speech (no local match → far search to script end) | 237–450 ms / update | 6–10 ms |
| Reading on script (local window only) | 5–11 ms | 1.3 ms |
| Skipped section 7,000 words ahead (far search finds it) | 180 ms / update | 12–23 ms |
| Constructor (tokenize + intern) | 5–6 ms | 6–15 ms |

Changes (semantics unchanged; all existing scenario tests pass):
- Script words are interned into a vocabulary; each spoken word's similarity to a vocabulary word
  is computed lazily once and cached (64 spoken words, LRU). The DP inner loop is a table lookup
  instead of an edit-distance call per cell.
- Far search is skipped when fewer than `jumpMinMatches + 1` tail words match anything in the
  script (it could never be accepted).
- DP uses two rolling rows instead of `(m+1)·(n+1)` arrays (~1 MB per far search before).

Bug fixed: a hypothesis revised to **fewer** words (iOS resends the full transcript) counted every
word as newly spoken, widening the accepted step and letting large jumps through without the
two-update confirmation. It now counts as one new word; only `resetUtterance()` grants a full step.

Perf tests: `aligner.test.ts` › "performance on a 10,000-word script" (< 40 ms per update budget).
Device: measure on Hermes with real partial-result rates (iOS ~10/s).

## 3. Lists

- Library: memoized `ScriptRow` (speaking-time estimate tokenizes the body, now memoized per body
  and pace), stable `renderItem`, `onOpen`, `onActions`, memoized folder name map.
- Search is debounced 200 ms (`useDebouncedValue`); clearing applies at once. Typing "camera":
  6 SQLite list queries → 1 (`libraryPerf.test.tsx`).
- Takes: memoized `TakeRow`, stable `renderItem` / `keyExtractor`.
- Device: scroll FPS with hundreds of scripts not measured.

## 4. Startup (`useBootstrap`)

- The three key-value reads (settings, Voice Follow usage, speaking rate) run with `Promise.all`
  instead of three sequential awaits (one round of async SQLite hops).
- `ready` no longer waits for orphan recovery and export cleanup. The orphan scan lists the
  recordings directory and stats only unknown files (synchronous expo-file-system calls), probes
  each orphan's video info (now in parallel) and inserts rows; `cleanExports` stats every export
  file synchronously. Both now run after the first screen; the Home banner reads the session store
  reactively.
- Purchases (SDK configure + customer info) start right after `ready` and overlap orphan recovery
  instead of following it.
- Not measured: Node's SQLite is synchronous, so the parallel reads show no difference in Jest.
  Cold start (TTI) and the scan's cost with many recordings need device profiling.
