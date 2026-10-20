/**
 * One hard line of the script. Memoized: during Voice Follow only the chunk
 * whose spoken/unspoken boundary moves gets new props, so React re-renders and
 * the native text layout re-measures one paragraph instead of the whole script
 * (see docs/architecture/performance.md).
 */
import { memo } from 'react';

import type { ScriptChunk as Chunk } from './scrollModel';
import { StyleSheet, Text, type LayoutChangeEvent, type TextLayoutEvent, type TextStyle } from 'react-native';

export interface ScriptChunkProps {
  index: number;
  text: string;
  /** Characters of this chunk already spoken (0..text.length). */
  spoken: number;
  style: TextStyle;
  onChunkLayout: (index: number, y: number) => void;
  onChunkTextLayout: (index: number, e: TextLayoutEvent) => void;
}

export function ScriptChunkBody({ index, text, spoken, style, onChunkLayout, onChunkTextLayout }: ScriptChunkProps) {
  // An empty line still takes one line of height, as inside a single <Text>.
  const content = text.length ? text : ' ';
  return (
    <Text
      style={style}
      maxFontSizeMultiplier={1}
      onLayout={(e: LayoutChangeEvent) => onChunkLayout(index, e.nativeEvent.layout.y)}
      onTextLayout={(e: TextLayoutEvent) => onChunkTextLayout(index, e)}
    >
      {spoken > 0 ? <Text style={styles.spoken}>{content.slice(0, spoken)}</Text> : null}
      {content.slice(spoken)}
    </Text>
  );
}

export const ScriptChunk = memo(ScriptChunkBody);

/** Chunks per block: keeps per-update reconciliation at ~(blocks + BLOCK_SIZE) memo checks. */
export const BLOCK_SIZE = 32;

interface BlockProps {
  first: number;
  chunks: Chunk[];
  /** Script offset spoken, clamped to this block's range so other blocks keep equal props. */
  spokenEnd: number;
  style: TextStyle;
  onChunkLayout: (index: number, y: number) => void;
  onChunkTextLayout: (index: number, e: TextLayoutEvent) => void;
}

/**
 * Renders chunks [first, first + BLOCK_SIZE) as siblings (a fragment, so the
 * native view tree is the same as rendering the chunks directly).
 */
function ChunkBlockBody({ first, chunks, spokenEnd, style, onChunkLayout, onChunkTextLayout }: BlockProps) {
  const out = [];
  const last = Math.min(chunks.length, first + BLOCK_SIZE);
  for (let i = first; i < last; i++) {
    const c = chunks[i]!;
    out.push(
      <ScriptChunk
        key={i}
        index={i}
        text={c.text}
        // Chunks fully before/after the boundary keep the same value (text.length or 0).
        spoken={Math.max(0, Math.min(spokenEnd - c.start, c.text.length))}
        style={style}
        onChunkLayout={onChunkLayout}
        onChunkTextLayout={onChunkTextLayout}
      />,
    );
  }
  return <>{out}</>;
}

export const ChunkBlock = memo(ChunkBlockBody);

/** Clamp the global spoken offset to block `b` (see BlockProps.spokenEnd). */
export function blockSpokenEnd(chunks: Chunk[], first: number, spokenEnd: number): number {
  const lastChunk = chunks[Math.min(chunks.length, first + BLOCK_SIZE) - 1]!;
  return Math.max(chunks[first]!.start, Math.min(spokenEnd, lastChunk.end));
}

const styles = StyleSheet.create({
  spoken: { opacity: 0.4 },
});
