import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Plus, ArrowLeft, Search, X, Briefcase, ChevronRight, Check, ChevronsUpDown, Users, Sparkles, Copy, Link2, Trash2,
} from 'lucide-react';
import api from '../hooks/useApi';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '../utils/formatters';

const PAGE_SIZE = 10;
const JOB_TITLE_MIN_LENGTH = 5;

const normalizeJobTitle = (title) => title.replace(/[\s\u200B-\u200D\uFEFF]+/g, ' ').trim();
const isBlankField = (value) => typeof value !== 'string' || !value.trim();

const STATUS_BADGE = {
  open: 'bg-green-100 text-green-800 hover:bg-green-100',
  paused: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  on_hold: 'bg-amber-100 text-amber-800 hover:bg-amber-100', // legacy records
  closed: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
  draft: 'bg-slate-100 text-slate-700 hover:bg-slate-100',
};
const STATUS_LABEL = { open: 'Open', paused: 'Paused', on_hold: 'Paused', closed: 'Closed', draft: 'Draft' };
const EMPLOYMENT_TYPE_LABEL = {
  full_time: 'Full-Time',
  part_time: 'Part-Time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
};

const EMPTY_FORM = {
  title: '',
  employmentType: 'full_time',
  fullTimeDetails: { workingHours: '' },
  partTimeDetails: { weeklyHours: '', workingHours: '' },
  contractDetails: { duration: '', workingHours: '', paymentRate: '' },
  internshipDetails: { duration: '', paidStatus: 'paid', workingHours: '' },
  temporaryDetails: { startDate: '', endDate: '', workingHours: '' },
  workplaceType: 'remote',
  officeLocation: '',
  remoteRegion: '',
  jobDescription: '',
  initialScreeningCriteria: [{ criteria: '', requirement: '' }],
  questionnaire: [{ question: '', idealAnswer: '' }],
  applicationDeadline: '',
  aiScreeningEnabled: true,
  pipelineTemplateId: '',
  status: 'open',
};

