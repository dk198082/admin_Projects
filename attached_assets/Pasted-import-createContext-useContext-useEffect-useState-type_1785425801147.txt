import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface AuthUser {
  entraOid: string;
  email: string | undefined;
  displayName: string | undefined;
  role: string;
}

type AuthStatus = "loading" | "authenticated" | "unauthenticated";

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: () => void;
  logout: () => void;
  /**
   * True when a sign-in attempt from inside an embedded preview could not open
   * a new tab (pop-up blocked by the iframe sandbox). The UI should then ask
   * the user to open the app in its own browser tab.
   */
  popupBlocked: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Auth routes live at the absolute /api prefix on the shared api-server,
// independent of this app's base path.
const ME_URL = "/api/me";
const LOGIN_URL = "/api/login";
const LOGOUT_URL = "/api/logout";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      try {
        const res = await fetch(ME_URL, {
          credentials: "same-origin",
          headers: { accept: "application/json" },
        });
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as AuthUser;
          setUser(data);
          setStatus("authenticated");
        } else {
          setUser(null);
          setStatus("unauthenticated");
        }
      } catch {
        if (cancelled) return;
        setUser(null);
        setStatus("unauthenticated");
      }
    }

    loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  function login() {
    // Bring the user back to their current location within this app after login.
    const returnTo = window.location.pathname + window.location.search;
    const url = `${LOGIN_URL}?returnTo=${encodeURIComponent(returnTo)}`;

    // When the app is NOT embedded (its own browser tab, incl. production), a
    // normal same-tab navigation runs the whole OAuth flow first-party, which
    // is the most reliable path.
    const embedded = window.top !== window.self;
    if (!embedded) {
      window.location.href = url;
      return;
    }

    // Embedded (Replit preview/canvas, or any iframe host): Microsoft's login
    // page cannot be displayed inside an iframe (it sends X-Frame-Options /
    // frame-ancestors that block framing), so open the flow in a new top-level
    // tab where cookies are first-party on this app's own origin.
    const opened = window.open(url, "_blank", "noopener");
    if (opened) {
      setPopupBlocked(false);
      return;
    }

    // Pop-up blocked (e.g. a sandboxed canvas iframe without allow-popups). Do
    // NOT navigate in-frame — that loads login.microsoftonline.com inside the
    // iframe and shows "refused to connect". Ask the user to open the app in
    // its own tab instead.
    setPopupBlocked(true);
  }

  function logout() {
    // POST to /logout, then send the browser to Entra's logout endpoint (the
    // server responds with a redirect that a full navigation will follow).
    const form = document.createElement("form");
    form.method = "POST";
    form.action = LOGOUT_URL;
    document.body.appendChild(form);
    form.submit();
  }

  return (
    <AuthContext.Provider value={{ status, user, login, logout, popupBlocked }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
