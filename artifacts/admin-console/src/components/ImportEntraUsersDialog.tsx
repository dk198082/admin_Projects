import { useEffect, useMemo, useState } from "react";
import {
  useSearchEntraUsers,
  getSearchEntraUsersQueryKey,
  useBulkImportUsers,
  getListUsersQueryKey,
  getListRolesQueryKey,
  EntraUser,
  Role,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

function extractErrorMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { error?: unknown } | null; message?: string };
  if (e?.data && typeof e.data === "object" && typeof e.data.error === "string") return e.data.error;
  if (typeof e?.message === "string" && e.message) return e.message;
  return fallback;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[] | undefined;
}

export default function ImportEntraUsersDialog({ open, onOpenChange, roles }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const bulkImport = useBulkImportUsers();

  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const enabled = open && debounced.length >= 2;
  const { data: results, isFetching, error } = useSearchEntraUsers(
    { query: debounced },
    {
      query: {
        queryKey: getSearchEntraUsersQueryKey({ query: debounced }),
        enabled,
        retry: false,
      },
    },
  );

  const [selected, setSelected] = useState<Map<string, EntraUser>>(new Map());
  const [roleIds, setRoleIds] = useState<Set<number>>(new Set());

  const reset = () => {
    setSearch("");
    setDebounced("");
    setSelected(new Map());
    setRoleIds(new Set());
  };

  const toggleUser = (u: EntraUser, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) next.set(u.objectId, u);
      else next.delete(u.objectId);
      return next;
    });
  };

  const toggleRole = (id: number, checked: boolean) => {
    setRoleIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedList = useMemo(() => [...selected.values()], [selected]);

  const handleImport = () => {
    bulkImport.mutate(
      {
        data: {
          users: selectedList.map((u) => ({
            name: u.displayName,
            email: u.email,
            entraObjectId: u.objectId,
            status: u.accountEnabled ? ("active" as const) : ("disabled" as const),
          })),
          roleIds: [...roleIds],
        },
      },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
          onOpenChange(false);
          reset();
          toast({
            title: `${result.created} user${result.created === 1 ? "" : "s"} imported`,
            description:
              [
                result.skipped > 0 ? `${result.skipped} already existed and were skipped.` : null,
                result.assignedRoles > 0 ? `${result.assignedRoles} role assignment(s) created.` : null,
              ]
                .filter(Boolean)
                .join(" ") || undefined,
          });
        },
        onError: (err) =>
          toast({
            title: "Import failed",
            description: extractErrorMessage(err, "Could not import users"),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Import Users from Azure Entra</DialogTitle>
          <DialogDescription>
            Search your directory, select users, and optionally assign roles to all of them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search directory by name or email (min 2 characters)..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {enabled && (
            <div className="rounded-md border max-h-44 overflow-y-auto divide-y">
              {isFetching ? (
                <div className="p-3 text-sm text-muted-foreground">Searching directory...</div>
              ) : error ? (
                <div className="p-3 text-sm text-destructive">
                  {extractErrorMessage(error, "Directory search failed")}
                </div>
              ) : results?.length ? (
                results.map((u) => (
                  <label
                    key={u.objectId}
                    className="flex items-center gap-3 p-2.5 hover:bg-muted/40 cursor-pointer"
                  >
                    <Checkbox
                      checked={selected.has(u.objectId)}
                      onCheckedChange={(c: boolean) => toggleUser(u, c)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.displayName}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <Badge variant="outline" className={u.accountEnabled ? "text-green-600 border-green-600/40" : "text-destructive border-destructive/40"}>
                      {u.accountEnabled ? "Active" : "Disabled"}
                    </Badge>
                  </label>
                ))
              ) : (
                <div className="p-3 text-sm text-muted-foreground">No matching directory users.</div>
              )}
            </div>
          )}

          {selectedList.length > 0 && (
            <div>
              <div className="text-sm font-medium mb-1.5">
                Selected ({selectedList.length})
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedList.map((u) => (
                  <Badge key={u.objectId} variant="secondary" className="gap-1">
                    {u.displayName}
                    <button
                      type="button"
                      className="ml-1 text-muted-foreground hover:text-foreground"
                      onClick={() => toggleUser(u, false)}
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="text-sm font-medium mb-1.5">Assign roles to all imported users (optional)</div>
            <div className="rounded-md border max-h-36 overflow-y-auto divide-y">
              {roles?.length ? (
                roles.map((r) => (
                  <label key={r.id} className="flex items-center gap-3 p-2.5 hover:bg-muted/40 cursor-pointer">
                    <Checkbox
                      checked={roleIds.has(r.id)}
                      onCheckedChange={(c: boolean) => toggleRole(r.id, c)}
                    />
                    <span className="text-sm">{r.name}</span>
                  </label>
                ))
              ) : (
                <div className="p-3 text-sm text-muted-foreground">No roles defined yet.</div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={selectedList.length === 0 || bulkImport.isPending}
          >
            {bulkImport.isPending
              ? "Importing..."
              : `Import ${selectedList.length || ""} user${selectedList.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
