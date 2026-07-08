import { Link, useLocation } from "wouter";
import { 
  ShieldCheck, 
  Users, 
  Key, 
  Lock, 
  ActivitySquare,
  PanelLeftClose,
  PanelLeft
} from "lucide-react";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthUser } from "@/App";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: ShieldCheck },
  { href: "/users", label: "Users", icon: Users },
  { href: "/permissions", label: "Permissions", icon: Key },
  { href: "/security", label: "Security Policies", icon: Lock },
  { href: "/audit", label: "Audit Log", icon: ActivitySquare },
];

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { data: user } = useAuthUser();
  const queryClient = useQueryClient();

  const signOut = async () => {
    await fetch(`${import.meta.env.BASE_URL}api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    queryClient.clear();
    window.location.href = import.meta.env.BASE_URL;
  };

  return (
    <div className="p-3 shrink-0 border-t border-sidebar-border">
      {!collapsed && (
        <div className="px-1 pb-2 text-xs text-sidebar-foreground/70 truncate">
          {user?.email ?? user?.name ?? ""}
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "w-full text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          collapsed ? "justify-center px-0" : "justify-start gap-2",
        )}
        onClick={signOut}
        title="Sign out"
      >
        <LogOut className="h-4 w-4 shrink-0" />
        {!collapsed && <span className="text-sm">Sign out</span>}
      </Button>
    </div>
  );
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside 
        className={cn(
          "flex flex-col bg-sidebar text-sidebar-foreground transition-all duration-300 ease-in-out border-r border-sidebar-border relative",
          collapsed ? "w-[60px]" : "w-[240px]"
        )}
      >
        <div className="h-14 flex items-center px-4 justify-between shrink-0">
          {!collapsed && (
            <span className="font-bold tracking-tight text-sidebar-primary-foreground truncate">
              Admin Console
            </span>
          )}
          <Button 
            variant="ghost" 
            size="icon" 
            className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ml-auto"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
        <Separator className="bg-sidebar-border" />
        <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                  isActive 
                    ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium" 
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed && "justify-center px-0"
                )}
                title={collapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="truncate text-sm">{item.label}</span>}
              </Link>
            );
          })}
        </nav>
        <SidebarFooter collapsed={collapsed} />
      </aside>
      <main className="flex-1 overflow-auto bg-background">
        {children}
      </main>
    </div>
  );
}
