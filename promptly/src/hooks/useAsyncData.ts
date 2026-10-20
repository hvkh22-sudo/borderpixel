import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

/** Loads data whenever the screen gains focus; keeps the last value while reloading. */
export function useFocusData<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; reload: () => void; error: unknown } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useCallback(() => {
    let alive = true;
    loadRef
      .current()
      .then((v) => alive && (setData(v), setError(null)))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useFocusEffect(run);
  return { data, reload: run, error };
}
