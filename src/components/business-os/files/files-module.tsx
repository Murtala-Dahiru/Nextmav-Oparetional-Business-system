'use client';

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Folder,
  FolderOpen,
  FileText,
  Image,
  FileSpreadsheet,
  Upload,
  FolderPlus,
  LayoutGrid,
  List,
  ChevronRight,
  Home,
  Download,
  Share2,
  Trash2,
  MoreVertical,
  Search,
  ArrowUpDown,
  File,
  HardDrive,
  Clock,
  User,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

import { files } from '@/lib/mock-data';
import type { FileItem } from '@/types';

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function totalFileSize(items: FileItem[]): number {
  return items.reduce((acc, f) => acc + f.size, 0);
}

type SortKey = 'name' | 'size' | 'category' | 'uploadedBy' | 'createdAt';
type SortDir = 'asc' | 'desc';

function sortFiles(list: FileItem[], key: SortKey, dir: SortDir): FileItem[] {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (key === 'size') cmp = a.size - b.size;
    else if (key === 'createdAt') cmp = a.createdAt.localeCompare(b.createdAt);
    else cmp = (a[key] as string).localeCompare(b[key] as string);
    return dir === 'asc' ? cmp : -cmp;
  });
}

/* -------------------------------------------------------------------------- */
/*  Folder data                                                                */
/* -------------------------------------------------------------------------- */

interface FolderCard {
  id: string;
  name: string;
  itemCount: number;
}

const folderData: FolderCard[] = [
  { id: 'd1', name: 'Reports', itemCount: 1 },
  { id: 'd2', name: 'Design', itemCount: 1 },
  { id: 'd3', name: 'Proposals', itemCount: 1 },
  { id: 'd4', name: 'Planning', itemCount: 1 },
  { id: 'd5', name: 'Documentation', itemCount: 1 },
  { id: 'd6', name: 'Policies', itemCount: 1 },
  { id: 'd7', name: 'Media', itemCount: 1 },
];

/* -------------------------------------------------------------------------- */
/*  File type icon resolver                                                    */
/* -------------------------------------------------------------------------- */

function getFileIcon(mimeType: string) {
  if (mimeType === 'application/pdf') {
    return { icon: FileText, color: 'text-red-500', bg: 'bg-red-50' };
  }
  if (mimeType.startsWith('image/')) {
    return { icon: Image, color: 'text-green-500', bg: 'bg-green-50' };
  }
  if (mimeType.includes('spreadsheet') || mimeType.includes('sheet')) {
    return { icon: FileSpreadsheet, color: 'text-emerald-500', bg: 'bg-emerald-50' };
  }
  if (mimeType.includes('word') || mimeType.includes('document')) {
    return { icon: FileText, color: 'text-blue-500', bg: 'bg-blue-50' };
  }
  return { icon: File, color: 'text-slate-400', bg: 'bg-slate-50' };
}

function getCategoryBadgeColor(category: string): string {
  const map: Record<string, string> = {
    Finance: 'bg-emerald-100 text-emerald-700',
    Marketing: 'bg-purple-100 text-purple-700',
    Sales: 'bg-blue-100 text-blue-700',
    Product: 'bg-amber-100 text-amber-700',
    General: 'bg-slate-100 text-slate-700',
    Engineering: 'bg-cyan-100 text-cyan-700',
    HR: 'bg-rose-100 text-rose-700',
  };
  return map[category] ?? 'bg-slate-100 text-slate-700';
}

