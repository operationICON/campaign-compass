import { ReactNode } from "react";
import { TopNav } from "./TopNav";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: "#08090c" }}>
      <TopNav />
      <main className="pt-12">
        {children}
      </main>
    </div>
  );
}
