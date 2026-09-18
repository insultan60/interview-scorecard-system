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

const STATUS_BADGE = {
  open: 'bg-green-100 text-green-800 hover:bg-green-100',
  on_hold: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  closed: 'bg-gray-100 text-gray-600 hover:bg-gray-100',
};
const STATUS_LABEL = { open: 'Open', on_hold: 'On Hold', closed: 'Closed' };
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
  location: '',
  jobDescription: '',
  initialScreeningCriteria: [{ criteria: '', requirement: '' }],
  questionnaire: [{ question: '', idealAnswer: '', redFlags: '' }],
  applicationDeadline: '',
  aiScreeningEnabled: true,
  pipelineTemplateId: '',
};

export default function Requisitions() {
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);

  const [requisitions, setRequisitions] = useState([]);
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
        setForm((f) => ({ ...f, questionnaire: questionsList.length ? questionsList : [{ question: '', idealAnswer: '', redFlags: '' }] }));
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
          ? { question: q, idealAnswer: '', redFlags: '' }
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
      questionnaire: [...(Array.isArray(prev.questionnaire) ? prev.questionnaire : []), { question: '', idealAnswer: '', redFlags: '' }],
    }));
  }

  function handleRemoveQuestion(index) {
    setForm((prev) => {
      const current = Array.isArray(prev.questionnaire) ? prev.questionnaire : [];
      const updated = current.filter((_, i) => i !== index);
      return { ...prev, questionnaire: updated.length ? updated : [{ question: '', idealAnswer: '', redFlags: '' }] };
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

    if (!form.title.trim()) {
      toast.error('Requisition Title is required.');
      return;
    }
    if (!form.employmentType) {
      toast.error('Employment Type is required.');
      return;
    }
    if (!form.location.trim()) {
      toast.error('Location is required.');
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
      const item = typeof questionnaireItems[i] === 'string' ? { question: questionnaireItems[i], idealAnswer: '', redFlags: '' } : questionnaireItems[i];
      if (!item || !item.question || !item.question.trim()) {
        toast.error(`Question #${i + 1} text cannot be empty.`);
        return;
      }
      if (!item.idealAnswer || !item.idealAnswer.trim()) {
        toast.error(`Question #${i + 1} ideal answer benchmark cannot be empty.`);
        return;
      }
      if (!item.redFlags || !item.redFlags.trim()) {
        toast.error(`Question #${i + 1} red flags benchmark cannot be empty.`);
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
      const createRes = await api.post('/requisitions', form);
      const requisition = createRes.data.requisition;
      toast.success('Requisition created. Generating scorecard from the JD…');
      await api.post(`/requisitions/${requisition._id}/generate-scorecard`);
      toast.success('Scorecard generated — review and edit below.');
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      loadRequisitions();
      navigate(`/requisitions/${requisition._id}`);

    } catch (error) {
      console.error('Failed to create requisition:', error);
      toast.error(
        error?.response?.data?.message ||
        'Failed to create requisition. Please check all fields.'
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

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)} disabled={!canGoBack}>
            <ArrowLeft />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Requisitions</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading…' : `${requisitions.length} ${statusFilter ? STATUS_LABEL[statusFilter].toLowerCase() : 'total'}`}
            </p>
          </div>
        </div>
        <Button className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90" onClick={() => setCreateOpen(true)}>
          <Plus />
          New Requisition
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
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
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
                  {statusFilter ? `No ${STATUS_LABEL[statusFilter].toLowerCase()} requisitions` : 'No requisitions yet'}
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
                  New Requisition
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
                  <TableHead>Requisition</TableHead>
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
            <DialogTitle>New requisition</DialogTitle>
            <DialogDescription>
              Claude reads the job description to draft stage questions and scoring criteria — the more detail, the better the scorecard.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="req-title">Title <span className="text-red-500">*</span></Label>
                <Input
                  id="req-title" value={form.title} autoFocus
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Sales Executive"
                  required
                />
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

              <div className="space-y-1.5">
                <Label htmlFor="req-location">Location <span className="text-red-500">*</span></Label>
                <Input
                  id="req-location"
                  value={form.location || ''}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Remote, NY, Hybrid..."
                  required
                />
              </div>
            </div>

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
                required
              />
            </div>

            {/* Initial Screening Criteria (Always Shown) */}
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between">
                <Label>Initial Screening Criteria <span className="text-red-500">*</span> ({Array.isArray(form.initialScreeningCriteria) ? form.initialScreeningCriteria.filter((c) => c && (typeof c === 'string' ? c.trim() : (c.criteria || c.requirement))).length : 0} items)</Label>
                <button
                  type="button"
                  onClick={() => togglePromptBox('initialScreeningCriteria')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#d21e2b] hover:underline"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  {promptOpen.initialScreeningCriteria ? 'Close AI Prompt' : 'Generate with AI'}
                </button>
              </div>

              {promptOpen.initialScreeningCriteria && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                      Specify AI Screening Requirements:
                    </span>
                  </div>
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
                  <div className="flex justify-end gap-2">
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
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-500 w-5 text-right flex-shrink-0">{idx + 1}.</span>
                        <Input
                          placeholder={`Criteria ${idx + 1} (e.g. Years of Experience, Technical Degree...)`}
                          value={cObj.criteria || ''}
                          onChange={(e) => handleCriteriaChange(idx, 'criteria', e.target.value)}
                          className="flex-1 bg-white font-medium text-slate-800"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveCriteria(idx)}
                          title="Remove criteria"
                          className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="pl-7">
                        <Label className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider">
                          Requirement Details <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          placeholder="e.g. Minimum 3+ years in B2B SaaS required..."
                          value={cObj.requirement || ''}
                          onChange={(e) => handleCriteriaChange(idx, 'requirement', e.target.value)}
                          className="bg-white text-xs mt-1"
                        />
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
                className="mt-1 text-xs gap-1 border-dashed text-slate-600 hover:text-[#d21e2b]"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Criteria
              </Button>
            </div>

            {/* Application Questionnaire Array */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Application Questionnaire <span className="text-red-500">*</span> ({Array.isArray(form.questionnaire) ? form.questionnaire.filter(Boolean).length : 0} questions)</Label>
                <button
                  type="button"
                  onClick={() => togglePromptBox('questionnaire')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#d21e2b] hover:underline"
                >
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  {promptOpen.questionnaire ? 'Close AI Prompt' : 'Generate with AI'}
                </button>
              </div>

              {promptOpen.questionnaire && (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                      Specify AI Questionnaire Instructions:
                    </span>
                  </div>
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
                  <div className="flex justify-end gap-2">
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
                {(Array.isArray(form.questionnaire) ? form.questionnaire : [{ question: '', idealAnswer: '', redFlags: '' }]).map((q, idx) => {
                  const qObj = typeof q === 'string' ? { question: q, idealAnswer: '', redFlags: '' } : q;
                  return (
                    <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-500 w-5 text-right flex-shrink-0">{idx + 1}.</span>
                        <Input
                          placeholder={`Question ${idx + 1} text...`}
                          value={qObj.question || ''}
                          onChange={(e) => handleQuestionChange(idx, 'question', e.target.value)}
                          className="flex-1 bg-white font-medium text-slate-800"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveQuestion(idx)}
                          title="Remove question"
                          className="h-9 w-9 text-slate-400 hover:text-red-600 hover:bg-red-50 flex-shrink-0"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pl-7">
                        <div>
                          <Label className="text-[11px] font-semibold text-emerald-700 uppercase tracking-wider">
                            Ideal Answer Benchmark (5 Stars) <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            placeholder="e.g. 3+ yrs B2B SaaS experience..."
                            value={qObj.idealAnswer || ''}
                            onChange={(e) => handleQuestionChange(idx, 'idealAnswer', e.target.value)}
                            className="bg-white text-xs mt-1 border-emerald-200 focus:border-emerald-500"
                          />
                        </div>
                        <div>
                          <Label className="text-[11px] font-semibold text-red-700 uppercase tracking-wider">
                            Red Flags Benchmark (1-2 Stars) <span className="text-red-500">*</span>
                          </Label>
                          <Input
                            placeholder="e.g. Under 1 yr or B2C experience..."
                            value={qObj.redFlags || ''}
                            onChange={(e) => handleQuestionChange(idx, 'redFlags', e.target.value)}
                            className="bg-white text-xs mt-1 border-red-200 focus:border-red-500"
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
                className="mt-1 text-xs gap-1 border-dashed text-slate-600 hover:text-[#d21e2b]"
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
