import { format } from "date-fns";

// The Sales CRM sheet's dropdown lists ("Lists" sheet)
export const LEAD_STATUSES = ["New", "Contacted", "Working", "Qualified", "Unqualified", "Converted"];
export const LEAD_SOURCES = ["Website", "Referral", "Cold Call", "WhatsApp Inquiry", "Social Media", "Trade Show / Exhibition", "Walk-in", "Other"];
export const INDUSTRIES = ["Construction", "Real Estate", "Architecture", "Interior Design", "Finance", "Manufacturing", "Other"];
export const OPP_STAGES = ["Discovery", "Demo Completed", "Pricing/POC Discussion", "Qualified", "Closed Won", "Closed Lost"];
export const STAGE_PROBABILITY = { "Discovery": 10, "Demo Completed": 30, "Pricing/POC Discussion": 50, "Qualified": 70, "Closed Won": 100, "Closed Lost": 0 };
export const ACCOUNT_TYPES = ["Prospect", "Active Client", "Churned", "Partner"];
export const OUTCOMES = ["Pending", "Completed", "No Response", "Skipped", "Rescheduled"];
export const ACTIVITY_TYPES = ["Email", "Call", "WhatsApp", "Note"];

export const TONES = {
  lead: { New: "tone-blue", Contacted: "tone-violet", Working: "tone-amber", Qualified: "tone-teal", Unqualified: "tone-red", Converted: "tone-green" },
  stage: { "Discovery": "tone-blue", "Demo Completed": "tone-violet", "Pricing/POC Discussion": "tone-amber", "Qualified": "tone-teal", "Closed Won": "tone-green", "Closed Lost": "tone-red" },
  account: { Prospect: "tone-blue", "Active Client": "tone-green", Churned: "tone-red", Partner: "tone-violet" },
  outcome: { Pending: "tone-amber", Completed: "tone-green", "No Response": "tone-red", Skipped: "tone-teal", Rescheduled: "tone-violet" },
  proposal: { DRAFT: "tone-teal", SENT: "tone-blue", ACCEPTED: "tone-green", REJECTED: "tone-red" },
  review: { PENDING: "tone-amber", CHANGES_ASKED: "tone-red", APPROVED: "tone-green" },
  contract: { DRAFT: "tone-amber", ACTIVE: "tone-green", COMPLETED: "tone-blue", TERMINATED: "tone-red" },
  invoice: { DRAFT: "tone-amber", POSTED: "tone-green", CANCELLED: "tone-red" },
  payment: { DRAFT: "tone-amber", POSTED: "tone-green", CANCELLED: "tone-red" },
  advance: { OPEN: "tone-blue", PARTLY_ADJUSTED: "tone-amber", ADJUSTED: "tone-green", CANCELLED: "tone-red" },
};
export const selectClass = "w-full h-10 rounded-xl border px-3 text-sm bg-white";
export const miniSelect = "h-8 rounded-lg border px-1.5 text-xs bg-white max-w-full";
export const money = (n) => (n == null ? "—" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n));
export const moneyShort = (n) => (n == null ? "—" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n));
export const day = (iso) => (iso ? format(new Date(iso.length === 10 ? iso + "T00:00:00" : iso), "d MMM yyyy") : "—");
export const when = (iso) => (iso ? format(new Date(iso), "d MMM yyyy, h:mm a") : "—");
export const todayStr = () => format(new Date(), "yyyy-MM-dd");
export const thisMonth = () => format(new Date(), "yyyy-MM");
// FastAPI sends a string, or an object ({message, ...}) as `detail`
export const apiError = (e, fallback) => { const d = e.response?.data?.detail; return typeof d === "string" ? d : d?.message || fallback; };
export const errorDetail = (e) => { const d = e.response?.data?.detail; return typeof d === "object" && d ? d : null; };
export const Pill = ({ tone, children }) => <span className={`chip ${tone || "tone-teal"}`}>{children}</span>;
export const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
