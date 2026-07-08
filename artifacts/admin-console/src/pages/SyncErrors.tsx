import { useState } from "react";
import {
  useListSyncErrors,
  getListSyncErrorsQueryKey,
  useListSyncEntities,
  getListSyncEntitiesQueryKey,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function SyncErrors() {
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [entity, setEntity] = useState<string>("__all__");
  const params = {
    ...(applied ? { search: applied } : {}),
    ...(entity !== "__all__" ? { entity } : {}),
  };
  const { data, isLoading } = useListSyncErrors(params, {
    query: { queryKey: getListSyncErrorsQueryKey(params) },
  });
  const { data: entities } = useListSyncEntities({
    query: { queryKey: getListSyncEntitiesQueryKey() },
  });

  return (
    <div className="p-8 max-w-7xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Data Sync Error Log</h1>
      <p className="text-muted-foreground mb-6">
        Errors from the D365 data sync (unique per entity and record).
        {data ? ` ${data.totalUnique.toLocaleString()} unique errors.` : ""}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={entity} onValueChange={setEntity}>
          <SelectTrigger className="w-[320px]">
            <SelectValue placeholder="Filter by entity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All entities</SelectItem>
            {entities?.map((e) => (
              <SelectItem key={e.entitySetName} value={e.entitySetName}>
                {e.entitySetName} ({e.uniqueErrors.toLocaleString()})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <form
          className="flex-1 min-w-[280px]"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(search.trim());
          }}
        >
          <Input
            placeholder="Search record id or error message… (press Enter)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-md"
          />
        </form>
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="w-[220px]">Entity</TableHead>
              <TableHead className="w-[300px]">Record ID</TableHead>
              <TableHead className="w-[100px]">Operation</TableHead>
              <TableHead>Error Message</TableHead>
              <TableHead className="w-[170px]">Last Seen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
              </TableRow>
            ) : data?.entries.length ? (
              data.entries.map((e) => (
                <TableRow key={`${e.entitySetName}-${e.recordId ?? "null"}-${e.id}`} className="font-mono text-xs hover:bg-muted/20 align-top">
                  <TableCell className="font-medium text-foreground">{e.entitySetName}</TableCell>
                  <TableCell className="text-muted-foreground break-all">{e.recordId ?? "—"}</TableCell>
                  <TableCell>
                    <span className="px-2 py-0.5 bg-destructive/10 text-destructive rounded">{e.operation}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-pre-wrap break-words max-w-[480px]">
                    {e.errorMessage}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {e.createdOn ? format(new Date(e.createdOn), "yyyy-MM-dd HH:mm:ss") : "—"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No sync errors found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
