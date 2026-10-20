import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  UserCog, Plus, Search, X, Pencil, Trash2, Shield, Crown, User,
  Check, AlertCircle, Eye, EyeOff, Lock, Users as UsersIcon, CheckCircle2,
} from 'lucide-react';
import api from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const ROLE_CONFIG = {
  owner: {
    label: 'Owner',
    badgeClass: 'bg-purple-100 text-purple-800 border-purple-200',
    icon: Crown,
    description: 'Super-admin with unrestricted permissions across all modules, settings, and users.',
  },
  admin: {
    label: 'Admin',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: Shield,
    description: 'Can manage users, job openings, settings, and workflows, but cannot modify Owner accounts.',
  },
  hiring_manager: {
    label: 'Hiring Manager',
    badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    icon: UserCog,
    description: 'Can review applicants, submit scorecards, and make hiring decisions.',
  },
  recruiter: {
    label: 'Recruiter',
    badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
    icon: UsersIcon,
    description: 'Can create job openings, attach candidates, and conduct screening calls.',
  },
  interviewer: {
    label: 'Interviewer',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
    icon: User,
    description: 'Can evaluate candidates in assigned interview stages and submit scorecards.',
  },
};

function formatDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const isOwner = currentUser?.role === 'owner';
  const isAdmin = currentUser?.role === 'admin';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  // Add / Edit Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null); // null = add mode, object = edit mode
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('recruiter');
  const [formActive, setFormActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/users');
      setUsers(res.data.users || []);
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = search.toLowerCase().trim();
      const matchSearch = !q || u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
      const matchRole = roleFilter === 'all' || u.role === roleFilter;
      const matchStatus = statusFilter === 'all' || (statusFilter === 'active' ? u.active : !u.active);
      return matchSearch && matchRole && matchStatus;
    });
  }, [users, search, roleFilter, statusFilter]);

  // Metrics
  const stats = useMemo(() => {
    return {
      total: users.length,
      owners: users.filter((u) => u.role === 'owner').length,
      admins: users.filter((u) => u.role === 'admin').length,
      active: users.filter((u) => u.active).length,
    };
  }, [users]);

  // Roles available to assign
  const assignableRoles = useMemo(() => {
    if (isOwner) {
      return ['owner', 'admin', 'hiring_manager', 'recruiter', 'interviewer'];
    }
    return ['admin', 'hiring_manager', 'recruiter', 'interviewer'];
  }, [isOwner]);

  const openAddModal = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('recruiter');
    setFormActive(true);
    setShowPassword(false);
    setModalOpen(true);
  };

  const openEditModal = (target) => {
    if (target.role === 'owner' && !isOwner) {
      toast.error('Admins cannot edit or modify an Owner account.');
      return;
    }
    setEditingUser(target);
    setFormName(target.name || '');
    setFormEmail(target.email || '');
    setFormPassword('');
    setFormRole(target.role || 'recruiter');
    setFormActive(target.active !== false);
    setShowPassword(false);
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Full name is required.');
      return;
    }
    if (!formEmail.trim()) {
      toast.error('Email address is required.');
      return;
    }
    if (!editingUser && (!formPassword || formPassword.length < 6)) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    if (editingUser && formPassword && formPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    if (formRole === 'owner' && !isOwner) {
      toast.error('Only an Owner can assign the Owner role.');
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        const payload = {
          name: formName.trim(),
          email: formEmail.trim(),
          role: formRole,
          active: formActive,
        };
        if (formPassword.trim()) {
          payload.password = formPassword.trim();
        }
        const res = await api.patch(`/users/${editingUser._id}`, payload);
        toast.success(res.data.message || 'User updated successfully.');
      } else {
        const payload = {
          name: formName.trim(),
          email: formEmail.trim(),
          password: formPassword.trim(),
          role: formRole,
        };
        const res = await api.post('/users', payload);
        toast.success(res.data.message || 'User created successfully.');
      }
      setModalOpen(false);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Operation failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/users/${deleteTarget._id}`);
      toast.success(res.data.message || 'User deleted successfully.');
      setDeleteTarget(null);
      fetchUsers();
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Failed to delete user.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <UserCog className="h-7 w-7 text-brand" />
            Users & Roles
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage system access, assign roles, and administer permissions.
          </p>
        </div>

        <Button
          onClick={openAddModal}
          className="bg-brand hover:bg-brand/90 text-white font-medium shadow-sm gap-2 shrink-0 self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" /> Add User
        </Button>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
              <UsersIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Total Users</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">{loading ? '—' : stats.total}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-700 shrink-0">
              <Crown className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Owners</p>
              <p className="text-xl font-bold text-purple-900 mt-0.5">{loading ? '—' : stats.owners}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-700 shrink-0">
              <Shield className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Admins</p>
              <p className="text-xl font-bold text-blue-900 mt-0.5">{loading ? '—' : stats.admins}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm bg-white">
          <CardContent className="p-4 flex items-center gap-3.5">
            <div className="h-10 w-10 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-700 shrink-0">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Active Accounts</p>
              <p className="text-xl font-bold text-emerald-900 mt-0.5">{loading ? '—' : stats.active}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-slate-200 shadow-sm bg-white">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-8 text-sm h-9 bg-slate-50/50"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Role Filter */}
            <div className="flex items-center gap-2">
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All Roles</option>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="hiring_manager">Hiring Manager</option>
                <option value="recruiter">Recruiter</option>
                <option value="interviewer">Interviewer</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border-slate-200 shadow-sm bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50/70 border-b border-slate-200">
              <TableRow>
                <TableHead className="font-semibold text-slate-700 min-w-[220px]">User</TableHead>
                <TableHead className="font-semibold text-slate-700 w-44">Role</TableHead>
                <TableHead className="font-semibold text-slate-700 w-32">Status</TableHead>
                <TableHead className="font-semibold text-slate-700 w-36">Joined Date</TableHead>
                <TableHead className="font-semibold text-slate-700 text-right w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-10 w-48" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-slate-500 text-sm">
                    {search || roleFilter !== 'all' || statusFilter !== 'all'
                      ? 'No users match your filters.'
                      : 'No users found.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((u) => {
                  const roleMeta = ROLE_CONFIG[u.role] || ROLE_CONFIG.recruiter;
                  const RoleIcon = roleMeta.icon;
                  const isSelf = String(u._id) === String(currentUser?._id);
                  const isTargetOwner = u.role === 'owner';
                  const canEdit = isOwner || !isTargetOwner;
                  const canDelete = !isSelf && (isOwner || !isTargetOwner);

                  return (
                    <TableRow key={u._id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Name & Email */}
                      <TableCell className="align-middle py-3">
                        <div className="flex items-center gap-3">
                          <div className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                            isTargetOwner ? 'bg-purple-100 text-purple-700 border border-purple-200' :
                            u.role === 'admin' ? 'bg-blue-100 text-blue-700 border border-blue-200' :
                            'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}>
                            {u.name?.charAt(0)?.toUpperCase() || 'U'}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-slate-900 text-sm truncate">{u.name}</span>
                              {isSelf && (
                                <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-600 border-slate-200 px-1.5 py-0 h-4">
                                  You
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>

                      {/* Role Badge */}
                      <TableCell className="align-middle py-3">
                        <Badge
                          variant="outline"
                          className={`inline-flex items-center gap-1.5 font-medium text-xs px-2.5 py-0.5 border shadow-none ${roleMeta.badgeClass}`}
                        >
                          <RoleIcon className="h-3 w-3 shrink-0" />
                          {roleMeta.label}
                        </Badge>
                      </TableCell>

                      {/* Active Status */}
                      <TableCell className="align-middle py-3">
                        {u.active ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2.5 py-0.5 rounded-full">
                            Inactive
                          </span>
                        )}
                      </TableCell>

                      {/* Created Date */}
                      <TableCell className="align-middle py-3 text-xs text-slate-600">
                        {formatDate(u.createdAt)}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="align-middle py-3 text-right">
                        {isTargetOwner && !isOwner ? (
                          <div className="inline-flex items-center gap-1 text-[11px] text-slate-400 italic bg-slate-50 border border-slate-200 rounded px-2 py-1" title="Admins cannot edit or delete Owner accounts">
                            <Lock className="h-3 w-3 text-slate-400" /> Protected
                          </div>
                        ) : (
                          <div className="inline-flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canEdit}
                              onClick={() => openEditModal(u)}
                              className="h-8 w-8 p-0 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                              title="Edit user"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canDelete}
                              onClick={() => setDeleteTarget(u)}
                              className="h-8 w-8 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                              title={isSelf ? 'Cannot delete your own account' : 'Delete user'}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Add / Edit User Dialog */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md bg-white p-6 shadow-xl rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <UserCog className="h-5 w-5 text-brand" />
              {editingUser ? 'Edit User & Permissions' : 'Add New User'}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {editingUser
                ? `Update account details and role for ${editingUser.name}.`
                : 'Create an account and assign an appropriate role.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSave} className="space-y-4 pt-2">
            {/* Full Name */}
            <div className="space-y-1.5">
              <Label htmlFor="user-name" className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Full Name <span className="text-red-500">*</span>
              </Label>
              <Input
                id="user-name"
                type="text"
                placeholder="e.g. Sarah Jenkins"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                required
                className="h-9 text-sm"
              />
            </div>

            {/* Email Address */}
            <div className="space-y-1.5">
              <Label htmlFor="user-email" className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Email Address <span className="text-red-500">*</span>
              </Label>
              <Input
                id="user-email"
                type="email"
                placeholder="sarah.jenkins@company.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
                className="h-9 text-sm"
              />
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="user-password" className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  {editingUser ? 'New Password (Optional)' : 'Password'} {!editingUser && <span className="text-red-500">*</span>}
                </Label>
                {editingUser && (
                  <span className="text-[11px] text-slate-400">Leave blank to keep current</span>
                )}
              </div>
              <div className="relative">
                <Input
                  id="user-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder={editingUser ? '••••••••' : 'Min. 6 characters'}
                  value={formPassword}
                  onChange={(e) => setFormPassword(e.target.value)}
                  required={!editingUser}
                  minLength={6}
                  className="h-9 text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Role Select */}
            <div className="space-y-1.5">
              <Label htmlFor="user-role" className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                Assign Role <span className="text-red-500">*</span>
              </Label>
              <select
                id="user-role"
                value={formRole}
                onChange={(e) => setFormRole(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_CONFIG[r]?.label || r}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 pt-0.5 leading-tight">
                {ROLE_CONFIG[formRole]?.description}
              </p>
            </div>

            {/* Active Status (Only in Edit mode) */}
            {editingUser && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="user-status" className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Account Status
                </Label>
                <select
                  id="user-status"
                  value={formActive ? 'active' : 'inactive'}
                  onChange={(e) => setFormActive(e.target.value === 'active')}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="active">Active (Can log in)</option>
                  <option value="inactive">Inactive (Suspended)</option>
                </select>
              </div>
            )}

            <DialogFooter className="pt-3 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving}
                className="bg-brand hover:bg-brand/90 text-white font-medium shadow-sm"
              >
                {saving ? 'Saving...' : editingUser ? 'Update User' : 'Create User'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-600" />
              Delete User Account?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 text-sm">
              Are you sure you want to permanently delete{' '}
              <strong className="text-slate-900">{deleteTarget?.name}</strong> (
              {deleteTarget?.email})? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? 'Deleting...' : 'Delete User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
