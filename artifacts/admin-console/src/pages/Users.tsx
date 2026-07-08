import { useState } from "react";
import { 
  useListUsers, 
  getListUsersQueryKey, 
  useListRoles, 
  getListRolesQueryKey,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useCreateRoleAssignment,
  useDeleteRoleAssignment
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Search, MoreVertical, Shield, Trash2, Edit2, Check, X, Key } from "lucide-react";
import { 
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow 
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuCheckboxItem 
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { User, UserStatus } from "@workspace/api-client-react";

export default function Users() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  
  const { data: users, isLoading } = useListUsers({
    query: { queryKey: getListUsersQueryKey() }
  });
  
  const { data: roles } = useListRoles({
    query: { queryKey: getListRolesQueryKey() }
  });

  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const createAssignment = useCreateRoleAssignment();
  const deleteAssignment = useDeleteRoleAssignment();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  
  const [formData, setFormData] = useState({ name: "", email: "", status: "active" as UserStatus });

  const filteredUsers = users?.filter(u => 
    u.name.toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = () => {
    if (editingUser) {
      updateUser.mutate({ id: editingUser.id, data: formData }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setEditingUser(null);
          toast({ title: "User updated successfully" });
        }
      });
    } else {
      createUser.mutate({ data: { ...formData, status: formData.status as UserStatus } }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          setIsCreateOpen(false);
          setFormData({ name: "", email: "", status: "active" });
          toast({ title: "User created successfully" });
        }
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this user?")) {
      deleteUser.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
          toast({ title: "User deleted" });
        }
      });
    }
  };

  const toggleRole = (userId: number, roleId: number, assigned: boolean, assignmentId?: number) => {
    if (assigned && assignmentId) {
      deleteAssignment.mutate({ id: assignmentId }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
      });
    } else if (!assigned) {
      createAssignment.mutate({ data: { userId, roleId } }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() })
      });
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Users</h1>
          <p className="text-muted-foreground mt-1">Manage personnel and assign security roles.</p>
        </div>
        <Button onClick={() => {
          setFormData({ name: "", email: "", status: "active" });
          setIsCreateOpen(true);
        }}>
          <Plus className="h-4 w-4 mr-2" />
          New User
        </Button>
      </div>

      <div className="border rounded-md bg-card overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border/50 bg-muted/20 flex items-center justify-between">
          <div className="relative w-72">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search users..." 
              className="pl-9 h-9" 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">Loading...</TableCell>
              </TableRow>
            ) : filteredUsers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No users found.</TableCell>
              </TableRow>
            ) : filteredUsers?.map((user) => (
              <TableRow key={user.id} className="group">
                <TableCell>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </TableCell>
                <TableCell>
                  <Badge variant={user.status === "active" ? "default" : "secondary"} className={user.status === "active" ? "bg-green-500/10 text-green-600 hover:bg-green-500/20" : ""}>
                    {user.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {user.roles.length === 0 ? (
                      <span className="text-xs text-muted-foreground">None</span>
                    ) : (
                      user.roles.map(r => (
                        <Badge key={r.assignmentId} variant="outline" className="text-[10px] py-0 h-5 font-mono">
                          {r.roleName}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground font-mono">
                  {format(new Date(user.createdAt), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-[200px]">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => {
                        setFormData({ name: user.name, email: user.email, status: user.status as UserStatus });
                        setEditingUser(user);
                      }}>
                        <Edit2 className="h-4 w-4 mr-2" /> Edit User
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => {
                        updateUser.mutate({
                          id: user.id,
                          data: { status: user.status === "active" ? "disabled" : "active" }
                        }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() }) })
                      }}>
                        {user.status === "active" ? <X className="h-4 w-4 mr-2" /> : <Check className="h-4 w-4 mr-2" />} 
                        {user.status === "active" ? "Disable" : "Enable"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Manage Roles</DropdownMenuLabel>
                      {roles?.map(role => {
                        const assignment = user.roles.find(r => r.roleId === role.id);
                        return (
                          <DropdownMenuCheckboxItem
                            key={role.id}
                            checked={!!assignment}
                            onCheckedChange={(checked: boolean) => toggleRole(user.id, role.id, !checked, assignment?.assignmentId)}
                          >
                            {role.name}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDelete(user.id)}>
                        <Trash2 className="h-4 w-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isCreateOpen || !!editingUser} onOpenChange={(o) => {
        if (!o) { setIsCreateOpen(false); setEditingUser(null); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingUser ? 'Edit User' : 'Create User'}</DialogTitle>
            <DialogDescription>
              {editingUser ? 'Update user details below.' : 'Add a new user to the system.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email Address</Label>
              <Input id="email" type="email" value={formData.email} onChange={e => setFormData(f => ({ ...f, email: e.target.value }))} />
            </div>
            {editingUser && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label>Active Status</Label>
                  <div className="text-xs text-muted-foreground">Allow user to log in</div>
                </div>
                <Switch 
                  checked={formData.status === "active"}
                  onCheckedChange={c => setFormData(f => ({ ...f, status: c ? "active" : "disabled" }))}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsCreateOpen(false); setEditingUser(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={createUser.isPending || updateUser.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}