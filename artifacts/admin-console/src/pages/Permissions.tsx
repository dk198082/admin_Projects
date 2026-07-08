import { useState } from "react";
import { 
  useListRoles, getListRolesQueryKey,
  useListApps, getListAppsQueryKey,
  useListResources, getListResourcesQueryKey,
  useListAccessGrants, getListAccessGrantsQueryKey,
  useCreateAccessGrant,
  useUpdateAccessGrant,
  useDeleteAccessGrant
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Shield, LayoutGrid, FileText, Table as TableIcon } from "lucide-react";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { PermissionLevel } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

export default function Permissions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [selectedApp, setSelectedApp] = useState<string>("all");

  const { data: roles, isLoading: loadingRoles } = useListRoles({
    query: { queryKey: getListRolesQueryKey() }
  });
  
  const { data: apps } = useListApps({
    query: { queryKey: getListAppsQueryKey() }
  });

  const { data: resources, isLoading: loadingResources } = useListResources(
    selectedApp !== "all" ? { appId: parseInt(selectedApp) } : {},
    { query: { queryKey: getListResourcesQueryKey(selectedApp !== "all" ? { appId: parseInt(selectedApp) } : {}) } }
  );

  const { data: grants, isLoading: loadingGrants } = useListAccessGrants(
    selectedApp !== "all" ? { appId: parseInt(selectedApp) } : {},
    { query: { queryKey: getListAccessGrantsQueryKey(selectedApp !== "all" ? { appId: parseInt(selectedApp) } : {}) } }
  );

  const createGrant = useCreateAccessGrant();
  const updateGrant = useUpdateAccessGrant();
  const deleteGrant = useDeleteAccessGrant();

  const handleGrantChange = (roleId: number, resourceId: number, currentGrantId: number | undefined, newLevel: string) => {
    if (newLevel === "None") {
      if (currentGrantId) {
        deleteGrant.mutate({ id: currentGrantId }, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListAccessGrantsQueryKey() });
            toast({ title: "Access revoked" });
          }
        });
      }
      return;
    }

    const level = newLevel as PermissionLevel;
    if (currentGrantId) {
      updateGrant.mutate({ id: currentGrantId, data: { level } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAccessGrantsQueryKey() });
          toast({ title: "Access updated" });
        }
      });
    } else {
      createGrant.mutate({ data: { roleId, resourceId, level } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAccessGrantsQueryKey() });
          toast({ title: "Access granted" });
        }
      });
    }
  };

  const getResourceIcon = (type: string) => {
    switch(type) {
      case 'Form': return <FileText className="h-3 w-3 mr-1" />;
      case 'Table': return <TableIcon className="h-3 w-3 mr-1" />;
      case 'Tab': return <LayoutGrid className="h-3 w-3 mr-1" />;
      default: return null;
    }
  };

  const isLoading = loadingRoles || loadingResources || loadingGrants;

  return (
    <div className="p-8 max-w-[1400px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Roles & Permissions</h1>
          <p className="text-muted-foreground mt-1">Configure access matrix across applications.</p>
        </div>
        
        <div className="w-64">
          <Select value={selectedApp} onValueChange={setSelectedApp}>
            <SelectTrigger>
              <SelectValue placeholder="Filter by Application" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Applications</SelectItem>
              {apps?.map(app => (
                <SelectItem key={app.id} value={app.id.toString()}>{app.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="border rounded-md bg-card overflow-hidden shadow-sm overflow-x-auto">
        <Table className="relative w-full">
          <TableHeader className="bg-muted/50 sticky top-0 z-10">
            <TableRow>
              <TableHead className="w-[300px] sticky left-0 bg-muted/50 border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Resource</TableHead>
              {roles?.map(role => (
                <TableHead key={role.id} className="min-w-[180px] text-center border-l">
                  <div className="flex flex-col items-center gap-1">
                    <Shield className="h-4 w-4 text-primary" />
                    <span className="font-semibold">{role.name}</span>
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={(roles?.length || 0) + 1} className="h-24 text-center">Loading permission matrix...</TableCell>
              </TableRow>
            ) : resources?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={(roles?.length || 0) + 1} className="h-24 text-center text-muted-foreground">No resources found.</TableCell>
              </TableRow>
            ) : resources?.map(resource => (
              <TableRow key={resource.id} className="hover:bg-muted/10 transition-colors">
                <TableCell className="sticky left-0 bg-card border-r shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">{resource.name}</span>
                    <div className="flex items-center text-xs text-muted-foreground mt-1">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 bg-secondary rounded mr-2">{resource.appName}</span>
                      <span className="flex items-center opacity-70">{getResourceIcon(resource.type)}{resource.type}</span>
                    </div>
                  </div>
                </TableCell>
                
                {roles?.map(role => {
                  const grant = grants?.find(g => g.roleId === role.id && g.resourceId === resource.id);
                  const isPending = createGrant.isPending || updateGrant.isPending || deleteGrant.isPending;
                  
                  return (
                    <TableCell key={`${resource.id}-${role.id}`} className="text-center border-l p-2">
                      <Select 
                        value={grant?.level || "None"} 
                        onValueChange={(val) => handleGrantChange(role.id, resource.id, grant?.id, val)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="h-8 w-full border-transparent hover:border-input bg-transparent hover:bg-muted/50 justify-between">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="None" className="text-muted-foreground italic">No Access</SelectItem>
                          <SelectItem value="View">View Only</SelectItem>
                          <SelectItem value="Read & Write">Read & Write</SelectItem>
                          <SelectItem value="Full Rights" className="font-medium text-primary">Full Rights</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}