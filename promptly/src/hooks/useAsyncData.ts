import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data whenever the screen gains focus or `deps` change; keeps the last
 * value while reloading. `deps` must be JSON-serializable.
 */
export function useFocusData<T>(load: () => Promise<T>, deps: unknown[] = []): { data: T | undefined; reload: () => void; error: unknown } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const key = JSON.stringify(deps);
  const run = useCallback(() => {
    let alive = true;
    loadRef
      .current()
      .then((v) => alive && (setData(v), setError(null)))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
    // `key` and `version` intentionally trigger reloads.
  }, [key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  useFocusEffect(run);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, reload, error };
}
