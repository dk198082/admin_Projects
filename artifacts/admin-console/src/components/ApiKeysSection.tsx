import { useState } from "react";
import {
  useListApiKeys,
  getListApiKeysQueryKey,
  useCreateApiKey,
  useRevokeApiKey,
  useListApps,
  getListAppsQueryKey,
  CreatedApiKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { KeyRound, Plus, Copy, Check, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function ApiKeysSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: keys, isLoading } = useListApiKeys({
    query: { queryKey: getListApiKeysQueryKey() },
  });
  const { data: apps } = useListApps({
    query: { queryKey: getListAppsQueryKey() },
  });

  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [appName, setAppName] = useState("");
  const [label, setLabel] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = () => {
    createKey.mutate(
      { data: { appName, label: label || undefined } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
          setCreatedKey(result);
        },
        onError: () => toast({ title: "Failed to create API key", variant: "destructive" }),
      },
    );
  };

  const handleRevoke = (id: number, appNameFor: string) => {
    revokeKey.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListApiKeysQueryKey() });
          toast({ title: `API key for ${appNameFor} revoked` });
        },
        onError: () => toast({ title: "Failed to revoke API key", variant: "destructive" }),
      },
    );
  };

  const copyKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const closeCreate = () => {
    setIsCreateOpen(false);
    setCreatedKey(null);
    setAppName("");
    setLabel("");
    setCopied(false);
  };

  return (
    <Card className="shadow-sm mt-8">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" />
              API Access Keys
            </CardTitle>
            <CardDescription className="mt-1.5">
              Keys let your apps call the access-check endpoint to verify user permissions at login.
            </CardDescription>
          </div>
          <Button onClick={() => { setCreatedKey(null); setIsCreateOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            New Key
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-24 animate-pulse bg-muted rounded-md" />
        ) : keys?.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>App</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[100px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.appName}</TableCell>
                  <TableCell className="text-muted-foreground">{k.label || "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{k.keyPrefix}…</TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(k.createdAt), "MMM d, yyyy")}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {k.lastUsedAt ? format(new Date(k.lastUsedAt), "MMM d, HH:mm") : "Never"}
                  </TableCell>
                  <TableCell>
                    {k.revoked ? (
                      <Badge variant="outline" className="text-destructive border-destructive/40">Revoked</Badge>
                    ) : (
                      <Badge variant="outline" className="text-green-600 border-green-600/40">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!k.revoked && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => handleRevoke(k.id, k.appName)}
                        disabled={revokeKey.isPending}
                      >
                        <Ban className="h-4 w-4 mr-1" /> Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No API keys yet. Create one for each app that should enforce Admin Console access.
          </div>
        )}
      </CardContent>

      <Dialog open={isCreateOpen} onOpenChange={(o) => { if (!o) closeCreate(); else setIsCreateOpen(true); }}>
        <DialogContent className="sm:max-w-[480px]">
          {createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>API Key Created</DialogTitle>
                <DialogDescription>
                  Copy this key now — it will not be shown again.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Input readOnly value={createdKey.key} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={copyKey}>
                    {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use it as the <span className="font-mono">X-API-Key</span> header when calling{" "}
                  <span className="font-mono">GET /api/access-check?email=…</span>
                </p>
              </div>
              <DialogFooter>
                <Button onClick={closeCreate}>Done</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>New API Key</DialogTitle>
                <DialogDescription>
                  Create a key for an app to check user access at login.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>App</Label>
                  <Select value={appName} onValueChange={setAppName}>
                    <SelectTrigger><SelectValue placeholder="Select an app" /></SelectTrigger>
                    <SelectContent>
                      {apps?.map((a) => (
                        <SelectItem key={a.id} value={a.name}>{a.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Label (optional)</Label>
                  <Input
                    placeholder="e.g. Production"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeCreate}>Cancel</Button>
                <Button onClick={handleCreate} disabled={!appName || createKey.isPending}>
                  {createKey.isPending ? "Creating..." : "Create Key"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
