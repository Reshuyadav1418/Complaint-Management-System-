import axios from 'axios';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  withCredentials: true,
  timeout: 20_000,
});

/** Listeners notified when the server says the session ended. */
const sessionListeners = new Set();
export function onSessionEvent(fn) {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
}

api.interceptors.response.use(
  (res) => res,
  (error) => {
    const status = error.response?.status;
    const code = error.response?.data?.error?.code;
    const isAuthCall = error.config?.url?.startsWith('/auth/login') || error.config?.url?.startsWith('/auth/me');
    if (status === 401 && !isAuthCall) sessionListeners.forEach((fn) => fn('expired'));
    if (code === 'PASSWORD_CHANGE_REQUIRED') sessionListeners.forEach((fn) => fn('password'));
    return Promise.reject(error);
  },
);

/** Normalise an axios error into { message, fields } for display. */
export function readError(error) {
  const body = error?.response?.data?.error;
  if (!error?.response) {
    return { message: 'Cannot reach the server. Check your connection and try again.', fields: {} };
  }
  const fields = {};
  for (const d of body?.details || []) {
    if (d.field && !fields[d.field]) fields[d.field] = d.message;
  }
  return { message: body?.message || 'Something went wrong. Try again.', fields, code: body?.code };
}
