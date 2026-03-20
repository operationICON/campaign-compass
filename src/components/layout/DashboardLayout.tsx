import { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { NotificationBell } from "./NotificationBell";
import { useTheme } from "@/hooks/useTheme";
import { Sun, Moon } from "lucide-react";

export function DashboardLayout({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme();

  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar />
      <div className="flex-1 flex flex-col overflow-auto">
        <header className="flex items-center justify-end gap-2 px-6 py-3 bg-card border-b border-border">
          <button
            onClick={toggle}
            className="p-2 rounded-xl hover:bg-secondary transition-colors duration-200"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Moon className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <NotificationBell />
        </header>
        <main className="flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
