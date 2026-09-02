import { useMemo, useState } from "react";
import {
  useListAccessMapping,
  getListAccessMappingQueryKey,
  useAssignAccessMapping,
  useRemoveAccessMapping,
  useListUsers,
  getListUsersQueryKey,
  useListApps,
  getListAppsQueryKey,
  getListRolesQueryKey,
  type AccessMappingEntry,
  type AccessMappingAssignInputLevel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppWindow, Settings2, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const LEVELS: AccessMappingAssignInputLevel[] = ["Read Only", "Read / Write"];

export default function AccessMapping() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: mapping, isLoading } = useListAccessMapping({
    query: { queryKey: getListAccessMappingQueryKey() },
  });
  const { data: users, isLoading: isUsersLoading } = useListUsers({
    query: { queryKey: getListUsersQueryKey() },
  });
  const { data: apps } = useListApps({ query: { queryKey: getListAppsQueryKey() } });

  const assign = useAssignAccessMapping();
  const remove = useRemoveAccessMapping();

  const [assignOpen, setAssignOpen] = useState(false);

  // ── By-User dialog state ────────────────────────────────────────────────────
  // When opened from a user banner the dialog is scoped to that one user
  const [lockedUserId, setLockedUserId] = useState<number | null>(null);
  const [lockedUserName, setLockedUserName] = useState<string>("");
  // appId → chosen level; only apps the user does NOT yet have access to
  const [appLevelMap, setAppLevelMap] = useState<Map<number, AccessMappingAssignInputLevel>>(
    new Map(),
  );

  // ── By-App dialog state ─────────────────────────────────────────────────────
  // When opened from an app banner the dialog is scoped to that one app
  const [lockedAppId, setLockedAppId] = useState<number | null>(null);
  const [lockedAppName, setLockedAppName] = useState<string>("");
  // userId → current level for this app (snapshot at dialog-open)
  const [originalAppUsers, setOriginalAppUsers] = useState<
    Map<number, AccessMappingAssignInputLevel>
  >(new Map());
  // userId → chosen level for the app-scoped dialog
  const [userLevelMap, setUserLevelMap] = useState<Map<number, AccessMappingAssignInputLevel>>(
    new Map(),
  );

  const [pendingRemove, setPendingRemove] = useState<AccessMappingEntry | null>(null);
  const [changingAssignmentId, setChangingAssignmentId] = useState<number | null>(null);

  // ── Derived data ────────────────────────────────────────────────────────────
  const byUser = useMemo(() => {
    const m = new Map<number, { name: string; email: string; entries: AccessMappingEntry[] }>();

    // Start with every user so newly-created users appear here even before
    // their first application entitlement is assigned.
    for (const user of users ?? []) {
      m.set(user.id, { name: user.name, email: user.email, entries: [] });
    }

    for (const e of mapping ?? []) {
      const g = m.get(e.userId) ?? { name: e.userName, email: e.userEmail, entries: [] };
      g.entries.push(e);
      m.set(e.userId, g);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [mapping, users]);

  const byApp = useMemo(() => {
    const m = new Map<number, { name: string; entries: AccessMappingEntry[] }>();
    for (const e of mapping ?? []) {
      const g = m.get(e.appId) ?? { name: e.appName, entries: [] };
      g.entries.push(e);
      m.set(e.appId, g);
    }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [mapping]);

  // ── Dialog helpers ──────────────────────────────────────────────────────────
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAccessMappingQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListRolesQueryKey() });
  };

  const resetDialog = () => {
    // by-user
    setAppLevelMap(new Map());
    setLockedUserId(null);
    setLockedUserName("");
    // by-app
    setLockedAppId(null);
    setLockedAppName("");
    setOriginalAppUsers(new Map());
    setUserLevelMap(new Map());
  };

  const openDialog = (opts?: {
    userId?: number;
    userName?: string;
    appId?: number;
    appName?: string;
  }) => {
    resetDialog();

    if (opts?.userId != null) {
      setLockedUserId(opts.userId);
      setLockedUserName(opts.userName ?? "");
    } else if (opts?.appId != null) {
      // ── By-App mode: pre-populate user→level snapshot ──────────────────────
      setLockedAppId(opts.appId);
      setLockedAppName(opts.appName ?? "");
      const existing = new Map<number, AccessMappingAssignInputLevel>();
      for (const e of mapping ?? []) {
        if (e.appId === opts.appId) {
          existing.set(e.userId, e.level as AccessMappingAssignInputLevel);
        }
      }
      setOriginalAppUsers(existing);
      // Level and selUsersForApp are chosen by the admin in step 1
    }

    setAssignOpen(true);
  };

  const setLevelForUser = (userId: number, lvl: AccessMappingAssignInputLevel) => {
    setUserLevelMap((prev) => {
      const next = new Map(prev);
      next.set(userId, lvl);
      return next;
    });
  };

  const removeUserFromMap = (userId: number) => {
    setUserLevelMap((prev) => {
      const next = new Map(prev);
      next.delete(userId);
      return next;
    });
  };

  // ── Grant handler ───────────────────────────────────────────────────────────
  const handleAssign = async () => {
    // By-App mode
    if (lockedAppId != null) {
      if (userLevelMap.size === 0) return;
      const userIds = [...userLevelMap.keys()];
      // Group by level and call once per level
      const byLevel = new Map<AccessMappingAssignInputLevel, number[]>();
      for (const [userId, lvl] of userLevelMap) {
        const group = byLevel.get(lvl) ?? [];
        group.push(userId);
        byLevel.set(lvl, group);
      }
      const calls = [...byLevel.entries()].map(
        ([lvl, userIds]) =>
          new Promise<{ assigned: number; updated: number; skipped: number }>((resolve, reject) =>
            assign.mutate(
              { data: { userIds, appIds: [lockedAppId], level: lvl } },
              { onSuccess: resolve, onError: reject },
            ),
          ),
      );
      try {
        const results = await Promise.all(calls);
        const totals = results.reduce(
          (acc, r) => ({
            assigned: acc.assigned + r.assigned,
            updated: acc.updated + r.updated,
            skipped: acc.skipped + r.skipped,
          }),
          { assigned: 0, updated: 0, skipped: 0 },
        );
        invalidate();
        setAssignOpen(false);
        resetDialog();
        toast({
          title: "Access updated",
          description: `${totals.assigned} granted, ${totals.updated} changed, ${totals.skipped} already set.`,
        });
      } catch (err) {
        toast({
          title: "Failed to save access",
          description: err instanceof Error ? err.message : "Unexpected error",
          variant: "destructive",
        });
      }
      return;
    }

    // By-User mode (scoped to a single user)
    if (lockedUserId == null || appLevelMap.size === 0) return;

    const byLevel = new Map<AccessMappingAssignInputLevel, number[]>();
    for (const [appId, lvl] of appLevelMap) {
      const group = byLevel.get(lvl) ?? [];
      group.push(appId);
      byLevel.set(lvl, group);
    }

    const calls = [...byLevel.entries()].map(
      ([lvl, appIds]) =>
        new Promise<{ assigned: number; updated: number; skipped: number }>((resolve, reject) =>
          assign.mutate(
            { data: { userIds: [lockedUserId!], appIds, level: lvl } },
            { onSuccess: resolve, onError: reject },
          ),
        ),
    );

    try {
      const results = await Promise.all(calls);
      const totals = results.reduce(
        (acc, r) => ({
          assigned: acc.assigned + r.assigned,
          updated: acc.updated + r.updated,
          skipped: acc.skipped + r.skipped,
        }),
        { assigned: 0, updated: 0, skipped: 0 },
      );
      invalidate();
      setAssignOpen(false);
      resetDialog();
      toast({
        title: "Access updated",
        description: `${totals.assigned} granted, ${totals.updated} changed, ${totals.skipped} already set.`,
      });
    } catch (err) {
      toast({
        title: "Failed to save access",
        description: err instanceof Error ? err.message : "Unexpected error",
        variant: "destructive",
      });
    }
  };

  const handleInlineLevelChange = (
    e: AccessMappingEntry,
    newLevel: AccessMappingAssignInputLevel,
  ) => {
    if (newLevel === e.level) return;
    setChangingAssignmentId(e.assignmentId);
    assign.mutate(
      { data: { userIds: [e.userId], appIds: [e.appId], level: newLevel } },
      {
        onSuccess: () => {
          invalidate();
          setChangingAssignmentId(null);
          toast({
            title: "Access level changed",
            description: `${e.userName} now has ${newLevel} access to ${e.appName}.`,
          });
        },
        onError: (err) => {
          setChangingAssignmentId(null);
          toast({
            title: "Failed to change access level",
            description: err instanceof Error ? err.message : "Unexpected error",
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleRemove = () => {
    if (!pendingRemove) return;
    remove.mutate(
      { data: { userIds: [pendingRemove.userId], appIds: [pendingRemove.appId] } },
      {
        onSuccess: () => {
          invalidate();
          toast({
            title: "Access removed",
            description: `${pendingRemove.userName} no longer has access to ${pendingRemove.appName}.`,
          });
          setPendingRemove(null);
        },
        onError: (err) => {
          toast({
            title: "Failed to remove access",
            description: err instanceof Error ? err.message : "Unexpected error",
            variant: "destructive",
          });
          setPendingRemove(null);
        },
      },
    );
  };

  const setLevelForApp = (appId: number, lvl: AccessMappingAssignInputLevel) => {
    setAppLevelMap((prev) => {
      const next = new Map(prev);
      next.set(appId, lvl);
      return next;
    });
  };

  const removeAppFromMap = (appId: number) => {
    setAppLevelMap((prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });
  };

  // ── Table row ───────────────────────────────────────────────────────────────
  const entryRow = (e: AccessMappingEntry, showUser: boolean, showApp: boolean) => (
    <TableRow key={e.assignmentId} data-testid={`row-mapping-${e.assignmentId}`}>
      {showUser && (
        <TableCell>
          <div className="font-medium">{e.userName}</div>
          <div className="text-xs text-muted-foreground">{e.userEmail}</div>
        </TableCell>
      )}
      {showApp && <TableCell className="font-medium">{e.appName}</TableCell>}
      <TableCell>
        <Select
          value={e.level}
          onValueChange={(v) => handleInlineLevelChange(e, v as AccessMappingAssignInputLevel)}
          disabled={changingAssignmentId === e.assignmentId && assign.isPending}
        >
          <SelectTrigger className="h-8 w-[150px]" data-testid={`select-level-${e.assignmentId}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-destructive"
          onClick={() => setPendingRemove(e)}
          data-testid={`button-remove-mapping-${e.assignmentId}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );

  // ── By-User dialog: app list with dropdown ────────────────────────────────────────
  const appGrantList = () => {
    if (lockedUserId == null) return null;
    // Build set of appIds this user already has access to
    const userApps = new Set<number>();
    for (const e of mapping ?? []) {
      if (e.userId === lockedUserId) userApps.add(e.appId);
    }
    const unassignedApps = (apps ?? []).filter((app) => !userApps.has(app.id));

    if (unassignedApps.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          This user already has access to all apps.
        </p>
      );
    }

    return (
      <div>
        <Label className="mb-2 block">Apps</Label>
        <div className="border rounded-md max-h-64 overflow-auto divide-y">
          {unassignedApps.map((app) => {
            const chosen = appLevelMap.get(app.id);
            return (
              <div
                key={app.id}
                className="flex items-center gap-3 px-3 py-2"
                data-testid={`row-grant-app-${app.id}`}
              >
                <span className="truncate font-medium text-sm flex-1">{app.name}</span>
                <Select
                  value={chosen ?? ""}
                  onValueChange={(v) => {
                    if (!v) removeAppFromMap(app.id);
                    else setLevelForApp(app.id, v as AccessMappingAssignInputLevel);
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-[155px] text-xs"
                    data-testid={`select-grant-app-level-${app.id}`}
                  >
                    <SelectValue placeholder="Choose level" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosen != null && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => removeAppFromMap(app.id)}
                    data-testid={`button-clear-app-${app.id}`}
                  >
                    clear
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── By-App dialog body ──────────────────────────────────────────────────────
  const appScopedDialogBody = () => {
    if (lockedAppId == null) return null;
    const appUsers = new Set<number>();
    for (const e of mapping ?? []) {
      if (e.appId === lockedAppId) appUsers.add(e.userId);
    }
    const unassignedUsers = (users ?? []).filter((u) => !appUsers.has(u.id));

    if (unassignedUsers.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          All users already have access to this app.
        </p>
      );
    }

    return (
      <div>
        <Label className="mb-2 block">Users</Label>
        <div className="border rounded-md max-h-64 overflow-auto divide-y">
          {unassignedUsers.map((u) => {
            const chosen = userLevelMap.get(u.id);
            return (
              <div
                key={u.id}
                className="flex items-center gap-3 px-3 py-2"
                data-testid={`row-grant-user-${u.id}`}
              >
                <span className="truncate font-medium text-sm flex-1">{u.name}</span>
                <Select
                  value={chosen ?? ""}
                  onValueChange={(v) => {
                    if (!v) removeUserFromMap(u.id);
                    else setLevelForUser(u.id, v as AccessMappingAssignInputLevel);
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-[155px] text-xs"
                    data-testid={`select-grant-user-level-${u.id}`}
                  >
                    <SelectValue placeholder="Choose level" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {l}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {chosen != null && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => removeUserFromMap(u.id)}
                    data-testid={`button-clear-user-${u.id}`}
                  >
                    clear
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Validity ────────────────────────────────────────────────────────────────
  const grantIsValid =
    lockedAppId != null ? userLevelMap.size > 0 : appLevelMap.size > 0;

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Map User Security Access</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Grant users Read Only or Read / Write access to entire apps. Entitlement roles and their
          permissions are managed automatically in the background.
        </p>
      </div>

      <div className="space-y-3">
        <Tabs defaultValue="byUser">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground font-medium">View:</span>
            <TabsList>
              <TabsTrigger value="byUser" data-testid="tab-by-user">
                <UserRound className="h-4 w-4 mr-1.5" />
                By User
              </TabsTrigger>
              <TabsTrigger value="byApp" data-testid="tab-by-app">
                <AppWindow className="h-4 w-4 mr-1.5" />
                By App
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── By User ── */}
          <TabsContent value="byUser" className="space-y-6 mt-4">
            {isLoading || isUsersLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : byUser.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No app access assigned yet. Use "Manage Assignments" to grant users access to apps.
              </p>
            ) : (
              byUser.map(([userId, group]) => (
                <div key={userId} className="border rounded-lg">
                  <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">{group.name}</span>
                      <span className="text-muted-foreground text-sm ml-2">{group.email}</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => openDialog({ userId, userName: group.name })}
                      data-testid={`button-manage-user-${userId}`}
                    >
                      <Settings2 className="h-4 w-4 mr-1.5" />
                      Add Application
                    </Button>
                  </div>
                   {group.entries.length === 0 ? (
                     <p className="px-4 py-4 text-sm text-muted-foreground">
                       No application access assigned yet.
                     </p>
                   ) : (
                     <Table>
                       <TableHeader>
                         <TableRow>
                           <TableHead>App</TableHead>
                           <TableHead>Access Level</TableHead>
                           <TableHead className="text-right">Remove</TableHead>
                         </TableRow>
                       </TableHeader>
                       <TableBody>{group.entries.map((e) => entryRow(e, false, true))}</TableBody>
                     </Table>
                   )}
                </div>
              ))
            )}
          </TabsContent>

          {/* ── By App ── */}
          <TabsContent value="byApp" className="space-y-6 mt-4">
            {isLoading ? (
              <p className="text-muted-foreground text-sm">Loading…</p>
            ) : byApp.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No app access assigned yet. Use "Manage Assignments" to grant users access to apps.
              </p>
            ) : (
              byApp.map(([appId, group]) => (
                <div key={appId} className="border rounded-lg">
                  <div className="px-4 py-3 border-b bg-muted/40 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-semibold">{group.name}</span>
                      <span className="text-muted-foreground text-sm ml-2">
                        {group.entries.length} user{group.entries.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => openDialog({ appId, appName: group.name })}
                      data-testid={`button-manage-app-${appId}`}
                    >
                      <Settings2 className="h-4 w-4 mr-1.5" />
                      Add User
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>User</TableHead>
                        <TableHead>Access Level</TableHead>
                        <TableHead className="text-right">Remove</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{group.entries.map((e) => entryRow(e, true, false))}</TableBody>
                  </Table>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Main dialog ── */}
      <Dialog
        open={assignOpen}
        onOpenChange={(o) => {
          setAssignOpen(o);
          if (!o) resetDialog();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {lockedAppId != null
                ? `Manage User Access — ${lockedAppName}`
                : lockedUserId != null
                  ? `Grant Access — ${lockedUserName}`
                  : "Manage Assignments"}
            </DialogTitle>
            <DialogDescription>
              {lockedAppId != null
                ? "Select a level for each user below. Only users without existing access are shown."
                : "Select a level for each app below. Only apps without existing access are shown."}
            </DialogDescription>
          </DialogHeader>

          {lockedAppId != null ? appScopedDialogBody() : appGrantList()}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!grantIsValid || assign.isPending}
              data-testid="button-save-assignment"
            >
              {assign.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Per-row remove confirm ── */}
      <AlertDialog open={!!pendingRemove} onOpenChange={(o) => !o && setPendingRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove app access?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemove
                ? `${pendingRemove.userName} will lose ${pendingRemove.level} access to ${pendingRemove.appName}.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRemove}
              disabled={remove.isPending}
              data-testid="button-confirm-remove-mapping"
            >
              {remove.isPending ? "Removing…" : "Remove Access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
