import { useState } from "react";
import {
  useListApps, getListAppsQueryKey,
  useUpdateAppLaunch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, ExternalLink, Pencil } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

function errMsg(err: unknown, fallback: string): string {
  return err && typeof err === "object" && "error" in err
    ? String((err as { error: unknown }).error)
    : fallback;
}

// Must stay in sync with artifacts/workspace-shell/src/lib/icons.ts — that
// file is the actual runtime registry; this list only exists so an admin
// picks from names that are guaranteed to render. Adding a new icon means
// updating both places (see docs/workspace/ADDING_NEW_APPS.md).
const ICON_OPTIONS = [
  "Wrench", "Factory", "ShoppingCart", "Package", "BarChart3",
  "Settings", "Users", "ClipboardList", "Calendar", "Truck",
  "ShieldCheck", "Database",
] as const;

interface AppWithLaunch {
  id: number;
  name: string;
  launchUrl?: string | null;
  description?: string | null;
  icon?: string | null;
  category?: string | null;
}

/**
 * Lets an admin set (or clear) the fields that turn an onboarded app into a
 * Workspace tile: launchUrl, icon, category, description. An app with no
 * launchUrl never appears as a tile, regardless of who has roles for it —
 * this is the one remaining manual step after onboarding a new app via "Add
 * App" above and assigning roles under Map User Security Access. See
 * docs/workspace/ADDING_NEW_APPS.md for the full runbook.
 */
export function WorkspaceTilesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: apps } = useListApps({ query: { queryKey: getListAppsQueryKey() } });
  const updateLaunch = useUpdateAppLaunch();

  const [editing, setEditing] = useState<AppWithLaunch | null>(null);
  const [launchUrl, setLaunchUrl] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string>("");
  const [category, setCategory] = useState("");

  const openEditor = (app: AppWithLaunch) => {
    setEditing(app);
    setLaunchUrl(app.launchUrl ?? "");
    setDescription(app.description ?? "");
    setIcon(app.icon ?? "");
    setCategory(app.category ?? "");
  };

  const save = () => {
    if (!editing) return;
    updateLaunch.mutate(
      {
        id: editing.id,
        data: {
          launchUrl: launchUrl.trim() || null,
          description: description.trim() || null,
          icon: icon || null,
          category: category.trim() || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
          toast({ title: `Workspace tile updated for ${editing.name}` });
          setEditing(null);
        },
        onError: (err) =>
          toast({ title: "Couldn't save", description: errMsg(err, "Please try again."), variant: "destructive" }),
      },
    );
  };

  return (
    <Card data-testid="card-workspace-tiles">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4" />
          Workspace Tiles
        </CardTitle>
        <CardDescription>
          Control how each app appears as a launch tile in the Digital Workspace.
          An app with no launch URL set is never shown to anyone, even if they
          have roles for it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="divide-y rounded-md border">
          {(apps ?? []).map((app) => (
            <div
              key={app.id}
              className="flex items-center justify-between gap-4 px-4 py-3"
              data-testid={`row-tile-${app.id}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  {app.name}
                  {app.launchUrl ? (
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      Not visible in Workspace
                    </span>
                  )}
                </div>
                {app.launchUrl ? (
                  <div className="truncate text-sm text-muted-foreground">
                    {app.launchUrl}
                    {app.category ? ` · ${app.category}` : ""}
                  </div>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => openEditor(app)}
                data-testid={`button-edit-tile-${app.id}`}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                Edit tile
              </Button>
            </div>
          ))}
          {(apps ?? []).length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No apps onboarded yet — use "Add App" above.
            </div>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Workspace tile — {editing?.name}</DialogTitle>
            <DialogDescription>
              These fields only control how (and whether) this app appears in
              the Digital Workspace launcher. They don't change who is allowed
              to use the app — that's still managed under Map User Security
              Access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tile-launch-url">Launch URL</Label>
              <Input
                id="tile-launch-url"
                placeholder="https://fieldservice.contoso.com"
                value={launchUrl}
                onChange={(e) => setLaunchUrl(e.target.value)}
                data-testid="input-tile-launch-url"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to hide this app from the Workspace entirely.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tile-description">Description</Label>
              <Input
                id="tile-description"
                placeholder="Short description shown on the tile"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                data-testid="input-tile-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Icon</Label>
                <Select value={icon} onValueChange={setIcon}>
                  <SelectTrigger data-testid="select-tile-icon">
                    <SelectValue placeholder="Choose an icon" />
                  </SelectTrigger>
                  <SelectContent>
                    {ICON_OPTIONS.map((name) => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tile-category">Category</Label>
                <Input
                  id="tile-category"
                  placeholder="e.g. Field Operations"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  data-testid="input-tile-category"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save} disabled={updateLaunch.isPending} data-testid="button-save-tile">
              {updateLaunch.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
