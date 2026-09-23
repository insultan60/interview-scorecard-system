import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Search, X, Users, Link2 } from 'lucide-react';
import api from '../hooks/useApi';
import PipelineStepper from '../components/PipelineStepper';
import ScorecardEditor from '../components/ScorecardEditor';
import CandidateRankTable from '../components/CandidateRankTable';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { formatDisposition } from '../utils/formatters';

const DISPOSITION_BADGE = {
  HIRE: 'bg-green-100 text-green-800 hover:bg-green-100',
  MAYBE: 'bg-amber-100 text-amber-800 hover:bg-amber-100',
  NO_HIRE: 'bg-red-100 text-red-800 hover:bg-red-100',
};

const STATUS_LABEL = { open: 'Open', on_hold: 'On Hold', closed: 'Closed' };
const CANDIDATE_PAGE_SIZE = 5;

export default function RequisitionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [canGoBack] = useState(() => typeof window !== 'undefined' && window.history.state?.idx > 0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingScorecard, setSavingScorecard] = useState(false);
  const [goingToInterview, setGoingToInterview] = useState(null);
  const [stageLinksByApp, setStageLinksByApp] = useState({});
  const [ranking, setRanking] = useState([]);
  const [savingStatus, setSavingStatus] = useState(false);
  const [candidatePage, setCandidatePage] = useState(1);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [dispositionFilter, setDispositionFilter] = useState('all');
  const [pendingClose, setPendingClose] = useState(false);

  const [overrideModalApp, setOverrideModalApp] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  async function handleOverrideInitialScreening(passed) {
    if (!overrideModalApp) return;
    setSavingOverride(true);
    try {
      await api.patch(`/scoring/application/${overrideModalApp._id}/override-initial-screening`, {
        passed,
        reason: overrideReason || (passed ? 'HR Manual Approval' : 'HR Manual Rejection'),
      });
      toast.success(passed ? 'Initial screening passed! Candidate advanced to Stage 1.' : 'Candidate marked as rejected.');
      setOverrideModalApp(null);
      setOverrideReason('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not override initial screening.');
    } finally {
      setSavingOverride(false);
    }
  }

  function handleCandidateSearchChange(value) {
    setCandidateSearch(value);
    setCandidatePage(1);
  }

  function handleDispositionFilterChange(value) {
    setDispositionFilter(value);
    setCandidatePage(1);
  }

  async function load() {
    setLoading(true);
    try {
      const res = await api.get(`/requisitions/${id}`);
      setData(res.data);

      console.log(res.data);

      const { data: interviewData } = await api.get('/interviews', { params: { requisitionId: id } });
      const byApp = {};
      interviewData.interviews.forEach((iv) => {
        if (!byApp[iv.applicationId]) byApp[iv.applicationId] = {};
        byApp[iv.applicationId][iv.stageKey] = iv._id;
      });
      setStageLinksByApp(byApp);

      const { data: rankingData } = await api.get(`/requisitions/${id}/ranking`);
      setRanking(rankingData.ranking);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSaveScorecard(stages) {
    const hasEmptyStage = stages.some((s) => !s.attributes || s.attributes.length === 0);
    if (hasEmptyStage) {
      toast.error('Each stage must have at least one question.');
      return;
    }
    setSavingScorecard(true);
    try {
      await api.patch(`/requisitions/${id}/scorecard`, { stages });
      toast.success('Scorecard saved.');
    } finally {
      setSavingScorecard(false);
    }
  }

  async function handleGoToInterview(app) {
    if (data?.requisition?.status !== 'open') {
      toast.error(data?.requisition?.status === 'on_hold'
        ? 'This job opening is on hold. Reopen it before starting a new interview stage.'
        : 'This job opening is closed and cannot start new interview stages.');
      return;
    }
    const enabledList = (requisition?.stages || []).filter((s) => s.enabled);
    const allStagesPassed = enabledList.length > 0 && enabledList.every((s) => {
      const p = (app.stageProgress || []).find((pr) => pr.stageKey === s.key);
      return p && (p.passed === true || p.status === 'passed' || p.status === 'approved');
    });

    if (app.disposition === 'NO_HIRE' || (app.stageProgress || []).some((p) => p.status === 'failed')) {
      toast.error('This candidate has failed a stage and cannot proceed.');
      return;
    }
    if (allStagesPassed) {
      toast.error('This candidate has passed all stages.');
      return;
    }
    if (!app.currentStageKey) {
      toast.error('This candidate has no remaining stage — check their pipeline status.');
      return;
    }
    setGoingToInterview(app._id);
    try {
      const res = await api.post(
        '/interviews',
        { applicationId: app._id, stageKey: app.currentStageKey },
        { validateStatus: () => true }
      );
      if (res.status === 201) {
        navigate(`/interview/${res.data.interview._id}`);
      } else if (res.status === 409 && res.data?.interviewId) {
        // Duplicate interview — open the one that already exists. Out-of-order
        // stage attempts also return 409, but carry no interviewId; those fall
        // through so their "Stage X must be approved first" message is shown.
        navigate(`/interview/${res.data.interviewId}`);
      } else {
        toast.error(res.data?.message || 'Could not open interview.');
      }
    } finally {
      setGoingToInterview(null);
    }
  }

  async function applyStatus(newStatus) {
    setSavingStatus(true);
    try {
      await api.patch(`/requisitions/${id}`, { status: newStatus });
      toast.success(`Requisition marked ${STATUS_LABEL[newStatus].toLowerCase()}.`);
      load();
    } finally {
      setSavingStatus(false);
    }
  }

  function handleStatusChange(newStatus) {
    if (newStatus === data?.requisition?.status) return;
    // Closing starts the retention countdown — confirm before it's irreversible.
    if (newStatus === 'closed') { setPendingClose(true); return; }
    applyStatus(newStatus);
  }

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 flex-shrink-0" />
          <Skeleton className="h-7 w-56" />
        </div>
        <Skeleton className="mt-3 h-7 w-40" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="mt-6">
            <CardContent className="space-y-3 p-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (!data) return <div className="text-muted-foreground">Job Opening not found.</div>;

  const { requisition, scorecard, applications } = data;
  const canStartNewWork = requisition.status === 'open';
  const stageLabels = Object.fromEntries(requisition.stages.map((s) => [s.key, s.label]));
  const candidateQuery = candidateSearch.trim().toLowerCase();
  const filteredApplications = applications.filter((app) => {
    if (dispositionFilter === 'in_progress' && app.disposition) return false;
    if (dispositionFilter !== 'all' && dispositionFilter !== 'in_progress' && app.disposition !== dispositionFilter) return false;
    if (candidateQuery) {
      const name = (app.candidateId?.name || '').toLowerCase();
      const email = (app.candidateId?.email || '').toLowerCase();
      if (!name.includes(candidateQuery) && !email.includes(candidateQuery)) return false;
    }
    return true;
  });
  const totalCandidatePages = Math.max(1, Math.ceil(filteredApplications.length / CANDIDATE_PAGE_SIZE));
  const safeCandidatePage = Math.min(candidatePage, totalCandidatePages);
  const paginatedApplications = filteredApplications.slice(
    (safeCandidatePage - 1) * CANDIDATE_PAGE_SIZE,
    safeCandidatePage * CANDIDATE_PAGE_SIZE
  );
  const enabledStages = requisition.stages.filter((s) => s.enabled).length;

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="flex items-start gap-3">
        <Button variant="outline" size="icon" className="flex-shrink-0" onClick={() => navigate(-1)} disabled={!canGoBack}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold leading-tight text-foreground sm:text-2xl">{requisition.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {enabledStages} stage{enabledStages === 1 ? '' : 's'} · {applications.length} candidate{applications.length === 1 ? '' : 's'}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Status</span>
          <Select value={requisition.status} onValueChange={handleStatusChange} disabled={savingStatus}>
            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const url = `${window.location.origin}/apply/${requisition._id}`;
            navigator.clipboard.writeText(url);
            toast.success('Public candidate application link copied to clipboard!');
          }}
          disabled={!canStartNewWork}
          className="h-8 text-xs gap-1.5 text-slate-700 hover:text-[#d21e2b]"
        >
          <Link2 className="h-3.5 w-3.5 text-[#d21e2b]" />
          Copy Candidate Apply Link
        </Button>
      </div>

      {!canStartNewWork && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {requisition.status === 'on_hold'
            ? 'This job opening is on hold. New candidate attachments and interview stages are paused; existing interviews can still be completed.'
            : 'This job opening is closed and read-only. Reopen it to make changes or start new interview stages.'}
        </div>
      )}

      {/* ---------- candidates ---------- */}
      <Card className="mt-6">
        <CardHeader className="space-y-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <CardTitle>Candidates</CardTitle>
          {applications.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={dispositionFilter} onValueChange={handleDispositionFilterChange}>
                <SelectTrigger className="h-8 w-full text-xs sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="HIRE">Hire</SelectItem>
                  <SelectItem value="MAYBE">Maybe</SelectItem>
                  <SelectItem value="NO_HIRE">No Hire</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={candidateSearch}
                  onChange={(e) => handleCandidateSearchChange(e.target.value)}
                  placeholder="Search by name or email…"
                  className="h-8 pl-8 pr-8 text-xs"
                />
                {candidateSearch && (
                  <button
                    type="button"
                    onClick={() => handleCandidateSearchChange('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => navigate('/candidates')}>
                Go to Candidates
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
                <Users className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No candidates yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Attach someone from the Candidates page to start interviewing.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate('/candidates')}>Go to Candidates</Button>
            </div>
          ) : filteredApplications.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {candidateQuery ? `No candidates match “${candidateSearch}”.` : 'No candidates match this filter.'}
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {paginatedApplications.map((app) => {
                const appLinks = stageLinksByApp[app._id] || {};
                const progressMap = Object.fromEntries(
                  (requisition?.stages || []).map((stage) => {
                    const p = (app.stageProgress || []).find((pr) => pr.stageKey === stage.key);
                    const interviewId = appLinks[stage.key];
                    const threshold = stage.passThreshold ?? 3;
                    const isFailed = p?.passed === false || p?.status === 'failed';
                    const isPassed = !isFailed && (p?.passed === true || p?.status === 'passed' || (p?.status === 'approved' && p?.passed !== false));
                    let status = isFailed ? 'failed' : isPassed ? 'passed' : p?.status || (interviewId ? 'scheduled' : 'pending');
                    return [stage.key, { stageKey: stage.key, status, passed: isFailed ? false : isPassed ? true : p?.passed }];
                  })
                );
                const enabledList = (requisition?.stages || []).filter((s) => s.enabled);
                const allStagesPassed = enabledList.length > 0 && enabledList.every((s) => {
                  const p = (app.stageProgress || []).find((pr) => pr.stageKey === s.key);
                  return p && (p.passed === true || p.status === 'passed' || p.status === 'approved');
                });
                const hasFailed = app.disposition === 'NO_HIRE' || (app.stageProgress || []).some((p) => p.status === 'failed');
                const isGoDisabled = !canStartNewWork || goingToInterview === app._id || !app.currentStageKey || hasFailed || allStagesPassed;

                return (
                  <li key={app._id} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:gap-4">
                    <div className="min-w-0 lg:w-40 lg:flex-shrink-0">
                      <div className="truncate text-sm font-medium text-foreground">{app.candidateId?.name || 'Unknown'}</div>
                      <div className="truncate text-xs text-muted-foreground">{app.candidateId?.email}</div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <PipelineStepper
                        stages={requisition.stages}
                        progress={progressMap}
                        stageLinks={stageLinksByApp[app._id]}
                        currentStageKey={hasFailed || allStagesPassed ? null : app.currentStageKey}
                        onStartStage={() => handleGoToInterview(app)}
                        startingStageKey={goingToInterview === app._id ? app.currentStageKey : null}
                      />
                    </div>

                    <div className="flex flex-shrink-0 items-center justify-between gap-3 lg:justify-end">
                      {app.disposition ? (
                        <Badge variant="secondary" className={`font-normal ${DISPOSITION_BADGE[app.disposition] || ''}`}>
                          {formatDisposition(app.disposition)}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">In progress</span>
                      )}
                      <Button
                        variant="outline" size="sm"
                        className="border-[#d21e2b]/40 text-[#d21e2b] hover:bg-[#d21e2b]/5 hover:text-[#d21e2b]"
                        onClick={() => handleGoToInterview(app)}
                        disabled={isGoDisabled}
                      >
                        {goingToInterview === app._id ? 'Opening…' : 'Go to Interview'}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {filteredApplications.length > CANDIDATE_PAGE_SIZE && (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {(safeCandidatePage - 1) * CANDIDATE_PAGE_SIZE + 1}
            –{Math.min(safeCandidatePage * CANDIDATE_PAGE_SIZE, filteredApplications.length)} of {filteredApplications.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={() => setCandidatePage((p) => Math.max(1, p - 1))}
              disabled={safeCandidatePage === 1}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">Page {safeCandidatePage} of {totalCandidatePages}</span>
            <Button
              variant="outline" size="sm"
              onClick={() => setCandidatePage((p) => Math.min(totalCandidatePages, p + 1))}
              disabled={safeCandidatePage === totalCandidatePages}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ---------- ranking ---------- */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Ranking</CardTitle>
        </CardHeader>
        <CardContent>
          <CandidateRankTable ranking={ranking} onDecisionRecorded={load} />
        </CardContent>
      </Card>

      {/* ---------- scorecard ---------- */}
      {scorecard?.stages?.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Scorecard</CardTitle>
          </CardHeader>
          <CardContent>
            {scorecard ? (
              <ScorecardEditor
                scorecard={scorecard}
                stageLabels={stageLabels}
                onSave={handleSaveScorecard}
                saving={savingScorecard}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No scorecard generated yet.</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- close confirmation ---------- */}
      <AlertDialog open={pendingClose} onOpenChange={setPendingClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close this job opening?</AlertDialogTitle>
            <AlertDialogDescription>
              New candidates will no longer be able to apply for this position using the public application link.
              Existing candidates and their scores will remain available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingStatus}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); setPendingClose(false); applyStatus('closed'); }}
              disabled={savingStatus}
              className="bg-[#d21e2b] text-white hover:bg-[#d21e2b]/90"
            >
              {savingStatus ? 'Closing…' : 'Close job'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
