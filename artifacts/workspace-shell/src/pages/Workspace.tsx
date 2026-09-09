import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, LayoutGrid } from "lucide-react";
import { Sidebar, type SidebarApp } from "@/components/Sidebar";
import { WorkspaceTabs, type OpenTab } from "@/components/WorkspaceTabs";
import type { AuthUser } from "@/App";

interface MyAppsResponse {
  userName: string;
  apps: SidebarApp[];
}

function useMyApps() {
  return useQuery<MyAppsResponse>({
    queryKey: ["my-apps"],
    queryFn: async () => {
      const res = await fetch("/api/my-apps", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load your apps");
      return res.json();
    },
    staleTime: 60 * 1000,
  });
}

async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  window.location.href = "/";
}

export function Workspace({ user }: { user: AuthUser }) {
  const { data, isLoading, isError } = useMyApps();
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([]);
  const [activeAppId, setActiveAppId] = useState<number | null>(null);

  const openApp = useCallback((app: SidebarApp) => {
  const isFieldService = app.name === "Field Service Calendar";

  setOpenTabs((prev) => {
    // If the tab is already open, just activate it.
    if (prev.some((t) => t.app.id === app.id)) {
      return prev;
    }

    // Start Field Service SSO directly from the user's click.
    if (isFieldService) {
      const loginUrl = `${app.launchUrl.replace(/\/$/, "")}/api/login?embedded=1`;

      const popupWidth = 480;
      const popupHeight = 600;

      const Center = Math.max(
        0,
        Math.round((window.screen.availWidth - popupWidth) / 2),
      );

      const top = Math.max(
        0,
        Math.round((window.screen.availHeight - popupHeight) / 2),
      );

      const popup = window.open(
        loginUrl,
        "fieldservice-sso",
        [
          `width=${popupWidth}`,
          `height=${popupHeight}`,
          `Center=${Center}`,
          `top=${top}`,
          "resizable=yes",
          "scrollbars=yes",
        ].join(","),
      );

      if (popup) {
        popup.focus();
      }
    }

    return [...prev, { app }];
  });

  setActiveAppId(app.id);
}, []);

  const closeTab = useCallback(
    (appId: number) => {
      setOpenTabs((prev) => {
        const next = prev.filter((t) => t.app.id !== appId);
        if (activeAppId === appId) {
          setActiveAppId(next.length > 0 ? next[next.length - 1]!.app.id : null);
        }
        return next;
      });
    },
    [activeAppId],
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-ws-bg">
      <header className="flex shrink-0 items-center gap-6 border-b border-white/10 bg-ws-bg px-6 py-3 text-white">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ws-accent">
            <LayoutGrid className="h-4.5 w-4.5 text-ws-bg" />
          </div>
          <span className="font-bold tracking-tight">Workspace</span>
        </div>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <span className="hidden text-ws-text-secondary sm:inline">{data?.userName ?? user.name}</span>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-ws-text-secondary hover:bg-white/10 hover:text-white"
            data-testid="button-sign-out"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {isLoading ? (
          <div className="w-64 shrink-0 border-r border-white/10 bg-ws-bg p-3">
            <div className="h-8 animate-pulse rounded bg-white/5" />
          </div>
        ) : isError ? (
          <div className="w-64 shrink-0 border-r border-white/10 bg-ws-bg p-4 text-sm text-red-300">
            Couldn't load your apps.
          </div>
        ) : (
          <Sidebar apps={data?.apps ?? []} activeAppId={activeAppId} onSelect={openApp} />
        )}

        {(data?.apps.length ?? 0) === 0 && !isLoading && !isError ? (
          <EmptyState />
        ) : (
          <WorkspaceTabs
            openTabs={openTabs}
            activeAppId={activeAppId}
            onActivate={setActiveAppId}
            onClose={closeTab}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <LayoutGrid className="h-8 w-8 text-white/20" />
      <h3 className="mt-4 text-lg font-semibold text-white">No applications yet</h3>
      <p className="mt-1 max-w-sm text-sm text-ws-text-secondary">
        You're signed in, but no applications have been assigned to your
        account yet. Contact an administrator to request access.
      </p>
    </div>
  );
}
