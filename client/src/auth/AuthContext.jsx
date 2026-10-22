import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi } from '../api/endpoints.js';
import { onSessionEvent } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null, permissions: [], notice: null });

  const applySession = useCallback((payload) => {
    setState({ status: 'signedIn', user: payload.data.user, permissions: payload.data.permissions, notice: null });
  }, []);

  useEffect(() => {
    authApi
      .me()
      .then(applySession)
      .catch(() => setState({ status: 'signedOut', user: null, permissions: [], notice: null }));
  }, [applySession]);

  useEffect(
    () =>
      onSessionEvent((kind) => {
        if (kind === 'expired') {
          setState({ status: 'signedOut', user: null, permissions: [], notice: 'Your session ended. Sign in again to continue.' });
        }
        if (kind === 'password') {
          setState((s) => (s.user ? { ...s, user: { ...s.user, mustChangePassword: true } } : s));
        }
      }),
    [],
  );

  const login = useCallback(async (email, password) => applySession(await authApi.login({ email, password })), [applySession]);

  const logout = useCallback(async (everywhere = false) => {
    try {
      await (everywhere ? authApi.logoutAll() : authApi.logout());
    } finally {
      setState({ status: 'signedOut', user: null, permissions: [], notice: null });
    }
  }, []);

  const changePassword = useCallback(
    async (currentPassword, newPassword) => applySession(await authApi.changePassword({ currentPassword, newPassword })),
    [applySession],
  );

  const value = useMemo(() => {
    const set = new Set(state.permissions);
    return {
      ...state,
      can: (...perms) => perms.every((p) => set.has(p)),
      canAny: (...perms) => perms.some((p) => set.has(p)),
      login,
      logout,
      changePassword,
    };
  }, [state, login, logout, changePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
