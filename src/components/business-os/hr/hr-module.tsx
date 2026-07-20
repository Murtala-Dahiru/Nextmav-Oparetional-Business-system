'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Users, Search, UserCheck, UserX, Clock, CalendarOff,
  Plus, Calendar, DollarSign, TrendingUp, Eye, Shield,
  CheckCircle2, XCircle, ArrowUpDown, Filter, CalendarDays,
  ChevronLeft, ChevronRight, Banknote, PieChart, Briefcase,
  UserRound, AlertCircle, FileCheck, Plane, Heart, Coffee,
  Baby, ArrowUpRight, BadgeDollarSign,
} from 'lucide-react';
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';

import { employees } from '@/lib/mock-data';
import type { EmployeeItem } from '@/types';

/* ---- helpers ---- */

function formatCurrency(v: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  }).format(v);
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName[0]}${lastName[0]}`;
}

const departmentColors: Record<string, string> = {
  Executive: 'bg-amber-500 text-white',
  Product: 'bg-violet-500 text-white',
  Engineering: 'bg-cyan-500 text-white',
  Design: 'bg-pink-500 text-white',
  Sales: 'bg-emerald-500 text-white',
  'Human Resources': 'bg-teal-500 text-white',
  Finance: 'bg-teal-500 text-white',
  Support: 'bg-orange-500 text-white',
  Marketing: 'bg-cyan-500 text-white',
};

const departments = [
  'All', 'Executive', 'Product', 'Engineering', 'Design',
  'Sales', 'HR', 'Finance', 'Support', 'Marketing',
];

/* ---- mock attendance data ---- */

type AttendanceStatus = 'present' | 'absent' | 'late' | 'on-leave';

interface AttendanceRecord {
  employee: EmployeeItem;
  clockIn: string;
  clockOut: string;
  status: AttendanceStatus;
}

const attendanceData: AttendanceRecord[] = [
  { employee: employees[0], clockIn: '08:05 AM', clockOut: '06:10 PM', status: 'present' },
  { employee: employees[1], clockIn: '08:30 AM', clockOut: '05:45 PM', status: 'present' },
  { employee: employees[2], clockIn: '09:15 AM', clockOut: '--', status: 'late' },
  { employee: employees[3], clockIn: '07:55 AM', clockOut: '06:30 PM', status: 'present' },
  { employee: employees[4], clockIn: '08:10 AM', clockOut: '05:50 PM', status: 'present' },
  { employee: employees[5], clockIn: '--', clockOut: '--', status: 'absent' },
  { employee: employees[6], clockIn: '09:20 AM', clockOut: '--', status: 'late' },
  { employee: employees[7], clockIn: '08:00 AM', clockOut: '05:30 PM', status: 'present' },
  { employee: employees[8], clockIn: '08:45 AM', clockOut: '--', status: 'present' },
  { employee: employees[9], clockIn: '--', clockOut: '--', status: 'on-leave' },
  { employee: employees[10], clockIn: '08:20 AM', clockOut: '06:00 PM', status: 'present' },
  { employee: employees[11], clockIn: '--', clockOut: '--', status: 'absent' },
];

/* ---- mock leave requests ---- */

type LeaveType = 'Vacation' | 'Sick' | 'Personal' | 'Maternity';
type LeaveStatus = 'pending' | 'approved' | 'rejected';

interface LeaveRequest {
  id: string;
  employee: EmployeeItem;
  type: LeaveType;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
}

const leaveRequests: LeaveRequest[] = [
  { id: 'lr1', employee: employees[0], type: 'Vacation', from: '2026-08-01', to: '2026-08-05', days: 5, reason: 'Family vacation to Hawaii for summer break', status: 'pending' },
  { id: 'lr2', employee: employees[2], type: 'Sick', from: '2026-07-22', to: '2026-07-23', days: 2, reason: 'Flu symptoms, doctor recommendation to rest', status: 'approved' },
  { id: 'lr3', employee: employees[5], type: 'Personal', from: '2026-07-28', to: '2026-07-29', days: 2, reason: 'Moving to a new apartment across town', status: 'pending' },
  { id: 'lr4', employee: employees[7], type: 'Vacation', from: '2026-08-10', to: '2026-08-21', days: 10, reason: 'Annual summer trip with family to Europe', status: 'approved' },
  { id: 'lr5', employee: employees[9], type: 'Sick', from: '2026-07-20', to: '2026-07-21', days: 2, reason: 'Dental surgery and recovery period', status: 'pending' },
  { id: 'lr6', employee: employees[4], type: 'Maternity', from: '2026-09-01', to: '2026-12-20', days: 80, reason: 'Maternity leave per company policy', status: 'approved' },
  { id: 'lr7', employee: employees[6], type: 'Vacation', from: '2026-07-25', to: '2026-07-26', days: 2, reason: 'Attend best friend wedding in Seattle', status: 'rejected' },
  { id: 'lr8', employee: employees[10], type: 'Personal', from: '2026-08-15', to: '2026-08-15', days: 1, reason: 'Home inspection for refinancing process', status: 'pending' },
];

/* ---- mock payroll data ---- */

const PIE_COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#ec4899', '#06b6d4', '#8b5cf6', '#f97316', '#ef4444', '#0d9488'];

/* ---- shared sub-components ---- */

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35 },
};

function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ElementType; label: string; value: string | number; accent?: string;
}) {
  return (
    <motion.div {...fadeUp}>
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardContent className="flex items-center gap-4 p-5">
          <div className={cn(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg',
            accent ?? 'bg-emerald-500/10 text-emerald-600',
          )}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground truncate">{label}</p>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function TabHeader({ title, description, actionLabel, actionIcon: ActionIcon }: {
  title: string; description: string; actionLabel?: string; actionIcon?: React.ElementType;
}) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {actionLabel && (
        <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white mt-2 sm:mt-0 w-fit gap-1.5" onClick={() => toast.success(`${actionLabel} created`)}>
          {ActionIcon && <ActionIcon className="h-4 w-4" />}
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

function AvatarInitials({ firstName, lastName, department, size = 'sm' }: {
  firstName: string; lastName: string; department: string; size?: 'sm' | 'md' | 'lg';
}) {
  const sizeMap = { sm: 'h-8 w-8 text-xs', md: 'h-10 w-10 text-sm', lg: 'h-12 w-12 text-base' };
  return (
    <div className={cn(
      'flex items-center justify-center rounded-full font-semibold shrink-0',
      sizeMap[size],
      departmentColors[department] ?? 'bg-gray-500 text-white',
    )}>
      {getInitials(firstName, lastName)}
    </div>
  );
}

/* ================================================================
   TAB 1 — EMPLOYEES
   ================================================================ */

function EmployeesTab() {
  const [search, setSearch] = useState('');
  const [dept, setDept] = useState('All');

  const filtered = useMemo(() => {
    return employees.filter((e) => {
      const matchSearch =
        `${e.firstName} ${e.lastName} ${e.email} ${e.jobTitle}`
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchDept =
        dept === 'All' ||
        e.department.toLowerCase() === dept.toLowerCase() ||
        (dept === 'HR' && e.department === 'Human Resources');
      return matchSearch && matchDept;
    });
  }, [search, dept]);

  const statusColor: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    'on-leave': 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    inactive: 'bg-red-500/15 text-red-700 dark:text-red-400',
  };

  return (
    <div className="space-y-6">
      <TabHeader
        title="Employees"
        description="Manage your organization's workforce and employee directory."
        actionLabel="Add Employee"
        actionIcon={Plus}
      />

      {/* summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Users} label="Total Employees" value="248" accent="bg-teal-500/10 text-teal-600" />
        <StatCard icon={UserCheck} label="Active" value="235" accent="bg-emerald-500/10 text-emerald-600" />
        <StatCard icon={CalendarOff} label="On Leave" value="8" accent="bg-amber-500/10 text-amber-600" />
        <StatCard icon={UserRound} label="New Hires" value="5" accent="bg-cyan-500/10 text-cyan-600" />
      </div>

      {/* search & filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search employees..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Select value={dept} onValueChange={setDept}>
          <SelectTrigger className="w-full sm:w-[180px] h-9">
            <Filter className="h-4 w-4 mr-1 text-muted-foreground" />
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* table */}
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="w-[50px]">Avatar</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden lg:table-cell">Job Title</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Hire Date</TableHead>
              <TableHead className="text-right">Salary</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((emp) => (
              <TableRow key={emp.id} className="group">
                <TableCell>
                  <AvatarInitials firstName={emp.firstName} lastName={emp.lastName} department={emp.department} />
                </TableCell>
                <TableCell className="font-medium whitespace-nowrap">
                  {emp.firstName} {emp.lastName}
                </TableCell>
                <TableCell className="hidden md:table-cell text-muted-foreground">{emp.email}</TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground">{emp.jobTitle}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs font-medium">
                    {emp.department}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className={cn('text-xs capitalize', statusColor[emp.status] ?? '')}>
                    {emp.status === 'on-leave' ? 'On Leave' : emp.status}
                  </Badge>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-muted-foreground">{formatDate(emp.hireDate)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatCurrency(emp.salary)}</TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                  No employees found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   TAB 2 — ATTENDANCE
   ================================================================ */

function AttendanceTab() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const statusBadge: Record<AttendanceStatus, { cls: string; label: string }> = {
    present: { cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', label: 'Present' },
    absent: { cls: 'bg-red-500/15 text-red-700 dark:text-red-400', label: 'Absent' },
    late: { cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', label: 'Late' },
    'on-leave': { cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-400', label: 'On Leave' },
  };

  return (
    <div className="space-y-6">
      <TabHeader
        title="Attendance"
        description="Track daily employee attendance and working hours."
        actionLabel="Export Report"
        actionIcon={ArrowUpRight}
      />

      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-5 py-3">
        <CalendarDays className="h-5 w-5 text-emerald-600" />
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{today}</p>
      </div>

      {/* summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={UserCheck} label="Present" value="18" accent="bg-emerald-500/10 text-emerald-600" />
        <StatCard icon={UserX} label="Absent" value="2" accent="bg-red-500/10 text-red-600" />
        <StatCard icon={Clock} label="Late" value="3" accent="bg-amber-500/10 text-amber-600" />
        <StatCard icon={CalendarOff} label="On Leave" value="1" accent="bg-cyan-500/10 text-cyan-600" />
      </div>

      {/* grid of cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {attendanceData.map((rec, i) => {
          const s = statusBadge[rec.status];
          return (
            <motion.div
              key={rec.employee.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
            >
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm hover:border-emerald-500/30 transition-colors">
                <CardContent className="flex flex-col items-center gap-3 p-5 text-center">
                  <AvatarInitials
                    firstName={rec.employee.firstName}
                    lastName={rec.employee.lastName}
                    department={rec.employee.department}
                    size="lg"
                  />
                  <div>
                    <p className="font-semibold text-sm">{rec.employee.firstName} {rec.employee.lastName}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{rec.employee.jobTitle}</p>
                  </div>
                  <Badge variant="secondary" className={cn('text-xs font-medium', s.cls)}>
                    {s.label}
                  </Badge>
                  <div className="w-full space-y-2 text-xs border-t pt-3 mt-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Clock In</span>
                      <span className={rec.clockIn === '--' ? 'text-muted-foreground' : 'font-medium'}>
                        {rec.clockIn}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Clock Out</span>
                      <span className={rec.clockOut === '--' ? 'text-muted-foreground' : 'font-medium'}>
                        {rec.clockOut}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================
   TAB 3 — LEAVE MANAGEMENT
   ================================================================ */

function LeaveManagementTab() {
  const leaveStatusColor: Record<LeaveStatus, string> = {
    pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    rejected: 'bg-red-500/15 text-red-700 dark:text-red-400',
  };

  const typeIcon: Record<LeaveType, React.ElementType> = {
    Vacation: Plane,
    Sick: Heart,
    Personal: Coffee,
    Maternity: Baby,
  };

  return (
    <div className="space-y-6">
      <TabHeader
        title="Leave Management"
        description="Review and manage employee leave requests and balances."
        actionLabel="New Request"
        actionIcon={Plus}
      />

      {/* summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={AlertCircle} label="Pending Requests" value="4" accent="bg-amber-500/10 text-amber-600" />
        <StatCard icon={FileCheck} label="Approved This Month" value="12" accent="bg-emerald-500/10 text-emerald-600" />
        <StatCard icon={XCircle} label="Rejected" value="2" accent="bg-red-500/10 text-red-600" />
        <StatCard icon={Shield} label="Leave Balance" value="Varies" accent="bg-teal-500/10 text-teal-600" />
      </div>

      {/* leave requests table */}
      <div className="rounded-lg border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="hidden sm:table-cell">From</TableHead>
              <TableHead className="hidden sm:table-cell">To</TableHead>
              <TableHead className="text-center">Days</TableHead>
              <TableHead className="hidden lg:table-cell">Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leaveRequests.map((lr) => {
              const TypeIcon = typeIcon[lr.type];
              return (
                <TableRow key={lr.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <AvatarInitials
                        firstName={lr.employee.firstName}
                        lastName={lr.employee.lastName}
                        department={lr.employee.department}
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-sm whitespace-nowrap">
                          {lr.employee.firstName} {lr.employee.lastName}
                        </p>
                        <p className="text-xs text-muted-foreground">{lr.employee.department}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-sm">
                      <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {lr.type}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">{formatDate(lr.from)}</TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">{formatDate(lr.to)}</TableCell>
                  <TableCell className="text-center font-medium">{lr.days}</TableCell>
                  <TableCell className="hidden lg:table-cell text-muted-foreground text-sm max-w-[200px] truncate">
                    {lr.reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={cn('text-xs capitalize', leaveStatusColor[lr.status])}>
                      {lr.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {lr.status === 'pending' && (
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10" onClick={() => toast.success(`Leave request approved for ${lr.employee.firstName} ${lr.employee.lastName}`)}>
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-red-600 hover:text-red-700 hover:bg-red-500/10" onClick={() => toast.error(`Leave request rejected for ${lr.employee.firstName} ${lr.employee.lastName}`)}>
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   TAB 4 — PAYROLL
   ================================================================ */

function PayrollTab() {
  const payrollRows = employees.slice(0, 8).map((emp) => {
    const bonus = Math.round(emp.salary * (0.02 + Math.random() * 0.08));
    const deduction = Math.round(emp.salary * (0.03 + Math.random() * 0.06));
    const net = emp.salary + bonus - deduction;
    const status = Math.random() > 0.25 ? 'paid' : 'pending';
    return { employee: emp, bonus, deduction, net, status };
  });

  const deptSalaryMap: Record<string, number> = {};
  employees.forEach((e) => {
    deptSalaryMap[e.department] = (deptSalaryMap[e.department] || 0) + e.salary;
  });
  const pieData = Object.entries(deptSalaryMap).map(([name, value]) => ({ name, value }));

  return (
    <div className="space-y-6">
      <TabHeader
        title="Payroll"
        description="Manage monthly payroll, bonuses, and salary distributions."
        actionLabel="Run Payroll"
        actionIcon={Banknote}
      />

      {/* summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={DollarSign} label="Total Payroll This Month" value="$892,000" accent="bg-emerald-500/10 text-emerald-600" />
        <StatCard icon={TrendingUp} label="Average Salary" value="$105,200" accent="bg-teal-500/10 text-teal-600" />
        <StatCard icon={BadgeDollarSign} label="Bonuses" value="$45,000" accent="bg-amber-500/10 text-amber-600" />
        <StatCard icon={ArrowUpDown} label="Deductions" value="$32,000" accent="bg-red-500/10 text-red-600" />
      </div>

      {/* pie chart + table */}
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        {/* pie chart */}
        <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-4">
              <PieChart className="h-4 w-4 text-emerald-600" />
              <h3 className="font-semibold text-sm">Salary by Department</h3>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <RechartsPie>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={95}
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                  >
                    {pieData.map((_entry, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => formatCurrency(value)}
                    contentStyle={{
                      borderRadius: 8,
                      border: '1px solid hsl(var(--border))',
                      backgroundColor: 'hsl(var(--card))',
                      fontSize: 12,
                    }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                </RechartsPie>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* payroll table */}
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Employee</TableHead>
                <TableHead className="hidden sm:table-cell">Department</TableHead>
                <TableHead className="text-right">Base Salary</TableHead>
                <TableHead className="text-right hidden md:table-cell">Bonuses</TableHead>
                <TableHead className="text-right hidden md:table-cell">Deductions</TableHead>
                <TableHead className="text-right">Net Pay</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollRows.map((row) => (
                <TableRow key={row.employee.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <AvatarInitials
                        firstName={row.employee.firstName}
                        lastName={row.employee.lastName}
                        department={row.employee.department}
                      />
                      <span className="font-medium text-sm whitespace-nowrap">
                        {row.employee.firstName} {row.employee.lastName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                    {row.employee.department}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatCurrency(row.employee.salary)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm hidden md:table-cell text-emerald-600">
                    +{formatCurrency(row.bonus)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm hidden md:table-cell text-red-500">
                    -{formatCurrency(row.deduction)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(row.net)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-xs capitalize',
                        row.status === 'paid'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
                      )}
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================================================================
   MAIN HR MODULE
   ================================================================ */

export default function HrModule() {
  return (
    <div className="flex flex-col gap-2 h-full">
      <Tabs defaultValue="employees" className="flex flex-col gap-4 flex-1 min-h-0">
        <TabsList className="bg-muted/60 border border-border/50">
          <TabsTrigger value="employees" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Users className="h-4 w-4" />
            Employees
          </TabsTrigger>
          <TabsTrigger value="attendance" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Clock className="h-4 w-4" />
            Attendance
          </TabsTrigger>
          <TabsTrigger value="leave" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <Calendar className="h-4 w-4" />
            Leave
          </TabsTrigger>
          <TabsTrigger value="payroll" className="gap-1.5 data-[state=active]:bg-emerald-600 data-[state=active]:text-white">
            <DollarSign className="h-4 w-4" />
            Payroll
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 min-h-0">
          <div className="pr-4 pb-6">
            <TabsContent value="employees">
              <EmployeesTab />
            </TabsContent>
            <TabsContent value="attendance">
              <AttendanceTab />
            </TabsContent>
            <TabsContent value="leave">
              <LeaveManagementTab />
            </TabsContent>
            <TabsContent value="payroll">
              <PayrollTab />
            </TabsContent>
          </div>
        </ScrollArea>
      </Tabs>
    </div>
  );
}