import { ReactNode } from "react";
import { SideNav } from "./SideNav";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: "radial-gradient(ellipse at 65% 0%, rgba(59,130,246,0.10) 0%, transparent 55%), radial-gradient(ellipse at 20% 80%, rgba(99,102,241,0.07) 0%, transparent 45%), #080d14" }}>
      <SideNav />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
