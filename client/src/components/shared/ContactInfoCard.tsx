import {
  Mail,
  Phone,
  Building2,
  Briefcase,
  MapPin,
  Linkedin,
  Globe,
  Calendar,
  Tag,
  Users,
  DollarSign,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatDistanceToNow } from "date-fns"

interface ContactInfoCardProps {
  lead: {
    email?: string
    phone?: string
    first_name?: string
    last_name?: string
    source?: string
    created_at?: string
  }
  enrichment?: {
    pdl_person?: {
      job_title?: string
      job_company_name?: string
      location_name?: string
      linkedin_url?: string
      industry?: string
      job_title_levels?: string[]
    }
    pdl_company?: {
      name?: string
      website?: string
      size?: string
      employee_count?: number
      estimated_annual_revenue?: string
    }
    hunter_verify?: { status?: string }
    personalizations?: {
      opener?: string
      painPoint?: string
      cta?: string
    }
  } | null
  tags?: string[]
}

function InfoRow({ icon: Icon, label, value, href }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value?: string | null
  href?: string
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <Icon className="size-3.5 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline truncate block">
            {value}
          </a>
        ) : (
          <p className="text-sm text-foreground truncate">{value}</p>
        )}
      </div>
    </div>
  )
}

export function ContactInfoCard({ lead, enrichment, tags }: ContactInfoCardProps) {
  const person = enrichment?.pdl_person
  const company = enrichment?.pdl_company
  const personalizations = enrichment?.personalizations

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4 space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Contact Information</h3>
        <InfoRow icon={Mail} label="Email" value={lead.email} href={lead.email ? `mailto:${lead.email}` : undefined} />
        <InfoRow icon={Phone} label="Phone" value={lead.phone} />
        <InfoRow icon={Briefcase} label="Title" value={person?.job_title} />
        <InfoRow icon={Building2} label="Company" value={person?.job_company_name ?? company?.name} />
        <InfoRow icon={Globe} label="Industry" value={person?.industry} />
        <InfoRow icon={MapPin} label="Location" value={person?.location_name} />
        <InfoRow icon={Linkedin} label="LinkedIn" value={person?.linkedin_url ? "View Profile" : undefined} href={person?.linkedin_url ?? undefined} />
        <InfoRow icon={Tag} label="Source" value={lead.source} />
        <InfoRow icon={Calendar} label="Created" value={lead.created_at ? formatDistanceToNow(new Date(lead.created_at), { addSuffix: true }) : undefined} />
      </div>

      {company && (company.size || company.estimated_annual_revenue) && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Company Details</h3>
          <InfoRow icon={Users} label="Headcount" value={company.size ?? (company.employee_count ? String(company.employee_count) : undefined)} />
          <InfoRow icon={DollarSign} label="Revenue" value={company.estimated_annual_revenue} />
          <InfoRow icon={Globe} label="Website" value={company.website} href={company.website ? (company.website.startsWith("http") ? company.website : `https://${company.website}`) : undefined} />
        </div>
      )}

      {personalizations && (personalizations.opener || personalizations.painPoint || personalizations.cta) && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Personalizations</h3>
          {personalizations.opener && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Opener</p>
              <p className="text-sm text-foreground">{personalizations.opener}</p>
            </div>
          )}
          {personalizations.painPoint && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pain Point</p>
              <p className="text-sm text-foreground">{personalizations.painPoint}</p>
            </div>
          )}
          {personalizations.cta && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">CTA</p>
              <p className="text-sm text-foreground">{personalizations.cta}</p>
            </div>
          )}
        </div>
      )}

      {tags && tags.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Tags</h3>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
