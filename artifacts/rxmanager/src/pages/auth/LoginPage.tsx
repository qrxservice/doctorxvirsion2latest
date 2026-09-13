import { FormEvent, useEffect, useState } from "react";
import { AlertCircle, Languages, Loader2, LogIn, Moon, RefreshCw, ShieldCheck, Stethoscope, Sun } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth, type LoginOtpChallenge } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { lang, setLang, t } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { user, isLoading, authError, retryAuth, login, verifyOtp, resendOtp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [challenge, setChallenge] = useState<LoginOtpChallenge | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) setLocation(user.role === "doctor" ? "/doctor/new-prescription" : "/");
  }, [setLocation, user]);

  if (user) return null;

  const submitLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login({ email: email.trim(), password });
      if (result) setChallenge(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loginFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setSubmitting(true);
    try {
      await verifyOtp(challenge.pendingToken, otp.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("loginFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const retrySession = async () => {
    setError(null);
    await retryAuth();
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-background via-background to-teal-50/70 dark:to-teal-950/20 px-4 py-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-teal-700 dark:text-teal-300">
            <Stethoscope className="h-6 w-6" />
            <span className="font-semibold tracking-tight">DoctorX Prescription</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={lang === "en" ? "বাংলা" : "English"}
              onClick={() => setLang(lang === "en" ? "bn" : "en")}
            >
              <Languages className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={toggleTheme}>
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
        </header>

        <div className="flex flex-1 items-center justify-center py-10">
          <Card className="w-full max-w-md border-teal-100/80 shadow-lg dark:border-teal-900/60">
            <CardHeader className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <CardTitle className="text-2xl">{challenge ? "Verify your sign-in" : t("signIn")}</CardTitle>
              <CardDescription>
                {challenge
                  ? `Enter the code sent by ${challenge.otpMethod}.`
                  : t("signInDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(authError || error) && (
                <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div className="min-w-0">
                    <p>{error || "The sign-in service is currently unavailable."}</p>
                    {authError && !error && (
                      <Button variant="link" className="mt-1 h-auto p-0 text-amber-900 dark:text-amber-200" onClick={retrySession}>
                        <RefreshCw className="mr-1 h-3 w-3" /> Try again
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
                </div>
              ) : challenge ? (
                <form className="space-y-4" onSubmit={submitOtp}>
                  <div className="space-y-2">
                    <Label htmlFor="login-otp">Verification code</Label>
                    <Input
                      id="login-otp"
                      autoFocus
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={otp}
                      onChange={(event) => setOtp(event.target.value)}
                      placeholder="Enter verification code"
                      required
                    />
                  </div>
                  <Button className="w-full" type="submit" disabled={submitting || !otp.trim()}>
                    {submitting ? <Loader2 className="animate-spin" /> : <LogIn />}
                    Verify and continue
                  </Button>
                  <div className="flex items-center justify-between text-xs">
                    <Button type="button" variant="link" className="h-auto px-0" onClick={() => setChallenge(null)}>
                      Back to sign in
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto px-0"
                      disabled={submitting}
                      onClick={async () => {
                        try {
                          await resendOtp(challenge.pendingToken);
                        } catch (cause) {
                          setError(cause instanceof Error ? cause.message : "Could not resend code");
                        }
                      }}
                    >
                      Resend code
                    </Button>
                  </div>
                </form>
              ) : (
                <form className="space-y-4" onSubmit={submitLogin}>
                  <div className="space-y-2">
                    <Label htmlFor="login-email">{t("email")}</Label>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="doctor@example.com"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">{t("password")}</Label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                    />
                  </div>
                  <Button className="w-full" type="submit" disabled={submitting}>
                    {submitting ? <Loader2 className="animate-spin" /> : <LogIn />}
                    {submitting ? t("signingIn") : t("signIn")}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
        <p className="text-center text-xs text-muted-foreground">Secure access for DoctorX clinical workspace</p>
      </div>
    </main>
  );
}