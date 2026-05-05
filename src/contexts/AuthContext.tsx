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
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => {
    try { return localStorage.getItem("ct_token"); } catch { return null; }
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) { setIsLoading(false); return; }
    authMe()
      .then((data) => setUser(data.user as User))
      .catch(() => { localStorage.removeItem("ct_token"); setToken(null); setUser(null); })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = async (email: string, password: string) => {
    const data = await authLogin(email, password);
    localStorage.setItem("ct_token", data.token);
    setToken(data.token);
    setUser(data.user as User);
  };

  const logout = () => {
    localStorage.removeItem("ct_token");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
