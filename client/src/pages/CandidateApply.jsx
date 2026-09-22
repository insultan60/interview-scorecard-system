import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/hooks/useApi';
import {
  Briefcase, Calendar, CheckCircle2, FileText, Upload, AlertCircle, Sparkles, ArrowRight, MapPin,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import redstarIcon from '../assets/redstar-icon.png';

const formatDeadline = (date) => {
  const d = new Date(date);

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}


export default function CandidateApply() {
  const { id } = useParams();

  const [requisition, setRequisition] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [step, setStep] = useState('jd'); // 'jd' | 'form' | 'success'

  // Application form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [answers, setAnswers] = useState({});
  const [resumeFile, setResumeFile] = useState(null);
  const [formPart, setFormPart] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    async function fetchPublicRequisition() {
      console.log(`[CandidateApply] Fetching public requisition with ID: "${id}"...`);
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/requisitions/${id}/public`);
        console.log('[CandidateApply] Received requisition data:', res.data);
        setRequisition(res.data.requisition);
      } catch (err) {
        console.error('[CandidateApply] Failed to load requisition error:', err);
        const serverMsg = err?.response?.data?.message || err?.message;
        const statusCode = err?.response?.status;
        console.error(`[CandidateApply] Status: ${statusCode}, Message: ${serverMsg}`);
        setError(serverMsg || 'Requisition not found or is closed.');
      } finally {
        setLoading(false);
      }
    }
    if (id) fetchPublicRequisition();
  }, [id]);

  function handleAnswerChange(question, value) {
    setAnswers((prev) => ({ ...prev, [question]: value }));
  }

  function resetForm() {
    setName('');
    setEmail('');
    setPhone('');
    setAnswers({});
    setResumeFile(null);
    setFormPart(1);
  }

  function handlePersonalContinue(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error('Name and Email are required.');
      return;
    }
    if (!/^\d{11}$/.test(phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }
    if (!resumeFile) {
      toast.error('Please upload your CV / Resume file (PDF).');
      return;
    }
    const isPdf = resumeFile.type === 'application/pdf' || resumeFile.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      toast.error('Please upload your CV / Resume as a PDF file.');
      return;
    }
    if (resumeFile.size > 5 * 1024 * 1024) {
      toast.error('Your CV / Resume must be 5 MB or smaller.');
      return;
    }
    setFormPart(2);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error('Name and Email are required.');
      return;
    }

    if (!/^\d{11}$/.test(phone)) {
      toast.error('Phone number must contain exactly 11 digits.');
      return;
    }

    const unansweredQuestionIndex = (requisition?.questionnaire || []).findIndex((question) => {
      const questionText = typeof question === 'string' ? question : question.question;
      return !answers[questionText]?.trim();
    });
    if (unansweredQuestionIndex !== -1) {
      toast.error(`Please answer screening question ${unansweredQuestionIndex + 1}.`);
      return;
    }

    if (!resumeFile) {
      toast.error('Please upload your CV / Resume file (PDF).');
      return;
    }
    const isPdf = resumeFile.type === 'application/pdf' || resumeFile.name.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      toast.error('Please upload your CV / Resume as a PDF file.');
      return;
    }
    if (resumeFile.size > 5 * 1024 * 1024) {
      toast.error('Your CV / Resume must be 5 MB or smaller.');
      return;
    }

    setSubmitting(true);
    console.log('[CandidateApply] Submitting application for requisition:', id, { name, email, phone });
    try {
      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('email', email.trim());
      formData.append('phone', phone.trim());
      formData.append('questionnaireAnswers', JSON.stringify(answers));
      formData.append('resume', resumeFile);

      const res = await api.post(`/requisitions/${id}/apply`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      console.log('[CandidateApply] Application submission success:', res.data);
      setResult(res.data);
      resetForm();
      setStep('success');
      toast.success('Application submitted successfully!');
    } catch (err) {
      console.error('[CandidateApply] Application submission failed:', err);
      toast.error(err?.response?.data?.message || 'Failed to submit application. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          <Skeleton className="h-12 w-3/4 rounded-lg" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (error || !requisition) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-lg w-full text-center border-red-200 shadow-lg">
          <CardHeader>
            <AlertCircle className="h-14 w-14 text-red-500 mx-auto mb-2" />
            <CardTitle className="text-2xl font-bold text-slate-900">Position Unavailable</CardTitle>
            <CardDescription className="text-slate-600 text-sm mt-1">
              {error || 'This position is no longer accepting applications or does not exist.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2 text-left bg-slate-100/70 mx-6 mb-6 p-4 rounded-lg text-xs font-mono text-slate-700 space-y-1.5 border border-slate-200">
            <div className="font-semibold text-slate-800 border-b border-slate-200 pb-1 text-[11px] uppercase tracking-wider">
              Diagnostic Logs & Info:
            </div>
            <div><span className="font-bold text-slate-900">URL ID:</span> {id || '(none)'}</div>
            <div><span className="font-bold text-slate-900">Error Detail:</span> {error || 'No requisition object returned'}</div>
            <div className="pt-2 font-sans text-slate-600 border-t border-slate-200 text-[11px]">
              Tip: Copy the public link directly from an active requisition in your dashboard (e.g. <strong>Requisitions &gt; Copy Link</strong>).
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isExpired = requisition.isExpired;

  return (
    <div className="min-h-screen bg-slate-50/60 font-sans text-slate-900">
      {/* Top Branding Header */}
      <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <img src={redstarIcon} alt="Red Star Technologies" className="h-9 w-9 object-contain" />
            <span className="font-semibold text-lg tracking-tight">Red Star Technologies</span>
          </div>
          {requisition.applicationDeadline && (
            <Badge variant={isExpired ? 'destructive' : 'outline'} className="gap-1.5 py-1 px-3">
              <Calendar className="h-3.5 w-3.5" />
              {isExpired ? 'Deadline Passed' : `Deadline: ${formatDeadline(requisition.applicationDeadline)}`}
            </Badge>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-3xl px-4 py-8">
        {step === 'jd' && (
          <Card className="shadow-md border-slate-200">
            <CardHeader className="border-b bg-white pb-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <Badge className="bg-[#d21e2b]/10 text-[#d21e2b] border-[#d21e2b]/20 hover:bg-[#d21e2b]/10">
                  Open Position
                </Badge>
              </div>
              <CardTitle className="text-3xl font-bold text-slate-900 tracking-tight">
                {requisition.title}
              </CardTitle>
              <CardDescription className="text-sm text-slate-500 flex flex-wrap items-center gap-2 mt-1">
                <span className="flex items-center gap-1">
                  <Briefcase className="h-4 w-4 text-slate-400" />
                  {
                    {
                      full_time: 'Full-Time',
                      part_time: 'Part-Time',
                      contract: 'Contract',
                      internship: 'Internship',
                      temporary: 'Temporary',
                    }[requisition.employmentType] || 'Full-Time'
                  }
                </span>
                {requisition.location && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <MapPin className="h-4 w-4 text-slate-400" />
                      {requisition.location}
                    </span>
                  </>
                )}
                <span>·</span>
                <span>Red Star Technologies</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6 space-y-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-[#d21e2b]" /> Job Description & Overview
                </h3>
                <div className="prose prose-slate max-w-none text-slate-700 whitespace-pre-wrap leading-relaxed text-sm bg-slate-50/70 p-4 rounded-lg border border-slate-100">
                  {requisition.jobDescription}
                </div>
              </div>

              {isExpired ? (
                <div className="rounded-lg bg-red-50 p-4 border border-red-200 text-red-800 text-sm flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  Applications for this role closed on {formatDeadline(requisition.applicationDeadline)}.
                </div>
              ) : (
                <div className="pt-4 flex justify-end">
                  <Button
                    onClick={() => { setFormPart(1); setStep('form'); }}
                    className="bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white px-6 py-2.5 text-base font-medium shadow-sm gap-2"
                  >
                    Apply for this Position <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === 'form' && (
          <Card className="shadow-md border-slate-200">
            <CardHeader className="border-b bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl font-bold text-slate-900">
                    Application Form
                  </CardTitle>
                  <CardDescription className="text-sm">
                    Step {formPart} of 2 · Position: <span className="font-medium text-slate-800">{requisition.title}</span>
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setFormPart(1); setStep('jd'); }} className="text-slate-500">
                  Back to JD
                </Button>
              </div>
            </CardHeader>

            <CardContent className="pt-6">
              <form onSubmit={formPart === 1 ? handlePersonalContinue : handleSubmit} className="space-y-6">
                {/* Contact Information */}
                {formPart === 1 && <div className="space-y-4">
                  <h3 className="text-base font-semibold text-slate-900 border-b pb-2">
                    Personal Information
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="candidate-name" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Full Name <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="candidate-name"
                        type="text"
                        placeholder="e.g. John Doe"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="candidate-email" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Email Address <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="candidate-email"
                        type="email"
                        placeholder="john.doe@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="candidate-phone" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Phone Number <span className="text-red-500">*</span>
                    </Label>
                    <Input
                      id="candidate-phone"
                      type="tel"
                      inputMode="numeric"
                      pattern="[0-9]{11}"
                      maxLength={11}
                      placeholder="03001234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                      required
                    />
                  </div>
                </div>}

                {/* Questionnaire Questions */}
                {formPart === 2 && requisition.questionnaire && requisition.questionnaire.length > 0 && (
                  <div className="space-y-4 pt-2">
                    <h3 className="text-base font-semibold text-slate-900 border-b pb-2">
                      Application Questionnaire
                    </h3>
                    {requisition.questionnaire.map((q, idx) => {
                      const qText = typeof q === 'string' ? q : q.question;
                      return (
                        <div key={idx} className="space-y-1.5">
                          <Label htmlFor={`question-${idx}`} className="text-sm font-medium text-slate-800">
                            {idx + 1}. {qText} <span className="text-red-500">*</span>
                          </Label>
                          <Textarea
                            id={`question-${idx}`}
                            placeholder="Your answer..."
                            rows={3}
                            value={answers[qText] || ''}
                            onChange={(e) => handleAnswerChange(qText, e.target.value)}
                            required
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {formPart === 1 && <div className="space-y-2 pt-2">
                  <h3 className="text-base font-semibold text-slate-900 border-b pb-2">
                    Resume / CV Attachment <span className="text-red-500">*</span>
                  </h3>
                  <div className="rounded-lg border-2 border-dashed border-slate-300 p-6 text-center hover:border-[#d21e2b]/50 transition-colors bg-slate-50/50">
                    <Upload className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                    <Label htmlFor="resume-file" className="cursor-pointer text-sm font-medium text-[#d21e2b] hover:underline">
                      Upload CV / Resume (PDF, max 5 MB)
                    </Label>
                    <p className="text-xs text-slate-500 mt-1">PDF only, up to 5 MB</p>
                    <input
                      id="resume-file"
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => setResumeFile(e.target.files[0] || null)}
                      className="hidden"
                    />
                    {resumeFile && (
                      <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-800 border shadow-sm">
                        <FileText className="h-4 w-4 text-[#d21e2b]" />
                        {resumeFile.name} ({(resumeFile.size / 1024 / 1024).toFixed(2)} MB)
                      </div>
                    )}
                  </div>
                </div>}

                <div className="pt-4 flex justify-end gap-3">
                  {formPart === 1 ? (
                    <Button type="button" variant="outline" onClick={() => { setFormPart(1); setStep('jd'); }}>Cancel</Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setFormPart(1)}>Back</Button>
                  )}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white px-6"
                  >
                    {formPart === 1 ? 'Continue' : (submitting ? 'Submitting Application...' : 'Submit Application')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {step === 'success' && (
          <Card className="shadow-md border-green-200 bg-white text-center py-8 px-4">
            <CardContent className="space-y-4">
              <CheckCircle2 className="h-16 w-16 text-green-600 mx-auto" />
              <h2 className="text-2xl font-bold text-slate-900">Application Submitted!</h2>
              <p className="text-slate-600 max-w-md mx-auto text-sm leading-relaxed">
                {result?.message || 'Thank you for applying. Your application has been received.'}
              </p>
              <div className="pt-4">
                <Button variant="outline" onClick={() => { resetForm(); setStep('jd'); }}>
                  Back to Job Details
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
