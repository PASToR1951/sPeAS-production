/**
 * Shared auth client for the legacy (non-React) pages.
 *
 * Authentication is powered by Better Auth under /api/auth/*. The session
 * lives in an HttpOnly cookie managed by the server; JavaScript never sees
 * it. `userInfo` in web storage is a display-only cache — never trust it
 * for gating, always confirm with getSession().
 *
 * Exposes window.PeasAuth = { getSession, signInUsername, signOut,
 * storeUserInfo, clearUserInfo, redirectByRole }.
 */
(function () {
  const STORAGE_KEYS = ['userInfo', 'session_token', 'accessToken', 'user', 'userData', 'auth', 'role'];

  /**
   * Returns { authenticated:true, id, role, username, user } or null.
   * Role is lowercase ('admin' | 'user').
   */
  async function getSession() {
    try {
      const response = await fetch('/api/auth/get-session', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Accept': 'application/json' }
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data || !data.user) return null;
      const user = data.user;
      return {
        authenticated: true,
        id: user.id,
        role: String(user.role || 'user').toLowerCase(),
        username: String(user.displayUsername || user.username || user.name || user.id),
        user: user
      };
    } catch (_error) {
      return null;
    }
  }

  /** School-ID + password sign-in. Resolves to the session summary. */
  async function signInUsername(username, password) {
    const response = await fetch('/api/auth/sign-in/username', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        username: String(username).trim().toLowerCase(),
        password: password,
        rememberMe: true
      })
    });
    let data = null;
    try { data = await response.json(); } catch (_error) { /* non-JSON error body */ }
    if (!response.ok) {
      const message = (data && (data.message || data.error)) ||
        (response.status === 429
          ? 'Too many attempts. Please wait a minute and try again.'
          : 'Login failed. Please check your credentials.');
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    const user = (data && data.user) || {};
    return {
      authenticated: true,
      id: user.id,
      role: String(user.role || 'user').toLowerCase(),
      username: String(user.displayUsername || user.username || user.name || user.id || username),
      user: user
    };
  }

  /** Revokes the session server-side and clears the local display cache. */
  async function signOut() {
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
    } catch (_error) { /* clearing local state still matters */ }
    clearUserInfo();
  }

  /** Writes the display-only userInfo cache that legacy UI reads. */
  function storeUserInfo(session) {
    if (!session) return;
    const userInfo = {
      isLoggedIn: true,
      id: session.id,
      role: session.role,
      username: session.username,
      loginTime: Date.now()
    };
    try {
      sessionStorage.setItem('userInfo', JSON.stringify(userInfo));
      localStorage.setItem('userInfo', JSON.stringify(userInfo));
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'userInfo',
        newValue: JSON.stringify(userInfo),
        storageArea: localStorage
      }));
    } catch (_error) { /* storage may be unavailable */ }
    return userInfo;
  }

  function clearUserInfo() {
    try {
      STORAGE_KEYS.forEach(function (key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
    } catch (_error) { /* ignore */ }
  }

  function redirectByRole(role) {
    window.location.href = String(role || 'user').toLowerCase() === 'admin'
      ? '/admin/dashboard.html'
      : '/index.html';
  }

  window.PeasAuth = {
    getSession: getSession,
    signInUsername: signInUsername,
    signOut: signOut,
    storeUserInfo: storeUserInfo,
    clearUserInfo: clearUserInfo,
    redirectByRole: redirectByRole
  };
})();
