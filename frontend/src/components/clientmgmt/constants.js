import { format } from "date-fns";

export const STAGES = [
  { key: "NEW", label: "New", tone: "tone-blue" },
  { key: "CONTACTED", label: "Contacted", tone: "tone-violet" },
  { key: "QUALIFIED", label: "Qualified", tone: "tone-teal" },
  { key: "TENDER", label: "Tender", tone: "tone-amber" },
  { key: "PROPOSAL", label: "Proposal", tone: "tone-blue" },
  { key: "WON", label: "Won", tone: "tone-green" },
  { key: "LOST", label: "Lost", tone: "tone-red" },
];
export const STAGE = Object.fromEntries(STAGES.map(s => [s.key, s]));
export const SOURCES = [["REFERRAL", "Referral"], ["WEBSITE", "Website"], ["EVENT", "Event"], ["COLD_CALL", "Cold call"], ["TENDER_PORTAL", "Tender portal"], ["PARTNER", "Partner"], ["OTHER", "Other"]];
export const SOURCE_LABEL = Object.fromEntries(SOURCES);
export const KINDS = [["CALL", "Call"], ["EMAIL", "Email"], ["MEETING", "Meeting"], ["NOTE", "Note"]];
export const TONES = {
  proposal: { DRAFT: "tone-teal", SENT: "tone-blue", ACCEPTED: "tone-green", REJECTED: "tone-red" },
  review: { PENDING: "tone-amber", CHANGES_ASKED: "tone-red", APPROVED: "tone-green" },
  contract: { DRAFT: "tone-amber", ACTIVE: "tone-green", COMPLETED: "tone-blue", TERMINATED: "tone-red" },
  invoice: { DRAFT: "tone-amber", POSTED: "tone-green", CANCELLED: "tone-red" },
  payment: { DRAFT: "tone-amber", POSTED: "tone-green", CANCELLED: "tone-red" },
  advance: { OPEN: "tone-blue", PARTLY_ADJUSTED: "tone-amber", ADJUSTED: "tone-green", CANCELLED: "tone-red" },
};
export const selectClass = "w-full h-10 rounded-xl border px-3 text-sm bg-white";
export const money = (n) => (n == null ? "—" : new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n));
export const day = (iso) => (iso ? format(new Date(iso.length === 10 ? iso + "T00:00:00" : iso), "d MMM yyyy") : "—");
export const when = (iso) => (iso ? format(new Date(iso), "d MMM yyyy, h:mm a") : "—");
export const todayStr = () => format(new Date(), "yyyy-MM-dd");
export const thisMonth = () => format(new Date(), "yyyy-MM");
// FastAPI sends a string, or an object ({message, ...}) as `detail`
export const apiError = (e, fallback) => { const d = e.response?.data?.detail; return typeof d === "string" ? d : d?.message || fallback; };
export const errorDetail = (e) => { const d = e.response?.data?.detail; return typeof d === "object" && d ? d : null; };
export const Pill = ({ tone, children }) => <span className={`chip ${tone || "tone-teal"}`}>{children}</span>;
export const label = (s) => (s || "").replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
