import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Search, Users, X } from 'lucide-react';
import api from '../hooks/useApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DISPOSITION_LABEL = { HIRE: 'Hire', MAYBE: 'Maybe', NO_HIRE: 'No Hire' };

const DISPOSITION_BADGE = {
  IN_PROGRESS: 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100',
  HIRE: 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100',
  MAYBE: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100',
  NO_HIRE: 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100',
};

export default function RequisitionCandidates() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter] = useState('all');

  useEffect(() => {
    let active = true;
    api.get(`/requisitions/${id}`)
      .then((res) => { if (active) setData(res.data); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  const applications = data?.applications || [];
  const stageLabels = useMemo(() => Object.fromEntries((data?.requisition?.stages || []).map((stage) => [stage.key, stage.label])), [data]);
  const query = search.trim().toLowerCase();

  const statusCounts = useMemo(() => {
    const counts = { IN_PROGRESS: 0, HIRE: 0, MAYBE: 0, NO_HIRE: 0 };
    applications.forEach((app) => {
      if (app.disposition && counts[app.disposition] !== undefined) {
        counts[app.disposition] += 1;
      } else {
        counts.IN_PROGRESS += 1;
      }
    });
    return counts;
  }, [applications]);

  const filteredApplications = useMemo(() => {
    return applications.filter((application) => {
      const matchesSearch = !query || `${application.candidateId?.name || ''} ${application.candidateId?.email || ''}`.toLowerCase().includes(query);
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'IN_PROGRESS' && !application.disposition)
        || application.disposition === statusFilter;
      const matchesStage = stageFilter === 'all'
        || application.currentStageKey === stageFilter;
      return matchesSearch && matchesStatus && matchesStage;
    });
  }, [applications, query, statusFilter, stageFilter]);

  const hasActiveFilters = Boolean(search || statusFilter !== 'all' || stageFilter !== 'all');

  if (loading) return <div className="space-y-3"><Skeleton className="h-9 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!data) return <div className="text-sm text-muted-foreground">Job opening not found.</div>;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{data.requisition.title} Candidates</h1>
            <p className="text-sm text-muted-foreground">
              {applications.length} candidate{applications.length === 1 ? '' : 's'} · {statusCounts.IN_PROGRESS} in progress
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate(`/requisitions/${id}`)}>Open Job Opening</Button>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search candidates..."
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses ({applications.length})</SelectItem>
            <SelectItem value="IN_PROGRESS">In progress ({statusCounts.IN_PROGRESS})</SelectItem>
            <SelectItem value="HIRE">Hire ({statusCounts.HIRE})</SelectItem>
            <SelectItem value="MAYBE">Maybe ({statusCounts.MAYBE})</SelectItem>
            <SelectItem value="NO_HIRE">No Hire ({statusCounts.NO_HIRE})</SelectItem>
          </SelectContent>
        </Select>

        {(data?.requisition?.stages || []).length > 0 && (
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue placeholder="All stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stages</SelectItem>
              {(data.requisition.stages || []).map((stage) => (
                <SelectItem key={stage.key} value={stage.key}>
                  {stage.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(''); setStatusFilter('all'); setStageFilter('all'); }}
            className="text-xs text-muted-foreground hover:text-foreground h-9 px-2"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Reset filters
          </Button>
        )}
      </div>

      <Card className="mt-4">
        <CardContent className="p-0">
          {filteredApplications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-muted-foreground">
              <Users className="h-6 w-6" />
              <p className="text-sm">
                {hasActiveFilters
                  ? 'No candidates match your current filter criteria.'
                  : 'No candidates found for this job opening.'}
              </p>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => { setSearch(''); setStatusFilter('all'); setStageFilter('all'); }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Current stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredApplications.map((application) => {
                  const disp = application.disposition;
                  const badgeClass = disp ? DISPOSITION_BADGE[disp] || '' : DISPOSITION_BADGE.IN_PROGRESS;
                  const badgeText = disp ? DISPOSITION_LABEL[disp] || disp : 'In progress';
                  return (
                    <TableRow key={application._id}>
                      <TableCell>
                        <div className="font-medium text-foreground">{application.candidateId?.name || 'Candidate'}</div>
                        <div className="text-xs text-muted-foreground">{application.candidateId?.email || '—'}</div>
                      </TableCell>
                      <TableCell>{stageLabels[application.currentStageKey] || 'Initial screening'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-medium ${badgeClass}`}>
                          {badgeText}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/requisitions/${id}?candidateId=${application.candidateId?._id || application.candidateId}`)}
                        >
                          Open application
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

