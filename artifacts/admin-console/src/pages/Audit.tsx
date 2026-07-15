import { useState } from "react";
import {
  useListAuditLog,
  getListAuditLogQueryKey,
  useListEntraSignIns,
  getListEntraSignInsQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const APP_FILTERS = ["All apps", "Field Service Calendar", "Production Shop Floor"] as const;

function extractErrorMessage(err: unknown): string {
  const e = err as { data?: { error?: unknown } | null; message?: string };
  if (e?.data && typeof e.data === "object" && typeof e.data.error === "string") return e.data.error;
  if (typeof e?.message === "string" && e.message) return e.message;
  return "Failed to load sign-in logs";
}

export default function Audit() {
  const { data: logs, isLoading } = useListAuditLog(
    {},
    { query: { queryKey: getListAuditLogQueryKey({}) } }
  );
  const [appFilter, setAppFilter] = useState<(typeof APP_FILTERS)[number]>("All apps");
  const signInParams = appFilter === "All apps" ? {} : { app: appFilter };
  const {
    data: signIns,
    isLoading: signInsLoading,
    error: signInsError,
  } = useListEntraSignIns(signInParams, {
    query: { queryKey: getListEntraSignInsQueryKey(signInParams) },
  });

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Audit Log</h1>
      <p className="text-muted-foreground mb-8">
        Administrative actions and Microsoft Entra sign-in activity.
      </p>

      <Tabs defaultValue="activity">
        <TabsList className="mb-4">
          <TabsTrigger value="activity">Admin Activity</TabsTrigger>
          <TabsTrigger value="signins">Entra Sign-ins</TabsTrigger>
        </TabsList>

        <TabsContent value="activity">
          <div className="border rounded-md bg-card overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="w-[180px]">Timestamp</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                  </TableRow>
                ) : logs?.length ? (
                  logs.map((log) => (
                    <TableRow key={log.id} className="font-mono text-xs hover:bg-muted/20">
                      <TableCell className="text-muted-foreground">
                        {format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{log.actor}</TableCell>
                      <TableCell>
                        <span className="px-2 py-0.5 bg-primary/10 text-primary rounded">{log.action}</span>
                      </TableCell>
                      <TableCell>{log.entity}</TableCell>
                      <TableCell className="text-muted-foreground">{log.detail}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No audit logs found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="signins">
          <div className="flex gap-2 mb-4">
            {APP_FILTERS.map((f) => (
              <Button
                key={f}
                size="sm"
                variant={appFilter === f ? "default" : "outline"}
                onClick={() => setAppFilter(f)}
              >
                {f}
              </Button>
            ))}
          </div>
          {signInsError ? (
            <div className="border rounded-md bg-destructive/5 text-destructive text-sm p-4">
              {extractErrorMessage(signInsError)}
            </div>
          ) : (
            <div className="border rounded-md bg-card overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="w-[180px]">Timestamp</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Application</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signInsLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading sign-in events...</TableCell>
                    </TableRow>
                  ) : signIns?.length ? (
                    signIns.map((s) => (
                      <TableRow key={s.id} className="font-mono text-xs hover:bg-muted/20">
                        <TableCell className="text-muted-foreground">
                          {format(new Date(s.createdDateTime), "yyyy-MM-dd HH:mm:ss")}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-foreground">{s.userDisplayName}</div>
                          <div className="text-muted-foreground">{s.userPrincipalName}</div>
                        </TableCell>
                        <TableCell>{s.appDisplayName}</TableCell>
                        <TableCell>
                          {s.success ? (
                            <Badge variant="outline" className="text-green-600 border-green-600/40">Success</Badge>
                          ) : (
                            <div>
                              <Badge variant="outline" className="text-destructive border-destructive/40">Failed</Badge>
                              {s.failureReason ? (
                                <div className="text-muted-foreground mt-1">{s.failureReason}</div>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{s.ipAddress ?? "—"}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No sign-in events found{appFilter !== "All apps" ? ` for ${appFilter}` : ""}.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
