import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, LogOut, LayoutGrid, ExternalLink } from "lucide-react";
import { resolveIcon } from "@/lib/icons";
import type { AuthUser } from "@/App";

interface MyApp {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  launchUrl: string;
}

interface MyAppsResponse {
  userName: string;
  apps: MyApp[];
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

/**
 * Opens an app tile. Plain navigation, not a fetch — the target app is a
 * fully separate origin/deployment with its own session. If the user
 * doesn't already have a live session there, the app's own login redirect
 * to Entra ID resolves silently against the existing tenant-wide SSO
 * session (see docs/workspace/TECHNICAL_DESIGN.md) rather than prompting.
 */
function launch(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export function Workspace({ user }: { user: AuthUser }) {
  const { data, isLoading, isError } = useMyApps();
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const apps = (data?.apps ?? []).filter((a) =>
      a.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    const byCategory = new Map<string, MyApp[]>();
    for (const app of apps) {
      const key = app.category?.trim() || "Other";
      const list = byCategory.get(key) ?? [];
      list.push(app);
      byCategory.set(key, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data, search]);

  return (
    <div className="min-h-[100dvh] bg-slate-50">
      <header className="bg-[#0b1b3a] text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500">
              <LayoutGrid className="h-4.5 w-4.5" />
            </div>
            <span className="font-bold tracking-tight">Workspace</span>
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search your apps…"
              className="w-full rounded-md border border-white/15 bg-white/10 py-2 pl-9 pr-3 text-sm placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <div className="ml-auto flex items-center gap-4 text-sm">
            <span className="text-white/70 hidden sm:inline">{data?.userName ?? user.name}</span>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10"
              data-testid="button-sign-out"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {isLoading ? (
          <TileGridSkeleton />
        ) : isError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">
            Couldn't load your applications. Try refreshing the page.
          </div>
        ) : (data?.apps.length ?? 0) === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-10">
            {grouped.map(([category, apps]) => (
              <section key={category}>
                <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {category}
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {apps.map((app) => (
                    <AppTile key={app.id} app={app} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function AppTile({ app }: { app: MyApp }) {
  const Icon = resolveIcon(app.icon);
  return (
    <button
      onClick={() => launch(app.launchUrl)}
      data-testid={`tile-app-${app.id}`}
      className="group flex flex-col items-start gap-3 rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
    >
      <div className="flex w-full items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600 group-hover:bg-blue-100">
          <Icon className="h-5.5 w-5.5" />
        </div>
        <ExternalLink className="h-4 w-4 text-slate-300 opacity-0 transition group-hover:opacity-100" />
      </div>
      <div>
        <div className="font-semibold text-slate-900">{app.name}</div>
        {app.description ? (
          <div className="mt-1 text-sm text-slate-500">{app.description}</div>
        ) : null}
      </div>
    </button>
  );
}

function TileGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
      <LayoutGrid className="h-8 w-8 text-slate-300" />
      <h3 className="mt-4 text-lg font-semibold text-slate-800">No applications yet</h3>
      <p className="mt-1 max-w-sm text-sm text-slate-500">
        You're signed in, but no applications have been assigned to your
        account yet. Contact an administrator to request access.
      </p>
    </div>
  );
}
