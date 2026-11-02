import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../components/ui/dialog";
import { toast } from "sonner";
import { NetworkBackground } from "../components/common/NetworkBackground";
import {
  Eye, EyeSlash, Envelope, Lock, Question, UserCircle, Clock, CalendarCheck, Receipt, ShieldCheck, ArrowRight
} from "@phosphor-icons/react";

const FEATURES = [
  { icon: Clock, title: "Login & Logout", text: "8-hour day, tracked live from Login to Logout" },
  { icon: CalendarCheck, title: "Leave & WFH", text: "Request, approve and track in one place" },
  { icon: Receipt, title: "Payroll", text: "Monthly payslips, emailed as PDF" },
  { icon: ShieldCheck, title: "Access control", text: "View / Edit / Delete per employee" },
];

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { login } = useAuth();

  const [formData, setFormData] = useState({
    email: "",
    password: ""
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(formData.email, formData.password);
      if (result.success) {
        toast.success("Welcome back!");
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ background: 'var(--brand-gradient)' }}>
      {/* Background glows + live "spider net" */}
      <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(125,211,252,0.35), transparent 65%)' }} />
      <div className="absolute -bottom-48 right-[-120px] w-[620px] h-[620px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.18), transparent 65%)' }} />
      <NetworkBackground />

      <div className="relative z-10 min-h-screen max-w-[1240px] mx-auto px-5 sm:px-8 py-10 flex flex-col lg:flex-row items-center justify-center gap-10 lg:gap-16">
        {/* Brand story (desktop) */}
        <div className="hidden lg:flex flex-1 flex-col text-white max-w-[540px]">
          <div className="flex items-center gap-4 mb-12">
            <div className="inline-flex items-center rounded-2xl px-5 py-3 shadow-lg" style={{ background: '#FFFFFF' }}>
              <img src="/sparkcurv-logo-full.png" alt="Sparkcurv — Tech, simplified" style={{ height: 46, width: 'auto' }} />
            </div>
            <span className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-[0.18em] text-white" style={{ background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.22)' }}>
              HR Portal
            </span>
          </div>

          <h2 className="text-[52px] leading-[1.05] font-bold tracking-tight font-['Outfit']">
            Your workday,<br />
            <span className="text-sky-200">all in one place.</span>
          </h2>
          <p className="mt-5 text-base text-blue-100/90 max-w-md leading-relaxed">
            Log in to your day, take breaks, request leave and download payslips — while your managers approve everything in seconds.
          </p>

          <div className="grid grid-cols-2 gap-3 mt-10">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <div
                key={title}
                className="rounded-2xl p-4"
                style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)', backdropFilter: 'blur(8px)' }}
              >
                <Icon className="h-5 w-5 text-sky-200 mb-2" weight="duotone" />
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-xs text-blue-100/80 mt-0.5 leading-snug">{text}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Sign-in card */}
        <div className="w-full max-w-[440px]">
          {/* Mobile brand */}
          <div className="lg:hidden flex flex-col items-center gap-3 mb-6">
            <div className="inline-flex items-center rounded-2xl px-4 py-2.5 shadow-lg" style={{ background: '#FFFFFF' }}>
              <img src="/sparkcurv-logo-full.png" alt="Sparkcurv — Tech, simplified" style={{ height: 38, width: 'auto' }} />
            </div>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-200">HR Portal</span>
          </div>

          <div className="bg-white rounded-[28px] p-7 sm:p-9" style={{ boxShadow: '0 30px 60px -20px rgba(2, 12, 50, 0.55)' }}>
            <div className="mb-7">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-50 text-[#0020F8]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#0020F8]" /> Secure sign in
              </span>
              <h1 className="text-[32px] font-bold text-slate-900 leading-tight tracking-tight mt-4 font-['Outfit']">
                Welcome back
              </h1>
              <p className="text-slate-500 mt-1.5 text-[15px]">
                Sign in with the credentials provided by your HR team
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-semibold text-slate-700">
                  Work Email
                </Label>
                <div className="relative">
                  <Envelope
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    weight="duotone"
                    style={{ width: 18, height: 18 }}
                  />
                  <Input
                    id="email"
                    data-testid="login-email-input"
                    type="email"
                    placeholder="you@company.com"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="pl-11 h-12 border-slate-200 bg-slate-50 rounded-xl text-sm focus:bg-white focus:border-[#0020F8] focus:ring-[#0020F8] transition-colors"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-semibold text-slate-700">
                    Password
                  </Label>
                  <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
                    <DialogTrigger asChild>
                      <button
                        type="button"
                        className="text-xs font-semibold text-[#0020F8] hover:text-[#0019C4] hover:underline transition-colors"
                      >
                        Forgot password?
                      </button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md rounded-2xl">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2 text-slate-900 font-['Outfit']">
                          <div className="flex items-center justify-center w-8 h-8 bg-blue-50 rounded-lg">
                            <Question className="h-4 w-4 text-[#0020F8]" weight="duotone" />
                          </div>
                          Password Reset
                        </DialogTitle>
                      </DialogHeader>
                      <div className="py-4">
                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                          <p className="text-sm text-slate-700 mb-3 font-medium">
                            Contact the HR department to reset your password:
                          </p>
                          <ul className="space-y-2.5 text-sm">
                            <li className="flex items-center gap-2.5 text-slate-600">
                              <div className="flex items-center justify-center w-7 h-7 bg-white rounded-lg border border-blue-100">
                                <Envelope className="h-3.5 w-3.5 text-[#0020F8]" />
                              </div>
                              <span>Email: <strong className="text-slate-900">hr@sparkcurv.com</strong></span>
                            </li>
                            <li className="flex items-center gap-2.5 text-slate-600">
                              <div className="flex items-center justify-center w-7 h-7 bg-white rounded-lg border border-blue-100">
                                <UserCircle className="h-3.5 w-3.5 text-[#0020F8]" />
                              </div>
                              <span>Visit HR office during working hours</span>
                            </li>
                          </ul>
                        </div>
                        <p className="text-xs text-slate-400 mt-3">
                          For security, password resets are handled by HR personnel only.
                        </p>
                      </div>
                      <Button
                        onClick={() => setResetDialogOpen(false)}
                        className="w-full bg-[#0020F8] text-white hover:bg-[#0019C4] rounded-xl font-semibold"
                      >
                        Got it
                      </Button>
                    </DialogContent>
                  </Dialog>
                </div>
                <div className="relative">
                  <Lock
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    weight="duotone"
                    style={{ width: 18, height: 18 }}
                  />
                  <Input
                    id="password"
                    data-testid="login-password-input"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pl-11 pr-11 h-12 border-slate-200 bg-slate-50 rounded-xl text-sm focus:bg-white focus:border-[#0020F8] focus:ring-[#0020F8] transition-colors"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5"
                  >
                    {showPassword
                      ? <EyeSlash style={{ width: 18, height: 18 }} />
                      : <Eye style={{ width: 18, height: 18 }} />
                    }
                  </button>
                </div>
              </div>

              <button
                type="submit"
                data-testid="login-submit-btn"
                disabled={loading}
                className="w-full h-12 text-white font-bold text-[15px] rounded-xl transition-all duration-200 mt-2 flex items-center justify-center gap-2 hover:-translate-y-px"
                style={{
                  background: loading ? '#64748B' : 'var(--brand-gradient)',
                  boxShadow: loading ? 'none' : 'var(--shadow-brand)',
                  cursor: loading ? 'not-allowed' : 'pointer'
                }}
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                    <span>Signing in…</span>
                  </>
                ) : (
                  <>
                    Sign In <ArrowRight className="h-4 w-4" weight="bold" />
                  </>
                )}
              </button>
            </form>

            <p className="mt-7 text-center text-slate-400 text-[13px]">
              Don't have an account?{" "}
              <span className="text-slate-600 font-medium">Contact your HR team.</span>
            </p>
          </div>

          <p className="mt-6 text-center text-[12px] text-blue-100/80">© {new Date().getFullYear()} Sparkcurv · HR Portal</p>
        </div>
      </div>
    </div>
  );
}
