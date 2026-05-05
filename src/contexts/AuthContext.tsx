import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { authLogin, authMe } from "@/lib/api";

interface User { id: string; email: string; role: "admin" | "user"; name: string; }

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem("ct_token"); } catch { return null; }
  });
  // Load cached user immediately so the page renders without waiting for the API
  const [user, setUser] = useState<User | null>(() => {
    try {
      const cached = localStorage.getItem("ct_user");
      return cached ? (JSON.parse(cached) as User) : null;
    } catch { return null; }
  });
  // isLoading only true when we have a token but no cached user yet
  const [isLoading, setIsLoading] = useState(!user && !!token);

  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    // Verify token in background; update user if it changed, clear if invalid
    authMe()
      .then((data) => {
        const freshUser = data.user as User;
        setUser(freshUser);
        try { localStorage.setItem("ct_user", JSON.stringify(freshUser)); } catch {}
      })
      .catch(() => {
        localStorage.removeItem("ct_token");
        localStorage.removeItem("ct_user");
        setUser(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = async (email: string, password: string) => {
    const data = await authLogin(email, password);
    localStorage.setItem("ct_token", data.token);
    try { localStorage.setItem("ct_user", JSON.stringify(data.user)); } catch {}
    setToken(data.token);
    setUser(data.user as User);
  };

  const logout = () => {
    localStorage.removeItem("ct_token");
    localStorage.removeItem("ct_user");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
