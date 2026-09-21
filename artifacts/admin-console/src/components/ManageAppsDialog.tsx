import { useEffect, useState } from "react";
import {
  useListApps, getListAppsQueryKey,
  useListResources, getListResourcesQueryKey,
  getListAccessGrantsQueryKey,
  getListSecurityPoliciesQueryKey,
  useCreateApp, useUpdateApp, useDeleteApp,
  useCreateResource, useUpdateResource, useDeleteResource,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutGrid, FileText, Table as TableIcon, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

function errMsg(err: unknown, fallback: string): string {
  return err && typeof err === "object" && "error" in err
    ? String((err as { error: unknown }).error)
    : fallback;
}

const RESOURCE_TYPES = ["Tab", "Form", "Table"] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];
type AppResourceDraft = { name: string; type: ResourceType };

function emptyResource(): AppResourceDraft {
  return { name: "", type: "Tab" };
}

function typeIcon(type: string) {
  switch (type) {
    case "Form": return <FileText className="h-3.5 w-3.5" />;
    case "Table": return <TableIcon className="h-3.5 w-3.5" />;
    case "Tab": return <LayoutGrid className="h-3.5 w-3.5" />;
    default: return null;
  }
}

export function AddAppDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (appId: number) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createApp = useCreateApp();
  const [name, setName] = useState("");
  const [launchUrl, setLaunchUrl] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("");
  const [category, setCategory] = useState("");
  const [resources, setResources] = useState<AppResourceDraft[]>([emptyResource()]);

  const handleCreate = () => {
    if (!name.trim()) {
      toast({ title: "App name is required", variant: "destructive" });
      return;
    }
    if (launchUrl.trim()) {
      try {
        new URL(launchUrl.trim());
      } catch {
        toast({ title: "Launch URL must be a valid web address", variant: "destructive" });
        return;
      }
    }
    const populatedResources = resources
      .filter((resource) => resource.name.trim())
      .map((resource) => ({ ...resource, name: resource.name.trim() }));
    const names = new Set<string>();
    for (const resource of populatedResources) {
      const normalized = resource.name.toLowerCase();
      if (names.has(normalized)) {
        toast({ title: `Duplicate resource "${resource.name}"`, variant: "destructive" });
        return;
      }
      names.add(normalized);
    }
    createApp.mutate(
      {
        data: {
          name: name.trim(),
          launchUrl: launchUrl.trim() || null,
          description: description.trim() || null,
          icon: icon.trim() || null,
          category: category.trim() || null,
          resources: populatedResources,
        },
      },
      {
        onSuccess: (app) => {
          queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListResourcesQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListSecurityPoliciesQueryKey() });
          setName("");
          setLaunchUrl("");
          setDescription("");
          setIcon("");
          setCategory("");
          setResources([emptyResource()]);
          onOpenChange(false);
          toast({
            title: `App "${app.name}" onboarded`,
            description:
              `${app.resourceCount} resource${app.resourceCount === 1 ? "" : "s"}, a default security policy, and Read Only / Read / Write entitlement roles were created.`,
          });
          onCreated?.(app.id);
        },
        onError: (err: unknown) =>
          toast({ title: errMsg(err, "Failed to create app"), variant: "destructive" }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Application</DialogTitle>
          <DialogDescription>
            Onboard a new app. A default security policy and Read Only / Read / Write entitlement
            roles are created automatically. Add tabs, forms, and tables now so the app is ready for
            access mapping immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="app-name">App Name</Label>
            <Input
              id="app-name"
              placeholder="e.g. Inventory Portal"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="app-launch-url">Workspace Launch URL</Label>
              <Input
                id="app-launch-url"
                type="url"
                placeholder="https://app.example.com"
                value={launchUrl}
                onChange={(event) => setLaunchUrl(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to keep this app hidden from the Digital Workspace.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-category">Workspace Category</Label>
              <Input
                id="app-category"
                placeholder="e.g. Reporting"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="app-icon">Icon</Label>
              <Input
                id="app-icon"
                placeholder="e.g. LayoutDashboard"
                value={icon}
                onChange={(event) => setIcon(event.target.value)}
              />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="app-description">Description</Label>
              <Textarea
                id="app-description"
                placeholder="Short description shown with the Workspace tile"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Resources</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Optional; blank rows are ignored.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setResources((current) => [...current, emptyResource()])}
              >
                <Plus className="h-4 w-4 mr-1" /> Add resource
              </Button>
            </div>
            <div className="space-y-2">
              {resources.map((resource, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Select
                    value={resource.type}
                    onValueChange={(type: ResourceType) =>
                      setResources((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, type } : item,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RESOURCE_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    className="flex-1"
                    placeholder="Resource name"
                    value={resource.name}
                    onChange={(event) =>
                      setResources((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    title="Remove resource"
                    onClick={() =>
                      setResources((current) =>
                        current.length === 1
                          ? [emptyResource()]
                          : current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={createApp.isPending}>
            {createApp.isPending ? "Adding..." : "Add App"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ManageResourcesDialog({
  open, onOpenChange, initialAppId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAppId?: number;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: apps } = useListApps({ query: { queryKey: getListAppsQueryKey() } });
  const [appId, setAppId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    if (initialAppId) {
      setAppId(initialAppId.toString());
    } else if (apps?.length) {
      setAppId((prev) => (prev && apps.some((a) => a.id.toString() === prev) ? prev : apps[0].id.toString()));
    }
  }, [open, initialAppId, apps]);

  const selectedApp = apps?.find((a) => a.id.toString() === appId);
  const resourceParams = appId ? { appId: parseInt(appId) } : {};
  const { data: resources } = useListResources(resourceParams, {
    query: { queryKey: getListResourcesQueryKey(resourceParams), enabled: !!appId },
  });

  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();
  const updateApp = useUpdateApp();
  const deleteApp = useDeleteApp();

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<string>("Tab");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<string>("Tab");
  const [renamingApp, setRenamingApp] = useState(false);
  const [appNameDraft, setAppNameDraft] = useState("");
  const [confirmDeleteApp, setConfirmDeleteApp] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [confirmDeleteResource, setConfirmDeleteResource] = useState<{ id: number; name: string } | null>(null);
  const [deleteResourceConfirmText, setDeleteResourceConfirmText] = useState("");

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: getListAppsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListResourcesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListResourcesQueryKey(resourceParams) });
    queryClient.invalidateQueries({ queryKey: getListAccessGrantsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSecurityPoliciesQueryKey() });
  };

  const handleAddResource = () => {
    if (!newName.trim() || !appId) return;
    createResource.mutate(
      { data: { appId: parseInt(appId), name: newName.trim(), type: newType as "Tab" | "Form" | "Table" } },
      {
        onSuccess: () => {
          invalidateAll();
          setNewName("");
          toast({ title: "Resource added", description: "It now appears in the permission matrix." });
        },
        onError: (err: unknown) =>
          toast({ title: errMsg(err, "Failed to add resource"), variant: "destructive" }),
      },
    );
  };

  const startEdit = (id: number, name: string, type: string) => {
    setEditingId(id);
    setEditName(name);
    setEditType(type);
  };

  const handleSaveEdit = () => {
    if (editingId === null || !editName.trim()) return;
    updateResource.mutate(
      { id: editingId, data: { name: editName.trim(), type: editType as "Tab" | "Form" | "Table" } },
      {
        onSuccess: () => {
          invalidateAll();
          setEditingId(null);
          toast({ title: "Resource updated" });
        },
        onError: (err: unknown) =>
          toast({ title: errMsg(err, "Failed to update resource"), variant: "destructive" }),
      },
    );
  };

  const deleteResourceNameMatches =
    !!confirmDeleteResource && deleteResourceConfirmText.trim() === confirmDeleteResource.name;

  const handleDeleteResource = () => {
    if (!confirmDeleteResource || !deleteResourceNameMatches) return;
    deleteResource.mutate(
      { id: confirmDeleteResource.id },
      {
        onSuccess: () => {
          invalidateAll();
          toast({ title: `Resource "${confirmDeleteResource.name}" removed`, description: "Its grants were revoked." });
          setConfirmDeleteResource(null);
          setDeleteResourceConfirmText("");
        },
        onError: (err: unknown) => {
          toast({ title: errMsg(err, "Failed to remove resource"), variant: "destructive" });
          setConfirmDeleteResource(null);
          setDeleteResourceConfirmText("");
        },
      },
    );
  };

  const handleRenameApp = () => {
    if (!selectedApp || !appNameDraft.trim()) return;
    updateApp.mutate(
      { id: selectedApp.id, data: { name: appNameDraft.trim() } },
      {
        onSuccess: () => {
          invalidateAll();
          setRenamingApp(false);
          toast({ title: "App renamed" });
        },
        onError: (err: unknown) =>
          toast({ title: errMsg(err, "Failed to rename app"), variant: "destructive" }),
      },
    );
  };

  const deleteNameMatches = !!selectedApp && deleteConfirmText.trim() === selectedApp.name;

  const handleDeleteApp = () => {
    if (!selectedApp || !deleteNameMatches) return;
    deleteApp.mutate(
      { id: selectedApp.id },
      {
        onSuccess: () => {
          invalidateAll();
          setConfirmDeleteApp(false);
          setAppId("");
          toast({ title: `App "${selectedApp.name}" deleted` });
        },
        onError: (err: unknown) => {
          toast({ title: errMsg(err, "Failed to delete app"), variant: "destructive" });
          setConfirmDeleteApp(false);
        },
      },
    );
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[620px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage App Resources</DialogTitle>
            <DialogDescription>
              Add, rename, or remove the tabs, forms, and tables that roles can be granted access to.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label>Application</Label>
                {renamingApp && selectedApp ? (
                  <div className="flex items-center gap-2">
                    <Input
                      value={appNameDraft}
                      onChange={(e) => setAppNameDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRenameApp(); }}
                      autoFocus
                    />
                    <Button size="icon" variant="outline" onClick={handleRenameApp} disabled={updateApp.isPending}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setRenamingApp(false)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Select value={appId} onValueChange={(v) => { setAppId(v); setEditingId(null); }}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Select an app" /></SelectTrigger>
                      <SelectContent>
                        {apps?.map((a) => (
                          <SelectItem key={a.id} value={a.id.toString()}>{a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedApp && (
                      <>
                        <Button
                          size="icon" variant="outline" title="Rename app"
                          onClick={() => { setAppNameDraft(selectedApp.name); setRenamingApp(true); }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon" variant="outline" title="Delete app"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setConfirmDeleteApp(true)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {selectedApp && (
              <>
                <div className="border rounded-md divide-y">
                  {resources?.length ? (
                    resources.map((r) => (
                      <div key={r.id} className="flex items-center gap-2 p-2.5">
                        {editingId === r.id ? (
                          <>
                            <Select value={editType} onValueChange={setEditType}>
                              <SelectTrigger className="w-[110px] h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {RESOURCE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Input
                              className="h-8 flex-1"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(); }}
                              autoFocus
                            />
                            <Button size="icon" variant="outline" className="h-8 w-8" onClick={handleSaveEdit} disabled={updateResource.isPending}>
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingId(null)}>
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="flex items-center gap-1.5 text-xs text-muted-foreground w-[80px]">
                              {typeIcon(r.type)}{r.type}
                            </span>
                            <span className="flex-1 text-sm font-medium">{r.name}</span>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => startEdit(r.id, r.name, r.type)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon" variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setConfirmDeleteResource({ id: r.id, name: r.name })}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="p-6 text-center text-sm text-muted-foreground">
                      No resources yet. Add the first one below.
                    </div>
                  )}
                </div>

                <div className="flex items-end gap-2 border rounded-md p-3 bg-muted/20">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Type</Label>
                    <Select value={newType} onValueChange={setNewType}>
                      <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RESOURCE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    <Label className="text-xs">Resource name</Label>
                    <Input
                      className="h-9"
                      placeholder="e.g. Work Orders"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddResource(); }}
                    />
                  </div>
                  <Button className="h-9" onClick={handleAddResource} disabled={!newName.trim() || createResource.isPending}>
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeleteApp}
        onOpenChange={(o) => { setConfirmDeleteApp(o); if (!o) setDeleteConfirmText(""); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{selectedApp?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the app along with all of its resources, access grants,
              security policy, and API keys. Apps using an API key for this app will lose access.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-delete-app">
              Type <span className="font-semibold">{selectedApp?.name}</span> to confirm
            </Label>
            <Input
              id="confirm-delete-app"
              autoComplete="off"
              placeholder={selectedApp?.name}
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteNameMatches || deleteApp.isPending}
              onClick={handleDeleteApp}
            >
              {deleteApp.isPending ? "Deleting..." : "Delete App"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!confirmDeleteResource}
        onOpenChange={(o) => { if (!o) { setConfirmDeleteResource(null); setDeleteResourceConfirmText(""); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove "{confirmDeleteResource?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the resource from the permission matrix and revokes any role grants on it.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="confirm-delete-resource">
              Type <span className="font-semibold">{confirmDeleteResource?.name}</span> to confirm
            </Label>
            <Input
              id="confirm-delete-resource"
              autoComplete="off"
              placeholder={confirmDeleteResource?.name}
              value={deleteResourceConfirmText}
              onChange={(e) => setDeleteResourceConfirmText(e.target.value)}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!deleteResourceNameMatches || deleteResource.isPending}
              onClick={handleDeleteResource}
            >
              {deleteResource.isPending ? "Removing..." : "Remove Resource"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
