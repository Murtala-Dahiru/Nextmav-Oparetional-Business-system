'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, Search, Shield, Settings, FileText, UserPlus,
  CheckCircle2, XCircle, Clock, Wifi, WifiOff, Edit3,
  ChevronDown, ChevronUp, Globe, Phone, Mail, Building2,
  Palette, Calendar, Lock, Eye, Download, Plus, Upload,
  Monitor, Key, UserCheck, UserX, Trash2, LogIn,
  ArrowUpDown, BadgeCheck, AlertCircle, MapPin, DollarSign,
} from 'lucide-react';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

import { users, roles, companyInfo } from '@/lib/mock-data';
import type { UserItem, RoleItem } from '@/types';
import { toast } from 'sonner';

/* ---- helpers ---- */

function getInitials(firstName: string, lastName: string) {
  return `${firstName[0]}${lastName[0]}`;
}

function formatLastSeen(d: string) {
  const date = new Date(d);
  const now = new Date('2026-07-20T11:00:00Z');
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

const roleColors: Record<string, string> = {
  'Super Admin': 'bg-red-100 text-red-700 border border-red-200',
  Administrator: 'bg-purple-100 text-purple-700 border border-purple-200',
  Manager: 'bg-teal-100 text-teal-700 border border-teal-200',
  Sales: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  HR: 'bg-teal-100 text-teal-700 border border-teal-200',
  Finance: 'bg-amber-100 text-amber-700 border border-amber-200',
  Employee: 'bg-gray-100 text-muted-foreground border border-border',
  Client: 'bg-cyan-100 text-cyan-700 border border-cyan-200',
};

/* ---- audit log mock data ---- */

const auditLog = [
  { id: 'al1', timestamp: '2026-07-20T10:32:00Z', userName: 'Alex Johnson', action: 'Login', module: 'Auth', entity: 'Session', ip: '192.168.1.101' },
  { id: 'al2', timestamp: '2026-07-20T10:15:00Z', userName: 'Maria Garcia', action: 'Updated', module: 'Projects', entity: 'CRM Implementation', ip: '192.168.1.145' },
  { id: 'al3', timestamp: '2026-07-20T09:45:00Z', userName: 'John Smith', action: 'Created', module: 'Support', entity: 'TKT-445', ip: '192.168.1.203' },
  { id: 'al4', timestamp: '2026-07-20T09:30:00Z', userName: 'David Kim', action: 'Deleted', module: 'Files', entity: 'old-backup.zip', ip: '192.168.1.204' },
  { id: 'al5', timestamp: '2026-07-20T09:00:00Z', userName: 'Lisa Taylor', action: 'Created', module: 'HR', entity: 'Amanda Wilson', ip: '192.168.1.108' },
  { id: 'al6', timestamp: '2026-07-20T08:30:00Z', userName: 'Michael Brown', action: 'Export', module: 'Finance', entity: 'Q3 Report', ip: '192.168.1.109' },
  { id: 'al7', timestamp: '2026-07-20T08:00:00Z', userName: 'Robert Williams', action: 'Updated', module: 'CRM', entity: 'FusionWorks Deal', ip: '10.0.0.55' },
  { id: 'al8', timestamp: '2026-07-20T07:45:00Z', userName: 'Jennifer Davis', action: 'Login', module: 'Auth', entity: 'Session', ip: '192.168.1.110' },
];

const actionStyles: Record<string, string> = {
  Created: 'bg-emerald-100 text-emerald-700',
  Updated: 'bg-teal-100 text-teal-700',
  Deleted: 'bg-red-100 text-red-700',
  Login: 'bg-gray-100 text-muted-foreground',
  Export: 'bg-amber-100 text-amber-700',
};

const actionIcons: Record<string, React.ElementType> = {
  Created: UserPlus,
  Updated: Edit3,
  Deleted: Trash2,
  Login: LogIn,
  Export: Download,
};

/* ---- permission matrix columns ---- */

const permissionModules = ['Dashboard', 'CRM', 'Projects', 'HR', 'Finance', 'Admin', 'Support', 'Communication'];
const permissionLevels = ['view', 'create', 'edit', 'delete', 'export', 'approve'];

/* ---- animation variants ---- */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

/* ---- main component ---- */

export default function AdminModule() {
  const [userSearch, setUserSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  const roleNames = useMemo(() => {
    return ['all', ...new Set(users.map(u => u.roleName))];
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      if (roleFilter !== 'all' && u.roleName !== roleFilter) return false;
      if (userSearch) {
        const q = userSearch.toLowerCase();
        return (
          u.firstName.toLowerCase().includes(q) ||
          u.lastName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.department.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [roleFilter, userSearch]);

  const onlineCount = 12;
  const activeCount = users.filter(u => u.isActive).length;

  return (
    <motion.div
      className="space-y-6 p-6"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Administration</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage users, roles, settings, and system activity</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => toast.success('Data exported')}>
            <Download className="mr-2 h-4 w-4" />
            Export
          </Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => toast.success('New user form opened')}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </div>
      </div>

      <Tabs defaultValue="users" className="space-y-6">
        <TabsList className="bg-background border border-border p-1 flex-wrap h-auto">
          <TabsTrigger value="users" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Users className="mr-2 h-4 w-4" />
            Users
          </TabsTrigger>
          <TabsTrigger value="roles" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Shield className="mr-2 h-4 w-4" />
            Roles &amp; Permissions
          </TabsTrigger>
          <TabsTrigger value="settings" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Settings className="mr-2 h-4 w-4" />
            Company Settings
          </TabsTrigger>
          <TabsTrigger value="audit" className="data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <FileText className="mr-2 h-4 w-4" />
            Audit Log
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB 1: USERS ===== */}
        <TabsContent value="users" className="space-y-6">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <motion.div variants={itemVariants}>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-teal-50"><Users className="h-5 w-5 text-teal-600" /></div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">48</p>
                      <p className="text-xs text-muted-foreground">Total Users</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={itemVariants}>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50"><UserCheck className="h-5 w-5 text-emerald-600" /></div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{activeCount}</p>
                      <p className="text-xs text-muted-foreground">Active</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={itemVariants}>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-red-50"><UserX className="h-5 w-5 text-red-500" /></div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">3</p>
                      <p className="text-xs text-muted-foreground">Inactive</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
            <motion.div variants={itemVariants}>
              <Card className="border border-border">
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50"><Wifi className="h-5 w-5 text-emerald-600" /></div>
                    <div>
                      <p className="text-2xl font-bold text-foreground">{onlineCount}</p>
                      <p className="text-xs text-muted-foreground">Online Now</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* Filters */}
          <Card className="border border-border">
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search users..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pl-9" />
                </div>
                <Select value={roleFilter} onValueChange={setRoleFilter}>
                  <SelectTrigger className="w-[180px]">
                    <Shield className="mr-2 h-4 w-4 text-muted-foreground" />
                    <SelectValue placeholder="Role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleNames.map(r => (
                      <SelectItem key={r} value={r}>{r === 'all' ? 'All Roles' : r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Users Table */}
          <Card className="border border-border">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold text-muted-foreground">User</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Email</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Phone</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Job Title</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Department</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Role</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Status</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map(user => (
                    <TableRow key={user.id} className="hover:bg-emerald-50/30 transition-colors">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarFallback className={cn(
                              'text-xs font-semibold text-white',
                              user.isActive ? 'bg-emerald-600' : 'bg-muted',
                            )}>
                              {getInitials(user.firstName, user.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground">
                            {user.firstName} {user.lastName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.phone}</TableCell>
                      <TableCell className="text-sm text-foreground">{user.jobTitle}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{user.department}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-xs font-medium', roleColors[user.roleName] || 'bg-gray-100 text-muted-foreground border border-border')}>
                          {user.roleName}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('text-xs font-medium', user.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-muted-foreground')}>
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatLastSeen(user.lastSeen)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 2: ROLES & PERMISSIONS ===== */}
        <TabsContent value="roles" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{roles.length} roles configured</p>
            <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => toast.success('New role created')}>
              <Plus className="mr-2 h-4 w-4" />
              Create Role
            </Button>
          </div>

          <div className="space-y-3">
            {roles.map((role, i) => {
              const isExpanded = expandedRole === role.id;
              const permissionEntries = Object.entries(role.permissions);
              return (
                <motion.div key={role.id} variants={itemVariants} initial="hidden" animate="visible" transition={{ delay: i * 0.04 }}>
                  <Card className="border border-border hover:border-emerald-200 transition-colors overflow-hidden">
                    <button
                      className="w-full text-left p-5 flex items-center justify-between bg-transparent border-0 cursor-pointer"
                      onClick={() => setExpandedRole(isExpanded ? null : role.id)}
                    >
                      <div className="flex items-center gap-4 flex-1">
                        <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-600">
                          <Key className="h-5 w-5" />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-foreground">{role.name}</h3>
                            {role.isSystem && (
                              <Badge className="bg-teal-100 text-teal-700 text-xs">System</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">{role.description}</p>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Users className="h-3 w-3" />{role.userCount} users
                            </span>
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Shield className="h-3 w-3" />{permissionEntries.length} modules
                            </span>
                          </div>
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <Separator />
                          <div className="p-5">
                            <p className="text-sm font-medium text-foreground mb-3">Permission Matrix</p>
                            <div className="overflow-x-auto">
                              <Table>
                                <TableHeader>
                                  <TableRow className="bg-muted/40">
                                    <TableHead className="font-semibold text-muted-foreground">Module</TableHead>
                                    {permissionLevels.map(level => (
                                      <TableHead key={level} className="font-semibold text-muted-foreground text-center capitalize text-xs">
                                        {level}
                                      </TableHead>
                                    ))}
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {permissionModules.map(mod => {
                                    const modKey = mod.toLowerCase();
                                    const perms = role.permissions[modKey] || [];
                                    return (
                                      <TableRow key={mod}>
                                        <TableCell className="font-medium text-sm text-foreground">{mod}</TableCell>
                                        {permissionLevels.map(level => (
                                          <TableCell key={level} className="text-center">
                                            {perms.includes(level) ? (
                                              <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
                                            ) : (
                                              <XCircle className="h-4 w-4 text-muted-foreground/40 mx-auto" />
                                            )}
                                          </TableCell>
                                        ))}
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </TabsContent>

        {/* ===== TAB 3: COMPANY SETTINGS ===== */}
        <TabsContent value="settings" className="space-y-6">
          {/* General */}
          <Card className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-emerald-600" />
                  <CardTitle className="text-base">General Information</CardTitle>
                </div>
                <Button variant="outline" size="sm" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => toast.info('Editing company information')}>
                  <Edit3 className="mr-2 h-3.5 w-3.5" />Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <SettingsField label="Company Name" value={companyInfo.name} />
                <SettingsField label="Industry" value={companyInfo.industry} />
                <SettingsField label="Website" value={companyInfo.website} icon={Globe} />
                <SettingsField label="Phone" value="+1 555-1000" icon={Phone} />
                <SettingsField label="Email" value="info@nexuscorp.com" icon={Mail} />
                <SettingsField label="Address" value="450 Tech Blvd, San Francisco, CA 94105" icon={MapPin} />
              </div>
            </CardContent>
          </Card>

          {/* Preferences */}
          <Card className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5 text-teal-600" />
                  <CardTitle className="text-base">Preferences</CardTitle>
                </div>
                <Button variant="outline" size="sm" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => toast.info('Editing preferences')}>
                  <Edit3 className="mr-2 h-3.5 w-3.5" />Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <SettingsField label="Currency" value="USD ($)" icon={DollarSign} />
                <SettingsField label="Timezone" value="America/Los_Angeles (PST)" />
                <SettingsField label="Language" value="English (US)" />
                <SettingsField label="Date Format" value="MM/DD/YYYY" icon={Calendar} />
              </div>
            </CardContent>
          </Card>

          {/* Branding */}
          <Card className="border border-border">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Palette className="h-5 w-5 text-emerald-600" />
                  <CardTitle className="text-base">Branding</CardTitle>
                </div>
                <Button variant="outline" size="sm" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50" onClick={() => toast.info('Editing branding')}>
                  <Edit3 className="mr-2 h-3.5 w-3.5" />Edit
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-muted-foreground">Company Logo</Label>
                  <div className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center gap-2 bg-muted/50 hover:bg-emerald-50/30 hover:border-emerald-300 transition-colors cursor-pointer">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">Click to upload</p>
                  </div>
                </div>
                <SettingsField label="Primary Color" value="#059669">
                  <div className="h-5 w-5 rounded-full bg-emerald-600 border border-border" />
                </SettingsField>
                <SettingsField label="Accent Color" value="#0D9488">
                  <div className="h-5 w-5 rounded-full bg-teal-600 border border-border" />
                </SettingsField>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB 4: AUDIT LOG ===== */}
        <TabsContent value="audit" className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50">
              <FileText className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Recent Activity</h3>
              <p className="text-sm text-muted-foreground">Showing latest system events and user actions</p>
            </div>
          </div>

          <Card className="border border-border">
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="font-semibold text-muted-foreground">Timestamp</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">User</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Action</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Module</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">Entity</TableHead>
                    <TableHead className="font-semibold text-muted-foreground">IP Address</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLog.map(entry => {
                    const ActionIcon = actionIcons[entry.action] || Eye;
                    return (
                      <TableRow key={entry.id} className="hover:bg-emerald-50/30 transition-colors">
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(entry.timestamp).toLocaleString('en-US', {
                            month: 'short', day: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </TableCell>
                        <TableCell className="font-medium text-foreground text-sm">{entry.userName}</TableCell>
                        <TableCell>
                          <Badge className={cn('text-xs font-medium', actionStyles[entry.action])}>
                            <ActionIcon className="mr-1 h-3 w-3" />
                            {entry.action}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{entry.module}</TableCell>
                        <TableCell className="text-sm text-foreground font-medium">{entry.entity}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{entry.ip}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}

/* ---- sub-components ---- */

function SettingsField({ label, value, icon: Icon, children }: { label: string; value: string; icon?: React.ElementType; children?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
      <div className="flex items-center gap-2 text-sm text-foreground font-medium py-1">
        {children || (Icon ? <Icon className="h-4 w-4 text-muted-foreground shrink-0" /> : null)}
        {value}
      </div>
    </div>
  );
}