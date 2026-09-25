import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Search, Users } from 'lucide-react';
import api from '../hooks/useApi';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const DISPOSITION_LABEL = { HIRE: 'Hire', MAYBE: 'Maybe', NO_HIRE: 'No Hire' };

export default function RequisitionCandidates() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

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
  const filteredApplications = applications.filter((application) => !query || `${application.candidateId?.name || ''} ${application.candidateId?.email || ''}`.toLowerCase().includes(query));
  const inProgress = applications.filter((application) => !application.disposition).length;

  if (loading) return <div className="space-y-3"><Skeleton className="h-9 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!data) return <div className="text-sm text-muted-foreground">Job opening not found.</div>;

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => navigate(-1)}><ArrowLeft /></Button>
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{data.requisition.title} Candidates</h1>
            <p className="text-sm text-muted-foreground">{applications.length} candidate{applications.length === 1 ? '' : 's'} · {inProgress} in progress</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate(`/requisitions/${id}`)}>Open Job Opening</Button>
      </div>

      <div className="relative mt-5 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search candidates..." className="pl-9" />
      </div>

      <Card className="mt-4">
        <CardContent className="p-0">
          {filteredApplications.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center text-muted-foreground"><Users className="h-6 w-6" /><p className="text-sm">No candidates found for this job opening.</p></div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Candidate</TableHead><TableHead>Current stage</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
              <TableBody>{filteredApplications.map((application) => (
                <TableRow key={application._id}>
                  <TableCell><div className="font-medium">{application.candidateId?.name || 'Candidate'}</div><div className="text-xs text-muted-foreground">{application.candidateId?.email || '—'}</div></TableCell>
                  <TableCell>{stageLabels[application.currentStageKey] || 'Initial screening'}</TableCell>
                  <TableCell><Badge variant="secondary">{application.disposition ? DISPOSITION_LABEL[application.disposition] || application.disposition : 'In progress'}</Badge></TableCell>
                  <TableCell className="text-right"><Button size="sm" variant="outline" onClick={() => navigate(`/requisitions/${id}?candidateId=${application.candidateId?._id || application.candidateId}`)}>Open application</Button></TableCell>
                </TableRow>
              ))}</TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
