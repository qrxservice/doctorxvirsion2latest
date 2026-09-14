import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ClipboardList, Eye, FilePlus2, Menu, Moon, RefreshCw, Search, Sun, X } from "lucide-react";
import { useListPrescriptions } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";

export default function PrescriptionManagementPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const isBn = lang === "bn";
  const prescriptionsQuery = useListPrescriptions();

  const prescriptions = prescriptionsQuery.data ?? [];
  const filteredPrescriptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return prescriptions;
    return prescriptions.filter(rx =>
      [rx.patientName, rx.patientPhone, rx.referenceNo, rx.diagnosis]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(normalized)),
    );
  }, [prescriptions, query]);

  if (!import.meta.env.DEV && (authLoading || !user)) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">{isBn ? "লোড হচ্ছে..." : "Loading..."}</div>;
  }

  return (
    <div className="rx-shell rx-management-page min-h-screen bg-background">
      <header className="border-b bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="rx-management-header mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-700 text-xl text-white">℞</div>
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-teal-800 dark:text-teal-300">
                {isBn ? "প্রেসক্রিপশন ম্যানেজমেন্ট" : "Prescription Management"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isBn ? "আগের প্রেসক্রিপশন খুঁজুন ও দেখুন" : "Search and review saved prescriptions"}
              </p>
            </div>
          </div>
          <Button
            size="icon"
            variant="outline"
            className="rx-management-menu-toggle ml-auto h-9 w-9"
            aria-expanded={showMobileMenu}
            aria-controls="prescription-management-nav"
            aria-label={showMobileMenu ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setShowMobileMenu(value => !value)}
          >
            {showMobileMenu ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
          <nav id="prescription-management-nav" className={cn("rx-management-nav ml-auto flex flex-wrap items-center gap-1", showMobileMenu && "is-mobile-open")} aria-label="Prescription navigation">
            <Link href="/doctor/new-prescription">
              <Button size="sm" className="gap-1.5 bg-teal-700 hover:bg-teal-800">
                <FilePlus2 className="h-3.5 w-3.5" />
                {isBn ? "নতুন প্রেসক্রিপশন" : "New Prescription"}
              </Button>
            </Link>
            <Link href="/doctor/dashboard">
              <Button size="sm" variant="ghost">{isBn ? "ড্যাশবোর্ড" : "Dashboard"}</Button>
            </Link>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setLang(isBn ? "en" : "bn")}>
              {isBn ? "EN" : "বাংলা"}
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="mb-1 flex items-center gap-2 text-teal-700 dark:text-teal-300">
                <ClipboardList className="h-5 w-5" />
                <span className="text-sm font-semibold">{isBn ? "সংরক্ষিত প্রেসক্রিপশন" : "Saved prescriptions"}</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">{isBn ? "প্রেসক্রিপশন তালিকা" : "Prescription list"}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {isBn ? `${filteredPrescriptions.length}টি রেকর্ড` : `${filteredPrescriptions.length} record${filteredPrescriptions.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  className="pl-9"
                  placeholder={isBn ? "নাম, ফোন বা রেফারেন্স খুঁজুন" : "Search name, phone, or reference"}
                />
              </div>
              <Button
                size="icon"
                variant="outline"
                aria-label={isBn ? "আবার লোড করুন" : "Refresh prescriptions"}
                onClick={() => void prescriptionsQuery.refetch()}
                disabled={prescriptionsQuery.isFetching}
              >
                <RefreshCw className={cn("h-4 w-4", prescriptionsQuery.isFetching && "animate-spin")} />
              </Button>
            </div>
          </div>
        </section>

        {prescriptionsQuery.isError ? (
          <section className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
            <p className="font-semibold">{isBn ? "প্রেসক্রিপশন লোড করা যায়নি" : "Prescriptions could not be loaded"}</p>
            <p className="mt-1 text-sm opacity-80">
              {isBn ? "API সংযোগ যাচাই করে আবার চেষ্টা করুন।" : "Check the API connection and try again."}
            </p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => void prescriptionsQuery.refetch()}>
              {isBn ? "আবার চেষ্টা করুন" : "Try again"}
            </Button>
          </section>
        ) : prescriptionsQuery.isLoading ? (
          <section className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground">{isBn ? "প্রেসক্রিপশন লোড হচ্ছে..." : "Loading prescriptions..."}</section>
        ) : filteredPrescriptions.length === 0 ? (
          <section className="rounded-2xl border border-dashed bg-card p-10 text-center">
            <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <h2 className="mt-3 font-semibold">{isBn ? "কোনো প্রেসক্রিপশন পাওয়া যায়নি" : "No prescriptions found"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {query ? (isBn ? "অন্য কোনো সার্চ ব্যবহার করুন।" : "Try a different search.") : (isBn ? "নতুন প্রেসক্রিপশন তৈরি করলে এখানে দেখা যাবে।" : "New prescriptions will appear here.")}
            </p>
          </section>
        ) : (
          <section className="grid gap-3">
            {filteredPrescriptions.map(rx => (
              <article key={rx.id} className="rounded-2xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="truncate text-lg font-bold">{rx.patientName}</h2>
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase",
                        rx.status === "final" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
                      )}>
                        {rx.status ?? "draft"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {rx.referenceNo ?? `#${rx.id}`} · {new Date(rx.createdAt).toLocaleDateString(isBn ? "bn-BD" : "en-GB")}
                    </p>
                  </div>
                  <Link href={`/doctor/new-prescription?reprint=${rx.id}`}>
                    <Button size="sm" variant="outline" className="gap-1.5">
                      <Eye className="h-3.5 w-3.5" />
                      {isBn ? "দেখুন" : "View"}
                    </Button>
                  </Link>
                </div>
                <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
                  <div><span className="block text-xs text-muted-foreground">{isBn ? "ফোন" : "Phone"}</span><span className="font-medium">{rx.patientPhone || "—"}</span></div>
                  <div><span className="block text-xs text-muted-foreground">{isBn ? "বয়স / লিঙ্গ" : "Age / Gender"}</span><span className="font-medium">{rx.patientAge ?? "—"} / {rx.patientGender || "—"}</span></div>
                  <div><span className="block text-xs text-muted-foreground">{isBn ? "রোগ নির্ণয়" : "Diagnosis"}</span><span className="line-clamp-1 font-medium">{rx.diagnosis || "—"}</span></div>
                  <div><span className="block text-xs text-muted-foreground">{isBn ? "ওষুধ" : "Medicines"}</span><span className="font-medium">{rx.items?.length ?? 0}</span></div>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}