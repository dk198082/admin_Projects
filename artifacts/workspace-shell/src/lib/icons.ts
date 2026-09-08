import {
  LayoutGrid,
  Wrench,
  Factory,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
  Users,
  ClipboardList,
  Calendar,
  Truck,
  ShieldCheck,
  Database,
  type LucideIcon,
} from "lucide-react";

/**
 * Apps store their icon as a plain string (`apps.icon`, set via PATCH
 * /apps/{id}/launch — see the Admin Console's Security page) rather than a
 * component reference, since it's persisted data, not code. This registry is
 * the one place that maps those strings to real icon components — add a new
 * entry here when a new app wants an icon this list doesn't already have.
 * An unrecognized or unset name falls back to a generic grid icon instead of
 * failing to render, since the tile should never disappear over a typo.
 */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  Wrench,
  Factory,
  ShoppingCart,
  Package,
  BarChart3,
  Settings,
  Users,
  ClipboardList,
  Calendar,
  Truck,
  ShieldCheck,
  Database,
};

export function resolveIcon(name: string | null): LucideIcon {
  if (!name) return LayoutGrid;
  return ICON_REGISTRY[name] ?? LayoutGrid;
}
