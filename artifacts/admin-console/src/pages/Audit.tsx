import { useListAuditLog, getListAuditLogQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Audit() {
  const { data: logs, isLoading } = useListAuditLog(
    {},
    { query: { queryKey: getListAuditLogQueryKey({}) } }
  );

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-3xl font-bold tracking-tight mb-2">Audit Log</h1>
      <p className="text-muted-foreground mb-8">Chronological log of administrative actions.</p>

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
    </div>
  );
}