/* -------------------------------------------------------------------------- */
/*  Animation variants                                                         */
/* -------------------------------------------------------------------------- */

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.03, duration: 0.3, ease: 'easeOut' },
  }),
};

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export default function FilesModule() {
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [currentFolder, setCurrentFolder] = useState('Home');

  const filteredFiles = useMemo(() => {
    let list = files;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q) ||
          f.uploadedBy.toLowerCase().includes(q),
      );
    }
    return sortFiles(list, sortKey, sortDir);
  }, [search, sortKey, sortDir]);

  const totalItems = folderData.length + filteredFiles.length;
  const totalBytes = totalFileSize(filteredFiles);
  const storageUsed = 15.2;
  const storageTotal = 50;
  const storagePct = (storageUsed / storageTotal) * 100;

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ---- GRID VIEW ---- */
  function renderGridView() {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {/* Folders */}
        {folderData.map((folder, i) => {
          const isSelected = selectedIds.has(folder.id);
          return (
            <motion.div
              key={folder.id}
              custom={i}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
            >
              <Card
                onClick={() => toggleSelect(folder.id)}
                className={cn(
                  'cursor-pointer transition-all duration-200 group hover:shadow-lg hover:shadow-emerald-500/5 hover:border-emerald-300',
                  isSelected && 'ring-2 ring-emerald-500 border-emerald-400',
                )}
              >
                <CardContent className="flex flex-col items-center justify-center p-6 gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                    <Folder className="w-8 h-8 text-amber-500" />
                  </div>
                  <span className="font-semibold text-sm text-center truncate w-full">
                    {folder.name}
                  </span>
                  <span className="text-xs text-slate-400">
                    {folder.itemCount} {folder.itemCount === 1 ? 'item' : 'items'}
                  </span>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}

        {/* Files */}
        {filteredFiles.map((file, i) => {
          const { icon: FIcon, color, bg } = getFileIcon(file.mimeType);
          const isSelected = selectedIds.has(file.id);
          return (
            <motion.div
              key={file.id}
              custom={folderData.length + i}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
            >
              <Card
                onClick={() => toggleSelect(file.id)}
                className={cn(
                  'cursor-pointer transition-all duration-200 group hover:shadow-lg hover:shadow-emerald-500/5 hover:border-emerald-300',
                  isSelected && 'ring-2 ring-emerald-500 border-emerald-400',
                )}
              >
                <CardContent className="flex flex-col items-center gap-3 p-5">
                  <div
                    className={cn(
                      'w-14 h-14 rounded-xl flex items-center justify-center transition-colors',
                      bg,
                    )}
                  >
                    <FIcon className={cn('w-7 h-7', color)} />
                  </div>
                  <div className="w-full text-center">
                    <p className="text-sm font-medium truncate" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatFileSize(file.size)}
                    </p>
                  </div>
                  <Badge
                    variant="secondary"
                    className={cn(
                      'text-[10px] px-2 py-0 h-5 font-medium',
                      getCategoryBadgeColor(file.category),
                    )}
                  >
                    {file.category}
                  </Badge>
                  <div className="flex items-center gap-3 text-[11px] text-slate-400 w-full justify-between px-1">
                    <span className="flex items-center gap-1 truncate">
                      <User className="w-3 h-3 shrink-0" />
                      <span className="truncate">{file.uploadedBy.split(' ')[0]}</span>
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      <Clock className="w-3 h-3" />
                      {file.createdAt}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>
    );
  }

  /* ---- LIST VIEW ---- */
  function renderListView() {
    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80 hover:bg-slate-50">
              <TableHead className="font-semibold text-slate-600 pl-5">Name</TableHead>
              <TableHead className="font-semibold text-slate-600">Size</TableHead>
              <TableHead className="font-semibold text-slate-600">Category</TableHead>
              <TableHead className="font-semibold text-slate-600">Uploaded By</TableHead>
              <TableHead className="font-semibold text-slate-600">Modified Date</TableHead>
              <TableHead className="font-semibold text-slate-600 text-right pr-5">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Folder rows */}
            {folderData.map((folder) => {
              const isSelected = selectedIds.has(folder.id);
              return (
                <motion.tr
                  key={folder.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => toggleSelect(folder.id)}
                  className={cn(
                    'border-b border-slate-100 cursor-pointer transition-colors hover:bg-emerald-50/40',
                    isSelected && 'bg-emerald-50/60',
                  )}
                >
                  <td className="pl-5 py-3">
                    <div className="flex items-center gap-3">
                      <Folder className="w-5 h-5 text-amber-500 shrink-0" />
                      <span className="font-medium text-sm">{folder.name}</span>
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-[10px] px-1.5 py-0 h-4 font-medium">
                        Folder
                      </Badge>
                    </div>
                  </td>
                  <td className="text-sm text-slate-500">—</td>
                  <td className="text-sm text-slate-500">—</td>
                  <td className="text-sm text-slate-500">—</td>
                  <td className="text-sm text-slate-500">—</td>
                  <td className="pr-5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-slate-400 hover:text-emerald-600">
                        <Share2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-slate-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}

            {/* File rows */}
            {filteredFiles.map((file) => {
              const { icon: FIcon, color } = getFileIcon(file.mimeType);
              const isSelected = selectedIds.has(file.id);
              return (
                <motion.tr
                  key={file.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => toggleSelect(file.id)}
                  className={cn(
                    'border-b border-slate-100 cursor-pointer transition-colors hover:bg-emerald-50/40',
                    isSelected && 'bg-emerald-50/60',
                  )}
                >
                  <td className="pl-5 py-3">
                    <div className="flex items-center gap-3">
                      <FIcon className={cn('w-5 h-5 shrink-0', color)} />
                      <span className="font-medium text-sm truncate max-w-[220px]" title={file.name}>
                        {file.name}
                      </span>
                    </div>
                  </td>
                  <td className="text-sm text-slate-500 tabular-nums">
                    {formatFileSize(file.size)}
                  </td>
                  <td>
                    <Badge
                      variant="secondary"
                      className={cn(
                        'text-[10px] px-2 py-0 h-5 font-medium',
                        getCategoryBadgeColor(file.category),
                      )}
                    >
                      {file.category}
                    </Badge>
                  </td>
                  <td className="text-sm text-slate-500">{file.uploadedBy}</td>
                  <td className="text-sm text-slate-500">{file.createdAt}</td>
                  <td className="pr-5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-slate-400 hover:text-emerald-600">
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-slate-400 hover:text-emerald-600">
                        <Share2 className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="w-7 h-7 text-slate-400 hover:text-red-500">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </td>
                </motion.tr>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  }

  /* ---- MAIN RENDER ---- */
  return (
    <div className="flex flex-col gap-5 p-6 h-full overflow-auto">
      {/* ── Top Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink
                href="#"
                className="flex items-center gap-1.5 text-slate-500 hover:text-emerald-600 transition-colors"
                onClick={() => setCurrentFolder('Home')}
              >
                <Home className="w-3.5 h-3.5" />
                Home
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator>
              <ChevronRight className="w-3.5 h-3.5" />
            </BreadcrumbSeparator>
            <BreadcrumbItem>
              <BreadcrumbPage className="font-semibold text-emerald-700">
                {currentFolder}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        {/* Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search files…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-48 h-9 text-sm bg-white"
            />
          </div>

          {/* Sort */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-slate-600">
                <ArrowUpDown className="w-3.5 h-3.5" />
                Sort
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => { setSortKey('name'); setSortDir('asc'); }}>
                Name A–Z
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortKey('name'); setSortDir('desc'); }}>
                Name Z–A
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortKey('size'); setSortDir('desc'); }}>
                Largest First
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortKey('size'); setSortDir('asc'); }}>
                Smallest First
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortKey('createdAt'); setSortDir('desc'); }}>
                Newest First
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setSortKey('createdAt'); setSortDir('asc'); }}>
                Oldest First
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* View Toggle */}
          <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('grid')}
              className={cn(
                'h-9 w-9 p-0 rounded-none',
                view === 'grid'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white'
                  : 'text-slate-500 hover:text-emerald-600',
              )}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setView('list')}
              className={cn(
                'h-9 w-9 p-0 rounded-none',
                view === 'list'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 hover:text-white'
                  : 'text-slate-500 hover:text-emerald-600',
              )}
            >
              <List className="w-4 h-4" />
            </Button>
          </div>

          {/* New Folder */}
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-slate-600 border-slate-200 hover:border-emerald-300 hover:text-emerald-700"
          >
            <FolderPlus className="w-4 h-4" />
            New Folder
          </Button>

          {/* Upload */}
          <Button
            size="sm"
            className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm shadow-emerald-200"
          >
            <Upload className="w-4 h-4" />
            Upload
          </Button>
        </div>
      </div>

      {/* ── Storage Usage Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-600 shrink-0">
          <HardDrive className="w-4 h-4 text-emerald-600" />
          <span className="font-medium">
            {storageUsed} GB of {storageTotal} GB used
          </span>
        </div>
        <div className="flex-1 flex items-center gap-3">
          <Progress
            value={storagePct}
            className="h-2.5 bg-slate-100 [&>[data-slot=indicator]]:bg-gradient-to-r [&>[data-slot=indicator]]:from-emerald-400 [&>[data-slot=indicator]]:to-teal-500"
          />
          <span className="text-xs text-slate-400 font-medium tabular-nums w-10 text-right">
            {storagePct.toFixed(0)}%
          </span>
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 min-h-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {view === 'grid' ? renderGridView() : renderListView()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Bottom Info Bar ── */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-5 py-3">
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600 font-medium">
            {totalItems} {totalItems === 1 ? 'item' : 'items'}
          </span>
          {selectedIds.size > 0 && (
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700 text-xs font-medium"
            >
              {selectedIds.size} selected
            </Badge>
          )}
        </div>
        <span className="text-sm text-slate-500 tabular-nums">
          Total size: <span className="font-medium text-slate-700">{formatFileSize(totalBytes)}</span>
        </span>
      </div>
    </div>
  );
}