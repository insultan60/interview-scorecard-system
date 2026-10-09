import RichTextViewer from '../components/RichTextViewer';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import api from '@/hooks/useApi';
import { sendApplicationConfirmationEmailClient } from '../services/emailService';
import {
  Briefcase, Calendar, CheckCircle2, FileText, Upload, AlertCircle, Sparkles, ArrowRight, MapPin, MessageCircle, Globe, ExternalLink, Users,
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
                <Badge
                  className={
                    isExpired
                      ? 'bg-red-100 text-red-700 border-red-200 hover:bg-red-100'
                      : 'bg-[#d21e2b]/10 text-[#d21e2b] border-[#d21e2b]/20 hover:bg-[#d21e2b]/10'
                  }
                >
                  {isExpired ? 'Closed Position' : 'Open Position'}
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
                <div className="min-w-0 overflow-hidden text-slate-700 leading-relaxed text-sm bg-slate-50/70 p-4 rounded-lg border border-slate-100">
                  <RichTextViewer content={requisition.jobDescription} />
                </div>
              </div>

              {employmentDetails && (
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4">
                  <h3 className="text-base font-semibold text-slate-900 mb-2">{employmentDetails.title}</h3>
                  <div className="grid gap-2 text-sm text-slate-700 sm:grid-cols-3">
                    {employmentDetails.items.map(([label, value]) => (
                      <p key={label}><span className="font-medium">{label}:</span> {value}</p>
                    ))}
                  </div>
                </div>
              )}

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

                  <div className="space-y-1.5 pt-1">
                    <Label htmlFor="opportunity-duration" className="text-xs font-semibold uppercase tracking-wider text-slate-600">
                      Opportunity Availability <span className="text-red-500">*</span>
                    </Label>
                    <p className="text-xs text-slate-500">
                      How long will you remain open to this job opportunity?
                    </p>
                    <select
                      id="opportunity-duration"
                      value={opportunityOption}
                      onChange={(e) => setOpportunityOption(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                        className="mt-2 text-sm"
                        required
                      />
                    )}
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

                {formPart === 2 && captcha.enabled && (
                  <div>
                    <TurnstileCaptcha key={captchaResetKey} siteKey={captcha.siteKey} onToken={setCaptchaToken} />
                  </div>
                )}

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
          <Card className="shadow-lg border-slate-200 bg-white max-w-5xl lg:max-w-6xl mx-auto overflow-hidden rounded-2xl">
            <CardContent className="p-0">
              <div className="grid grid-cols-1 md:grid-cols-12 items-center gap-0">
                {/* Left Column: Image Media (Zero Padding & Fully Edge-to-Edge) */}
                <div className="md:col-span-5 p-0 border-b md:border-b-0 md:border-r border-slate-100 overflow-hidden flex self-stretch items-stretch">
                  <img
                    src={applicationSubmittedMedia}
                    alt="Application Submitted"
                    className="w-full h-full min-h-[351px] object-cover rounded-none block"
                  />
                </div>

                {/* Right Column: Content Section */}
                <div className="md:col-span-7 p-6 sm:p-8 space-y-6 text-left">
                  <div className="space-y-3">
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 px-3 py-1 text-xs font-semibold rounded-full gap-1.5 w-fit">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                      Application Submitted!
                    </Badge>
                    <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                      Thank You for Applying!
                    </h2>
                    <p className="text-slate-600 text-sm leading-relaxed">
                      Please join our community for future updates, interview schedules, job opportunities, and official announcements.
                    </p>
                  </div>

                  {/* Standardized Action Buttons */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
                    <a
                      href="https://chat.whatsapp.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-9 py-2 px-3.5 rounded-lg text-xs font-semibold shadow-sm inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Join WhatsApp
                    </a>
                    <Button
                      variant="outline"
                      onClick={() => { resetForm(); setStep('jd'); }}
                      className="h-9 py-2 px-3.5 rounded-lg text-xs font-semibold shadow-sm border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      Back to Job Details
                    </Button>
                  </div>

                  {/* Social Icons (Facebook, Instagram, LinkedIn, YouTube, Website) */}
                  <div className="pt-4 border-t border-slate-100 space-y-2">
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Connect with Us</p>
                    <div className="flex items-center gap-3 pt-1">
                      {/* Facebook */}
                      <a
                        href="https://facebook.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-9 w-9 rounded-full bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-600 flex items-center justify-center transition-colors"
                        title="Facebook"
                      >
                        <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                      </a>

                      {/* Instagram */}
                      <a
                        href="https://instagram.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-9 w-9 rounded-full bg-slate-100 hover:bg-pink-50 hover:text-pink-600 text-slate-600 flex items-center justify-center transition-colors"
                        title="Instagram"
                      >
                        <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                        </svg>
                      </a>

                      {/* LinkedIn */}
                      <a
                        href="https://linkedin.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-9 w-9 rounded-full bg-slate-100 hover:bg-sky-50 hover:text-sky-600 text-slate-600 flex items-center justify-center transition-colors"
                        title="LinkedIn"
                      >
                        <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                          <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                        </svg>
                      </a>

                      {/* YouTube */}
                      <a
                        href="https://youtube.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-9 w-9 rounded-full bg-slate-100 hover:bg-red-50 hover:text-red-600 text-slate-600 flex items-center justify-center transition-colors"
                        title="YouTube"
                      >
                        <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
                          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
                        </svg>
                      </a>

                      {/* Website */}
                      <a
                        href="https://redstartech.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="h-9 w-9 rounded-full bg-slate-100 hover:bg-red-50 hover:text-[#d21e2b] text-slate-600 flex items-center justify-center transition-colors"
                        title="Website"
                      >
                        <Globe className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
