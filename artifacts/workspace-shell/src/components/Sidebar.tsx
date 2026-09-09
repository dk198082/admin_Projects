import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { resolveIcon } from "@/lib/icons";

export interface SidebarApp {
  id: number;
  name: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  launchUrl: string;
}

interface SidebarProps {
  apps: SidebarApp[];
  activeAppId: number | null;
  onSelect: (app: SidebarApp) => void;
}

/**
 * Left-nav menu: apps' `category` becomes a collapsible "main heading",
 * apps within it are the "sub menu" items directly beneath it — matching
 * the requested menu shape (e.g. "Business App" heading with "Field Service
 * Calendar"/"Production Shop Floor" beneath it; "Reporting Apps" heading
 * with "Packing Control Board"/"Production Priority Board" beneath it).
 * An app with no category falls under a plain "Apps" heading rather than
 * disappearing.
 */
export function Sidebar({ apps, activeAppId, onSelect }: SidebarProps) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const filtered = apps.filter((a) =>
      a.name.toLowerCase().includes(search.trim().toLowerCase()),
    );
    const byCategory = new Map<string, SidebarApp[]>();
    for (const app of filtered) {
      const key = app.category?.trim() || "Apps";
      const list = byCategory.get(key) ?? [];
      list.push(app);
      byCategory.set(key, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [apps, search]);

  const toggle = (category: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  return (
    <nav className="flex h-full w-64 shrink-0 flex-col border-r border-white/10 bg-ws-bg">
      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ws-text-secondary/60" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search apps…"
            className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-2 text-sm text-white placeholder:text-ws-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-ws-accent"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {grouped.map(([category, categoryApps]) => {
          const isCollapsed = collapsed.has(category);
          return (
            <div key={category} className="mb-1">
              <button
                onClick={() => toggle(category)}
                data-testid={`heading-category-${category}`}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-ws-text-secondary hover:bg-white/5"
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
                {category}
              </button>
              {!isCollapsed && (
                <div className="mt-0.5 space-y-0.5">
                  {categoryApps.map((app) => {
                    const Icon = resolveIcon(app.icon);
                    const active = app.id === activeAppId;
                    return (
                      <button
                        key={app.id}
                        onClick={() => onSelect(app)}
                        data-testid={`menu-item-app-${app.id}`}
                        title={app.description ?? undefined}
                        className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition ${
                          active
                            ? "bg-ws-accent/15 font-medium text-ws-accent"
                            : "text-white/85 hover:bg-white/5"
                        }`}
                      >
                        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-ws-accent" : "text-ws-text-secondary"}`} />
                        <span className="truncate">{app.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {grouped.length === 0 && (
          <div className="px-3 py-6 text-center text-sm text-ws-text-secondary/70">No apps found.</div>
        )}
      </div>
    </nav>
  );
}
