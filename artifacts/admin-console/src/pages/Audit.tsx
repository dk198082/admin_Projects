import {
  useListAuditLog,
  getListAuditLogQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { useSearch, useLocation } from "wouter";

type Category = "all" | "access" | "admin";
type Outcome = "all" | "allowed" | "denied";

function ActionBadge({ action }: { action: string }) {
  if (action === "ACCESS_DENIED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-destructive/15 text-destructive border border-destructive/30 rounded font-semibold">
        {action}
      </span>
    );
  }
  if (action === "ACCESS_ALLOWED") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/30 rounded">
        {action}
      </span>
    );
  }
  return (
    <span className="px-2 py-0.5 bg-primary/10 text-primary rounded">{action}</span>
  );
}

export default function Audit() {
  const rawSearch = useSearch();
  const [, navigate] = useLocation();
  const searchParams = new URLSearchParams(rawSearch);
  const urlActor = searchParams.get("actor") ?? "";
  const urlEntity = searchParams.get("entity") ?? "";

  // If the URL carries ?action=ACCESS_DENIED, pre-select the "denied" outcome filter.
  const urlActionParam = searchParams.get("action") ?? "";
  const initialOutcome: Outcome =
    urlActionParam === "ACCESS_DENIED" ? "denied" :
    urlActionParam === "ACCESS_ALLOWED" ? "allowed" : "all";

  const [category, setCategory] = useState<Category>("all");
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);

  const auditParams = {
    category: category !== "all" ? category : undefined,
    outcome: outcome !== "all" ? outcome : undefined,
  };

  const { data: logs, isLoading } = useListAuditLog(auditParams, {
    query: { queryKey: getListAuditLogQueryKey(auditParams) },
  });

  // Apply URL-driven actor and entity filters client-side on top of server-filtered results
  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    let result = logs;
    if (urlActor) result = result.filter((log) => log.actor === urlActor);
    if (urlEntity) result = result.filter((log) => log.entity === urlEntity);
    return result;
  }, [logs, urlActor, urlEntity]);

  const showOutcomeFilter = category !== "admin";

  const hasUrlFilter = Boolean(urlActor || urlEntity || urlActionParam);

  function clearAllFilters() {
    setCategory("all");
    setOutcome("all");
    navigate("/audit");
  }

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Audit Log</h1>
      <p className="text-muted-foreground mb-8">
        Administrative actions and application access-check activity.
      </p>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Show:</span>
              <Select value={category} onValueChange={(v) => {
                setCategory(v as Category);
                if (v === "admin") setOutcome("all");
              }}>
                <SelectTrigger className="w-[180px] h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All entries</SelectItem>
                  <SelectItem value="access">Access checks only</SelectItem>
                  <SelectItem value="admin">Admin actions only</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showOutcomeFilter && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Outcome:</span>
                <Select value={outcome} onValueChange={(v) => setOutcome(v as Outcome)}>
                  <SelectTrigger className="w-[140px] h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All outcomes</SelectItem>
                    <SelectItem value="denied">Denied only</SelectItem>
                    <SelectItem value="allowed">Allowed only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {(category !== "all" || outcome !== "all" || hasUrlFilter) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground"
                onClick={clearAllFilters}
              >
                Clear filters
              </Button>
            )}
      </div>

      {/* URL-driven actor / entity badges */}
      {(urlActor || urlEntity) && (
        <div className="mb-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground">Also filtered by:</span>
              {urlActor && (
                <Badge variant="secondary" className="font-mono text-xs max-w-[300px] truncate">
                  actor: {urlActor}
                </Badge>
              )}
              {urlEntity && (
                <Badge variant="secondary" className="font-mono text-xs max-w-[300px] truncate">
                  entity: {urlEntity}
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => navigate("/audit")}
              >
                <X className="h-3 w-3" />
                Remove
              </Button>
        </div>
      )}

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
                ) : filteredLogs.length ? (
                  filteredLogs.map((log) => (
                    <TableRow
                      key={log.id}
                      className={`font-mono text-xs hover:bg-muted/20 ${log.action === "ACCESS_DENIED" ? "bg-destructive/5" : ""}`}
                    >
                      <TableCell className="text-muted-foreground">
                        {format(new Date(log.createdAt), "yyyy-MM-dd HH:mm:ss")}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{log.actor}</TableCell>
                      <TableCell>
                        <ActionBadge action={log.action} />
                      </TableCell>
                      <TableCell>{log.entity}</TableCell>
                      <TableCell className="text-muted-foreground">{log.detail}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No audit logs found{category !== "all" || outcome !== "all" || hasUrlFilter ? " for the selected filters" : ""}.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
        </Table>
      </div>
    </div>
  );
}
