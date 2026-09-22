import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Plus, ArrowLeft, Search, X, MoreHorizontal, FileText, Copy, Link2, Users, Check, ChevronsUpDown, Trash2, Upload,
} from 'lucide-react';
import api from '../hooks/useApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { formatDate, formatDisposition } from '../utils/formatters';

const PAGE_SIZE = 10;

const DISPOSITION_BADGE = {
  HIRE: 'bg-green-100 text-green-800 hover:bg-green-100',
  MAYBE: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  NO_HIRE: 'bg-red-100 text-red-800 hover:bg-red-100',
};

/** "Mehwish Tariq" -> "MT"; falls back to the first character for single-word names. */
function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const EMPTY_FORM = { name: '', email: '', phone: '', notes: '' };
const PHONE_NUMBER_PATTERN = /^\d{11}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

export default function Candidates() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);

  const [candidates, setCandidates] = useState([]);
  const [requisitions, setRequisitions] = useState([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [resumeFile, setResumeFile] = useState(null);
  const [creating, setCreating] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState([]);
  const [importing, setImporting] = useState(false);

  const [attachFor, setAttachFor] = useState(null); // the candidate being attached
  const [attachTarget, setAttachTarget] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [reqPickerOpen, setReqPickerOpen] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [search, setSearch] = useState('');
  const [requisitionFilter, setRequisitionFilter] = useState('all');
  const [dateSort, setDateSort] = useState('newest');
  const [page, setPage] = useState(1);

  async function loadCandidates() {
    setLoading(true);
    try {
      const res = await api.get('/candidates');
      setCandidates(res.data.candidates);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCandidates();
    api.get('/requisitions', { params: { status: 'open' } }).then((res) => setRequisitions(res.data.requisitions));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (form.phone && !PHONE_NUMBER_PATTERN.test(form.phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }
    setCreating(true);
    try {
      const body = new FormData();
      body.append('name', form.name);
      if (form.email) body.append('email', form.email);
      if (form.phone) body.append('phone', form.phone);
      if (form.notes) body.append('notes', form.notes);
      if (resumeFile) body.append('resume', resumeFile);

      await api.post('/candidates', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(`${form.name.trim()} added.`);
      setForm(EMPTY_FORM);
      setResumeFile(null);
      setCreateOpen(false);
      loadCandidates();
    } finally {
      setCreating(false);
    }
  }

  function openAttach(candidate) {
    setAttachFor(candidate);
    setAttachTarget('');
    setReqPickerOpen(false);
  }

  async function handleAttach() {
    if (!attachTarget) {
      toast.error('Pick a requisition first.');
      return;
    }
    setAttaching(true);
    try {
      const res = await api.post(
        `/candidates/${attachFor._id}/apply`,
        { requisitionId: attachTarget },
        { validateStatus: () => true }
      );
      if (res.status === 201) {
        const title = requisitions.find((r) => r._id === attachTarget)?.title || 'requisition';
        toast.success(`${attachFor.name} attached to ${title}.`);
        setAttachFor(null);
        loadCandidates(); // reflect the new badge without a manual refresh
      } else if (res.status === 409) {
        toast.error(res.data?.message || 'Already attached to this requisition.');
      } else {
        toast.error(res.data?.message || 'Could not attach candidate.');
      }
    } finally {
      setAttaching(false);
    }
  }

  function downloadBulkTemplate() {
    const blob = new Blob(['name,email,phone,notes\nJane Cooper,jane@example.com,03001234567,Referral\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'candidate-import-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleBulkFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a CSV file.');
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) {
        toast.error('The CSV must include a header row and at least one candidate.');
        return;
      }
      const headers = parsed[0].map((header) => header.replace(/^\uFEFF/, '').trim().toLowerCase());
      const requiredHeaders = ['name', 'email', 'phone', 'notes'];
      const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
      if (missingHeaders.length > 0) {
        toast.error(`Missing CSV column${missingHeaders.length > 1 ? 's' : ''}: ${missingHeaders.join(', ')}.`);
        return;
      }

      const existingEmails = new Set(candidates.map((candidate) => candidate.email?.trim().toLowerCase()).filter(Boolean));
      const fileEmails = new Set();
      const headerIndex = Object.fromEntries(headers.map((header, index) => [header, index]));
      const rows = parsed.slice(1).map((cells, index) => {
        const candidate = {
          rowNumber: index + 2,
          name: (cells[headerIndex.name] || '').trim(),
          email: (cells[headerIndex.email] || '').trim(),
          phone: (cells[headerIndex.phone] || '').trim(),
          notes: (cells[headerIndex.notes] || '').trim(),
        };
        const errors = [];
        if (!candidate.name) errors.push('Name is required');
        if (candidate.email && !EMAIL_PATTERN.test(candidate.email)) errors.push('Invalid email');
        if (candidate.phone && !PHONE_NUMBER_PATTERN.test(candidate.phone)) errors.push('Phone must be exactly 11 digits');
        const emailKey = candidate.email.toLowerCase();
        if (emailKey && existingEmails.has(emailKey)) errors.push('Email already exists');
        if (emailKey && fileEmails.has(emailKey)) errors.push('Duplicate email in file');
        if (emailKey) fileEmails.add(emailKey);
        return { ...candidate, errors };
      });
      setBulkRows(rows);
    } catch (error) {
      console.error('[Candidates] CSV parsing failed:', error);
      toast.error('Could not read this CSV file.');
    }
  }

  async function handleBulkImport() {
    const validRows = bulkRows.filter((row) => row.errors.length === 0);
    if (validRows.length === 0) {
      toast.error('Fix the CSV errors before importing.');
      return;
    }
    setImporting(true);
    try {
      const res = await api.post('/candidates/bulk', { candidates: validRows });
      const { createdCount, skippedCount } = res.data;
      toast.success(`${createdCount} candidate${createdCount === 1 ? '' : 's'} imported.${skippedCount ? ` ${skippedCount} skipped.` : ''}`);
      setBulkRows([]);
      setBulkImportOpen(false);
      loadCandidates();
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete() {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      await api.delete(`/candidates/${deleteFor._id}`);
      toast.success(`${deleteFor.name} and all related records were deleted.`);
      setDeleteFor(null);
      loadCandidates();
    } finally {
      setDeleting(false);
    }
  }

  function copyContact(value, label) {
    if (!value) return;
    navigator.clipboard.writeText(value)
      .then(() => toast.success(`${label} copied.`))
      .catch(() => toast.error(`Could not copy the ${label.toLowerCase()}.`));
  }

  const query = search.trim().toLowerCase();
  const attachedRequisitions = useMemo(() => {
    const unique = new Map();
    candidates.forEach((candidate) => {
      (candidate.applications || []).forEach((application) => {
        if (application.requisitionId && application.title) {
          unique.set(application.requisitionId, application.title);
        }
      });
    });
    return [...unique.entries()]
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [candidates]);

  const filtered = useMemo(() => candidates
    .filter((candidate) => {
      const matchesSearch = !query
        || `${candidate.name || ''} ${candidate.email || ''} ${candidate.phone || ''}`.toLowerCase().includes(query);
      const matchesRequisition = requisitionFilter === 'all'
        || (candidate.applications || []).some((application) => application.requisitionId === requisitionFilter);
      return matchesSearch && matchesRequisition;
    })
    .sort((a, b) => {
      const difference = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return dateSort === 'oldest' ? difference : -difference;
    }), [candidates, query, requisitionFilter, dateSort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Requisitions this candidate isn't on yet — attaching twice is a guaranteed 409.
  const availableRequisitions = attachFor
    ? requisitions.filter((r) => !(attachFor.applications || []).some((a) => a.requisitionId === r._id))
    : [];

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Candidates</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : `${candidates.length} total`}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkImportOpen(true)}>
            <Upload />
            Import CSV
          </Button>
          <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
            <Plus />
            New Candidate
          </Button>
        </div>
      </div>

      {/* ---------- search ---------- */}
      {(candidates.length > 0 || loading) && (
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, email or phone…"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          </div>

          <Select value={requisitionFilter} onValueChange={(value) => { setRequisitionFilter(value); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder="All requisitions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All requisitions</SelectItem>
              {attachedRequisitions.map((requisition) => (
                <SelectItem key={requisition.id} value={requisition.id}>{requisition.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={dateSort} onValueChange={(value) => { setDateSort(value); setPage(1); }}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="Sort by date" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ---------- list ---------- */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </div>
                  <Skeleton className="h-8 w-20" />
                </div>
              ))}
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No candidates yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Add someone, then attach them to a requisition to start interviewing.
                </p>
              </div>
              <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
                <Plus />
                New Candidate
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-foreground">No matches for “{search}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different name, email or phone number.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead className="hidden md:table-cell">Phone</TableHead>
                  <TableHead>Attached to</TableHead>
                  <TableHead className="hidden lg:table-cell">Added</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>{initials(c.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                          {c.email ? (
                            <button
                              type="button"
                              onClick={() => copyContact(c.email, 'Email')}
                              className="block max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline"
                              title="Copy email"
                            >
                              {c.email}
                            </button>
                          ) : (
                            <div className="text-xs text-muted-foreground">—</div>
                          )}
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground md:table-cell">
                      {c.phone ? (
                        <button
                          type="button"
                          onClick={() => copyContact(c.phone, 'Phone number')}
                          className="hover:text-foreground hover:underline"
                          title="Copy phone number"
                        >
                          {c.phone}
                        </button>
                      ) : '—'}
                    </TableCell>

                    <TableCell>
                      {(c.applications || []).length === 0 ? (
                        <span className="text-xs text-muted-foreground">Not attached</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {c.applications.map((a) => (
                            <Link key={a.applicationId} to={`/requisitions/${a.requisitionId}`}>
                              <Badge
                                variant="secondary"
                                className={`font-normal ${a.disposition ? DISPOSITION_BADGE[a.disposition] || '' : ''}`}
                                title={a.disposition ? formatDisposition(a.disposition) : 'In progress'}
                              >
                                {a.title}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      )}
                    </TableCell>

                    <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                      {formatDate(c.createdAt)}
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline" size="sm"
                          className="border-[#d21e2b]/40 text-[#d21e2b] hover:bg-[#d21e2b]/5 hover:text-[#d21e2b]"
                          onClick={() => openAttach(c)}
                        >
                          <Link2 />
                          Attach
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal />
                              <span className="sr-only">More actions</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              disabled={!c.resumeFileUrl}
                              onClick={() => window.open(c.resumeFileUrl, '_blank', 'noreferrer')}
                            >
                              <FileText />
                              {c.resumeFileUrl ? 'View résumé' : 'No résumé'}
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!c.email} onClick={() => copyContact(c.email, 'Email')}>
                              <Copy />
                              Copy email
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!c.phone} onClick={() => copyContact(c.phone, 'Phone number')}>
                              <Copy />
                              Copy phone
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeleteFor(c)} className="text-red-600 focus:text-red-600">
                              <Trash2 />
                              Delete candidate
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* ---------- pagination ---------- */}
      {!loading && filtered.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1}>
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</span>
            <Button
              variant="outline" size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteFor} onOpenChange={(open) => !open && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteFor?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the candidate, all of their applications, interviews, scores, audit entries, and uploaded files. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(event) => { event.preventDefault(); handleDelete(); }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {deleting ? 'Deleting…' : 'Delete candidate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- bulk import dialog ---------- */}
      <Dialog open={bulkImportOpen} onOpenChange={(open) => {
        setBulkImportOpen(open);
        if (!open) setBulkRows([]);
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import candidates from CSV</DialogTitle>
            <DialogDescription>
              Use the columns <code>name</code>, <code>email</code>, <code>phone</code>, and <code>notes</code>. Name is required; email and phone are optional, but must be valid when included.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-3">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => handleBulkFile(event.target.files?.[0])}
              className="max-w-sm cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-[#d21e2b]/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-[#d21e2b] hover:file:bg-[#d21e2b]/5"
            />
            <Button type="button" variant="link" className="px-0" onClick={downloadBulkTemplate}>
              Download template
            </Button>
          </div>

          {bulkRows.length > 0 && (() => {
            const validCount = bulkRows.filter((row) => row.errors.length === 0).length;
            const invalidCount = bulkRows.length - validCount;
            return (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {validCount} ready to import{invalidCount ? ` · ${invalidCount} row${invalidCount === 1 ? '' : 's'} need attention` : ''}
                </p>
                <div className="max-h-72 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background">
                      <TableRow>
                        <TableHead>Row</TableHead>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Notes</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bulkRows.map((row) => (
                        <TableRow key={row.rowNumber} className={row.errors.length > 0 ? 'bg-red-50/60' : ''}>
                          <TableCell>{row.rowNumber}</TableCell>
                          <TableCell>{row.name || '—'}</TableCell>
                          <TableCell>{row.email || '—'}</TableCell>
                          <TableCell>{row.phone || '—'}</TableCell>
                          <TableCell className="max-w-[10rem] truncate" title={row.notes}>{row.notes || '—'}</TableCell>
                          <TableCell className={row.errors.length > 0 ? 'text-red-600' : 'text-green-700'}>
                            {row.errors.length > 0 ? row.errors.join(', ') : 'Ready'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBulkImportOpen(false)} disabled={importing}>Cancel</Button>
            <Button
              type="button"
              onClick={handleBulkImport}
              disabled={importing || bulkRows.filter((row) => row.errors.length === 0).length === 0}
              className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
            >
              {importing ? 'Importing…' : `Import ${bulkRows.filter((row) => row.errors.length === 0).length || ''} candidate${bulkRows.filter((row) => row.errors.length === 0).length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- create dialog ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New candidate</DialogTitle>
            <DialogDescription>
              Only a name is required — everything else can be added later.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cand-name">Name</Label>
                <Input
                  id="cand-name" value={form.name} autoFocus
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Jane Cooper"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-email">Email</Label>
                <Input
                  id="cand-email" type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="jane@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-phone">Phone</Label>
                <Input
                  id="cand-phone" value={form.phone}
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]{11}"
                  maxLength={11}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                  placeholder="03001234567"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cand-resume">Résumé <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="cand-resume" type="file"
                  onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
                  className="cursor-pointer py-1.5 file:mr-3 file:cursor-pointer file:rounded file:border file:border-[#d21e2b]/40 file:bg-white file:px-2 file:py-0.5 file:text-xs file:font-medium file:text-[#d21e2b] hover:file:bg-[#d21e2b]/5"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cand-notes">Notes</Label>
              <Textarea
                id="cand-notes" rows={3} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Source, referral, anything worth remembering…"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90">
                {creating ? 'Creating…' : 'Create candidate'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------- attach dialog ---------- */}
      <Dialog open={!!attachFor} onOpenChange={(open) => !open && setAttachFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Attach to a requisition</DialogTitle>
            <DialogDescription>
              {attachFor ? `${attachFor.name} will start at the first stage of the pipeline.` : ''}
            </DialogDescription>
          </DialogHeader>

          {(attachFor?.applications || []).length > 0 && (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs font-medium text-muted-foreground">Already attached to</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {attachFor.applications.map((a) => (
                  <Badge key={a.applicationId} variant="secondary" className="font-normal">{a.title}</Badge>
                ))}
              </div>
            </div>
          )}

          {availableRequisitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {requisitions.length === 0
                ? 'No open requisitions yet — create one first.'
                : 'This candidate is already attached to every open requisition.'}
            </p>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="attach-req">Requisition</Label>
              {/* Searchable rather than a plain Select: a hiring team can easily
                  carry dozens of open roles, and scrolling a flat list to find
                  one is unusable. Capping the list instead would be worse — it
                  would make anything past the cap impossible to attach to. */}
              <Popover open={reqPickerOpen} onOpenChange={setReqPickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="attach-req"
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={reqPickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className={attachTarget ? '' : 'text-muted-foreground'}>
                      {attachTarget
                        ? availableRequisitions.find((r) => r._id === attachTarget)?.title
                        : `Search ${availableRequisitions.length} open requisition${availableRequisitions.length === 1 ? '' : 's'}…`}
                    </span>
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type to filter…" />
                    <CommandList>
                      <CommandEmpty>No requisition matches.</CommandEmpty>
                      <CommandGroup>
                        {availableRequisitions.map((r) => (
                          <CommandItem
                            key={r._id}
                            value={r.title}
                            onSelect={() => {
                              setAttachTarget(r._id);
                              setReqPickerOpen(false);
                            }}
                          >
                            <Check className={attachTarget === r._id ? 'opacity-100' : 'opacity-0'} />
                            {r.title}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAttachFor(null)}>Cancel</Button>
            <Button
              onClick={handleAttach}
              disabled={attaching || !attachTarget || availableRequisitions.length === 0}
              className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
            >
              {attaching ? 'Attaching…' : 'Attach'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
