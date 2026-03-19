import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  SearchCheck,
  User,
  Building2,
  Loader2,
  Mail,
  Briefcase,
  Globe,
  MapPin,
  Linkedin,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

type Tab = 'person' | 'company';

export function LookupPanel() {
  const [tab, setTab] = useState<Tab>('person');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <SearchCheck className="h-5 w-5 text-cyan-400" />
        <h1 className="text-lg font-semibold">Person & Company Lookup</h1>
      </div>

      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setTab('person')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'person' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <User className="h-4 w-4" /> Person Lookup
        </button>
        <button
          onClick={() => setTab('company')}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === 'company' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Building2 className="h-4 w-4" /> Company Lookup
        </button>
      </div>

      {tab === 'person' ? <PersonLookup /> : <CompanyLookup />}
    </div>
  );
}

// ── Person Lookup ────────────────────────────────────────────

function PersonLookup() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.lookupPerson({ email: email || undefined, name: name || undefined, company: company || undefined }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email && !name) return;
    mutation.mutate();
  };

  const pdl = mutation.data?.pdl;
  const hunter = mutation.data?.hunter;
  const hunterFind = mutation.data?.hunterFind;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Full Name (for email finding)</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Smith"
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Company Domain (for email finding)</label>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="example.com"
              className="w-full px-3 py-2 bg-muted border border-border rounded text-sm"
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={mutation.isPending || (!email && !name)}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
            Search
          </button>
          <span className="text-xs text-muted-foreground">
            Enter email for PDL enrichment + Hunter verification, or name + company domain for Hunter email finding
          </span>
        </div>
      </form>

      {mutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
          {(mutation.error as Error).message}
        </div>
      )}

      {/* Hunter verification result */}
      {hunter && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email Verification (Hunter.io)
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              {hunter.status === 'valid' ? (
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              ) : hunter.status === 'invalid' ? (
                <XCircle className="h-5 w-5 text-red-400" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
              )}
              <span className="font-medium capitalize">{hunter.status}</span>
            </div>
            <span className="text-sm text-muted-foreground">Score: {hunter.score}/100</span>
            <div className="flex gap-2 text-xs">
              <VerifyBadge label="MX" ok={hunter.mx_records} />
              <VerifyBadge label="SMTP" ok={hunter.smtp_server} />
              <VerifyBadge label="Check" ok={hunter.smtp_check} />
              <VerifyBadge label="Webmail" ok={!hunter.webmail} inverted />
              <VerifyBadge label="Disposable" ok={!hunter.disposable} inverted />
            </div>
          </div>
        </div>
      )}

      {/* Hunter find result */}
      {hunterFind && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Mail className="h-4 w-4" /> Email Found (Hunter.io)
          </h3>
          <div className="flex items-center gap-4 text-sm">
            <span className="font-medium">{hunterFind.email}</span>
            <span className="text-muted-foreground">Score: {hunterFind.score}/100</span>
            {hunterFind.position && <span className="text-muted-foreground">{hunterFind.position}</span>}
          </div>
        </div>
      )}

      {/* PDL person result */}
      {pdl && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <User className="h-4 w-4" /> Person Data (People Data Labs)
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <Field icon={User} label="Name" value={pdl.full_name} />
            <Field icon={Mail} label="Email" value={pdl.email || pdl.work_email} />
            <Field icon={Briefcase} label="Title" value={pdl.job_title} />
            <Field icon={Building2} label="Company" value={pdl.job_company_name} />
            <Field icon={Globe} label="Industry" value={pdl.job_company_industry} />
            <Field icon={MapPin} label="Location" value={pdl.location_name} />
            {pdl.linkedin_url && (
              <div>
                <span className="text-xs text-muted-foreground">LinkedIn</span>
                <a href={pdl.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-400 hover:underline text-sm">
                  <Linkedin className="h-3.5 w-3.5" /> Profile <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            {pdl.job_company_size && <Field icon={Building2} label="Company Size" value={pdl.job_company_size} />}
            {pdl.inferred_years_experience > 0 && <Field icon={Briefcase} label="Experience" value={`${pdl.inferred_years_experience} years`} />}
          </div>

          {pdl.phone_numbers && pdl.phone_numbers.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Phone Numbers</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {pdl.phone_numbers.map((p: string) => (
                  <span key={p} className="text-xs px-2 py-0.5 bg-muted rounded">{p}</span>
                ))}
              </div>
            </div>
          )}

          {pdl.skills && pdl.skills.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Skills</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {pdl.skills.slice(0, 15).map((s: string) => (
                  <span key={s} className="text-xs px-2 py-0.5 bg-muted/50 rounded">{s}</span>
                ))}
                {pdl.skills.length > 15 && <span className="text-xs text-muted-foreground">+{pdl.skills.length - 15} more</span>}
              </div>
            </div>
          )}

          {pdl.experience && pdl.experience.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Experience</span>
              <div className="space-y-1 mt-1">
                {pdl.experience.slice(0, 5).map((exp: any, i: number) => (
                  <div key={i} className="text-xs flex items-center gap-2">
                    <span className="font-medium">{exp.title?.name || '—'}</span>
                    <span className="text-muted-foreground">at {exp.company?.name || '—'}</span>
                    {exp.start_date && <span className="text-muted-foreground">({exp.start_date})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mutation.isSuccess && !pdl && !hunter && !hunterFind && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          No data found. Try a different email or check that PDL/Hunter API keys are configured.
        </div>
      )}
    </div>
  );
}

// ── Company Lookup ───────────────────────────────────────────

function CompanyLookup() {
  const [domain, setDomain] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.lookupCompany({ domain: domain || undefined }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain) return;
    mutation.mutate();
  };

  const company = mutation.data?.company;

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div className="max-w-md">
          <label className="text-xs text-muted-foreground mb-1 block">Company Domain</label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.com"
            className="w-full px-3 py-2 bg-muted border border-border rounded text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={mutation.isPending || !domain}
          className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
          Search
        </button>
      </form>

      {mutation.isError && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-sm text-red-400">
          {(mutation.error as Error).message}
        </div>
      )}

      {company && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Building2 className="h-4 w-4" /> {company.name}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <Field icon={Globe} label="Website" value={company.website} />
            <Field icon={Building2} label="Industry" value={company.industry} />
            <Field icon={User} label="Size" value={company.size} />
            <Field icon={User} label="Employees" value={company.employee_count > 0 ? company.employee_count.toLocaleString() : '—'} />
            <Field icon={MapPin} label="Location" value={company.location} />
            <Field icon={Building2} label="Type" value={company.type} />
            {company.founded > 0 && <Field icon={Building2} label="Founded" value={String(company.founded)} />}
            {company.linkedin_url && (
              <div>
                <span className="text-xs text-muted-foreground">LinkedIn</span>
                <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-blue-400 hover:underline text-sm">
                  <Linkedin className="h-3.5 w-3.5" /> Company Page <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>
          {company.description && (
            <div>
              <span className="text-xs text-muted-foreground">Description</span>
              <p className="text-sm mt-1">{company.description}</p>
            </div>
          )}
          {company.tags && company.tags.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Tags</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {company.tags.map((t: string) => (
                  <span key={t} className="text-xs px-2 py-0.5 bg-muted/50 rounded">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {mutation.isSuccess && !company && (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground text-sm">
          No company found. Check the domain and ensure PDL API key is configured.
        </div>
      )}
    </div>
  );
}

// ── Shared ───────────────────────────────────────────────────

function Field({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground flex items-center gap-1"><Icon className="h-3 w-3" />{label}</span>
      <div className="text-sm font-medium">{value || '—'}</div>
    </div>
  );
}

function VerifyBadge({ label, ok, inverted }: { label: string; ok: boolean; inverted?: boolean }) {
  const pass = inverted ? ok : ok;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs ${pass ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
      {label}
    </span>
  );
}
