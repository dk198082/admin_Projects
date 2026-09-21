import { useState } from "react";
import {
  getListAppsQueryKey,
  useUpdateApp,
  type App,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LayoutGrid, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type TileDraft = {
  name: string;
  launchUrl: string;
  description: string;
  icon: string;
  category: string;
};

const ICON_OPTIONS = [
  { value: "LayoutGrid", label: "Workspace" },
  { value: "Factory", label: "Production" },
  { value: "CalendarDays", label: "Calendar" },
  { value: "BarChart3", label: "Reporting" },
  { value: "Wrench", label: "Service" },
  { value: "Shield", label: "Administration" },
] as const;

function draftFromApp(app: App): TileDraft {
  return {
    name: app.name,
    launchUrl: app.launchUrl ?? "",
    description: app.description ?? "",
    icon: app.icon ?? "",
    category: app.category ?? "",
  };
}

function errorMessage(error: unknown): string {
  return error && typeof error === "object" && "error" in error
    ? String((error as { error: unknown }).error)
    : "Workspace tile could not be updated";
}

export default function WorkspaceTilesSection({
  apps,
  onAdd,
}: {
  apps: App[];
  onAdd: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateApp = useUpdateApp();
  const [editingApp, setEditingApp] = useState<App | null>(null);
  const [draft, setDraft] = useState<TileDraft | null>(null);

  const startEdit = (app: App) => {
    setEditingApp(app);
    setDraft(draftFromApp(app));
  };

  const closeEditor = () => {
    setEditingApp(null);
    setDraft(null);
  };

  const saveTile = () => {
    if (!editingApp || !draft || !draft.name.trim()) {
      toast({ title: "App name is required", variant: "destructive" });
      return;
    }
    if (draft.launchUrl.trim()) {
      try {
        new URL(draft.launchUrl.trim());
      } catch {
        toast({ title: "Launch URL must be a valid web address", variant: "destructive" });
        return;
      }
    }
    updateApp.mutate(
      {
        id: editingApp.id,
        data: {
          name: draft.name.trim(),
          launchUrl: draft.launchUrl.trim() || null,
          description: draft.description.trim() || null,
          icon: draft.icon.trim() || null,
          category: draft.category.trim() || null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
          toast({ title: `Workspace tile for "${draft.name.trim()}" updated` });
          closeEditor();
        },
        onError: (error) =>
          toast({ title: errorMessage(error), variant: "destructive" }),
      },
    );
  };

  const updateDraft = (field: keyof TileDraft, value: string) => {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  };

  return (
    <>
      <Card className="mb-8 shadow-sm">
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-primary" />
              Workspace Tiles
            </CardTitle>
            <CardDescription className="mt-1">
              Control how each app appears as a launch tile in the Digital Workspace.
              An app with no launch URL is hidden from the Workspace.
            </CardDescription>
          </div>
          <Button type="button" onClick={onAdd} className="shrink-0">
            <Plus className="mr-2 h-4 w-4" />
            Add app
          </Button>
        </CardHeader>
        <CardContent>
          <div className="divide-y rounded-md border">
            {apps.length ? apps.map((app) => (
              <div
                key={app.id}
                className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{app.name}</span>
                    {app.launchUrl ? (
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Not visible in Workspace
                      </span>
                    )}
                  </div>
                  {app.launchUrl && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      <a
                        href={app.launchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="max-w-full truncate hover:text-foreground hover:underline"
                      >
                        {app.launchUrl}
                      </a>
                      {app.category && <><span>·</span><span>{app.category}</span></>}
                    </div>
                  )}
                  {app.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{app.description}</p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => startEdit(app)}
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit tile
                </Button>
              </div>
            )) : (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No applications have been added.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!editingApp} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Workspace tile — {editingApp?.name}</DialogTitle>
            <DialogDescription>
              These fields only control how (and whether) this app appears in the Digital
              Workspace launcher. They don&apos;t change who is allowed to use the app —
              that&apos;s still managed under Map User Security Access.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="grid gap-4 py-2 sm:grid-cols-2">
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="tile-url">Launch URL</Label>
                <Input
                  id="tile-url"
                  type="url"
                  placeholder="https://app.example.com"
                  value={draft.launchUrl}
                  onChange={(event) => updateDraft("launchUrl", event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to hide this app from the Workspace entirely.
                </p>
              </div>
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="tile-description">Description</Label>
                <Input
                  id="tile-description"
                  placeholder="Short description shown on the tile"
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tile-icon">Icon</Label>
                <Select
                  value={draft.icon || "none"}
                  onValueChange={(value) => updateDraft("icon", value === "none" ? "" : value)}
                >
                  <SelectTrigger id="tile-icon">
                    <SelectValue placeholder="Choose an icon" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose an icon</SelectItem>
                    {ICON_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="tile-category">Category</Label>
                <Input
                  id="tile-category"
                  placeholder="Administration"
                  value={draft.category}
                  onChange={(event) => updateDraft("category", event.target.value)}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditor}>
              Cancel
            </Button>
            <Button type="button" onClick={saveTile} disabled={updateApp.isPending}>
              {updateApp.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}