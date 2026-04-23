import { useState, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Already logged in
  if (user) {
    navigate(user.role === "user" ? "/campaigns" : "/", { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
      // AuthContext sets user; redirect based on role happens via ProtectedRoute / useEffect
      const stored = localStorage.getItem("ct_token");
      if (stored) {
        // decode role from JWT payload (no library needed — just base64)
        try {
          const payload = JSON.parse(atob(stored.split(".")[1]));
          navigate(payload.role === "user" ? "/campaigns" : "/", { replace: true });
          return;
        } catch {}
      }
      navigate("/", { replace: true });
    } catch (err: any) {
      const msg = err.message ?? "";
      if (msg.includes("401") || msg.toLowerCase().includes("invalid")) {
        setError("Incorrect email or password.");
      } else {
        setError("Login failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-[400px]">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-[52px] h-[52px] rounded-[14px] gradient-bg flex items-center justify-center text-white font-bold text-lg shadow-lg mb-3">
            CT
          </div>
          <h1 className="text-white font-bold text-xl leading-tight">CT Tracker</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Icon Models Agency</p>
        </div>

        {/* Card */}
        <div className="bg-card border border-border rounded-2xl p-7 shadow-xl">
          <h2 className="text-foreground font-semibold text-[17px] mb-1">Sign in</h2>
          <p className="text-muted-foreground text-sm mb-6">Enter your credentials to continue</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Password</label>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full h-10 px-3 pr-10 rounded-lg bg-secondary border border-border text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-[13px] text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full h-10 rounded-lg gradient-bg text-white font-semibold text-sm hero-glow hover:opacity-90 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</> : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          CT Tracker · Icon Models Agency
        </p>
      </div>
    </div>
  );
}
