import { ReactNode } from "react";
import { SideNav } from "./SideNav";

export function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: "#08090c" }}>
      <SideNav />
      <main className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