export default function Requisitions() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);

  const [requisitions, setRequisitions] = useState([]);
  const [officeLocations, setOfficeLocations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [generatingField, setGeneratingField] = useState({});
  const [promptOpen, setPromptOpen] = useState({});
  const [fieldPrompts, setFieldPrompts] = useState({});
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  function togglePromptBox(fieldType) {
    if (fieldType === 'jobDescription') {
      if (!form.title.trim()) {
        toast.error('Please enter a Job Title first so AI has context.');
        return;
      }
    } else if (fieldType === 'initialScreeningCriteria' || fieldType === 'questionnaire') {
      if (!form.jobDescription.trim()) {
        toast.error('Please enter or generate a Job Description first so AI has context.');
        return;
      }
    }
    setPromptOpen((prev) => ({ ...prev, [fieldType]: !prev[fieldType] }));
  }

  async function handleRunFieldAiGeneration(fieldType) {
    if (fieldType === 'jobDescription') {
      if (!form.title.trim()) {
        toast.error('Please enter a Job Title first so AI has context.');
        return;
      }
    } else if (fieldType === 'initialScreeningCriteria' || fieldType === 'questionnaire') {
      if (!form.jobDescription.trim()) {
        toast.error('Please enter or generate a Job Description first so AI has context.');
        return;
      }
    }

    const userInstruction = fieldPrompts[fieldType] || '';

    setGeneratingField((prev) => ({ ...prev, [fieldType]: true }));
    try {
      const res = await api.post('/requisitions/generate-field', {
        fieldType,
        title: form.title,
        jobDescription: form.jobDescription,
        prompt: userInstruction,
      });

      if (fieldType === 'questionnaire') {
        const questionsList = res.data.questions || [];
        setForm((f) => ({ ...f, questionnaire: questionsList.length ? questionsList : [{ question: '', idealAnswer: '' }] }));
      } else if (fieldType === 'initialScreeningCriteria') {
        const criteriaList = res.data.criteria || [];
        setForm((f) => ({ ...f, initialScreeningCriteria: criteriaList.length ? criteriaList : [{ criteria: '', requirement: '' }] }));
      } else {
        setForm((f) => ({ ...f, [fieldType]: res.data.content || '' }));
      }
      setPromptOpen((prev) => ({ ...prev, [fieldType]: false }));
      toast.success('Generated content with AI!');
    } catch (err) {
      console.error(`Field generation error for ${fieldType}:`, err);
      toast.error(err?.response?.data?.message || `Failed to generate ${fieldType}.`);
    } finally {
      setGeneratingField((prev) => ({ ...prev, [fieldType]: false }));
    }
  }

  function handleCriteriaChange(index, field, value) {
    setForm((prev) => {
      const current = Array.isArray(prev.initialScreeningCriteria) ? prev.initialScreeningCriteria : [];
      const updated = current.map((c, i) => {
        if (i !== index) return c;
        const cObj = typeof c === 'string'
          ? { criteria: c, requirement: '' }
          : { ...c };
        cObj[field] = value;
        return cObj;
      });
      return { ...prev, initialScreeningCriteria: updated };
    });
  }

  function handleAddCriteria() {
    setForm((prev) => ({
      ...prev,
      initialScreeningCriteria: [...(Array.isArray(prev.initialScreeningCriteria) ? prev.initialScreeningCriteria : []), { criteria: '', requirement: '' }],
    }));
  }

  function handleRemoveCriteria(index) {
    setForm((prev) => {
      const current = Array.isArray(prev.initialScreeningCriteria) ? prev.initialScreeningCriteria : [];
      const updated = current.filter((_, i) => i !== index);
      return { ...prev, initialScreeningCriteria: updated.length ? updated : [{ criteria: '', requirement: '' }] };
    });
  }

  function handleQuestionChange(index, field, value) {
    setForm((prev) => {
      const current = Array.isArray(prev.questionnaire) ? prev.questionnaire : [];
      const updated = current.map((q, i) => {
        if (i !== index) return q;
        const qObj = typeof q === 'string'
          ? { question: q, idealAnswer: '' }
          : { ...q };
        qObj[field] = value;
        return qObj;
      });
      return { ...prev, questionnaire: updated };
    });
  }

  function handleAddQuestion() {
    setForm((prev) => ({
      ...prev,
      questionnaire: [...(Array.isArray(prev.questionnaire) ? prev.questionnaire : []), { question: '', idealAnswer: '' }],
    }));
  }

  function handleRemoveQuestion(index) {
    setForm((prev) => {
      const current = Array.isArray(prev.questionnaire) ? prev.questionnaire : [];
      const updated = current.filter((_, i) => i !== index);
      return { ...prev, questionnaire: updated.length ? updated : [{ question: '', idealAnswer: '' }] };
    });
  }

  function copyApplyLink(reqId, e) {
    if (e) e.stopPropagation();
    const url = `${window.location.origin}/apply/${reqId}`;
    navigator.clipboard.writeText(url);
    toast.success('Candidate application link copied to clipboard!');
  }

  async function loadRequisitions() {
    setLoading(true);
    try {
      const res = await api.get('/requisitions', { params: statusFilter ? { status: statusFilter } : {} });
      setRequisitions(res.data.requisitions);
      setOfficeLocations(res.data.registeredOfficeLocations || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRequisitions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  useEffect(() => {
    api.get('/pipelines').then((res) => setTemplates(res.data.templates));
  }, []);

  async function handleCreate(e) {
    e.preventDefault();
    const normalizedTitle = normalizeJobTitle(form.title);

    if (!normalizedTitle) {
      toast.error('Job Opening Title is required.');
      return;
    }
    if (normalizedTitle.length < JOB_TITLE_MIN_LENGTH) {
      toast.error(`Job Opening Title must be at least ${JOB_TITLE_MIN_LENGTH} characters.`);
      return;
    }
    if (!form.employmentType) {
      toast.error('Employment Type is required.');
      return;
    }
    const employmentValidation = {
      full_time: [['fullTimeDetails', 'workingHours', 'Full-Time working hours']],
      part_time: [['partTimeDetails', 'weeklyHours', 'Part-Time weekly hours'], ['partTimeDetails', 'workingHours', 'Part-Time working hours']],
      contract: [['contractDetails', 'duration', 'Contract duration'], ['contractDetails', 'workingHours', 'Contract working hours'], ['contractDetails', 'paymentRate', 'Contract payment/rate']],
      internship: [['internshipDetails', 'duration', 'Internship duration'], ['internshipDetails', 'workingHours', 'Internship working hours']],
      temporary: [['temporaryDetails', 'startDate', 'Temporary role start date'], ['temporaryDetails', 'endDate', 'Temporary role end date'], ['temporaryDetails', 'workingHours', 'Temporary role working hours']],
    };
    for (const [group, field, label] of employmentValidation[form.employmentType] || []) {
      if (isBlankField(form[group]?.[field])) {
        toast.error(`${label} is required.`);
        return;
      }
    }
    if (form.employmentType === 'temporary' && form.temporaryDetails.endDate < form.temporaryDetails.startDate) {
      toast.error('Temporary role end date must be after the start date.');
      return;
    }
    if (!form.workplaceType) {
      toast.error('Work arrangement is required.');
      return;
    }
    if (form.workplaceType === 'onsite' && !officeLocations[0]) {
      toast.error('Add a registered office location before creating an onsite job opening.');
      return;
    }
    if (form.workplaceType === 'hybrid' && !form.officeLocation) {
      toast.error('Select an office location for a hybrid job opening.');
      return;
    }
    if (!form.jobDescription.trim()) {
      toast.error('Job Description is required.');
      return;
    }

    // Validate Criteria items
    const criteriaItems = Array.isArray(form.initialScreeningCriteria) ? form.initialScreeningCriteria : [];
    if (criteriaItems.length === 0) {
      toast.error('At least one Initial Screening Criteria item is required.');
      return;
    }
    for (let i = 0; i < criteriaItems.length; i++) {
      const item = typeof criteriaItems[i] === 'string' ? { criteria: criteriaItems[i], requirement: '' } : criteriaItems[i];
      if (!item || !item.criteria || !item.criteria.trim()) {
        toast.error(`Criteria #${i + 1} name cannot be empty.`);
        return;
      }
      if (!item.requirement || !item.requirement.trim()) {
        toast.error(`Criteria #${i + 1} requirement details cannot be empty.`);
        return;
      }
    }

    // Validate Questionnaire items
    const questionnaireItems = Array.isArray(form.questionnaire) ? form.questionnaire : [];
    if (questionnaireItems.length === 0) {
      toast.error('At least one Application Questionnaire item is required.');
      return;
    }
    for (let i = 0; i < questionnaireItems.length; i++) {
      const item = typeof questionnaireItems[i] === 'string' ? { question: questionnaireItems[i], idealAnswer: '' } : questionnaireItems[i];
      if (!item || !item.question || !item.question.trim()) {
        toast.error(`Question #${i + 1} text cannot be empty.`);
        return;
      }
      if (!item.idealAnswer || !item.idealAnswer.trim()) {
        toast.error(`Question #${i + 1} ideal answer benchmark cannot be empty.`);
        return;
      }
    }

    if (!form.applicationDeadline) {
      toast.error('Application Deadline date is required.');
      return;
    }

    if (!form.pipelineTemplateId) {
      toast.error('Pipeline Template is required.');
      return;
    }

    setCreating(true);
    try {
      const createRes = await api.post('/requisitions', { ...form, title: normalizedTitle });
      const requisition = createRes.data.requisition;
      if (createRes.data.warning) toast(createRes.data.warning, { icon: '⚠️' });
      if (requisition.status !== 'closed') {
        toast.success('Job Opening created. Generating scorecard from the JD…');
        await api.post(`/requisitions/${requisition._id}/generate-scorecard`);
        toast.success('Scorecard generated — review and edit below.');
      } else {
        toast.success('Closed job opening created. Reopen it before generating a scorecard.');
      }
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      loadRequisitions();
      navigate(`/requisitions/${requisition._id}`);

    } catch (error) {
      console.error('Failed to create job opening:', error);
      toast.error(
        error?.response?.data?.message ||
        'Failed to create job opening. Please check all fields.'
      );
    } finally {
      setCreating(false);
    }
  }

  const query = search.trim().toLowerCase();
  const filtered = useMemo(() => (
    query ? requisitions.filter((r) => (r.title || '').toLowerCase().includes(query)) : requisitions
  ), [requisitions, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const selectedTemplate = templates.find((t) => t._id === form.pipelineTemplateId);
  const normalizedFormTitle = normalizeJobTitle(form.title);
  const duplicateActiveOpening = form.status === 'open' && normalizedFormTitle && requisitions.some((r) => (
    r.status === 'open' && normalizeJobTitle(r.title || '').toLowerCase() === normalizedFormTitle.toLowerCase()
  ));

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Job Openings</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : `${requisitions.length} ${statusFilter ? STATUS_LABEL[statusFilter].toLowerCase() : 'total'}`}
            </p>
          </div>
        </div>
        <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
          <Plus />
          New Job Opening
        </Button>
      </div>

      {/* ---------- toolbar ---------- */}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by title…"
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
        <Select
          value={statusFilter || 'all'}
          onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1); }}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ---------- list ---------- */}
      <Card className="mt-4">
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-56" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : requisitions.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {statusFilter ? `No ${STATUS_LABEL[statusFilter].toLowerCase()} job openings` : 'No job opening yet'}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {statusFilter
                    ? 'Try a different status filter.'
                    : 'Paste a job description and Claude will draft the scorecard for you.'}
                </p>
              </div>
              {!statusFilter && (
                <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
                  <Plus />
                  New Job Opening
                </Button>
              )}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-foreground">No matches for “{search}”</p>
              <p className="mt-1 text-sm text-muted-foreground">Try a different title.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job Opening</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Candidates</TableHead>
                  <TableHead>Pipeline</TableHead>
                  <TableHead className="hidden lg:table-cell">Created</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map((r) => {
                  const stats = r.candidateStats || { total: 0, inProgress: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 };
                  const enabledStages = (r.stages || []).filter((s) => s.enabled).length;
                  return (
                    <TableRow
                      key={r._id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/requisitions/${r._id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-foreground">{r.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {EMPLOYMENT_TYPE_LABEL[r.employmentType] || 'Full-Time'}
                              {r.location ? ` · ${r.location}` : ''}
                              {` · ${enabledStages} stage${enabledStages === 1 ? '' : 's'}`}
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            title="Copy Candidate Application Link"
                            onClick={(e) => copyApplyLink(r._id, e)}
                            className="h-8 text-xs gap-1 text-slate-600 hover:text-[#d21e2b] hover:bg-slate-100"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            Apply Link
                          </Button>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Badge variant="secondary" className={`font-normal ${STATUS_BADGE[r.status] || ''}`}>
                          {STATUS_LABEL[r.status] || r.status}
                        </Badge>
                      </TableCell>

                      <TableCell>
                        {stats.total === 0 ? (
                          <span className="text-xs text-muted-foreground">None yet</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                              <Users className="h-3.5 w-3.5 text-muted-foreground" />
                              {stats.total}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {stats.inProgress > 0 ? `${stats.inProgress} in progress` : 'all decided'}
                              {stats.HIRE > 0 ? ` · ${stats.HIRE} hire` : ''}
                            </span>
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-sm text-muted-foreground">
                        {r?.pipelineTemplateName}
                      </TableCell>

                      <TableCell className="hidden whitespace-nowrap text-sm text-muted-foreground lg:table-cell">
                        {formatDate(r.createdAt)}
                      </TableCell>

                      <TableCell>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  );
                })}
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

      {/* ---------- create dialog ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New job opening</DialogTitle>
          </DialogHeader>

          <form noValidate onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="req-title">Title <span className="text-red-500">*</span></Label>
                <Input
                  id="req-title" value={form.title} autoFocus
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Sales Executive (at least 5 characters)"
                />
                {duplicateActiveOpening && (
                  <p className="text-xs text-amber-700">
                    An active job opening with this title already exists.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="req-status">Status</Label>
                <Select value={form.status || 'open'} onValueChange={(val) => setForm({ ...form, status: val })}>
                  <SelectTrigger id="req-status" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="req-employment-type">Employment Type <span className="text-red-500">*</span></Label>
              <Select
                value={form.employmentType || 'full_time'}
                onValueChange={(val) => setForm({ ...form, employmentType: val })}
              >
                <SelectTrigger id="req-employment-type" className="w-full">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full-Time</SelectItem>
                  <SelectItem value="part_time">Part-Time</SelectItem>
                  <SelectItem value="contract">Contract</SelectItem>
                  <SelectItem value="internship">Internship</SelectItem>
                  <SelectItem value="temporary">Temporary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.employmentType === 'full_time' && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Full-Time details</p>
                <div className="space-y-1.5">
                  <Label htmlFor="full-time-working-hours">Working hours / shift <span className="text-red-500">*</span></Label>
                  <Input id="full-time-working-hours" value={form.fullTimeDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, fullTimeDetails: { ...form.fullTimeDetails, workingHours: e.target.value } })} placeholder="e.g. 9 AM–6 PM, Monday–Friday" />
                </div>
              </div>
            )}

            {form.employmentType === 'part_time' && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Part-Time details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label htmlFor="part-time-weekly-hours">Weekly hours <span className="text-red-500">*</span></Label><Input id="part-time-weekly-hours" value={form.partTimeDetails?.weeklyHours || ''} onChange={(e) => setForm({ ...form, partTimeDetails: { ...form.partTimeDetails, weeklyHours: e.target.value } })} placeholder="e.g. 20 hours per week" /></div>
                  <div className="space-y-1.5"><Label htmlFor="part-time-working-hours">Working hours / shift <span className="text-red-500">*</span></Label><Input id="part-time-working-hours" value={form.partTimeDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, partTimeDetails: { ...form.partTimeDetails, workingHours: e.target.value } })} placeholder="e.g. 1 PM–5 PM, Mon–Fri" /></div>
                </div>
              </div>
            )}

            {form.employmentType === 'contract' && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Contract details</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5"><Label htmlFor="contract-duration">Duration <span className="text-red-500">*</span></Label><Input id="contract-duration" value={form.contractDetails?.duration || ''} onChange={(e) => setForm({ ...form, contractDetails: { ...form.contractDetails, duration: e.target.value } })} placeholder="e.g. 6 months" /></div>
                  <div className="space-y-1.5"><Label htmlFor="contract-working-hours">Working hours <span className="text-red-500">*</span></Label><Input id="contract-working-hours" value={form.contractDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, contractDetails: { ...form.contractDetails, workingHours: e.target.value } })} placeholder="e.g. 9 AM–6 PM" /></div>
                  <div className="space-y-1.5"><Label htmlFor="contract-payment-rate">Payment / rate <span className="text-red-500">*</span></Label><Input id="contract-payment-rate" value={form.contractDetails?.paymentRate || ''} onChange={(e) => setForm({ ...form, contractDetails: { ...form.contractDetails, paymentRate: e.target.value } })} placeholder="e.g. PKR 150,000/month" /></div>
                </div>
              </div>
            )}

            {form.employmentType === 'internship' && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Internship details</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="internship-duration">Duration <span className="text-red-500">*</span></Label>
                    <Input
                      id="internship-duration"
                      value={form.internshipDetails?.duration || ''}
                      onChange={(e) => setForm({ ...form, internshipDetails: { ...form.internshipDetails, duration: e.target.value } })}
                      placeholder="e.g. 3 months"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="internship-paid-status">Paid status</Label>
                    <Select
                      value={form.internshipDetails?.paidStatus || 'paid'}
                      onValueChange={(val) => setForm({ ...form, internshipDetails: { ...form.internshipDetails, paidStatus: val } })}
                    >
                      <SelectTrigger id="internship-paid-status"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="unpaid">Unpaid</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="internship-working-hours">Working hours <span className="text-red-500">*</span></Label>
                    <Input
                      id="internship-working-hours"
                      value={form.internshipDetails?.workingHours || ''}
                      onChange={(e) => setForm({ ...form, internshipDetails: { ...form.internshipDetails, workingHours: e.target.value } })}
                      placeholder="e.g. 9 AM–5 PM, Mon–Fri"
                    />
                  </div>
                </div>
              </div>
            )}

            {form.employmentType === 'temporary' && (
              <div className="rounded-md border p-3 space-y-3">
                <p className="text-sm font-medium">Temporary role details</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5"><Label htmlFor="temporary-start-date">Start date <span className="text-red-500">*</span></Label><Input id="temporary-start-date" type="date" value={form.temporaryDetails?.startDate || ''} onChange={(e) => setForm({ ...form, temporaryDetails: { ...form.temporaryDetails, startDate: e.target.value } })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="temporary-end-date">End date <span className="text-red-500">*</span></Label><Input id="temporary-end-date" type="date" value={form.temporaryDetails?.endDate || ''} onChange={(e) => setForm({ ...form, temporaryDetails: { ...form.temporaryDetails, endDate: e.target.value } })} /></div>
                  <div className="space-y-1.5"><Label htmlFor="temporary-working-hours">Working hours <span className="text-red-500">*</span></Label><Input id="temporary-working-hours" value={form.temporaryDetails?.workingHours || ''} onChange={(e) => setForm({ ...form, temporaryDetails: { ...form.temporaryDetails, workingHours: e.target.value } })} placeholder="e.g. 9 AM–6 PM, Mon–Fri" /></div>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="req-workplace-type">Work arrangement <span className="text-red-500">*</span></Label>
              <Select
                value={form.workplaceType || 'remote'}
                onValueChange={(val) => setForm((current) => ({
                  ...current,
                  workplaceType: val,
                  officeLocation: val === 'onsite' ? (officeLocations[0] || '') : (val === 'remote' ? '' : current.officeLocation),
                  remoteRegion: val === 'remote' ? current.remoteRegion : '',
                }))}
              >
                <SelectTrigger id="req-workplace-type" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="onsite">Onsite</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                  <SelectItem value="remote">Remote</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.workplaceType === 'onsite' && (
              <div className="space-y-1.5">
                <Label htmlFor="req-onsite-location">Office location</Label>
                <Input
                  id="req-onsite-location"
                  value={officeLocations[0] || 'No registered office location configured'}
                  disabled
                />
                {!officeLocations[0] && (
                  <p className="text-xs text-muted-foreground">Set REGISTERED_OFFICE_LOCATIONS in the server .env file to enable onsite roles.</p>
                )}
              </div>
            )}

            {form.workplaceType === 'hybrid' && (
              <div className="space-y-1.5">
                <Label htmlFor="req-hybrid-location">Office location <span className="text-red-500">*</span></Label>
                <Select
                  value={form.officeLocation || undefined}
                  onValueChange={(val) => setForm({ ...form, officeLocation: val })}
                  disabled={officeLocations.length === 0}
                >
                  <SelectTrigger id="req-hybrid-location" className="w-full">
                    <SelectValue placeholder={officeLocations.length ? 'Select an office...' : 'No registered office location configured'} />
                  </SelectTrigger>
                  <SelectContent>
                    {officeLocations.map((office) => <SelectItem key={office} value={office}>{office}</SelectItem>)}
                  </SelectContent>
                </Select>
                {officeLocations.length === 0 && (
                  <p className="text-xs text-muted-foreground">Set REGISTERED_OFFICE_LOCATIONS in the server .env file to enable hybrid roles.</p>
                )}
              </div>
            )}

            {form.workplaceType === 'remote' && (
              <div className="space-y-1.5">
                <Label htmlFor="req-remote-region">Remote region or time zone <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  id="req-remote-region"
                  value={form.remoteRegion || ''}
                  onChange={(e) => setForm({ ...form, remoteRegion: e.target.value })}
                  placeholder="e.g. Pakistan (PKT), EMEA, US Eastern"
                />
              </div>
            )}

            {/* Job Description with Generate AI button on right */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="req-jd">Job Description <span className="text-red-500">*</span></Label>
                <button
                  type="button"
                  onClick={() => togglePromptBox('jobDescription')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#d21e2b] hover:underline"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  {promptOpen.jobDescription ? 'Close AI Prompt' : 'Generate with AI'}
                </button>
              </div>

              {promptOpen.jobDescription && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                      Specify AI Instructions / Context:
                    </span>
                  </div>
                  <Input
                    placeholder="e.g. Senior role, 5+ yrs React, remote position, competitive pay & stock options..."
                    value={fieldPrompts.jobDescription || ''}
                    onChange={(e) => setFieldPrompts({ ...fieldPrompts, jobDescription: e.target.value })}
                    className="bg-white text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleRunFieldAiGeneration('jobDescription');
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePromptBox('jobDescription')}
                      className="h-7 text-xs text-slate-600"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={generatingField.jobDescription}
                      onClick={() => handleRunFieldAiGeneration('jobDescription')}
                      className="bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white text-xs h-7 gap-1"
                    >
                      <Sparkles className="h-3 w-3" />
                      {generatingField.jobDescription ? 'Generating...' : 'Generate & Insert'}
                    </Button>
                  </div>
                </div>
              )}

              <Textarea
                id="req-jd" rows={5} value={form.jobDescription}
                onChange={(e) => setForm({ ...form, jobDescription: e.target.value })}
                placeholder="Paste or generate the full job description here…"
              />
            </div>

            {/* Initial Screening Criteria */}
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-semibold text-slate-900">Initial Screening Criteria</Label>
                    <span className="text-red-500 font-semibold">*</span>
                    <Badge variant="outline" className="text-[11px] font-normal text-slate-600 bg-slate-50">
                      {Array.isArray(form.initialScreeningCriteria) ? form.initialScreeningCriteria.length : 0} {Array.isArray(form.initialScreeningCriteria) && form.initialScreeningCriteria.length === 1 ? 'item' : 'items'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Mandatory qualifications used by AI to evaluate candidate fit.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => togglePromptBox('initialScreeningCriteria')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#d21e2b] hover:underline pt-0.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  {promptOpen.initialScreeningCriteria ? 'Close AI Prompt' : 'Generate with AI'}
                </button>
              </div>

              {promptOpen.initialScreeningCriteria && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                  <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                    AI Screening Criteria Instructions:
                  </span>
                  <Input
                    placeholder="e.g. Must have 3+ yrs React, Computer Science degree, sales background..."
                    value={fieldPrompts.initialScreeningCriteria || ''}
                    onChange={(e) => setFieldPrompts({ ...fieldPrompts, initialScreeningCriteria: e.target.value })}
                    className="bg-white text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleRunFieldAiGeneration('initialScreeningCriteria');
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2 pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePromptBox('initialScreeningCriteria')}
                      className="h-7 text-xs text-slate-600"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={generatingField.initialScreeningCriteria}
                      onClick={() => handleRunFieldAiGeneration('initialScreeningCriteria')}
                      className="bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white text-xs h-7 gap-1"
                    >
                      <Sparkles className="h-3 w-3" />
                      {generatingField.initialScreeningCriteria ? 'Generating...' : 'Generate & Insert'}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {(Array.isArray(form.initialScreeningCriteria) ? form.initialScreeningCriteria : [{ criteria: '', requirement: '' }]).map((c, idx) => {
                  const cObj = typeof c === 'string' ? { criteria: c, requirement: '' } : c;
                  return (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3 shadow-sm relative">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">Criteria Item #{idx + 1}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveCriteria(idx)}
                          title="Remove criteria"
                          className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">
                            Category / Title <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            placeholder="e.g. Years of Experience, Education..."
                            value={cObj.criteria || ''}
                            onChange={(e) => handleCriteriaChange(idx, 'criteria', e.target.value)}
                            className="bg-white text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">
                            Requirement Details <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            placeholder="e.g. Minimum 3+ years in B2B SaaS required..."
                            value={cObj.requirement || ''}
                            onChange={(e) => handleCriteriaChange(idx, 'requirement', e.target.value)}
                            className="bg-white text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddCriteria}
                className="text-xs gap-1.5 border-dashed border-slate-300 text-slate-700 hover:text-[#d21e2b] hover:border-[#d21e2b] w-full sm:w-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Screening Criteria
              </Button>
            </div>

            {/* Application Questionnaire */}
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <Label className="text-sm font-semibold text-slate-900">Application Questionnaire</Label>
                    <span className="text-red-500 font-semibold">*</span>
                    <Badge variant="outline" className="text-[11px] font-normal text-slate-600 bg-slate-50">
                      {Array.isArray(form.questionnaire) ? form.questionnaire.length : 0} {Array.isArray(form.questionnaire) && form.questionnaire.length === 1 ? 'question' : 'questions'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Questions asked on the public application form with ideal benchmarks for scoring.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => togglePromptBox('questionnaire')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#d21e2b] hover:underline pt-0.5"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  {promptOpen.questionnaire ? 'Close AI Prompt' : 'Generate with AI'}
                </button>
              </div>

              {promptOpen.questionnaire && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 space-y-2">
                  <span className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                    AI Questionnaire Instructions:
                  </span>
                  <Input
                    placeholder="e.g. Generate 5 technical React & System Design questions..."
                    value={fieldPrompts.questionnaire || ''}
                    onChange={(e) => setFieldPrompts({ ...fieldPrompts, questionnaire: e.target.value })}
                    className="bg-white text-xs"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleRunFieldAiGeneration('questionnaire');
                      }
                    }}
                  />
                  <div className="flex justify-end gap-2 pt-0.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => togglePromptBox('questionnaire')}
                      className="h-7 text-xs text-slate-600"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={generatingField.questionnaire}
                      onClick={() => handleRunFieldAiGeneration('questionnaire')}
                      className="bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white text-xs h-7 gap-1"
                    >
                      <Sparkles className="h-3 w-3" />
                      {generatingField.questionnaire ? 'Generating...' : 'Generate & Insert'}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {(Array.isArray(form.questionnaire) ? form.questionnaire : [{ question: '', idealAnswer: '' }]).map((q, idx) => {
                  const qObj = typeof q === 'string' ? { question: q, idealAnswer: '' } : q;
                  return (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-3 shadow-sm relative">
                      <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">
                            {idx + 1}
                          </span>
                          <span className="text-xs font-semibold text-slate-700">Question #{idx + 1}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveQuestion(idx)}
                          title="Remove question"
                          className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="space-y-2.5">
                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">
                            Question Text <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            placeholder={`e.g. What experience do you have with modern web frameworks?`}
                            value={qObj.question || ''}
                            onChange={(e) => handleQuestionChange(idx, 'question', e.target.value)}
                            className="bg-white text-xs"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs font-medium text-slate-700">
                            Ideal Answer <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            placeholder="e.g. 3+ yrs experience building production apps with React/Next.js..."
                            value={qObj.idealAnswer || ''}
                            onChange={(e) => handleQuestionChange(idx, 'idealAnswer', e.target.value)}
                            className="bg-white text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddQuestion}
                className="text-xs gap-1.5 border-dashed border-slate-300 text-slate-700 hover:text-[#d21e2b] hover:border-[#d21e2b] w-full sm:w-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Question
              </Button>
            </div>

            {/* Application Deadline & AI Screening Toggle */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="req-deadline">Application Deadline <span className="text-red-500">*</span></Label>
                <Input
                  id="req-deadline"
                  type="date"
                  value={form.applicationDeadline}
                  onChange={(e) => setForm({ ...form, applicationDeadline: e.target.value })}
                />
              </div>

              <div className="flex items-center space-x-2 pt-6">
                <Checkbox
                  id="req-ai-screening"
                  checked={form.aiScreeningEnabled}
                  onCheckedChange={(checked) => setForm({ ...form, aiScreeningEnabled: Boolean(checked) })}
                />
                <Label htmlFor="req-ai-screening" className="text-sm font-medium cursor-pointer">
                  Enable Automated AI Screening
                </Label>
              </div>
            </div>

            {/* Pipeline template picker */}
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="req-template">Pipeline template <span className="text-red-500">*</span></Label>
              <Popover open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    id="req-template" type="button" variant="outline" role="combobox"
                    aria-expanded={templatePickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    <span className={selectedTemplate ? '' : 'text-muted-foreground'}>
                      {selectedTemplate
                        ? `${selectedTemplate.name}${selectedTemplate.isDefault ? ' (default)' : ''}`
                        : 'Choose a pipeline…'}
                    </span>
                    <ChevronsUpDown className="opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type to filter…" />
                    <CommandList>
                      <CommandEmpty>No pipeline matches.</CommandEmpty>
                      <CommandGroup>
                        {templates.map((t) => {
                          const stageCount = (t.stages || []).filter((s) => s.enabled).length;
                          return (
                            <CommandItem
                              key={t._id}
                              value={t.name}
                              onSelect={() => {
                                setForm((f) => ({ ...f, pipelineTemplateId: t._id }));
                                setTemplatePickerOpen(false);
                              }}
                            >
                              <Check className={form.pipelineTemplateId === t._id ? 'opacity-100' : 'opacity-0'} />
                              <span className="flex-1">{t.name}{t.isDefault ? ' (default)' : ''}</span>
                              <span className="text-xs text-muted-foreground">{stageCount} stages</span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {selectedTemplate && (
                <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={creating} className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90">
                {creating ? 'Creating & generating…' : 'Create & generate scorecard'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
