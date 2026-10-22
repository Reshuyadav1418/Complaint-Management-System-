import { useCallback, useEffect, useRef, useState } from 'react';
import { readError } from '../api/client.js';

/** Run an async loader when deps change; ignores stale responses. */
export function useAsync(loader, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null, meta: null });
  const seq = useRef(0);

  const run = useCallback(async () => {
    const id = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await loader();
      if (id === seq.current) setState({ loading: false, error: null, data: res.data, meta: res.meta || null });
    } catch (err) {
      if (id === seq.current) setState((s) => ({ ...s, loading: false, error: readError(err).message }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
