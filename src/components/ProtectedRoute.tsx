import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface Props {
  children: ReactNode;
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false }: Props) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Connecting to server...</p>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;

  // "user" role can only access /campaigns (Tracking Links)
  if (adminOnly && user.role !== "admin") return <Navigate to="/campaigns" replace />;

  return <>{children}</>;
}
