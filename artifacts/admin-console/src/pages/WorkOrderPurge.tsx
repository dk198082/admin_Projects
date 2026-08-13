import { useState } from "react";
import {
  useSearchWorkOrders,
  getSearchWorkOrdersQueryKey,
  usePreviewWorkOrderPurge,
  useExecuteWorkOrderPurge,
} from "@workspace/api-client-react";
import type { WorkOrderPurgeResult } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Eraser, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { useToast } from "@/hooks/use-toast";

export default function WorkOrderPurge() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<WorkOrderPurgeResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<WorkOrderPurgeResult | null>(null);

  const { data: results, isFetching } = useSearchWorkOrders(
    { q: applied },
    {
      query: {
        enabled: applied.length > 0,
        queryKey: getSearchWorkOrdersQueryKey({ q: applied }),
      },
    },
  );

  const previewMutation = usePreviewWorkOrderPurge();
  const executeMutation = useExecuteWorkOrderPurge();

  const toggle = (orderNumber: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderNumber)) next.delete(orderNumber);
      else next.add(orderNumber);
      return next;
    });
    setPreview(null);
    setLastResult(null);
  };

  const runPreview = () => {
    previewMutation.mutate(
      { data: { orderNumbers: [...selected] } },
      {
        onSuccess: (res) => {
          setPreview(res);
          setLastResult(null);
        },
        onError: (err) =>
          toast({
            title: "Preview failed",
            description: err instanceof Error ? err.message : "Unexpected error",
            variant: "destructive",
          }),
      },
    );
  };

  const runExecute = () => {
    setConfirmOpen(false);
    executeMutation.mutate(
      { data: { orderNumbers: [...selected] } },
      {
        onSuccess: (res) => {
          setLastResult(res);
          setPreview(null);
          setSelected(new Set());
          toast({
            title: "Work orders purged",
            description: `${res.totalRows.toLocaleString()} row(s) deleted for ${res.orderNumbers.join(", ")}.`,
          });
        },
        onError: (err) =>
          toast({
            title: "Purge failed",
            description:
              (err instanceof Error ? err.message : "Unexpected error") +
              " — check the Audit Log or re-run a dry-run preview to confirm the current state.",
            variant: "destructive",
          }),
      },
    );
  };

  const countsTable = (r: WorkOrderPurgeResult) => {
    const nonZero = Object.entries(r.counts).filter(([, n]) => n > 0);
    return (
      <div className="border rounded-md bg-card overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/50 flex items-center justify-between">
          <span className="font-medium text-sm">
            {r.dryRun
              ? `Preview — ${r.totalRows.toLocaleString()} row(s) would be deleted`
              : `Purged — ${r.totalRows.toLocaleString()} row(s) deleted`}
          </span>
          <span className="text-xs text-muted-foreground">
            Orders: {r.orderNumbers.join(", ")} · Company: {r.dataAreaId}
          </span>
        </div>
        {nonZero.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Staging table</TableHead>
                <TableHead className="w-[120px] text-right">Rows</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {nonZero.map(([table, n]) => (
                <TableRow key={table} className="font-mono text-xs">
                  <TableCell>{table}</TableCell>
                  <TableCell className="text-right">{n.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            No matching rows found in any staging table.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Work Order Purge</h1>
        <p className="text-muted-foreground max-w-3xl">
          Remove all staging-mirror data for production orders that were deleted in D365 F&amp;O.
          The incremental export never removes deleted orders, so their rows linger and keep
          appearing in downstream apps. Only purge orders that were actually deleted in F&amp;O —
          otherwise the next export will re-insert them. Deletes are restricted to company TOUS
          and run in a single transaction.
        </p>
      </div>

      <form
        className="flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(search.trim());
        }}
      >
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by work order number…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-wo-search"
          />
        </div>
        <Button type="submit" variant="secondary" data-testid="button-wo-search">
          Search
        </Button>
      </form>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-4 py-3">
          <span className="text-sm font-medium mr-1">Selected:</span>
          {[...selected].map((o) => (
            <Badge key={o} variant="secondary" className="gap-1 font-mono">
              {o}
              <button type="button" onClick={() => toggle(o)} aria-label={`Deselect ${o}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={runPreview}
              disabled={previewMutation.isPending}
              data-testid="button-wo-preview"
            >
              <Eraser className="h-4 w-4 mr-1.5" />
              {previewMutation.isPending ? "Counting…" : "Preview (dry run)"}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={executeMutation.isPending}
              data-testid="button-wo-delete"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {executeMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}

      {preview && countsTable(preview)}
      {lastResult && countsTable(lastResult)}

      {applied && (
        <div className="border rounded-md bg-card overflow-hidden">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead className="w-[140px]">Order</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="w-[160px]">Item</TableHead>
                <TableHead className="w-[140px]">Status</TableHead>
                <TableHead className="w-[130px]">Scheduled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isFetching ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Searching…
                  </TableCell>
                </TableRow>
              ) : results?.length ? (
                results.map((wo) => {
                  const checked = selected.has(wo.orderNumber);
                  return (
                    <TableRow
                      key={wo.orderNumber}
                      className={
                        "cursor-pointer hover:bg-muted/20 " + (checked ? "bg-primary/5" : "")
                      }
                      onClick={() => toggle(wo.orderNumber)}
                      data-testid={`row-wo-${wo.orderNumber}`}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(wo.orderNumber)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 accent-primary"
                          aria-label={`Select ${wo.orderNumber}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium">
                        {wo.orderNumber}
                      </TableCell>
                      <TableCell className="text-sm">{wo.name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{wo.itemNumber || "—"}</TableCell>
                      <TableCell className="text-sm">{wo.status || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {wo.scheduledDate
                          ? format(new Date(wo.scheduledDate), "yyyy-MM-dd")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No work orders found matching “{applied}”. Orders already fully purged (or
                    never exported) won&apos;t appear here — you can still purge them by number
                    from the calendar project&apos;s CLI if needed.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete staging data?</AlertDialogTitle>
            <AlertDialogDescription>
              All rows for work order{selected.size > 1 ? "s" : ""}{" "}
              <span className="font-mono font-medium">{[...selected].join(", ")}</span> will be
              deleted from every d365fo staging table (company TOUS). This cannot be undone. Only
              proceed if the order{selected.size > 1 ? "s were" : " was"} deleted in F&amp;O.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={runExecute}
              data-testid="button-wo-confirm-delete"
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
