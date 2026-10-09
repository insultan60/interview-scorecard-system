import RichTextViewer from '../components/RichTextViewer';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/hooks/useApi';
import { sendApplicationConfirmationEmailClient } from '../services/emailService';
import {
  Briefcase, Calendar, CheckCircle2, FileText, Upload, AlertCircle, Sparkles, ArrowRight, MapPin,
  MessageCircle, Facebook, Instagram, Linkedin, Youtube, Globe,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import redstarIcon from '../assets/redstar-icon.png';
import applicationSubmittedMedia from '../assets/application-submitted-media.png';

const formatDeadline = (date) => {
  const d = new Date(date);

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';

function getEmploymentDetails(requisition) {
  const byType = {
    full_time: ['Full-Time details', [['Working hours', requisition.fullTimeDetails?.workingHours]]],
    part_time: ['Part-Time details', [['Weekly hours', requisition.partTimeDetails?.weeklyHours], ['Working hours', requisition.partTimeDetails?.workingHours]]],
    contract: ['Contract details', [['Duration', requisition.contractDetails?.duration], ['Working hours', requisition.contractDetails?.workingHours], ['Payment / rate', requisition.contractDetails?.paymentRate]]],
    internship: ['Internship details', [['Duration', requisition.internshipDetails?.duration], ['Status', requisition.internshipDetails?.paidStatus === 'paid' ? 'Paid' : requisition.internshipDetails?.paidStatus === 'unpaid' ? 'Unpaid' : ''], ['Working hours', requisition.internshipDetails?.workingHours]]],
    temporary: ['Temporary role details', [['Start date', requisition.temporaryDetails?.startDate ? String(requisition.temporaryDetails.startDate).slice(0, 10) : ''], ['End date', requisition.temporaryDetails?.endDate ? String(requisition.temporaryDetails.endDate).slice(0, 10) : ''], ['Working hours', requisition.temporaryDetails?.workingHours]]],
  };
  const details = byType[requisition.employmentType];
  if (!details) return null;
  const [title, items] = details;
  const populatedItems = items.filter(([, value]) => value);
  return populatedItems.length ? { title, items: populatedItems } : null;
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  const existing = document.getElementById(TURNSTILE_SCRIPT_ID);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true });
      existing.addEventListener('error', reject, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = TURNSTILE_SCRIPT_ID;
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function TurnstileCaptcha({ siteKey, onToken }) {
  const containerRef = useRef(null);

  useEffect(() => {
    let widgetId;
    let active = true;
    loadTurnstile()
      .then((turnstile) => {
        if (!active || !turnstile || !containerRef.current) return;
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onToken,
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      })
      .catch(() => onToken(''));
    return () => {
      active = false;
      if (widgetId !== undefined && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  return <div ref={containerRef} />;
}


export default function CandidateApply() {
  const { id } = useParams();

  const [requisition, setRequisition] = useState(null);
  const employmentDetails = requisition ? getEmploymentDetails(requisition) : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [step, setStep] = useState('jd'); // 'jd' | 'form' | 'success'

  // Application form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [opportunityOption, setOpportunityOption] = useState('30_days');
  const [opportunityCustom, setOpportunityCustom] = useState('');
  const [answers, setAnswers] = useState({});
  const [resumeFile, setResumeFile] = useState(null);
  const [formPart, setFormPart] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [captcha, setCaptcha] = useState({ enabled: false, siteKey: '' });
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => {
    if (formPart !== 2) setCaptchaToken('');
  }, [formPart]);

  useEffect(() => {
    async function fetchPublicRequisition() {
      console.log(`[CandidateApply] Fetching public requisition with ID: "${id}"...`);
      setLoading(true);
      setError(null);
      try {
        const res = await api.get(`/requisitions/${id}/public`);
        setRequisition(res.data.requisition);
        setCaptcha(res.data.captcha || { enabled: false, siteKey: '' });
      } catch (err) {
        console.error('[CandidateApply] Failed to load job opening error:', err);
        const serverMsg = err?.response?.data?.message || err?.message;
        const statusCode = err?.response?.status;
        console.error(`[CandidateApply] Status: ${statusCode}, Message: ${serverMsg}`);
        setError(serverMsg || 'Job Opening not found or is closed.');
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
    setCaptchaToken('');
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

    if (captcha.enabled && !captchaToken) {
      toast.error('Please complete the security check.');
      return;
    }

    setSubmitting(true);
    try {
      let durationText = '30 days';
      if (opportunityOption === '7_days') durationText = '7 days';
      else if (opportunityOption === '15_days') durationText = '15 days';
      else if (opportunityOption === '30_days') durationText = '30 days';
      else if (opportunityOption === '2_months') durationText = '2 months';
      else if (opportunityOption === 'custom') {
        if (!opportunityCustom.trim()) {
          toast.error('Please enter your custom opportunity availability duration.');
          return;
        }
        durationText = opportunityCustom.trim();
      }

      const formData = new FormData();
      formData.append('name', name.trim());
      formData.append('email', email.trim());
      formData.append('phone', phone.trim());
      formData.append('opportunityDuration', durationText);
      formData.append('questionnaireAnswers', JSON.stringify(answers));
      formData.append('resume', resumeFile);
      if (captcha.enabled) formData.append('captchaToken', captchaToken);

      const res = await api.post(`/requisitions/${id}/apply`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // Use browser EmailJS when backend email delivery is unavailable. The
      // application has already been saved, so a mail failure never blocks it.
      if (!res.data.confirmationEmailSent) {
        const emailResult = await sendApplicationConfirmationEmailClient({
          candidateEmail: email.trim(),
          candidateName: name.trim(),
          requisitionTitle: requisition.title,
        });
        if (!emailResult.sent) {
          console.warn('[CandidateApply] Application confirmation email was not sent:', emailResult.reason);
        }
      }

      console.log('[CandidateApply] Application submission success:', res.data);
      setResult(res.data);
      resetForm();
      setStep('success');
      toast.success('Application submitted successfully!');
    } catch (err) {
      console.error('[CandidateApply] Application submission failed:', err);
      if (err?.response?.data?.error === 'CAPTCHA_FAILED') {
        setCaptchaToken('');
        setCaptchaResetKey((key) => key + 1);
      }
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
              This position is no longer accepting applications. It may have been filled, closed, or the application link is no longer valid.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2 pb-6">
            <p className="text-sm text-slate-500">
              Please check the link or contact the hiring team for help.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isExpired = requisition.isExpired;

  return (
    <div className="min-h-screen bg-slate-50/60 font-sans text-slate-900">
      {/* Top Branding Header */}
      {step !== 'success' && (
        <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-20 shadow-sm">
          <div className="mx-auto max-w-5xl px-4 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-xl bg-red-50 border border-red-100">
                <img src={redstarIcon} alt="Red Star Technologies" className="h-7 w-7 object-contain" />
              </div>
              <div>
                <span className="font-bold text-base tracking-tight text-slate-900 block leading-none">Red Star</span>
                <span className="text-[10px] uppercase font-semibold text-[#d21e2b] tracking-wider">Technologies</span>
              </div>
            </div>
            {requisition.applicationDeadline && (
              <Badge variant={isExpired ? 'destructive' : 'outline'} className="gap-1.5 py-1 px-3.5 text-xs font-medium rounded-full shadow-xs">
                <Calendar className="h-3.5 w-3.5" />
                {isExpired ? 'Deadline Passed' : `Deadline: ${formatDeadline(requisition.applicationDeadline)}`}
              </Badge>
            )}
          </div>
        </header>
      )}

      {/* Main Container */}
      <main className="mx-auto max-w-3xl px-4 py-8">
        {step === 'jd' && (
          <Card className="shadow-xl shadow-slate-200/50 border-slate-200/80 rounded-2xl overflow-hidden bg-white transition-all">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-red-50/30 pb-6 pt-7 px-6 sm:px-8">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <Badge
                  className={
                    isExpired
                      ? 'bg-red-100 text-red-700 border-red-200 rounded-full px-3 py-0.5 text-xs font-semibold'
                      : 'bg-[#d21e2b]/10 text-[#d21e2b] border-[#d21e2b]/20 rounded-full px-3 py-0.5 text-xs font-semibold'
                  }
                >
                  {isExpired ? 'Closed Position' : 'Open Position'}
                </Badge>
              </div>
              <CardTitle className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
                {requisition.title}
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 flex flex-wrap items-center gap-2 mt-2 font-medium">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-slate-700">
                  <Briefcase className="h-4 w-4 text-[#d21e2b]" />
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
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 text-slate-700">
                    <MapPin className="h-4 w-4 text-[#d21e2b]" />
                    {requisition.location}
                  </span>
                )}
                <span className="text-slate-400">·</span>
                <span className="text-slate-700 font-semibold">Red Star Technologies</span>
              </CardDescription>
            </CardHeader>

            <CardContent className="p-6 sm:p-8 space-y-6">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-3 flex items-center gap-2 border-l-4 border-[#d21e2b] pl-3 py-0.5">
                  Job Description & Requirements
                </h3>
                <div className="min-w-0 overflow-hidden text-slate-700 leading-relaxed text-sm bg-slate-50/80 p-5 rounded-xl border border-slate-200/70 shadow-xs">
                  <RichTextViewer content={requisition.jobDescription} />
                </div>
              </div>

              {employmentDetails && (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-5 shadow-xs">
                  <h3 className="text-base font-bold text-slate-900 mb-3">{employmentDetails.title}</h3>
                  <div className="grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
                    {employmentDetails.items.map(([label, value]) => (
                      <div key={label} className="bg-white p-3 rounded-lg border border-slate-200/60 shadow-2xs">
                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">{label}</span>
                        <span className="font-semibold text-slate-900 mt-0.5 block">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isExpired ? (
                <div className="rounded-xl bg-red-50 p-4 border border-red-200 text-red-800 text-sm flex items-center gap-2.5 font-medium">
                  <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                  Applications for this role closed on {formatDeadline(requisition.applicationDeadline)}.
                </div>
              ) : (
                <div className="pt-2 flex justify-end">
                  <Button
                    onClick={() => { setFormPart(1); setStep('form'); }}
                    className="bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white px-7 py-3 text-base font-semibold shadow-lg shadow-red-500/20 rounded-xl gap-2.5 transition-all transform hover:-translate-y-0.5"
                  >
                    Apply for this Position <ArrowRight className="h-5 w-5" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === 'form' && (
          <Card className="shadow-xl shadow-slate-200/50 border-slate-200/80 rounded-2xl overflow-hidden bg-white">
            <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-red-50/30 py-5 px-6 sm:px-8">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-2xl font-bold text-slate-900 tracking-tight">
                    Application Form
                  </CardTitle>
                  <CardDescription className="text-xs sm:text-sm text-slate-600 mt-1">
                    Step {formPart} of 2 · Position: <span className="font-semibold text-slate-900">{requisition.title}</span>
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setFormPart(1); setStep('jd'); }} className="text-slate-500 hover:text-slate-900 rounded-lg">
                  Back to JD
                </Button>
              </div>

              {/* Progress Stepper Bar */}
              <div className="grid grid-cols-2 gap-2 pt-4">
                <div className={`h-1.5 rounded-full transition-all ${formPart >= 1 ? 'bg-[#d21e2b]' : 'bg-slate-200'}`} />
                <div className={`h-1.5 rounded-full transition-all ${formPart >= 2 ? 'bg-[#d21e2b]' : 'bg-slate-200'}`} />
              </div>
            </CardHeader>

            <CardContent className="p-6 sm:p-8">
              <form onSubmit={formPart === 1 ? handlePersonalContinue : handleSubmit} className="space-y-6">
                {/* Personal Info Step */}
                {formPart === 1 && (
                  <div className="space-y-5">
                    <h3 className="text-base font-bold text-slate-900 border-l-4 border-[#d21e2b] pl-3 py-0.5">
                      Personal & Availability Details
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
                          className="h-10 rounded-lg focus:ring-2 focus:ring-[#d21e2b]/30"
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
                          className="h-10 rounded-lg focus:ring-2 focus:ring-[#d21e2b]/30"
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="candidate-phone" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Phone Number (11 Digits) <span className="text-red-500">*</span>
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
                        className="h-10 rounded-lg focus:ring-2 focus:ring-[#d21e2b]/30"
                        required
                      />
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <Label htmlFor="opportunity-duration" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                        Opportunity Availability Duration <span className="text-red-500">*</span>
                      </Label>
                      <p className="text-xs text-slate-500">
                        How long will you remain open to this job opportunity?
                      </p>
                      <select
                        id="opportunity-duration"
                        value={opportunityOption}
                        onChange={(e) => setOpportunityOption(e.target.value)}
                        className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d21e2b]/30"
                      >
                        <option value="7_days">7 days</option>
                        <option value="15_days">15 days</option>
                        <option value="30_days">30 days</option>
                        <option value="2_months">2 months</option>
                        <option value="custom">Custom duration...</option>
                      </select>
                      {opportunityOption === 'custom' && (
                        <Input
                          type="text"
                          placeholder="e.g. 45 days or 3 months"
                          value={opportunityCustom}
                          onChange={(e) => setOpportunityCustom(e.target.value)}
                          className="mt-2 text-sm h-10 rounded-lg"
                          required
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Questionnaire Questions Step */}
                {formPart === 2 && requisition.questionnaire && requisition.questionnaire.length > 0 && (
                  <div className="space-y-5">
                    <h3 className="text-base font-bold text-slate-900 border-l-4 border-[#d21e2b] pl-3 py-0.5">
                      Application Screening Questionnaire
                    </h3>
                    {requisition.questionnaire.map((q, idx) => {
                      const qText = typeof q === 'string' ? q : q.question;
                      return (
                        <div key={idx} className="space-y-1.5 bg-slate-50/70 p-4 rounded-xl border border-slate-200/70">
                          <Label htmlFor={`question-${idx}`} className="text-sm font-semibold text-slate-900 block">
                            {idx + 1}. {qText} <span className="text-red-500">*</span>
                          </Label>
                          <Textarea
                            id={`question-${idx}`}
                            placeholder="Type your answer here..."
                            rows={3}
                            value={answers[qText] || ''}
                            onChange={(e) => handleAnswerChange(qText, e.target.value)}
                            className="rounded-lg bg-white focus:ring-2 focus:ring-[#d21e2b]/30"
                            required
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Resume Upload Drop Zone */}
                {formPart === 1 && (
                  <div className="space-y-2 pt-2">
                    <h3 className="text-base font-bold text-slate-900 border-l-4 border-[#d21e2b] pl-3 py-0.5">
                      Resume / CV Document <span className="text-red-500">*</span>
                    </h3>
                    <div className="rounded-xl border-2 border-dashed border-slate-300 p-6 text-center hover:border-[#d21e2b] hover:bg-red-50/20 transition-all bg-slate-50/50">
                      <Upload className="mx-auto h-9 w-9 text-slate-400 mb-2" />
                      <Label htmlFor="resume-file" className="cursor-pointer text-sm font-bold text-[#d21e2b] hover:underline block">
                        Click to Upload CV / Resume (PDF, max 5 MB)
                      </Label>
                      <p className="text-xs text-slate-500 mt-1">PDF document format only</p>
                      <input
                        id="resume-file"
                        type="file"
                        accept="application/pdf,.pdf"
                        onChange={(e) => setResumeFile(e.target.files[0] || null)}
                        className="hidden"
                      />
                      {resumeFile && (
                        <div className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-800 border border-green-200 shadow-sm text-green-800">
                          <FileText className="h-4 w-4 text-green-600" />
                          {resumeFile.name} ({(resumeFile.size / 1024 / 1024).toFixed(2)} MB) ✓
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {formPart === 2 && captcha.enabled && (
                  <div className="pt-2">
                    <TurnstileCaptcha key={captchaResetKey} siteKey={captcha.siteKey} onToken={setCaptchaToken} />
                  </div>
                )}

                <div className="pt-4 flex items-center justify-between gap-3 border-t">
                  {formPart === 1 ? (
                    <Button type="button" variant="outline" onClick={() => { setFormPart(1); setStep('jd'); }} className="rounded-xl px-5">Cancel</Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setFormPart(1)} className="rounded-xl px-5">Back</Button>
                  )}
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white font-semibold px-7 py-2.5 rounded-xl shadow-lg shadow-red-500/20"
                  >
                    {formPart === 1 ? 'Continue to Questions' : (submitting ? 'Submitting Application...' : 'Submit Application')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Success Visual View */}
        {step === 'success' && (
          <div className="min-h-[85vh] py-8 px-4 flex flex-col items-center justify-center font-sans animate-in fade-in duration-300">
            <Card className="max-w-5xl lg:max-w-6xl w-full mx-auto shadow-2xl border border-slate-200/90 rounded-3xl overflow-hidden bg-white p-0">
              <div className="grid grid-cols-1 md:grid-cols-12 items-center">
                {/* Left Side: Graphic Poster Image (5 cols) */}
                <div className="md:col-span-5 bg-slate-50 border-b md:border-b-0 md:border-r border-slate-100 p-0 flex items-center justify-center overflow-hidden">
                  <img
                    src={applicationSubmittedMedia}
                    alt="Thank You - Application Submitted Successfully"
                    className="w-[292px] max-w-full h-[351px] object-cover rounded-none block"
                  />
                </div>

                {/* Right Side: Message, Actions & Social Links (7 cols - Wider) */}
                <div className="md:col-span-7 p-6 sm:p-9 flex flex-col justify-between space-y-6">
                  <div className="space-y-3">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full border border-emerald-200/60">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      <span>Application Submitted!</span>
                    </div>

                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight leading-snug">
                      Thank You for Applying!
                    </h2>

                    <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                      Please join our community for future updates, interview schedules, job opportunities, and official announcements.
                    </p>
                  </div>

                  {/* Action Buttons (Standard Website Size & Font) */}
                  <div className="flex flex-col sm:flex-row gap-2.5 w-full">
                    <a
                      href="https://chat.whatsapp.com/"
                      target="_blank"
                      rel="noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] text-white font-semibold py-2 px-3.5 rounded-lg shadow-sm transition-colors text-xs text-center"
                    >
                      <MessageCircle className="h-4 w-4 fill-white text-white flex-shrink-0" />
                      <span>Join WhatsApp</span>
                    </a>

                    <Button
                      onClick={() => { resetForm(); setStep('jd'); }}
                      className="flex-1 bg-[#d21e2b] hover:bg-[#d21e2b]/90 text-white font-semibold py-2 px-3.5 rounded-lg shadow-sm transition-colors text-xs gap-1.5 h-9 text-center"
                    >
                      <ArrowRight className="h-3.5 w-3.5 rotate-180 flex-shrink-0" />
                      <span>Back to Job Details</span>
                    </Button>
                  </div>

                  {/* Social Icons Footer */}
                  <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <span className="text-xs font-medium text-slate-500">Connect with us:</span>
                    <div className="flex items-center gap-2.5">
                      <a
                        href="https://www.facebook.com"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Facebook"
                        className="p-2.5 rounded-full bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-[#1877F2] transition-all"
                      >
                        <Facebook className="h-4 w-4" />
                      </a>
                      <a
                        href="https://www.instagram.com"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Instagram"
                        className="p-2.5 rounded-full bg-slate-100 hover:bg-pink-50 text-slate-600 hover:text-[#E4405F] transition-all"
                      >
                        <Instagram className="h-4 w-4" />
                      </a>
                      <a
                        href="https://www.linkedin.com"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="LinkedIn"
                        className="p-2.5 rounded-full bg-slate-100 hover:bg-sky-50 text-slate-600 hover:text-[#0A66C2] transition-all"
                      >
                        <Linkedin className="h-4 w-4" />
                      </a>
                      <a
                        href="https://www.youtube.com"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="YouTube"
                        className="p-2.5 rounded-full bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-[#FF0000] transition-all"
                      >
                        <Youtube className="h-4 w-4" />
                      </a>
                      <a
                        href="https://www.redstartechs.com"
                        target="_blank"
                        rel="noreferrer"
                        aria-label="Website"
                        className="p-2.5 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-[#d21e2b] transition-all"
                      >
                        <Globe className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
