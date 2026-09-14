import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCreatePrescription, useUpdatePrescription, useGetDoctorProfile,
  useGetMyRxSettings, useUpdateMyRxSettings, getPrescription,
  useListQueue, useListAppointments, useListPrescriptions, useGetAppSettings,
  useCallNextPatient, useSkipPatient, useMarkPatientSeen,
  useRecallPatient, useServeQueueEntry, useUpdateDoctorStatus, useCreateMedicine,
} from "@workspace/api-client-react";
import type { DoctorRxSettings, DoctorRxSettingsInput, Prescription } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/contexts/ThemeContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Stethoscope, Sun, Moon, Languages, LayoutDashboard, Plus, Trash2,
  Printer, Search, ChevronRight, ChevronDown, ChevronUp, Calendar,
  Activity, UserCheck, CheckCircle2, SkipForward, RotateCcw, ClipboardList,
  BookOpen, PlusCircle, Settings2, FileCog, Save, Copy, Star, Pencil, FileDown,
  Coffee, Timer, TrendingUp, Upload, FlaskConical,
  Eye, EyeOff, ArrowUp, ArrowDown, RefreshCw, X, Calculator,
} from "lucide-react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { downloadObject, storageUrl } from "@/lib/storage";

/* ── Constants ─────────────────────────────────────────────────────── */

// DOSE_BTNS, DOSE_OPTIONS: removed — replaced by DB-driven templates["dose"] below.
const DOSE_FORMS = ["Tab","Cap","Syrup","Susp","Drop","Inj","Cream","Ointment","Gel","Inhaler","Sachet","Suppository","Solution","Lotion","Spray","Powder","Eye Drop","Ear Drop","Nasal Spray","Chewable","Lozenge"];

// Local (not UTC) YYYY-MM-DD — matches the <input type="date"> calendar value.
const toLocalDateStr = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
// TIMING_BTNS, DURATION_PRESETS: removed — replaced by DB-driven templates["timing"/"duration"] below.

// BUILTIN_TIMING_TEMPLATES and BUILTIN_DURATION_TEMPLATES removed —
// timing/duration defaults are now seeded as real DB rows per doctor
// (isBuiltin=true) so they can be hidden, reordered, and replaced like
// any other template. See /api/rx-templates backend for SYSTEM_DEFAULTS.
const IX_CHIPS = ["CBC","Urine R/E","Blood Sugar (F)","Blood Sugar (R)","HbA1c","Lipid Profile","LFT","KFT","ECG","CXR","TSH","Stool R/E","USG Abdomen","Creatinine","PT/INR","Blood Culture","Urine Culture","Serum Electrolytes"];

/* ── Types ──────────────────────────────────────────────────────────── */

interface MedItem {
  id: string;
  brandName: string; genericName: string;
  strength: string; dosageForm: string;
  dose: string; durationNum: string; durationUnit: "D" | "W" | "M";
  timing: string; instructions: string;
}

interface MedSuggestion {
  id: number; brandName: string; genericName: string | null;
  strength: string | null; dosageForm: string | null;
  manufacturer: string | null;
}

interface RxTemplate { id: number; type: string; title: string; content: string; department?: string | null; isFavorite?: boolean | null; isHidden?: boolean | null; }

type MedicineShortcut = Omit<MedItem, "id"> & { key: string; lastUsedAt: number; isFavorite: boolean };

const CUSTOM_TEMPLATE_VALUE = "__custom__";
const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

const DEFAULT_DOSE_TEMPLATES: RxTemplate[] = [
  "১+০+০", "০+১+০", "০+০+১", "১+১+০", "১+০+১", "১+১+১",
  "১ চামচ দিনে ১ বার", "১ চামচ দিনে ২ বার", "১ চামচ দিনে ৩ বার",
].map((value, index) => ({ id: -(index + 1), type: "dose", title: value, content: value }));

const DEFAULT_TIMING_TEMPLATES: RxTemplate[] = [
  "সকালে খালি পেটে", "খালি পেটে", "ভরা পেটে", "রাতে ঘুমাবার আগে",
].map((value, index) => ({ id: -(index + 20), type: "timing", title: value, content: value }));

const DEFAULT_DURATION_TEMPLATES: RxTemplate[] = [
  "১ দিন", "৩ দিন", "৫ দিন", "৭ দিন", "১০ দিন", "১৫ দিন", "২১ দিন", "৩০ দিন",
].map((value, index) => ({ id: -(index + 40), type: "duration", title: value, content: value }));

const DEFAULT_FOLLOW_UP_OPTIONS = [
  "৭ দিন পরে আসবেন",
  "১০ দিন পরে আসবেন",
  "৩০ দিন পরে আসবেন",
  "৯০ দিন পরে আসবেন",
];
const DEFAULT_FOLLOW_UP_TEMPLATES: RxTemplate[] = DEFAULT_FOLLOW_UP_OPTIONS.map((value, index) => ({
  id: -(index + 60), type: "followup", title: value, content: value,
}));
const DEFAULT_TEMPLATE_SET: RxTemplate[] = [
  ...DEFAULT_DOSE_TEMPLATES,
  ...DEFAULT_TIMING_TEMPLATES,
  ...DEFAULT_DURATION_TEMPLATES,
  ...DEFAULT_FOLLOW_UP_TEMPLATES,
];

const mergeTemplateOptions = (defaults: RxTemplate[], saved: RxTemplate[]) => {
  const seen = new Set<string>();
  return [...defaults, ...saved].filter(template => {
    const key = template.content.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const toAsciiDigits = (value: string) =>
  value.replace(/[০-৯]/g, digit => String(BENGALI_DIGITS.indexOf(digit)));

const toBengaliDigits = (value: string) =>
  value.replace(/\d/g, digit => BENGALI_DIGITS[Number(digit)]);

const parseDurationPreset = (content: string) => {
  const normalized = toAsciiDigits(content.trim());
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(D|W|M|দিন|সপ্তাহ|মাস)?/i);
  if (!match) return null;
  const unitText = match[2] ?? content;
  const unit = /M|মাস/i.test(unitText) ? "M" : /W|সপ্তাহ/i.test(unitText) ? "W" : "D";
  return { n: match[1], u: unit as "D" | "W" | "M" };
};

type QuickToolField = {
  key: string;
  label: string;
  placeholder?: string;
};

type QuickToolDefinition = {
  key: string;
  label: string;
  description?: string;
  fields: QuickToolField[];
  calculate: (values: Record<string, string>) => string | null;
};

// Add future clinical calculators here. The generic renderer below handles
// their fields and output without changes to the prescription page layout.
const QUICK_TOOL_REGISTRY: QuickToolDefinition[] = [];

type CalculatorField = {
  key: string;
  label: string;
  placeholder?: string;
};

type CalculatorDefinition = {
  key: string;
  label: string;
  description?: string;
  fields: CalculatorField[];
  calculate: (values: Record<string, string>) => string | null;
};

// Add future calculators here. CalculatorDialog handles their inputs, action,
// result area, and closing behavior without changes to the prescription page.
const CALCULATOR_REGISTRY: CalculatorDefinition[] = [];

interface LocalPrescriptionDraft {
  version: 1;
  savedAt: number;
  patient: PatientState;
  currentMed: MedItem;
  medicines: MedItem[];
  advice: string;
  treatmentNote: string;
  followUpDate: string;
  diagnosis: string;
}

interface FullPrescriptionTemplateData {
  observations?: {
    cc?: string;
    oe?: string;
    ixChips?: string[];
    ixCustom?: string;
    drugHistory?: string;
  };
  diagnosis?: string;
  medicines?: Array<Omit<MedItem, "id">>;
  advice?: string;
  treatmentNote?: string;
  followUpDate?: string;
}

type StoredPrescription = Prescription & { drugHistory?: string | null };

const emptyTemplateForm = (type: string = "advice") => ({
  type,
  title: "",
  content: "",
  department: "",
  isFavorite: false,
});

interface PatientState {
  name: string; age: string; ageUnit: string; sex: string;
  phone: string; address: string; regNo: string; date: string;
  bp: string; weight: string; height: string; pulse: string; temp: string;
  hb: string; sugar: string; spo2: string;
  cc: string; oe: string; oeMode: "text" | "box";
  ixChips: string[]; ixCustom: string; drugHistory: string;
  labReportUrl: string; prescriptionUploadUrl: string;
  photoUrl?: string;
}

/* ── Empty states ───────────────────────────────────────────────────── */

const emptyPatient = (): PatientState => ({
  name: "", age: "", ageUnit: "Y", sex: "M",
  phone: "", address: "", regNo: "",
  date: new Date().toLocaleDateString("en-GB").split("/").reverse().join("-"),
  bp: "", weight: "", height: "", pulse: "", temp: "",
  hb: "", sugar: "", spo2: "",
  cc: "", oe: "", oeMode: "text",
  ixChips: [], ixCustom: "", drugHistory: "",
  labReportUrl: "", prescriptionUploadUrl: "",
});

const emptyMed = (): MedItem => ({
  id: crypto.randomUUID(), brandName: "", genericName: "",
  strength: "", dosageForm: "",
  dose: "১+০+১", durationNum: "5", durationUnit: "D",
  timing: "ভরা পেটে", instructions: "",
});

const emptyTemplateMed = (): MedItem => ({
  id: crypto.randomUUID(), brandName: "", genericName: "",
  strength: "", dosageForm: "",
  dose: "1 tablet", durationNum: "5", durationUnit: "D",
  timing: "1+0+1", instructions: "",
});

const cloneTemplateMedicines = (items: Array<Partial<MedItem>> = []) =>
  items.map(m => ({
    id: crypto.randomUUID(),
    brandName: m.brandName ?? "",
    genericName: m.genericName ?? "",
    strength: m.strength ?? "",
    dosageForm: m.dosageForm ?? "",
    dose: m.dose ?? "",
    timing: m.timing ?? "",
    durationNum: m.durationNum ?? "",
    durationUnit: m.durationUnit === "W" ? "W" : m.durationUnit === "M" ? "M" : "D",
    instructions: m.instructions ?? "",
  } satisfies MedItem));

/* ── Page label map (en/bn) ─────────────────────────────────────────────
   Universal medical notation (BP, Pulse, C/C, O/E, IX, Dx, Rx, dose/timing
   chips) is intentionally kept identical across languages. */

type RxLabels = ReturnType<typeof rxLabels>;

function rxLabels(isBn: boolean) {
  return isBn
    ? {
        navDashboard: "ড্যাশবোর্ড", navNewRx: "নতুন প্রেসক্রিপশন", navPatients: "রোগীগণ",
        navLogs: "লগ", navAppointments: "অ্যাপয়েন্টমেন্ট", navQueue: "কিউ",
        preview: "প্রিভিউ", savePrint: "সেভ ও প্রিন্ট", saveOnly: "শুধু সেভ", loading: "লোড হচ্ছে...",
        loadPatient: "রোগী লোড করুন", searchPlaceholder: "নাম / ফোন / সিরিয়াল...",
        queueLabel: "কিউ", apptLabel: "অ্যাপয়েন্টমেন্ট", patientsLabel: "রোগী তালিকা", noPatientFound: "কোনো রোগী পাওয়া যায়নি",
        patientName: "রোগীর নাম", typeNamePlaceholder: "নাম টাইপ করুন...",
        age: "বয়স", gender: "লিঙ্গ", male: "পুরুষ", female: "মহিলা", other: "অন্যান্য",
        mobile: "মোবাইল", address: "ঠিকানা", addressPlaceholder: "ঠিকানা...",
        regNo: "রেজি নং", date: "তারিখ", vitals: "ভাইটালস", assistantTag: "অ্যাসিস্ট্যান্ট",
        ccLabel: "C/C — প্রধান অভিযোগ", ccPlaceholder: "জ্বর, মাথাব্যথা, কাশি...",
        box: "বক্স", oePlaceholder: "পরীক্ষায়...",
        ixLabel: "IX — পরীক্ষা-নিরীক্ষা", ixCustomPlaceholder: "অতিরিক্ত টেস্ট লিখুন...",
        drugHistory: "ওষুধের ইতিহাস", drugHistoryPlaceholder: "পূর্বের ওষুধের ইতিহাস...", addNewMedicine: "নতুন ঔষুধ যোগ করুন",
        attachments: "সংযুক্তি", labReport: "ল্যাব রিপোর্ট", previousRx: "পূর্বের প্রেসক্রিপশন",
        queueColon: "কিউ:", serving: "চলছে", waitingSuffix: "অপেক্ষমাণ", followUpColon: "ফলো-আপ:",
        next: "পরবর্তী", seen: "দেখা হয়েছে", skip: "বাদ", recall: "রিকল", nextColon: "পরবর্তী:",
        addMedicineHeading: "ঔষুধ যোগ করুন", brandName: "ব্র্যান্ড নাম",
        medNamePlaceholder: "ওষুধের নাম টাইপ করুন...", genericName: "জেনেরিক নাম",
        strengthPlaceholder: "শক্তি (৫০০mg)", formPlaceholder: "ফর্ম (ট্যাবলেট/সিরাপ)",
        dose: "ডোজ", customDose: "কাস্টম ডোজ", duration: "মেয়াদ", dayUnit: "দিন", weekUnit: "সপ্তাহ", monthUnit: "মাস",
        dateLocale: "bn-BD",
        timing: "সময়", customTiming: "কাস্টম সময়", instructionsOptional: "নির্দেশনা (ঐচ্ছিক)",
        instructionsPlaceholder: "যেমন: প্রয়োজনে, সতর্কতার সাথে ব্যবহার করুন...",
        addMedicineBtn: "যোগ করুন — ঔষুধ", addedMedicines: "যোগ করা ওষুধ",
        recentMedicines: "সাম্প্রতিক ওষুধ", favoriteMedicines: "প্রিয় ওষুধ", noRecentMedicines: "এখনও কোনো ওষুধ নেই",
        favoriteMedicine: "প্রিয় ওষুধে রাখুন", unfavoriteMedicine: "প্রিয় ওষুধ থেকে সরান",
        restoreDraft: "অসম্পূর্ণ প্রেসক্রিপশন ফিরে পান", restoreDraftHint: "শেষবারের অসম্পূর্ণ কাজ পাওয়া গেছে।",
        restore: "ফিরিয়ে আনুন", discard: "বাদ দিন",
        advice: "পরামর্শ", advicePlaceholder: "পরামর্শ লিখুন...",
        treatmentNote: "চিকিৎসা নোট", treatmentPlaceholder: "চিকিৎসার বিবরণ, পরিকল্পনা...",
        diagnosisDx: "রোগ নির্ণয় (Dx)", diagnosisPlaceholder: "নির্ণয়...", followUpDate: "ফলো-আপ তারিখ",
         templates: "টেমপ্লেট", newBtn: "নতুন", tmplAdvice: "পরামর্শ", tmplCc: "প্রধান অভিযোগ",
        tmplOe: "O/E", tmplIx: "পরীক্ষা", tmplDose: "ডোজ", tmplTiming: "সময় টেমপ্লেট", tmplDuration: "মেয়াদ টেমপ্লেট", tmplProtocol: "প্রোটোকল", tmplTreatment: "চিকিৎসা নোট", tmplFollowup: "ফলো-আপ", tmplManage: "পরিচালনা", tmplRestoreDefaults: "ডিফল্ট পুনরুদ্ধার", tmplHide: "লুকান", tmplShow: "দেখান",
         tmplDrugHistory: "ওষুধের ইতিহাস", tmplFull: "সম্পূর্ণ প্রেসক্রিপশন", saveCurrentTemplate: "বর্তমান প্রেসক্রিপশন সেভ",
        tmplTitlePlaceholder: "টেমপ্লেট শিরোনাম", tmplContentPlaceholder: "টেমপ্লেট বিষয়বস্তু...",
        save: "সেভ", cancel: "বাতিল", genericToBrand: "জেনেরিক → ব্র্যান্ড",
        genericToBrandHint: "ব্র্যান্ড ফিল্ডে জেনেরিক নাম লিখুন...", treatmentProtocol: "চিকিৎসা প্রোটোকল",
        adviceTemplate: "পরামর্শ টেমপ্লেট", ccTemplate: "C/C টেমপ্লেট", oeTemplate: "O/E টেমপ্লেট",
        ixTemplate: "I/X টেমপ্লেট", genericNamePlaceholder: "জেনেরিক নাম লিখুন...",
        enterMedName: "ওষুধের নাম দিন", loadedNowServing: "লোড হয়েছে — চলছে", loaded: "লোড হয়েছে",
        failed: "ব্যর্থ", templateApplied: "টেমপ্লেট প্রয়োগ হয়েছে", titleContentRequired: "শিরোনাম ও বিষয়বস্তু প্রয়োজন",
        templateSaved: "টেমপ্লেট সেভ হয়েছে", templateSaveFailed: "টেমপ্লেট সেভ ব্যর্থ",
        enterPatientName: "রোগীর নাম দিন", addAtLeastOneMed: "কমপক্ষে একটি ওষুধ যোগ করুন", saveFailed: "সেভ ব্যর্থ",
        prescription: "প্রেসক্রিপশন", savedExcl: "সেভ হয়েছে!", backToEdit: "এডিটে ফিরুন", printPdf: "প্রিন্ট / PDF", printNoHeader: "হেডার ছাড়া প্রিন্ট",
        doctorFallback: "ডাক্তার", nameColon: "নাম: ", phoneColon: "ফোন: ", ageSex: "বয়স/লিঙ্গ: ", wt: "ওজন: ",
        medicines: "ওষুধ", investigations: "IX — পরীক্ষা-নিরীক্ষা", adviceTitle: "পরামর্শ",
        treatmentNoteTitle: "চিকিৎসা নোট", followUpPrint: "ফলো-আপ:", doctorSignature: "ডাক্তারের স্বাক্ষর",
        headerSettings: "হেডার সেটিংস", pageSetup: "পেজ সেটআপ", saveDraft: "ড্রাফট সেভ",
        duplicate: "ডুপ্লিকেট", editingBadge: "এডিট করা হচ্ছে", draftBadge: "ড্রাফট", pendingInvBadge: "অনুসন্ধান বাকি",
        continueRx: "পূর্বের Rx", uploadReport: "রিপোর্ট আপলোড", uploading: "আপলোড হচ্ছে...", reportUploaded: "রিপোর্ট আপলোড হয়েছে",
        settingsSaved: "সেটিংস সেভ হয়েছে", settingsSaveFailed: "সেটিংস সেভ ব্যর্থ",
        headerSettingsDesc: "প্রেসক্রিপশনের শীর্ষে যা দেখানো হবে তা নির্ধারণ করুন।",
        pageSetupDesc: "প্রিন্ট পেজের আকার, মার্জিন ও উপাদান নিয়ন্ত্রণ করুন।",
        hdrName: "ডাক্তারের নাম", hdrDegree: "ডিগ্রি", hdrDesignation: "পদবি", hdrBmdc: "BMDC নং",
        hdrHospital: "হাসপাতাল / চেম্বার", hdrAddress: "ঠিকানা", hdrPhone: "ফোন", hdrEmail: "ইমেইল",
        hdrSignature: "স্বাক্ষরের টেক্সট", hdrPlaceholderHint: "খালি রাখলে প্রোফাইল থেকে নেওয়া হবে",
        hdrSignatureImage: "স্বাক্ষরের ছবি", remove: "সরান",
        psSize: "পেজ সাইজ", psMargins: "মার্জিন (mm)", psTop: "উপরে", psRight: "ডানে", psBottom: "নিচে", psLeft: "বামে",
        psHeaderHeight: "হেডার উচ্চতা (mm)", psFooterHeight: "ফুটার উচ্চতা (mm)",
        psShowHeader: "হেডার দেখান", psShowQr: "QR কোড দেখান", psShowSignature: "স্বাক্ষর দেখান", psShowFooter: "ফুটার দেখান",
        psFooterText: "ফুটার টেক্সট", saveSettings: "সেটিংস সেভ",
        refNoLabel: "রেফ নং", scanToVerify: "যাচাই করতে স্ক্যান করুন", reprint: "পুনঃপ্রিন্ট",
        ageColon: "বয়স: ", sexColon: "লিঙ্গ: ", dateColon: "তারিখ: ", regNoColon: "রেজি নং: ", wtColon: "ওজন: ", htColon: "উচ্চতা: ", mobileColon: "মোবাইল: ", visitNo: "ভিজিট নং:", rxHeading: "Rx.", advicePrint: "পরামর্শ", ixShort: "IX", complianceNote: "নিয়ম মাফিক ঔষধ খাবেন। ডাক্তারের পরামর্শ ব্যতীত ঔষধ পরিবর্তন নিষেধ।",
        tmplDepartment: "বিভাগ", tmplDepartmentPlaceholder: "বিভাগ (ঐচ্ছিক)",
        editLabel: "সম্পাদনা", deleteLabel: "মুছুন", favorites: "প্রিয়", deleteTmplConfirm: "এই টেমপ্লেটটি মুছবেন?",
        templateDeleted: "টেমপ্লেট মুছে ফেলা হয়েছে", templateUpdated: "টেমপ্লেট আপডেট হয়েছে",
        markFavorite: "প্রিয় হিসেবে চিহ্নিত করুন", update: "আপডেট",
        queueSummary: "কিউ সামারি", nowServingShort: "চলছে", nextShort: "পরবর্তী", waitingShort: "অপেক্ষমাণ",
        todaysQueue: "আজকের কিউ", queueEmpty: "কিউ খালি", liveTag: "লাইভ",
        breakActive: "বিরতি চলছে", breakRemaining: "বাকি সময়", expectedResume: "আনুমানিক পুনরায়",
        resumeBreak: "ফিরে আসুন", dayEnded: "দিন শেষ",
        recallPatient: "রিকল রোগী", followUpConsult: "ফলো-আপ পরামর্শ", resumeConsult: "পরামর্শ শুরু করুন",
        queueStillServing: "কিউতে চলছে",
        noMoreAppts: "আজকের জন্য আর অ্যাপয়েন্টমেন্ট নেই", doctorUnavailable: "ডাক্তার আজকে অনুপলব্ধ",
        statusAvailable: "উপলব্ধ", statusOnBreak: "বিরতিতে", statusDayEnded: "দিন শেষ",
        totalAppts: "মোট আজকে", completedCount: "সম্পন্ন", skippedCount: "বাদ দেওয়া",
        avgConsultation: "গড় পরামর্শ", firstPatient: "প্রথম রোগী", lastPatient: "শেষ রোগী",
        daySummaryTitle: "দিনের সারসংক্ষেপ", avgWaitTime: "গড় অপেক্ষা", estWaitNext: "পরবর্তীর অপেক্ষা",
        queuePosition: "কিউ অবস্থান",
      }
    : {
        navDashboard: "Dashboard", navNewRx: "New Rx", navPatients: "Patients",
        navLogs: "Logs", navAppointments: "Appointments", navQueue: "Queue",
        preview: "Preview", savePrint: "Save & Print", saveOnly: "Save Only", loading: "Loading...",
        loadPatient: "Load Patient", searchPlaceholder: "Name / Phone / Serial...",
        queueLabel: "Queue", apptLabel: "Appointment", patientsLabel: "Patient List", noPatientFound: "No patient found",
        patientName: "Patient Name", typeNamePlaceholder: "Type name...",
        age: "Age", gender: "Gender", male: "Male", female: "Female", other: "Other",
        mobile: "Mobile", address: "Address", addressPlaceholder: "Address...",
        regNo: "Reg No", date: "Date", vitals: "VITALS", assistantTag: "assistant",
        ccLabel: "C/C — CHIEF COMPLAINT", ccPlaceholder: "Fever, headache, cough...",
        box: "Box", oePlaceholder: "On examination...",
        ixLabel: "IX — INVESTIGATIONS", ixCustomPlaceholder: "Add extra test...",
        drugHistory: "DRUG HISTORY", drugHistoryPlaceholder: "Previous medication history...",
        attachments: "ATTACHMENTS", labReport: "Lab report", previousRx: "Previous prescription",
        queueColon: "Queue:", serving: "Serving", waitingSuffix: "waiting", followUpColon: "Follow-up:",
        next: "Next", seen: "Seen", skip: "Skip", recall: "Recall", nextColon: "Next:",
        addMedicineHeading: "Add Medicine", brandName: "Brand Name",
        medNamePlaceholder: "Type medicine name...", genericName: "Generic name", addNewMedicine: "Add New Medicine",
        strengthPlaceholder: "Strength (500mg)", formPlaceholder: "Form (Tablet/Syrup)",
        dose: "Dose", customDose: "Custom dose", duration: "Duration", dayUnit: "দিন", weekUnit: "সপ্তাহ", monthUnit: "মাস",
        dateLocale: "en-GB",
        timing: "Timing", customTiming: "Custom timing", instructionsOptional: "Instructions (optional)",
        instructionsPlaceholder: "e.g. as needed, use with caution...",
        addMedicineBtn: "ADD MEDICINE", addedMedicines: "Added Medicines",
        recentMedicines: "Recent medicines", favoriteMedicines: "Favorite medicines", noRecentMedicines: "No saved medicines yet",
        favoriteMedicine: "Add to favorites", unfavoriteMedicine: "Remove from favorites",
        restoreDraft: "Recover unfinished prescription", restoreDraftHint: "An unfinished prescription was found from your last session.",
        restore: "Restore", discard: "Discard",
        advice: "ADVICE", advicePlaceholder: "Write advice...",
        treatmentNote: "TREATMENT NOTE", treatmentPlaceholder: "Treatment details, plan...",
        diagnosisDx: "Diagnosis (Dx)", diagnosisPlaceholder: "Diagnosis...", followUpDate: "Follow-up Date",
         templates: "TEMPLATES", newBtn: "New", tmplAdvice: "Advice", tmplCc: "Chief Complaint",
        tmplOe: "O/E", tmplIx: "Investigation", tmplDose: "Dose", tmplTiming: "Timing Template", tmplDuration: "Duration Template", tmplProtocol: "Protocol", tmplTreatment: "Treatment Note", tmplFollowup: "Follow-up", tmplManage: "Manage", tmplRestoreDefaults: "Restore Defaults", tmplHide: "Hide", tmplShow: "Show",
         tmplDrugHistory: "Drug History", tmplFull: "Full Prescription", saveCurrentTemplate: "Save Current Prescription",
        tmplTitlePlaceholder: "Template title", tmplContentPlaceholder: "Template content...",
        save: "Save", cancel: "Cancel", genericToBrand: "Generic → Brand",
        genericToBrandHint: "Type generic name in brand field...", treatmentProtocol: "Treatment Protocol",
        adviceTemplate: "Advice Template", ccTemplate: "C/C Template", oeTemplate: "O/E Template",
        ixTemplate: "I/X Template", genericNamePlaceholder: "Type generic name...",
        enterMedName: "Enter medicine name", loadedNowServing: "loaded — Now Serving", loaded: "loaded",
        failed: "Failed", templateApplied: "Template applied", titleContentRequired: "Title and content required",
        templateSaved: "Template saved", templateSaveFailed: "Failed to save template",
        enterPatientName: "Enter patient name", addAtLeastOneMed: "Add at least one medicine", saveFailed: "Save failed",
        prescription: "Prescription", savedExcl: "saved!", backToEdit: "Back to Edit", printPdf: "Print / PDF", printNoHeader: "Without Header Print",
        doctorFallback: "Doctor", nameColon: "Name: ", phoneColon: "Phone: ", ageSex: "Age/Sex: ", wt: "Wt: ",
        medicines: "Medicines", investigations: "IX — Investigations", adviceTitle: "Advice",
        treatmentNoteTitle: "Treatment Note", followUpPrint: "Follow-up:", doctorSignature: "Doctor's Signature",
        headerSettings: "Header Settings", pageSetup: "Page Setup", saveDraft: "Save Draft",
        duplicate: "Duplicate", editingBadge: "Editing", draftBadge: "Draft", pendingInvBadge: "Pending Investigation",
        continueRx: "Continue Rx", uploadReport: "Upload Report", uploading: "Uploading...", reportUploaded: "Report uploaded",
        settingsSaved: "Settings saved", settingsSaveFailed: "Failed to save settings",
        headerSettingsDesc: "Configure what appears at the top of your prescriptions.",
        pageSetupDesc: "Control print page size, margins and elements.",
        hdrName: "Doctor Name", hdrDegree: "Degree", hdrDesignation: "Designation", hdrBmdc: "BMDC No",
        hdrHospital: "Hospital / Chamber", hdrAddress: "Address", hdrPhone: "Phone", hdrEmail: "Email",
        hdrSignature: "Signature Text", hdrPlaceholderHint: "Leave blank to use profile data",
        hdrSignatureImage: "Signature Image", remove: "Remove",
        psHeaderHeight: "Header Height (mm)", psFooterHeight: "Footer Height (mm)",
        psSize: "Page Size", psMargins: "Margins (mm)", psTop: "Top", psRight: "Right", psBottom: "Bottom", psLeft: "Left",
        psShowHeader: "Show Header", psShowQr: "Show QR Code", psShowSignature: "Show Signature", psShowFooter: "Show Footer",
        psFooterText: "Footer Text", saveSettings: "Save Settings",
        refNoLabel: "Ref No", scanToVerify: "Scan to verify", reprint: "Re-print",
        ageColon: "Age: ", sexColon: "Sex: ", dateColon: "Date: ", regNoColon: "Reg. No: ", wtColon: "Wt: ", htColon: "Ht: ", mobileColon: "Mobile: ", visitNo: "Visit No:", rxHeading: "Rx.", advicePrint: "Advice", ixShort: "IX", complianceNote: "Take medicines as directed. Changing medication without the doctor's advice is prohibited.",
        tmplDepartment: "Department", tmplDepartmentPlaceholder: "Department (optional)",
        editLabel: "Edit", deleteLabel: "Delete", favorites: "Favorites", deleteTmplConfirm: "Delete this template?",
        templateDeleted: "Template deleted", templateUpdated: "Template updated",
        markFavorite: "Mark as favorite", update: "Update",
        queueSummary: "Queue Summary", nowServingShort: "Now Serving", nextShort: "Next", waitingShort: "Waiting",
        todaysQueue: "Today's Queue", queueEmpty: "Queue is empty", liveTag: "LIVE",
        breakActive: "Break Active", breakRemaining: "Remaining Time", expectedResume: "Expected Resume",
        resumeBreak: "Resume", dayEnded: "Day Ended",
        recallPatient: "Recall Patient", followUpConsult: "Follow-up Consultation", resumeConsult: "Resume Consultation",
        queueStillServing: "Queue still serving",
        noMoreAppts: "No More Appointments Today", doctorUnavailable: "Doctor Unavailable Today",
        statusAvailable: "Available", statusOnBreak: "On Break", statusDayEnded: "Day Ended",
        totalAppts: "Total Today", completedCount: "Completed", skippedCount: "Skipped",
        avgConsultation: "Avg Consultation", firstPatient: "First Patient", lastPatient: "Last Patient",
        daySummaryTitle: "Day Summary", avgWaitTime: "Avg Wait", estWaitNext: "Est. Wait (Next)",
        queuePosition: "Queue Position",
      };
}

function PrescriptionFontStyles() {
  return (
    <style>{`
      @import url("https://fonts.maateen.me/kalpurush/font.css");
      .rx-prescription-font {
        font-family: Inter, "Kalpurush", system-ui, sans-serif;
      }
    `}</style>
  );
}

function AutoGrowingTextarea(props: ComponentProps<typeof Textarea>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    resize();
  }, [props.value, resize]);

  return (
    <Textarea
      {...props}
      ref={textareaRef}
      onInput={(event) => {
        resize();
        props.onInput?.(event);
      }}
    />
  );
}

/* ══════════════════════════════════════════════════════════════════════
   PRINT VIEW
══════════════════════════════════════════════════════════════════════ */

function PrintView({ rx, doctor, settings, qrDataUrl, adminQrEnabled = true, nextPatientLabel, onNewRx, onBack, onDuplicate, L }: {
  rx: any; doctor: any; settings?: DoctorRxSettings | null; qrDataUrl?: string | null;
  adminQrEnabled?: boolean; nextPatientLabel?: string | null;
  onNewRx: () => void; onBack: () => void; onDuplicate: () => void; L: RxLabels;
}) {
  const s = settings;
  const [hideHeaderForPrint, setHideHeaderForPrint] = useState(false);
  const showHeader = (s ? s.showHeader : true) && !hideHeaderForPrint;
  // One-click print that omits the letterhead regardless of the saved setting.
  // Wait for the header to actually unmount (two paints) before printing, then
  // restore it once the print dialog closes via the afterprint event.
  useEffect(() => {
    if (!hideHeaderForPrint) return;
    let printed = false;
    const restore = () => setHideHeaderForPrint(false);
    window.addEventListener("afterprint", restore, { once: true });
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      printed = true;
      window.print();
    }));
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("afterprint", restore);
      // Safety net if afterprint never fires (some browsers).
      if (printed) setTimeout(() => setHideHeaderForPrint(false), 0);
    };
  }, [hideHeaderForPrint]);
  const printWithoutHeader = () => setHideHeaderForPrint(true);
  // Effective QR = admin global toggle AND per-doctor toggle.
  const showQr = (s ? s.showQr : true) && adminQrEnabled;
  const showSignature = s ? s.showSignature : true;
  const showFooter = s ? s.showFooter : true;
  const hName = s?.headerName || doctor?.name || L.doctorFallback;
  const hDegree = s?.headerDegree || doctor?.degree;
  const hDesignation = s?.headerDesignation || "";
  const hBmdc = s?.headerBmdc || doctor?.bmdcNumber;
  const hHospital = s?.hospitalName || "";
  const hAddress = s?.headerAddress || doctor?.chamberAddress;
  const hPhone = s?.headerPhone || doctor?.phone || "";
  const hEmail = s?.headerEmail || doctor?.email || "";
  const hVisitingTime = doctor?.visitingTime || doctor?.visitingTime2 || "";
  const signatureText = s?.signatureText || L.doctorSignature;
  const signatureImage = s?.signatureImage || "";
  const footerText = s?.footerText || "";
  const pageSize = s?.pageSize || "A4";
  const mt = s?.marginTop ?? 15, mr = s?.marginRight ?? 15, mb = s?.marginBottom ?? 15, ml = s?.marginLeft ?? 15;
  const headerHeight = s?.headerHeight ?? 25;
  const footerHeight = s?.footerHeight ?? 15;
  const refNo = rx.referenceNo || `#${rx.id}`;
  const isDraft = rx.status === "draft";
  const rxDate = new Date(rx.createdAt).toLocaleDateString(L.dateLocale, { day: "2-digit", month: "2-digit", year: "numeric" });
  const vitalsLines: string[] = rx.vitals ? String(rx.vitals).split(/[\n,]+/).map((v: string) => v.trim()).filter(Boolean) : [];

  return (
    <div className="rx-print-page rx-prescription-font min-h-screen bg-gray-100 p-4 print:p-0 print:bg-white">
      <PrescriptionFontStyles />
      <style>{`@media print{html,body{overflow:visible!important;background:#fff!important}@page{size:${pageSize};margin:${mt}mm ${mr}mm ${mb}mm ${ml}mm}body *{visibility:hidden}.rx-print-page>.no-print,.rx-print-page>.no-print *,.no-print{display:none!important;visibility:hidden!important}#rxprint,#rxprint *{visibility:visible}#rxprint{position:static;width:auto;max-width:none;margin:0;background:white;box-sizing:border-box}.rx-print-header,.rx-print-patient,.rx-print-medicine,.rx-print-footer{break-inside:avoid;page-break-inside:avoid}}`}</style>
      <div className="no-print flex gap-2 mb-4 items-center flex-wrap">
        <CheckCircle2 className="h-5 w-5 text-green-500" />
        <span className="font-semibold text-green-700">{L.prescription} {refNo} {isDraft ? `(${L.draftBadge})` : L.savedExcl}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={onBack}><ChevronRight className="h-4 w-4 rotate-180 mr-1" />{L.backToEdit}</Button>
          <Button variant="outline" size="sm" onClick={onDuplicate}><Copy className="h-4 w-4 mr-1.5" />{L.duplicate}</Button>
          <Button size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1.5" />{L.printPdf}</Button>
          <Button variant="outline" size="sm" onClick={printWithoutHeader}><Printer className="h-4 w-4 mr-1.5" />{L.printNoHeader}</Button>
          <Button size="sm" onClick={onNewRx}><Plus className="h-4 w-4 mr-1.5" />{nextPatientLabel ? `${L.nextColon} ${nextPatientLabel}` : L.navNewRx}</Button>
        </div>
      </div>
      <div id="rxprint" className="rx-print-preview max-w-3xl mx-auto bg-white rounded-xl border shadow-lg print:shadow-none print:border-none print:rounded-none">
        {/* Letterhead */}
        {showHeader && (
          <div className="rx-print-header text-white p-5 print:p-4" style={{ minHeight: `${headerHeight}mm` }}>
            <div className="rx-print-header-content">
              <div className="rx-print-doctor">
                <div className="rx-print-mark" aria-hidden="true">℞</div>
                <div>
                  <h1 className="text-xl font-bold leading-tight">{hName}</h1>
                  {hDegree && <p className="text-teal-100 text-sm">{hDegree}</p>}
                  {(hDesignation || doctor?.specialtyName) && (
                    <p className="text-teal-200 text-xs mt-0.5">{hDesignation || doctor?.specialtyName}{doctor?.departmentName ? ` · ${doctor.departmentName}` : ""}</p>
                  )}
                  {hBmdc && <p className="text-teal-200 text-xs">BMDC: {hBmdc}</p>}
                </div>
              </div>
              <div className="rx-print-contact text-right text-xs text-teal-100">
                {hHospital && <p className="font-semibold text-white">{hHospital}</p>}
                {hAddress && <p className="text-teal-200">{hAddress}</p>}
                {hPhone && <p className="text-teal-200">{hPhone}</p>}
                {hEmail && <p className="text-teal-200">{hEmail}</p>}
                {hVisitingTime && <p className="text-teal-200">{hVisitingTime}</p>}
              </div>
            </div>
          </div>
        )}
        <div className="rx-print-meta flex justify-between items-center px-5 py-1.5 border-b text-xs">
          <span className="font-medium text-teal-700">{L.refNoLabel}: {refNo}</span>
          <span className="text-gray-500">{new Date(rx.createdAt).toLocaleDateString(L.dateLocale, { day:"numeric",month:"long",year:"numeric" })}</span>
        </div>
        <div className="p-5 print:p-4">
          {/* Patient — bordered two-row bar (classic BD format) */}
          <div className="rx-print-patient border-y-2 border-gray-800 py-2 text-sm">
            <div className="rx-print-patient-grid">
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.nameColon}</span><span className="font-semibold">{rx.patientName || "—"}</span></div>
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.ageColon}</span>{rx.patientAge ?? "—"}</div>
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.sexColon}</span>{rx.patientGender || "—"}</div>
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.dateColon}</span>{rxDate}</div>
            </div>
            <div className="rx-print-patient-grid mt-1">
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.regNoColon}</span><span className="font-mono">{refNo}</span></div>
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.wtColon}</span>{rx.patientWeight || "—"}</div>
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.htColon}</span>{rx.patientHeight || "—"}</div>
              <div className="rx-print-patient-item"><span className="rx-print-patient-label">{L.mobileColon}</span>{rx.patientPhone || "—"}</div>
            </div>
          </div>

          {/* Body — two columns: clinical findings (left) | Rx medicines (right) */}
          <div className="rx-print-body flex border-b-2 border-gray-800" style={{ minHeight: "120mm" }}>
            <div className="rx-print-clinical w-1/3 pr-3 py-3 border-r border-gray-300 space-y-3 text-sm">
              <div className="text-xs text-gray-500">{L.visitNo}</div>
              {rx.chiefComplaint && (
                <div>
                  <p className="font-semibold text-gray-700">C/C</p>
                  <p className="text-sm whitespace-pre-wrap">{rx.chiefComplaint}</p>
                </div>
              )}
              {(vitalsLines.length > 0 || rx.examination) && (
                <div>
                  <p className="font-semibold text-gray-700">O/E</p>
                  {vitalsLines.map((v, i) => (<p key={i} className="leading-snug">{v}</p>))}
                   {rx.examination && <p className="text-sm whitespace-pre-wrap mt-1">{rx.examination}</p>}
                </div>
              )}
              {rx.diagnosis && (
                <div>
                  <p className="font-semibold text-gray-700">Dx</p>
                  <p className="font-medium">{rx.diagnosis}</p>
                </div>
              )}
              {rx.investigations && (
                <div>
                  <p className="font-semibold text-gray-700">{L.ixShort}</p>
                  {rx.investigations.split(",").map((v: string, i: number) => (
                     <p key={i} className="text-sm">{v.trim()}</p>
                  ))}
                </div>
              )}
              {rx.advice && (
                <div>
                  <p className="font-semibold text-gray-700">{L.advicePrint}</p>
                  {rx.advice.split("\n").filter(Boolean).map((a: string, i: number) => (
                     <p key={i} className="text-sm whitespace-pre-wrap">{a}</p>
                  ))}
                </div>
              )}
            </div>
            <div className="rx-print-medicines w-2/3 pl-5 py-3">
              <div className="rx-print-symbol mb-2" aria-label="Rx">℞</div>
              <div className="space-y-3">
                {rx.items?.map((item: any, i: number) => (
                     <div key={item.id ?? `${item.medicineName}-${i}`} className="rx-print-medicine flex gap-2 items-start">
                    <span className="font-semibold text-sm w-5 shrink-0">{i+1}.</span>
                     <div className="min-w-0 flex-1">
                        <div className="rx-print-medicine-name font-bold text-sm break-words">
                        {item.dosageForm ? `${item.dosageForm}. ` : ""}{item.medicineName}{item.strength ? ` ${item.strength}` : ""}
                        {item.genericName && <span className="font-normal text-xs text-gray-500"> ({item.genericName})</span>}
                      </div>
                        <div className="rx-print-medicine-details text-sm text-gray-700 break-words">
                        {[item.dose, item.mealTiming, item.duration].filter(Boolean).join(" — ")}
                        {item.instruction && <span className="italic text-gray-600"> ({item.instruction})</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {rx.notes && (
                <div className="mt-4 text-sm">
                  <p className="font-semibold text-gray-700">{L.treatmentNoteTitle}</p>
                   <p className="text-sm text-gray-700 whitespace-pre-wrap">{rx.notes}</p>
                </div>
              )}
              {rx.followUpDate && (
                <p className="mt-3 text-sm font-medium text-gray-800">{L.followUpPrint} {rx.followUpDate}</p>
              )}
            </div>
          </div>

          {/* Compliance note (default, like attached format) */}
          <p className="text-center text-sm text-gray-700 py-2">{L.complianceNote}</p>

          {/* QR + signature */}
          <div className="flex justify-between items-end pt-1">
            {showQr && qrDataUrl ? (
              <div className="flex items-center gap-2">
                <img src={qrDataUrl} alt="QR" className="h-16 w-16" />
                <div className="text-[10px] text-gray-500 max-w-[100px]">
                  <p className="font-medium text-gray-600">{L.scanToVerify}</p>
                  <p className="font-mono">{refNo}</p>
                </div>
              </div>
            ) : (
              <div />
            )}
            {showSignature && (
              <div className="text-center">
                {signatureImage && (
                  <img src={signatureImage} alt="signature" className="h-12 mx-auto object-contain mb-0.5" />
                )}
                <div className="border-t border-gray-400 pt-1 w-40 text-xs text-gray-500">{signatureText}</div>
              </div>
            )}
          </div>
          {showFooter && (
             <div
               className="rx-print-footer text-center text-[10px] text-gray-400 border-t pt-2 whitespace-pre-wrap flex flex-col justify-end"
              style={{ minHeight: `${footerHeight}mm` }}
            >
              {footerText && <span>{footerText}</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   MAIN PRESCRIPTION PAGE
══════════════════════════════════════════════════════════════════════ */

export default function NewPrescriptionPage() {
  const { user, isLoading } = useAuth();
  const [, setLoc] = useLocation();
  const searchStr = useSearch();
  const { toast } = useToast();
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang } = useLanguage();
  const isBn = lang === "bn";
  const L = rxLabels(isBn);

  const { data: doctor } = useGetDoctorProfile();
  const createRx = useCreatePrescription();
  const updateRx = useUpdatePrescription();
  const { data: rxSettings } = useGetMyRxSettings();
  const updateSettings = useUpdateMyRxSettings();
  const screenHName = rxSettings?.headerName || doctor?.name || L.doctorFallback;
  const screenHDegree = rxSettings?.headerDegree || doctor?.degree;
  const screenHDesignation = rxSettings?.headerDesignation || "";
  const screenHBmdc = rxSettings?.headerBmdc || doctor?.bmdcNumber;
  const screenHHospital = rxSettings?.hospitalName || "";
  const screenHAddress = rxSettings?.headerAddress || doctor?.chamberAddress;
  const screenHPhone = rxSettings?.headerPhone || doctor?.phone || "";
  const screenHEmail = rxSettings?.headerEmail || doctor?.email || "";
  const today = new Date().toISOString().split("T")[0];
  const [loaderDate, setLoaderDate] = useState(today);
  // refetchInterval keeps the right-panel Queue Summary widget (and the existing
  // Load Patient queue list) live without the doctor needing to switch tabs.
  const { data: queueData, refetch: refetchQ } = useListQueue({ doctorId: doctor?.id ?? 0, date: today }, { query: { refetchInterval: 10000 } as any });
  const { data: apptData } = useListAppointments({ date: loaderDate, limit: 100 });
  const { data: rxHistory } = useListPrescriptions({ limit: 500 });
  const { data: appSettings } = useGetAppSettings();
  const adminQrEnabled = appSettings?.prescriptionQrEnabled ?? true;
  const callNext = useCallNextPatient();
  const skipMut = useSkipPatient();
  const seenMut = useMarkPatientSeen();
  const recallMut = useRecallPatient();
  const serveMut = useServeQueueEntry();
  const updateStatusRx = useUpdateDoctorStatus();

  // ── Auth redirect
  useEffect(() => {
    if (!import.meta.env.DEV && !isLoading && (!user || user.role !== "doctor")) setLoc("/login");
  }, [user, isLoading]);

  // ── Main state
  const [patient, setPatient] = useState<PatientState>(emptyPatient());
  const [currentMed, setCurrentMed] = useState<MedItem>(emptyMed());
  const [medicines, setMedicines] = useState<MedItem[]>([]);
  const [editingMedicineId, setEditingMedicineId] = useState<string | null>(null);
  const [draggedMedicineId, setDraggedMedicineId] = useState<string | null>(null);
  const [advice, setAdvice] = useState("");
  const [treatmentNote, setTreatmentNote] = useState("");
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpValue, setFollowUpValue] = useState("");
  const [savedFollowUpOptions, setSavedFollowUpOptions] = useState<string[]>([]);
  const [diagnosis, setDiagnosis] = useState("");
  const [mode, setMode] = useState<"write" | "saved">("write");
  const [savedRx, setSavedRx] = useState<any>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loadedQueueId, setLoadedQueueId] = useState<number | null>(null);
  const [pendingNext, setPendingNext] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [medicineShortcuts, setMedicineShortcuts] = useState<MedicineShortcut[]>([]);
  const [saveMedicineToDb, setSaveMedicineToDb] = useState(false);
  const [selectedMedicineId, setSelectedMedicineId] = useState<number | null>(null);
  const [recoveryDraft, setRecoveryDraft] = useState<LocalPrescriptionDraft | null>(null);
  const draftHydratedKeyRef = useRef<string | null>(null);

  // ── Per-doctor Rx settings (header + page setup)
  const [showHeaderDlg, setShowHeaderDlg] = useState(false);
  const [showPageDlg, setShowPageDlg] = useState(false);
  const [settingsForm, setSettingsForm] = useState<DoctorRxSettings | null>(null);
  useEffect(() => { if (rxSettings) setSettingsForm(rxSettings); }, [rxSettings]);

  // ── Medicine autocomplete
  const [medSug, setMedSug] = useState<MedSuggestion[]>([]);
  const [showSug, setShowSug] = useState(false);
  const [activeMedSugIndex, setActiveMedSugIndex] = useState(-1);
  const medInputRef = useRef<HTMLInputElement>(null);
  const sugRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createMedicine = useCreateMedicine();

  // ── Templates
  const [templates, setTemplates] = useState<Record<string, RxTemplate[]>>({});
  const [managedDefaultTemplates, setManagedDefaultTemplates] = useState<RxTemplate[]>(
    DEFAULT_TEMPLATE_SET.map(t => ({ ...t, isHidden: false }))
  );

  const doseOptions = useMemo(
    () => mergeTemplateOptions(
      managedDefaultTemplates.filter(t => t.type === "dose" && !t.isHidden),
      templates["dose"] ?? [],
    ),
    [managedDefaultTemplates, templates],
  );
  const timingOptions = useMemo(
    () => mergeTemplateOptions(
      managedDefaultTemplates.filter(t => t.type === "timing" && !t.isHidden),
      templates["timing"] ?? [],
    ),
    [managedDefaultTemplates, templates],
  );

  // Keep the exact Bangla defaults available even when the optional template
  // API is unavailable, while still including any doctor-created templates.
  const durationPresetsDB = useMemo(() =>
    mergeTemplateOptions(
      managedDefaultTemplates.filter(t => t.type === "duration" && !t.isHidden),
      templates["duration"] ?? [],
    )
      .map(t => {
        const parsed = parseDurationPreset(t.content);
        return parsed ? { ...parsed, title: t.title } : null;
      })
      .filter((p): p is { n: string; u: "D" | "W" | "M"; title: string } => p !== null),
    [managedDefaultTemplates, templates]
  );

  const selectedDoseTemplate = doseOptions.some(option => option.content === currentMed.dose)
    ? currentMed.dose
    : CUSTOM_TEMPLATE_VALUE;
  const selectedTimingTemplate = timingOptions.some(option => option.content === currentMed.timing)
    ? currentMed.timing
    : CUSTOM_TEMPLATE_VALUE;
  const selectedDurationTemplate = durationPresetsDB.some(
    option => option.n === currentMed.durationNum && option.u === currentMed.durationUnit,
  )
    ? `${currentMed.durationNum}|${currentMed.durationUnit}`
    : CUSTOM_TEMPLATE_VALUE;

  // ── UI toggles
  const [showLoadPatient, setShowLoadPatient] = useState(false);
  const [showMedicineComposer, setShowMedicineComposer] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [activeCalculatorKey, setActiveCalculatorKey] = useState<string | null>(null);
  const [showQuickTools, setShowQuickTools] = useState(true);
  const [showNewToolNotice, setShowNewToolNotice] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [isManageTemplates, setIsManageTemplates] = useState(false);
  const [allTemplatesGrouped, setAllTemplatesGrouped] = useState<Record<string, any[]>>({});
  const [newTmpl, setNewTmpl] = useState(emptyTemplateForm());
  const [templateMedicines, setTemplateMedicines] = useState<MedItem[]>([]);
  const [editingTmplId, setEditingTmplId] = useState<number | null>(null);
  // C/C, O/E and IX are collapsed by default to keep the left panel short — they
  // only expand on click, or automatically if a loaded/edited patient already has
  // content for that section (so existing data is never hidden).
  const [ccOpen, setCcOpen] = useState(false);
  const [oeOpen, setOeOpen] = useState(false);
  const [ixOpen, setIxOpen] = useState(false);
  const [loadedApptId, setLoadedApptId] = useState<number | null>(null);
  const [reportUploading, setReportUploading] = useState(false);
  // isRecallMode = true when a patient is loaded from prescription history (not from
  // the live queue).  The queue is NOT touched in recall mode — Now Serving stays
  // unchanged.  The doctor sees a distinct "Recall / Follow-up" indicator instead
  // of the queue status, and can optionally "Resume Consultation" to re-link the
  // patient to the queue if they are present in today's waiting list.
  const [isRecallMode, setIsRecallMode] = useState(false);

  const medicineShortcutStorageKey = doctor?.id ? `doctorx:medicine-shortcuts:${doctor.id}` : null;
  const prescriptionDraftStorageKey = doctor?.id ? `doctorx:prescription-draft:${doctor.id}` : null;
  const followUpPresetStorageKey = `doctorx:follow-up-options:${doctor?.id ?? "default"}`;
  const defaultTemplateStorageKey = `doctorx:default-templates:${doctor?.id ?? "default"}`;

  const persistManagedDefaultTemplates = useCallback((next: RxTemplate[]) => {
    setManagedDefaultTemplates(next);
    try {
      localStorage.setItem(defaultTemplateStorageKey, JSON.stringify(next));
    } catch { /* local storage is optional */ }
  }, [defaultTemplateStorageKey]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(defaultTemplateStorageKey) ?? "null");
      if (Array.isArray(stored)) {
        const valid = stored.filter((template): template is RxTemplate =>
          template && typeof template.id === "number" && template.id < 0 &&
          typeof template.type === "string" && typeof template.title === "string" && typeof template.content === "string"
        );
        setManagedDefaultTemplates(valid);
        return;
      }
    } catch { /* use the built-in defaults */ }
    setManagedDefaultTemplates(DEFAULT_TEMPLATE_SET);
  }, [defaultTemplateStorageKey]);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(followUpPresetStorageKey) ?? "[]");
      setSavedFollowUpOptions(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : []);
    } catch {
      setSavedFollowUpOptions([]);
    }
  }, [followUpPresetStorageKey]);

  const followUpOptions = useMemo(
    () => [...new Set([
      ...managedDefaultTemplates.filter(t => t.type === "followup" && !t.isHidden).map(t => t.content),
      ...savedFollowUpOptions,
    ])],
    [managedDefaultTemplates, savedFollowUpOptions],
  );
  const managedTemplatesGrouped = useMemo(() => {
    const grouped: Record<string, RxTemplate[]> = {};
    const add = (template: RxTemplate) => {
      const items = grouped[template.type] ?? [];
      if (items.some(item => item.id === template.id || item.content.trim() === template.content.trim())) return;
      grouped[template.type] = [...items, template];
    };
    Object.values(allTemplatesGrouped).flat().forEach(template => add(template as RxTemplate));
    Object.values(templates).flat().forEach(add);
    managedDefaultTemplates.forEach(add);
    return grouped;
  }, [allTemplatesGrouped, managedDefaultTemplates, templates]);
  const selectedFollowUpOption = followUpOptions.includes(followUpValue) ? followUpValue : CUSTOM_TEMPLATE_VALUE;

  const saveFollowUpOption = () => {
    const value = followUpValue.trim();
    if (!value) {
      toast({ title: isBn ? "ফলো-আপ লিখুন" : "Enter a follow-up first", variant: "destructive" });
      return;
    }
    const next = [...new Set([...savedFollowUpOptions, value])];
    setSavedFollowUpOptions(next);
    localStorage.setItem(followUpPresetStorageKey, JSON.stringify(next));
    toast({ title: isBn ? "ফলো-আপ পুনঃব্যবহারের জন্য সেভ হয়েছে" : "Follow-up saved for reuse", duration: 1500 });
  };

  const queueServing = queueData?.serving?.[0] ?? null;
  const queueWaiting = queueData?.waiting ?? [];
  const allQueue = [...(queueData?.serving ?? []), ...(queueData?.waiting ?? [])];
  const activeCalculator = CALCULATOR_REGISTRY.find(calculator => calculator.key === activeCalculatorKey) ?? null;
  const quickToolItems = [
    {
      key: "templates",
      label: L.templates,
      icon: BookOpen,
      onClick: () => setShowTemplates(v => !v),
      indicator: showTemplates ? "−" : "+",
    },
    {
      key: "new-tool",
      label: isBn ? "নতুন টুল" : "New Tool",
      icon: Plus,
      onClick: () => setShowNewToolNotice(v => !v),
      indicator: "+",
    },
  ];
  const savePrintLabel = editingId != null ? (isBn ? "আপডেট ও প্রিন্ট" : "Update & Print") : L.savePrint;
  const saveOnlyLabel = editingId != null ? (isBn ? "আপডেট" : "Update") : L.saveOnly;
  const saveDraftLabel = editingId != null ? (isBn ? "ড্রাফট আপডেট" : "Update Draft") : L.saveDraft;

  // ── Doctor status from queue data (new fields added to GET /queue)
  const qDoctorStatus = (queueData as any)?.doctorStatus ?? null;
  const qBreakUntil = (queueData as any)?.breakUntil ?? null;
  const isOnBreak = qDoctorStatus === "busy" && !!qBreakUntil;
  const isDayEnded = qDoctorStatus === "offline";
  const qCompleted = (queueData as any)?.completed ?? 0;
  const qSkipped = (queueData as any)?.skipped?.length ?? 0;
  const qTotalToday = (queueData as any)?.totalToday ?? 0;
  const qAvgConsultMs = (queueData as any)?.avgConsultationMs ?? 0;
  const qFirstPatientTime = (queueData as any)?.firstPatientTime ?? null;
  const qLastPatientTime = (queueData as any)?.lastPatientTime ?? null;
  const allAppts = apptData?.appointments ?? [];

  const shortcutKey = (med: Omit<MedItem, "id">) =>
    [med.brandName, med.genericName, med.strength, med.dosageForm, med.dose, med.durationNum, med.durationUnit, med.timing, med.instructions]
      .map(value => value.trim().toLowerCase())
      .join("|");

  const persistMedicineShortcuts = useCallback((next: MedicineShortcut[]) => {
    if (!medicineShortcutStorageKey) return;
    try { localStorage.setItem(medicineShortcutStorageKey, JSON.stringify(next.slice(0, 30))); } catch { /* storage is optional */ }
  }, [medicineShortcutStorageKey]);

  useEffect(() => {
    if (!medicineShortcutStorageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(medicineShortcutStorageKey) || "[]");
      if (Array.isArray(saved)) setMedicineShortcuts(saved.filter(item => item && typeof item.key === "string").slice(0, 30));
    } catch { setMedicineShortcuts([]); }
  }, [medicineShortcutStorageKey]);

  const recordMedicineShortcut = (med: MedItem) => {
    const { id: _id, ...shortcut } = med;
    const key = shortcutKey(shortcut);
    setMedicineShortcuts(previous => {
      const existing = previous.find(item => item.key === key);
      const next = [
        { ...shortcut, key, lastUsedAt: Date.now(), isFavorite: existing?.isFavorite ?? false },
        ...previous.filter(item => item.key !== key),
      ];
      persistMedicineShortcuts(next);
      return next.slice(0, 30);
    });
  };

  const toggleMedicineFavorite = (key: string) => {
    setMedicineShortcuts(previous => {
      const next = previous.map(item => item.key === key ? { ...item, isFavorite: !item.isFavorite } : item);
      persistMedicineShortcuts(next);
      return next;
    });
  };

  const removeMedicineShortcut = (key: string) => {
    setMedicineShortcuts(previous => {
      const next = previous.filter(item => item.key !== key);
      persistMedicineShortcuts(next);
      return next;
    });
  };

  const useMedicineShortcut = (shortcut: MedicineShortcut) => {
    setSelectedMedicineId(-1);
    setSaveMedicineToDb(false);
    setCurrentMed({ ...shortcut, id: crypto.randomUUID() });
    setShowSug(false);
    setMedSug([]);
    medInputRef.current?.focus();
  };

  const visibleMedicineShortcuts = useMemo(() =>
    [...medicineShortcuts].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.lastUsedAt - a.lastUsedAt).slice(0, 8),
    [medicineShortcuts],
  );
  const favoriteMedicineShortcuts = useMemo(
    () => visibleMedicineShortcuts.filter(item => item.isFavorite),
    [visibleMedicineShortcuts],
  );
  const recentMedicineShortcuts = useMemo(
    () => visibleMedicineShortcuts.filter(item => !item.isFavorite),
    [visibleMedicineShortcuts],
  );

  const hasDraftContent = (draft: Pick<LocalPrescriptionDraft, "patient" | "currentMed" | "medicines" | "advice" | "treatmentNote" | "followUpDate" | "diagnosis">) =>
    !!draft.patient.name.trim() || !!draft.patient.phone.trim() || !!draft.patient.cc.trim() ||
    !!draft.patient.oe.trim() || !!draft.patient.ixCustom.trim() || draft.patient.ixChips.length > 0 ||
    !!draft.patient.drugHistory.trim() || !!draft.currentMed.brandName.trim() ||
    !!draft.currentMed.genericName.trim() || draft.medicines.length > 0 || !!draft.advice.trim() ||
    !!draft.treatmentNote.trim() || !!draft.followUpDate || !!draft.diagnosis.trim();

  const clearLocalDraft = useCallback(() => {
    if (prescriptionDraftStorageKey) {
      try { localStorage.removeItem(prescriptionDraftStorageKey); } catch { /* storage is optional */ }
    }
    setRecoveryDraft(null);
  }, [prescriptionDraftStorageKey]);

  // Recover only an unfinished write-form draft. Existing URL loads and reprints
  // continue to take precedence over local recovery.
  useEffect(() => {
    if (!prescriptionDraftStorageKey) return;
    const params = new URLSearchParams(searchStr);
    if (params.get("id") || params.get("duplicate") || params.get("reprint")) return;
    draftHydratedKeyRef.current = prescriptionDraftStorageKey;
    try {
      const saved = JSON.parse(localStorage.getItem(prescriptionDraftStorageKey) || "null") as LocalPrescriptionDraft | null;
      if (saved?.version === 1 && hasDraftContent(saved) && Date.now() - saved.savedAt < 1000 * 60 * 60 * 24 * 14) {
        setRecoveryDraft(saved);
      }
    } catch { /* ignore malformed optional recovery data */ }
  }, [prescriptionDraftStorageKey, searchStr]);

  // A small local safety net protects work from a browser refresh or accidental
  // navigation without changing the server prescription or database schema.
  useEffect(() => {
    if (!prescriptionDraftStorageKey || draftHydratedKeyRef.current !== prescriptionDraftStorageKey || mode !== "write" || recoveryDraft) return;
    const draft = { patient, currentMed, medicines, advice, treatmentNote, followUpDate, diagnosis };
    if (!hasDraftContent(draft)) {
      try { localStorage.removeItem(prescriptionDraftStorageKey); } catch { /* storage is optional */ }
      return;
    }
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(prescriptionDraftStorageKey, JSON.stringify({ version: 1, savedAt: Date.now(), ...draft }));
      } catch { /* storage is optional */ }
    }, 500);
    return () => clearTimeout(timer);
  }, [prescriptionDraftStorageKey, mode, recoveryDraft, patient, currentMed, medicines, advice, treatmentNote, followUpDate, diagnosis]);

  // Patient list = unique patients from this doctor's prescription history,
  // scoped to the selected loader date (only patients seen on that date).
  const patientList = (() => {
    const seen = new Map<string, Prescription>();
    for (const p of rxHistory ?? []) {
      if (toLocalDateStr(new Date(p.createdAt)) !== loaderDate) continue;
      const key = `${(p.patientName ?? "").toLowerCase()}|${p.patientPhone ?? ""}`;
      if (!seen.has(key)) seen.set(key, p);
    }
    return Array.from(seen.values());
  })();

  // Build a phone-number set from ALL prescription history (not date-filtered)
  // so we can show "Continue Rx" next to any queue/appt entry that has a prior Rx.
  const prevRxByPhone = useMemo(() => {
    const s = new Set<string>();
    for (const p of rxHistory ?? []) {
      if (p.patientPhone) s.add(p.patientPhone);
    }
    return s;
  }, [rxHistory]);

  const filteredQ = patientSearch
    ? allQueue.filter(e => (e.patientName ?? "").toLowerCase().includes(patientSearch.toLowerCase()) || (e.patientPhone ?? "").includes(patientSearch) || String(e.serialNo).includes(patientSearch))
    : allQueue;
  const apptNumbered = allAppts.map((a, i) => ({ ...a, _serial: i + 1 }));
  const filteredA = patientSearch
    ? apptNumbered.filter(a => (a.patientName ?? "").toLowerCase().includes(patientSearch.toLowerCase()) || (a.patientPhone ?? "").includes(patientSearch) || String(a._serial).includes(patientSearch))
    : apptNumbered;
  const filteredP = patientSearch
    ? patientList.filter(p => (p.patientName ?? "").toLowerCase().includes(patientSearch.toLowerCase()) || (p.patientPhone ?? "").includes(patientSearch))
    : patientList.slice(0, 10);

  // ── Load templates
  // Returns a promise so callers can `await` it right after a create/edit/delete
  // mutation — guaranteeing the left panel (and the manager list) always reflect
  // the latest saved template database state, never a stale cached copy.
  const reloadTemplates = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    try {
      const res = await fetch("/api/rx-templates", { headers: { Authorization: token ? `Bearer ${token}` : "" } });
      if (!res.ok) return;
      const data: RxTemplate[] = await res.json();
      const grouped: Record<string, RxTemplate[]> = {};
      data.forEach(t => {
        const arr = grouped[t.type] ? [...grouped[t.type], t] : [t];
        arr.sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0));
        grouped[t.type] = arr;
      });
      setTemplates(grouped);
    } catch { /* keep last known-good templates on transient network errors */ }
  }, []);

  const reloadAllTemplates = useCallback(async () => {
    const token = localStorage.getItem("auth_token");
    try {
      const res = await fetch("/api/rx-templates?all=1", { headers: { Authorization: token ? `Bearer ${token}` : "" } });
      if (!res.ok) return;
      const data: any[] = await res.json();
      const grouped: Record<string, any[]> = {};
      data.forEach(t => { grouped[t.type] = grouped[t.type] ? [...grouped[t.type], t] : [t]; });
      setAllTemplatesGrouped(grouped);
    } catch { /* keep last good state */ }
  }, []);

  useEffect(() => { reloadTemplates(); }, [reloadTemplates]);

  // ── Break countdown (real-time HH:MM:SS)
  const breakCdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [breakCdStr, setBreakCdStr] = useState<string | null>(null);
  const [breakExpired, setBreakExpired] = useState(false);
  useEffect(() => {
    if (breakCdRef.current) clearInterval(breakCdRef.current);
    setBreakExpired(false);
    if (!isOnBreak || !qBreakUntil) { setBreakCdStr(null); return; }
    const tick = () => {
      const ms = new Date(qBreakUntil).getTime() - Date.now();
      if (ms <= 0) {
        setBreakCdStr("00:00:00"); setBreakExpired(true);
        if (breakCdRef.current) clearInterval(breakCdRef.current);
        return;
      }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setBreakCdStr(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
    };
    tick();
    breakCdRef.current = setInterval(tick, 1000);
    return () => { if (breakCdRef.current) clearInterval(breakCdRef.current); };
  }, [isOnBreak, qBreakUntil]);

  // ── Medicine autocomplete
  // `suppressNextSearchRef` is set right before a programmatic (non-typing) change to
  // currentMed.brandName — e.g. selecting a suggestion — so the effect below skips
  // re-querying and reopening the dropdown for that one change. It resets itself
  // after being consumed once, so the next real keystroke searches normally.
  const suppressNextSearchRef = useRef(false);

  const searchMeds = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q || q.length < 2) {
      setMedSug([]);
      setShowSug(false);
      setActiveMedSugIndex(-1);
      return;
    }
    debounceRef.current = setTimeout(() => {
      fetch(`/api/medicines?q=${encodeURIComponent(q)}&limit=10`)
        .then(r => r.json()).then(data => {
          setMedSug(data);
          setShowSug(data.length > 0);
          setActiveMedSugIndex(-1);
        })
        .catch(() => {});
    }, 250);
  }, []);

  useEffect(() => {
    if (suppressNextSearchRef.current) {
      suppressNextSearchRef.current = false;
      return;
    }
    searchMeds(currentMed.brandName);
  }, [currentMed.brandName]);

  // Close autocomplete on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sugRef.current && !sugRef.current.contains(e.target as Node) && !medInputRef.current?.contains(e.target as Node)) {
        setShowSug(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectMedSug = (s: MedSuggestion) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    suppressNextSearchRef.current = true;
    setSelectedMedicineId(s.id);
    setSaveMedicineToDb(false);
    setCurrentMed(m => ({ ...m, brandName: s.brandName, genericName: s.genericName ?? "", strength: s.strength ?? "", dosageForm: s.dosageForm ?? "" }));
    setShowSug(false);
    setMedSug([]);
    setActiveMedSugIndex(-1);
  };

  const handleMedicineInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && showSug && medSug.length > 0) {
      event.preventDefault();
      setActiveMedSugIndex(index => (index + 1) % medSug.length);
      return;
    }
    if (event.key === "ArrowUp" && showSug && medSug.length > 0) {
      event.preventDefault();
      setActiveMedSugIndex(index => (index <= 0 ? medSug.length - 1 : index - 1));
      return;
    }
    if (event.key === "Escape" && showSug) {
      event.preventDefault();
      setShowSug(false);
      setActiveMedSugIndex(-1);
      return;
    }
    if (event.key !== "Enter") return;

    if (showSug && medSug.length > 0) {
      event.preventDefault();
      selectMedSug(medSug[activeMedSugIndex >= 0 ? activeMedSugIndex : 0]);
      return;
    }

    if (currentMed.brandName.trim() || currentMed.genericName.trim()) {
      event.preventDefault();
      if (editingMedicineId) updateMedicine();
      else void addMedicine();
    }
  };

  // ── Add medicine to list
  const addMedicine = async () => {
    if (!currentMed.brandName.trim() && !currentMed.genericName.trim()) {
      toast({ title: L.enterMedName, variant: "destructive" }); return;
    }
    if (saveMedicineToDb && !currentMed.brandName.trim()) {
      toast({ title: isBn ? "ব্র্যান্ড নাম প্রয়োজন" : "Brand name is required to save in DB", variant: "destructive" });
      return;
    }
    if (saveMedicineToDb) {
      try {
        await createMedicine.mutateAsync({
          data: {
            brandName: currentMed.brandName.trim(),
            genericName: currentMed.genericName.trim() || undefined,
            strength: currentMed.strength.trim() || undefined,
            dosageForm: currentMed.dosageForm.trim() || undefined,
          },
        });
        toast({ title: isBn ? "ডাটাবেসে সংরক্ষিত হয়েছে" : "Medicine saved in DB" });
      } catch {
        toast({ title: isBn ? "ডাটাবেসে সংরক্ষণ করা যায়নি" : "Could not save medicine in DB", variant: "destructive" });
      }
    }
    recordMedicineShortcut(currentMed);
    setMedicines(m => [...m, { ...currentMed, id: crypto.randomUUID() }]);
    setCurrentMed(emptyMed());
    setSaveMedicineToDb(false);
    setSelectedMedicineId(null);
    setMedSug([]);
    setShowSug(false);
    setActiveMedSugIndex(-1);
    setShowMedicineComposer(false);
    medInputRef.current?.focus();
  };

  const editMedicine = (medicine: MedItem) => {
    suppressNextSearchRef.current = true;
    setSelectedMedicineId(null);
    setCurrentMed({ ...medicine });
    setEditingMedicineId(medicine.id);
    setShowSug(false);
    window.setTimeout(() => medInputRef.current?.focus(), 0);
  };

  const updateMedicine = () => {
    if (!editingMedicineId) return;
    if (!currentMed.brandName.trim() && !currentMed.genericName.trim()) {
      toast({ title: L.enterMedName, variant: "destructive" }); return;
    }
    recordMedicineShortcut(currentMed);
    setMedicines(items => items.map(item =>
      item.id === editingMedicineId ? { ...currentMed, id: editingMedicineId } : item,
    ));
    setCurrentMed(emptyMed());
    setEditingMedicineId(null);
    setSaveMedicineToDb(false);
    setMedSug([]);
    setShowSug(false);
    setActiveMedSugIndex(-1);
    setShowMedicineComposer(false);
    medInputRef.current?.focus();
  };

  const moveMedicine = (id: string, direction: -1 | 1) => {
    setMedicines(items => {
      const index = items.findIndex(item => item.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= items.length) return items;
      const next = [...items];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const dropMedicine = (targetId: string) => {
    if (!draggedMedicineId || draggedMedicineId === targetId) return;
    setMedicines(items => {
      const fromIndex = items.findIndex(item => item.id === draggedMedicineId);
      const toIndex = items.findIndex(item => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return items;
      const next = [...items];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(fromIndex < toIndex ? toIndex - 1 : toIndex, 0, moved);
      return next;
    });
    setDraggedMedicineId(null);
  };

  const removeMed = (id: string) => {
    const medicine = medicines.find(item => item.id === id);
    const medicineName = medicine?.brandName || medicine?.genericName || (isBn ? "এই ওষুধ" : "this medicine");
    const confirmed = window.confirm(
      isBn ? `${medicineName} প্রেসক্রিপশন থেকে মুছে ফেলবেন?` : `Remove ${medicineName} from this prescription?`,
    );
    if (!confirmed) return;
    setMedicines(items => items.filter(item => item.id !== id));
    if (editingMedicineId === id) {
      setCurrentMed(emptyMed());
      setEditingMedicineId(null);
      setSelectedMedicineId(null);
      setSaveMedicineToDb(false);
    }
  };

  const cancelMedicineEdit = () => {
    setCurrentMed(emptyMed());
    setEditingMedicineId(null);
    setSelectedMedicineId(null);
    setSaveMedicineToDb(false);
    setShowSug(false);
    setMedSug([]);
    setActiveMedSugIndex(-1);
    medInputRef.current?.focus();
  };

  const restoreLocalDraft = () => {
    if (!recoveryDraft) return;
    setPatient({ ...emptyPatient(), ...recoveryDraft.patient });
    setCurrentMed({ ...emptyMed(), ...recoveryDraft.currentMed, id: crypto.randomUUID() });
    setMedicines(recoveryDraft.medicines.map(med => ({ ...med, id: crypto.randomUUID() })));
    setAdvice(recoveryDraft.advice);
    setTreatmentNote(recoveryDraft.treatmentNote);
    setFollowUpDate(recoveryDraft.followUpDate);
    setDiagnosis(recoveryDraft.diagnosis);
    setCcOpen(!!recoveryDraft.patient.cc);
    setOeOpen(!!recoveryDraft.patient.oe);
    setIxOpen(!!recoveryDraft.patient.ixChips.length || !!recoveryDraft.patient.ixCustom);
    setRecoveryDraft(null);
    toast({ title: isBn ? "অসম্পূর্ণ প্রেসক্রিপশন ফিরে এসেছে" : "Prescription draft restored" });
  };

  // ── Apply vitals from an appointment record onto patient state
  const applyApptVitals = (appt: Partial<(typeof allAppts)[0]> | undefined) => {
    if (!appt) return;
    setPatient(p => ({
      ...p,
      age: appt.patientAge != null ? String(appt.patientAge) : p.age,
      sex: appt.patientGender === "Male" ? "M" : appt.patientGender === "Female" ? "F" : appt.patientGender ? "O" : p.sex,
      bp: appt.bp ?? p.bp,
      pulse: appt.pulse ?? p.pulse,
      temp: appt.temp ?? p.temp,
      weight: appt.weight ?? p.weight,
      height: appt.height ?? p.height,
      hb: appt.hb ?? p.hb,
      sugar: appt.sugar ?? p.sugar,
      spo2: appt.spo2 ?? p.spo2,
      cc: appt.complaint ? (p.cc ? p.cc : appt.complaint) : p.cc,
      oe: appt.notes ? (p.oe ? p.oe : appt.notes) : p.oe,
      drugHistory: appt.medicalHistory ? (p.drugHistory ? p.drugHistory : appt.medicalHistory) : p.drugHistory,
      labReportUrl: appt.labReportUrl ?? p.labReportUrl,
      prescriptionUploadUrl: appt.prescriptionUploadUrl ?? p.prescriptionUploadUrl,
    }));
    // Auto-expand sections that now have content from the appointment so the
    // doctor can see (and edit) the pre-filled data immediately.
    if (appt.complaint) setCcOpen(true);
    if (appt.notes) setOeOpen(true);
  };

  // ── Fetch the most-recent prescription saved for a patient phone number.
  //    Used to auto-reload prior clinical data (CC, OE, IX, medicines, advice, etc.)
  //    whenever the same patient is opened again from the queue, appointment list,
  //    or prescription history.  Silent on any error — never blocks the load.
  const fetchLatestRxForPatient = useCallback(async (phone: string | null | undefined): Promise<StoredPrescription | null> => {
    if (!phone) return null;
    try {
      const token = localStorage.getItem("auth_token") || "";
      const res = await fetch(`/api/prescriptions?patientPhone=${encodeURIComponent(phone)}&limit=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data) && data.length > 0 ? (data[0] as StoredPrescription) : null;
    } catch { return null; }
  }, []);

  // ── Fetch patient profile photo by phone (best-effort, silent on failure)
  const fetchPatientPhoto = useCallback(async (phone: string | null | undefined) => {
    if (!phone) return;
    try {
      const token = localStorage.getItem("auth_token") || "";
      const r = await fetch(`/api/doctor/patient-photo?phone=${encodeURIComponent(phone)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return;
      const data = await r.json();
      if (data.profilePicture) {
        setPatient(p => ({ ...p, photoUrl: data.profilePicture }));
      }
    } catch { /* silent */ }
  }, []);

  // ── Load patient from queue
  const loadFromQueue = async (entry: (typeof allQueue)[0]) => {
    const matchedAppt = allAppts.find(a => a.id === entry.appointmentId);
    setShowLoadPatient(false);
    setLoadedQueueId(entry.id);
    setLoadedApptId(matchedAppt?.id ?? null);
    setIsRecallMode(false);
    if (entry.status === "waiting") {
      try { await serveMut.mutateAsync({ id: entry.id }); refetchQ(); } catch {}
    }
    // Auto-restore the latest saved prescription for this patient so the
    // doctor doesn't have to re-enter prior clinical data (CC/OE/IX/medicines).
    const latestRx = await fetchLatestRxForPatient(entry.patientPhone);
    if (latestRx) {
      populateFromRx(latestRx);
      // Overlay today's fresh appointment vitals on top of historical values,
      // and ensure name/phone reflect the current queue entry.
      applyApptVitals(matchedAppt);
      setPatient(p => ({ ...p, name: entry.patientName ?? p.name, phone: entry.patientPhone ?? p.phone, photoUrl: undefined }));
    } else {
      setPatient(p => ({ ...p, name: entry.patientName ?? p.name, phone: entry.patientPhone ?? p.phone, photoUrl: undefined }));
      applyApptVitals(matchedAppt);
    }
    toast({ title: `${entry.patientName} ${L.loadedNowServing}` });
    fetchPatientPhoto(entry.patientPhone);
  };

  const loadFromAppt = async (appt: (typeof allAppts)[0]) => {
    setLoadedApptId(appt.id);
    setIsRecallMode(false);
    // Auto-restore the latest saved prescription for this patient.
    const latestRx = await fetchLatestRxForPatient(appt.patientPhone);
    if (latestRx) {
      populateFromRx(latestRx);
      // Overlay appointment's fresh vitals and ensure name/phone are current.
      applyApptVitals(appt);
      setPatient(p => ({ ...p, name: appt.patientName ?? p.name, phone: appt.patientPhone ?? p.phone, photoUrl: undefined }));
    } else {
      setPatient(p => ({ ...p, name: appt.patientName ?? p.name, phone: appt.patientPhone ?? p.phone, photoUrl: undefined }));
      applyApptVitals(appt);
    }
    setShowLoadPatient(false);
    toast({ title: `${appt.patientName} ${L.loaded}` });
    fetchPatientPhoto(appt.patientPhone);
  };

  // Load a patient from prescription history — fully restores all saved clinical
  // data (CC, OE, IX, medicines, advice, follow-up, notes) so the doctor can
  // review, edit, and save a new prescription without re-entering everything.
  // This is RECALL mode: the live queue is NOT touched — Now Serving stays as-is.
  const loadFromPatient = (p: StoredPrescription) => {
    populateFromRx(p);
    // Ensure no queue or appointment link is inherited — this patient is recalled
    // from history, not from the live queue.
    setLoadedQueueId(null);
    setLoadedApptId(null);
    setIsRecallMode(true);
    setShowLoadPatient(false);
    toast({ title: `${p.patientName} ${L.loaded}` });
    fetchPatientPhoto(p.patientPhone);
  };

  // ── Resume Consultation: re-link a recalled patient to the live queue.
  // If the patient's phone is found in today's queue (waiting or serving), the
  // doctor is switched to queue mode for that entry so the prescription save will
  // auto-advance the queue.  If not found the recall mode is simply cleared and
  // the prescription is saved without touching the queue.
  const handleResumeConsultation = async () => {
    const matchedEntry = allQueue.find(
      e => e.patientPhone && patient.phone && e.patientPhone === patient.phone,
    );
    if (matchedEntry) {
      try {
        // Bring this entry back to "serving" via the recall API, then re-link.
        await recallMut.mutateAsync({ id: matchedEntry.id } as any);
        await refetchQ();
        setLoadedQueueId(matchedEntry.id);
        setIsRecallMode(false);
        toast({
          title: isBn
            ? `${patient.name} — পরামর্শ শুরু হয়েছে`
            : `${patient.name} — Consultation resumed`,
        });
      } catch {
        toast({ title: L.failed, variant: "destructive" });
      }
    } else {
      // Patient is not in today's queue — exit recall mode, save will proceed
      // without queue advancement.
      setIsRecallMode(false);
      toast({
        title: isBn ? "কিউতে নেই" : "Not in today's queue",
        description: isBn
          ? "প্রেসক্রিপশন স্বাভাবিকভাবে সেভ হবে।"
          : "Prescription will be saved without queue advancement.",
      });
    }
  };

  // ── Queue actions
  const queueAction = async (action: "next"|"skip"|"seen"|"recall", id?: number) => {
    // Guard: do not advance if the doctor is on break or the day has ended.
    if (action === "next" && (isOnBreak || isDayEnded)) {
      toast({
        title: isOnBreak
          ? (isBn ? "বিরতিতে আছেন" : "Doctor is on break")
          : (isBn ? "দিন শেষ হয়েছে" : "Day has ended"),
        variant: "destructive",
      });
      return;
    }
    try {
      if (action === "next") {
        // callNext expects a queue ENTRY id (not the doctor profile id).
        // Use the currently-serving entry's id; fall back to the entry the
        // doctor explicitly loaded so the API can resolve the doctorId.
        const entryId = queueServing?.id ?? loadedQueueId;
        if (!entryId) {
          toast({ title: isBn ? "কোনো সক্রিয় রোগী নেই" : "No active patient in queue" });
          return;
        }
        await callNext.mutateAsync({ id: entryId });
        const fresh = await refetchQ();
        const nextServing = (fresh.data as any)?.serving?.[0] ?? null;
        if (nextServing) {
          resetForm();
          await loadFromQueue(nextServing);
        } else {
          // No more waiting patients — queue is complete for today.
          toast({
            title: isBn ? "আজকের কিউ সম্পন্ন" : "Today's Queue Completed",
            description: isBn ? "আজকের সব রোগী দেখা হয়েছে।" : "All patients for today have been seen.",
          });
        }
      } else if (action === "skip" && id) {
        await skipMut.mutateAsync({ id } as any);
        refetchQ();
      } else if (action === "seen" && id) {
        await seenMut.mutateAsync({ id } as any);
        refetchQ();
      } else if (action === "recall" && id) {
        await recallMut.mutateAsync({ id } as any);
        refetchQ();
      }
    } catch { toast({ title: L.failed, variant: "destructive" }); }
  };

  // ── Apply template
  const applyTemplate = (t: RxTemplate) => {
    if (t.type === "full") {
      try {
        const data = JSON.parse(t.content) as FullPrescriptionTemplateData;
        const observations = data.observations ?? {};
        setPatient(p => ({
          ...p,
          ...(Object.prototype.hasOwnProperty.call(observations, "cc") ? { cc: observations.cc ?? "" } : {}),
          ...(Object.prototype.hasOwnProperty.call(observations, "oe") ? { oe: observations.oe ?? "" } : {}),
          ...(Object.prototype.hasOwnProperty.call(observations, "ixChips") ? { ixChips: observations.ixChips ?? [] } : {}),
          ...(Object.prototype.hasOwnProperty.call(observations, "ixCustom") ? { ixCustom: observations.ixCustom ?? "" } : {}),
          ...(Object.prototype.hasOwnProperty.call(observations, "drugHistory") ? { drugHistory: observations.drugHistory ?? "" } : {}),
        }));
        if (Object.prototype.hasOwnProperty.call(observations, "cc")) setCcOpen(!!observations.cc);
        if (Object.prototype.hasOwnProperty.call(observations, "oe")) setOeOpen(!!observations.oe);
        if (Object.prototype.hasOwnProperty.call(observations, "ixChips") || Object.prototype.hasOwnProperty.call(observations, "ixCustom")) {
          setIxOpen(!!observations.ixChips?.length || !!observations.ixCustom);
        }
        if (Object.prototype.hasOwnProperty.call(data, "diagnosis")) setDiagnosis(data.diagnosis ?? "");
        if (Object.prototype.hasOwnProperty.call(data, "advice")) setAdvice(data.advice ?? "");
        if (Object.prototype.hasOwnProperty.call(data, "treatmentNote")) setTreatmentNote(data.treatmentNote ?? "");
        if (Object.prototype.hasOwnProperty.call(data, "followUpDate")) setFollowUpDate(data.followUpDate ?? "");
        if (Array.isArray(data.medicines)) {
          setMedicines(cloneTemplateMedicines(data.medicines));
        }
      } catch {
        toast({ title: L.templateSaveFailed, variant: "destructive" });
        return;
      }
    }
    else if (t.type === "cc") setPatient(p => ({ ...p, cc: p.cc ? `${p.cc}\n${t.content}` : t.content }));
    else if (t.type === "oe") setPatient(p => ({ ...p, oe: p.oe ? `${p.oe}\n${t.content}` : t.content }));
    else if (t.type === "ix") {
      const chips = t.content.split(",").map(s => s.trim()).filter(Boolean);
      setPatient(p => ({ ...p, ixChips: [...new Set([...p.ixChips, ...chips])] }));
    }
    else if (t.type === "drugHistory") setPatient(p => ({ ...p, drugHistory: p.drugHistory ? `${p.drugHistory}\n${t.content}` : t.content }));
    else if (t.type === "advice") setAdvice(a => a ? `${a}\n${t.content}` : t.content);
    else if (t.type === "dose") setCurrentMed(m => ({ ...m, dose: t.content }));
    else if (t.type === "timing") setCurrentMed(m => ({ ...m, timing: t.content }));
    else if (t.type === "duration") {
      const parsed = parseDurationPreset(t.content);
      if (parsed) {
        setCurrentMed(m => ({ ...m, durationNum: parsed.n, durationUnit: parsed.u }));
      } else {
        setCurrentMed(m => ({ ...m, durationNum: t.content }));
      }
    }
    else if (t.type === "treatment" || t.type === "protocol") setTreatmentNote(n => n ? `${n}\n${t.content}` : t.content);
    else if (t.type === "followup") setFollowUpDate(t.content);
    toast({ title: `${L.templateApplied}: ${t.title}`, duration: 1500 });
  };

  const openNewTemplate = (type: string = "advice") => {
    setEditingTmplId(null);
    setNewTmpl(emptyTemplateForm(type));
    setTemplateMedicines(type === "full" ? cloneTemplateMedicines(medicines) : []);
    setShowTemplateForm(true);
  };

  const updateTemplateMedicine = (id: string, patch: Partial<MedItem>) => {
    setTemplateMedicines(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const addTemplateMedicine = () => {
    setTemplateMedicines(items => [...items, emptyTemplateMed()]);
  };

  const removeTemplateMedicine = (id: string) => {
    setTemplateMedicines(items => items.filter(item => item.id !== id));
  };

  const cancelTemplateForm = () => {
    setShowTemplateForm(false);
    setEditingTmplId(null);
    setNewTmpl(emptyTemplateForm());
    setTemplateMedicines([]);
  };

  // ── Save template (create or edit)
  const saveTemplate = async () => {
    const content = newTmpl.type === "full"
      ? JSON.stringify({
          observations: {
            cc: patient.cc,
            oe: patient.oe,
            ixChips: patient.ixChips,
            ixCustom: patient.ixCustom,
            drugHistory: patient.drugHistory,
          },
          diagnosis,
          medicines: templateMedicines.map(({ id: _id, ...medicine }) => medicine),
          advice,
          treatmentNote,
          followUpDate,
        } satisfies FullPrescriptionTemplateData)
      : newTmpl.content;
    if (!newTmpl.title.trim() || (newTmpl.type !== "full" && !content.trim())) {
      toast({ title: L.titleContentRequired, variant: "destructive" }); return;
    }
    try {
      const token = localStorage.getItem("auth_token") || "";
      const body = {
        type: newTmpl.type,
        title: newTmpl.title,
        content,
        department: newTmpl.department.trim() || null,
        isFavorite: newTmpl.isFavorite,
      };
      const isBuiltinEdit = editingTmplId !== null && editingTmplId < 0;
      const isEditingCustom = editingTmplId !== null && editingTmplId > 0;
      if (isBuiltinEdit) {
        persistManagedDefaultTemplates(managedDefaultTemplates.map(template =>
          template.id === editingTmplId ? { ...template, ...body } : template
        ));
        toast({ title: L.templateUpdated });
        cancelTemplateForm();
        return;
      }
      const res = await fetch(isEditingCustom && !isBuiltinEdit ? `/api/rx-templates/${editingTmplId}` : "/api/rx-templates", {
        method: isEditingCustom && !isBuiltinEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Save failed"));
      toast({ title: isEditingCustom ? L.templateUpdated : L.templateSaved });
      cancelTemplateForm();
      await Promise.all([reloadTemplates(), reloadAllTemplates()]);
    } catch { toast({ title: L.templateSaveFailed, variant: "destructive" }); }
  };

  const editTemplate = (t: RxTemplate) => {
    setEditingTmplId(t.id);
    setNewTmpl({ type: t.type, title: t.title, content: t.content, department: t.department ?? "", isFavorite: !!t.isFavorite });
    if (t.type === "full") {
      try {
        const data = JSON.parse(t.content) as FullPrescriptionTemplateData;
        setTemplateMedicines(Array.isArray(data.medicines) ? cloneTemplateMedicines(data.medicines) : []);
      } catch {
        setTemplateMedicines([]);
      }
    } else {
      setTemplateMedicines([]);
    }
    setShowTemplateForm(true);
  };

  const deleteTemplate = async (t: RxTemplate) => {
    if (!window.confirm(L.deleteTmplConfirm)) return;
    if (t.id < 0) {
      persistManagedDefaultTemplates(managedDefaultTemplates.filter(template => template.id !== t.id));
      toast({ title: L.templateDeleted });
      return;
    }
    try {
      const token = localStorage.getItem("auth_token") || "";
      const res = await fetch(`/api/rx-templates/${t.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await res.text().catch(() => "Delete failed"));
      toast({ title: L.templateDeleted });
      await reloadTemplates();
    } catch { toast({ title: L.templateSaveFailed, variant: "destructive" }); }
  };

  const toggleFavorite = async (t: RxTemplate) => {
    try {
      const token = localStorage.getItem("auth_token") || "";
      const res = await fetch(`/api/rx-templates/${t.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: t.type, title: t.title, content: t.content, department: t.department ?? null, isFavorite: !t.isFavorite }),
      });
      if (!res.ok) throw new Error(await res.text().catch(() => "Update failed"));
      await reloadTemplates();
    } catch { toast({ title: L.templateSaveFailed, variant: "destructive" }); }
  };

  const hideTemplate = async (t: any, hide: boolean) => {
    if (t.id < 0) {
      persistManagedDefaultTemplates(managedDefaultTemplates.map(template =>
        template.id === t.id ? { ...template, isHidden: hide } : template
      ));
      return;
    }
    const token = localStorage.getItem("auth_token") || "";
    await fetch(`/api/rx-templates/${t.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ isHidden: hide }),
    });
    await Promise.all([reloadTemplates(), reloadAllTemplates()]);
  };

  const moveTemplate = async (t: any, dir: -1 | 1) => {
    if (t.id < 0) {
      const list = managedDefaultTemplates.filter(template => template.type === t.type);
      const idx = list.findIndex(template => template.id === t.id);
      const swapIdx = idx + dir;
      if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return;
      [list[idx], list[swapIdx]] = [list[swapIdx], list[idx]];
      let position = 0;
      persistManagedDefaultTemplates(managedDefaultTemplates.map(template =>
        template.type === t.type ? list[position++] : template
      ));
      return;
    }
    const list = [...(allTemplatesGrouped[t.type] ?? [])];
    const idx = list.findIndex((x: any) => x.id === t.id);
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const swap = list[swapIdx];
    const token = localStorage.getItem("auth_token") || "";
    const tOrder = t.sortOrder ?? idx;
    const sOrder = swap.sortOrder ?? swapIdx;
    await Promise.all([
      fetch(`/api/rx-templates/${t.id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ sortOrder: sOrder === tOrder ? tOrder - dir : sOrder }) }),
      fetch(`/api/rx-templates/${swap.id}`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ sortOrder: sOrder === tOrder ? sOrder + dir : tOrder }) }),
    ]);
    await Promise.all([reloadTemplates(), reloadAllTemplates()]);
  };

  const restoreDefaultTemplates = async () => {
    if (!window.confirm(isBn ? "সকল ডিফল্ট টেমপ্লেট পুনরুদ্ধার করবেন? লুকানো ও মুছে ফেলা ডিফল্টগুলো ফিরে আসবে।" : "Restore all default templates? Hidden and deleted defaults will be brought back.")) return;
    const token = localStorage.getItem("auth_token") || "";
    const res = await fetch("/api/rx-templates/restore-defaults", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) toast({ title: isBn ? "ডিফল্ট টেমপ্লেট পুনরুদ্ধার হয়েছে" : "Default templates restored" });
    else toast({ title: L.templateSaveFailed, variant: "destructive" });
    persistManagedDefaultTemplates(DEFAULT_TEMPLATE_SET);
    await Promise.all([reloadTemplates(), reloadAllTemplates()]);
  };

  // ── Populate form from an existing prescription (edit / duplicate / reprint)
  const populateFromRx = (rx: StoredPrescription) => {
    const v = rx.vitals ?? "";
    const grab = (re: RegExp) => { const m = v.match(re); return m ? m[1].trim() : ""; };
    // Split stored investigations back into chip-selectable items vs free-text.
    const savedIxList = (rx.investigations ?? "").split(",").map(s => s.trim()).filter(Boolean);
    const savedIxChips = savedIxList.filter(s => IX_CHIPS.includes(s));
    const savedIxCustom = savedIxList.filter(s => !IX_CHIPS.includes(s)).join(", ");
    setPatient(() => ({
      ...emptyPatient(),
      name: rx.patientName ?? "",
      age: rx.patientAge != null ? String(rx.patientAge) : "",
      sex: rx.patientGender === "Male" ? "M" : rx.patientGender === "Female" ? "F" : rx.patientGender ? "O" : "M",
      phone: rx.patientPhone ?? "",
      weight: rx.patientWeight ?? "",
      height: rx.patientHeight ?? "",
      bp: grab(/BP:\s*([^|]+)/),
      pulse: grab(/Pulse:\s*([^|]+)/),
      temp: grab(/Temp:\s*([^|]+)/),
      spo2: grab(/SpO2:\s*([^|]+)/),
      hb: grab(/Hb:\s*([^|]+)/),
      sugar: grab(/Sugar:\s*([^|]+)/),
      cc: rx.chiefComplaint ?? "",
      oe: rx.examination ?? "",
      ixChips: savedIxChips,
      ixCustom: savedIxCustom,
       drugHistory: rx.drugHistory ?? "",
    }));
    // Auto-expand any section that already has saved content so loaded data is
    // never hidden behind a collapsed panel; stays collapsed if empty.
    setCcOpen(!!rx.chiefComplaint);
    setOeOpen(!!rx.examination);
    setIxOpen(!!rx.investigations);
    setDiagnosis(rx.diagnosis ?? "");
    setAdvice(rx.advice ?? "");
    setTreatmentNote(rx.notes ?? "");
    setFollowUpDate(rx.followUpDate ?? "");
    setMedicines((rx.items ?? []).map(it => {
      const dur = (it.duration ?? "").trim();
      const dm = dur.match(/(\d+)/);
      const isMonth = /মাস|month/i.test(dur);
      const isWeek = /সপ্তাহ|week/i.test(dur);
      return {
        id: crypto.randomUUID(),
        brandName: it.medicineName ?? "",
        genericName: it.genericName ?? "",
        strength: it.strength ?? "",
        dosageForm: it.dosageForm ?? "",
        dose: it.dose ?? "",
        timing: it.mealTiming ?? "",
        durationNum: dm ? dm[1] : "",
        durationUnit: isMonth ? "M" : isWeek ? "W" : "D",
        instructions: it.instruction ?? "",
      };
    }));
  };

  // ── Generate the verification QR for a reference number
  const genQr = async (referenceNo: string | null | undefined): Promise<string | null> => {
    if (!referenceNo) return null;
    try {
      const verifyUrl = `${window.location.origin}${import.meta.env.BASE_URL}verify/${referenceNo}`;
      return await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });
    } catch { return null; }
  };

  // ── Load existing prescription from URL:
  //    ?id= edit, ?duplicate= copy, ?reprint= open immutable print view.
  //    Re-runs when the query string changes so switching IDs in-session is reactive.
  const lastLoadedRef = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(searchStr);
    const idStr = params.get("id");
    const dupStr = params.get("duplicate");
    const reprintStr = params.get("reprint");
    const loadId = idStr || dupStr || reprintStr;
    if (!loadId) { lastLoadedRef.current = null; return; }
    const loadKey = `${reprintStr ? "r" : idStr ? "e" : "d"}:${loadId}`;
    if (lastLoadedRef.current === loadKey) return;
    lastLoadedRef.current = loadKey;
    getPrescription(Number(loadId)).then(async rx => {
      populateFromRx(rx);
      if (reprintStr) {
        // Reprint: open the existing prescription's print view without mutating it.
        setEditingId(rx.id);
        const qr = await genQr(rx.referenceNo);
        setQrDataUrl(qr);
        setSavedRx(rx);
        setMode("saved");
      } else if (idStr) {
        setEditingId(rx.id);
      }
    }).catch(() => {});
  }, [searchStr]);

  // ── Reset form to blank state (for next patient)
  const resetForm = () => {
    setPatient(emptyPatient());
    setCcOpen(false);
    setOeOpen(false);
    setIxOpen(false);
    setCurrentMed(emptyMed());
    setMedicines([]);
    setAdvice("");
    setTreatmentNote("");
    setFollowUpDate("");
    setDiagnosis("");
    setSavedRx(null);
    setEditingId(null);
    setQrDataUrl(null);
    setLoadedQueueId(null);
    setLoadedApptId(null);
    setIsRecallMode(false);
    setLoc("/doctor/new-prescription");
  };

  // ── Upload an investigation report file (PDF / JPG / PNG)
  const uploadReport = async (file: File) => {
    setReportUploading(true);
    try {
      const token = localStorage.getItem("auth_token") || "";
      const urlRes = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type, category: "prescriptions" }),
      });
      if (!urlRes.ok) throw new Error("URL request failed");
      const { uploadURL, objectPath } = await urlRes.json();
      const putRes = await fetch(uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!putRes.ok) throw new Error("Upload failed");
      setPatient(p => ({ ...p, labReportUrl: objectPath }));
      // Also persist to the linked appointment so it appears in patient timeline.
      if (loadedApptId) {
        await fetch(`/api/appointments/${loadedApptId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ labReportUrl: objectPath }),
        });
      }
      toast({ title: L.reportUploaded });
    } catch {
      toast({ title: L.failed, variant: "destructive" });
    } finally {
      setReportUploading(false);
    }
  };

  // ── Submit prescription
  const handleSave = async (printAfter = false, explicitStatus: "final" | "draft" | "pending_investigation" = "final") => {
    if (!patient.name.trim()) {
      toast({ title: L.enterPatientName, variant: "destructive" }); return;
    }
    // Investigations-only prescriptions (lab referrals, pathology orders) are
    // valid prescriptions — do not require at least one medicine.
    const allIx = [...patient.ixChips, ...(patient.ixCustom ? patient.ixCustom.split(",").map(s => s.trim()).filter(Boolean) : [])].join(", ");
    // Auto-promote to "pending_investigation" when there are IX tests but no medicines.
    const status: "final" | "draft" | "pending_investigation" =
      explicitStatus === "final" && allIx.length > 0 && medicines.length === 0
        ? "pending_investigation"
        : explicitStatus;
    const vitalsStr = [
      patient.bp && `BP: ${patient.bp}`,
      patient.pulse && `Pulse: ${patient.pulse}`,
      patient.temp && `Temp: ${patient.temp}`,
      patient.spo2 && `SpO2: ${patient.spo2}`,
      patient.hb && `Hb: ${patient.hb}`,
      patient.sugar && `Sugar: ${patient.sugar}`,
    ].filter(Boolean).join("  |  ");
    const payload = {
      doctorId: doctor?.id ?? 0,
      status,
      patientName: patient.name,
      patientAge: patient.age ? Number(patient.age) : undefined,
      patientGender: patient.sex === "M" ? "Male" : patient.sex === "F" ? "Female" : "Other",
      patientPhone: patient.phone || undefined,
      patientWeight: patient.weight || undefined,
      patientHeight: patient.height || undefined,
      vitals: vitalsStr || undefined,
      chiefComplaint: patient.cc || undefined,
      examination: patient.oe || undefined,
      drugHistory: patient.drugHistory || undefined,
      diagnosis: diagnosis || undefined,
      investigations: allIx || undefined,
      advice: advice || undefined,
      followUpDate: followUpDate || undefined,
      notes: treatmentNote || undefined,
      items: medicines.map(m => ({
        medicineName: m.brandName || m.genericName,
        genericName: m.genericName || undefined,
        strength: m.strength || undefined,
        dosageForm: m.dosageForm || undefined,
        dose: m.dose || undefined,
        mealTiming: m.timing || undefined,
        duration: m.durationNum.trim()
          ? `${m.durationNum.trim()} ${m.durationUnit === "D" ? "দিন" : m.durationUnit === "W" ? "সপ্তাহ" : "মাস"}`
          : undefined,
        instruction: m.instructions || undefined,
      })),
    };
    try {
      const result = editingId
        ? await updateRx.mutateAsync({ id: editingId, data: payload })
        : await createRx.mutateAsync({ data: payload });
      setEditingId(result.id);
      clearLocalDraft();

      // QR for verification (only final prescriptions get a reference number)
      const qr = await genQr(result.referenceNo);

      // Integrated queue: auto-advance after a finalised prescription.
      const wasInQueue = status === "final" && loadedQueueId != null;
      let nextPatient: any = null;
      if (wasInQueue) {
        try {
          // Mark the current patient as seen first.
          await seenMut.mutateAsync({ id: loadedQueueId! } as any);
          // callNext expects a queue ENTRY id — use loadedQueueId so the API
          // can resolve the doctorId and promote the next waiting patient.
          await callNext.mutateAsync({ id: loadedQueueId! });
          const fresh = await refetchQ();
          nextPatient = (fresh.data as any)?.serving?.[0] ?? null;
        } catch {}
        setLoadedQueueId(null);
      }

      if (printAfter) {
        // Open the print view in a NEW TAB — current tab stays open for next patient.
        window.open(`/doctor/new-prescription?reprint=${result.id}`, "_blank");

        // Auto-advance to next queue patient in the current tab.
        if (nextPatient) {
          resetForm();
          await loadFromQueue(nextPatient);
        } else if (wasInQueue) {
          resetForm();
          toast({ title: isBn ? "আর কোনো রোগী নেই" : "No More Patients in Queue", description: isBn ? "আজকের সব রোগী দেখা হয়েছে।" : "All patients for today have been seen." });
        } else {
          // Not in queue mode — just reset for a fresh prescription
          resetForm();
          toast({ title: isBn ? "সেভ হয়েছে!" : "Prescription saved!", description: result.referenceNo ?? `#${result.id}` });
        }
      } else {
        // Save Only / Save Draft: show preview in same tab as before.
        const rxData = { ...result, patientAgeUnit: patient.ageUnit };
        setSavedRx(rxData);
        setQrDataUrl(qr);
        setMode("saved");
        setPendingNext(nextPatient);
        setIsRecallMode(false);
      }
    } catch {
      toast({ title: L.saveFailed, variant: "destructive" });
    }
  };

  const handlePreview = () => {
    const allIx = [...patient.ixChips, ...(patient.ixCustom ? patient.ixCustom.split(",").map(s => s.trim()).filter(Boolean) : [])].join(", ");
    const vitalsStr = [
      patient.bp && `BP: ${patient.bp}`,
      patient.pulse && `Pulse: ${patient.pulse}`,
      patient.temp && `Temp: ${patient.temp}`,
      patient.spo2 && `SpO2: ${patient.spo2}`,
      patient.hb && `Hb: ${patient.hb}`,
      patient.sugar && `Sugar: ${patient.sugar}`,
    ].filter(Boolean).join("  |  ");
    setSavedRx({
      id: 0,
      referenceNo: null,
      status: "draft",
      createdAt: new Date().toISOString(),
      doctorName: doctor?.name ?? null,
      patientName: patient.name,
      patientPhone: patient.phone || null,
      patientAge: patient.age ? Number(patient.age) : null,
      patientGender: patient.sex === "M" ? "Male" : patient.sex === "F" ? "Female" : "Other",
      patientWeight: patient.weight || null,
      patientHeight: patient.height || null,
      vitals: vitalsStr || null,
      chiefComplaint: patient.cc || null,
      examination: patient.oe || null,
      diagnosis: diagnosis || null,
      investigations: allIx || null,
      advice: advice || null,
      followUpDate: followUpDate || null,
      notes: treatmentNote || null,
      items: medicines.map(m => ({
        medicineName: m.brandName || m.genericName,
        genericName: m.genericName || null,
        strength: m.strength || null,
        dosageForm: m.dosageForm || null,
        dose: m.dose || null,
        mealTiming: m.timing || null,
        duration: m.durationNum.trim()
          ? `${m.durationNum.trim()} ${m.durationUnit === "D" ? "দিন" : m.durationUnit === "W" ? "সপ্তাহ" : "মাস"}`
          : null,
        instruction: m.instructions || null,
      })),
      patientAgeUnit: patient.ageUnit,
    });
    setQrDataUrl(null);
    setPendingNext(null);
    setMode("saved");
  };

  const handleNewRx = () => {
    clearLocalDraft();
    setMode("write");
    setSavedRx(null);
    setEditingId(null);
    setLoadedQueueId(null);
    setIsRecallMode(false);
    setQrDataUrl(null);
    setPatient(emptyPatient());
    setCurrentMed(emptyMed());
    setEditingMedicineId(null);
    setDraggedMedicineId(null);
    setMedicines([]);
    setAdvice("");
    setTreatmentNote("");
    setFollowUpDate("");
    setDiagnosis("");
    setLoc("/doctor/new-prescription");
    // Auto-load the next patient that was staged when the queue advanced.
    const next = pendingNext;
    setPendingNext(null);
    if (next) void loadFromQueue(next);
  };

  // ── Duplicate: keep current form data but save as a brand-new prescription
  const handleDuplicate = () => {
    clearLocalDraft();
    setEditingId(null);
    setSavedRx(null);
    setQrDataUrl(null);
    setLoadedQueueId(null);
    setMode("write");
    setLoc("/doctor/new-prescription");
    toast({ title: L.duplicate });
  };

  // ── Persist per-doctor Rx settings (header + page setup)
  const saveSettings = async () => {
    if (!settingsForm) return;
    const input: DoctorRxSettingsInput = {
      headerName: settingsForm.headerName ?? null,
      headerDegree: settingsForm.headerDegree ?? null,
      headerDesignation: settingsForm.headerDesignation ?? null,
      headerBmdc: settingsForm.headerBmdc ?? null,
      hospitalName: settingsForm.hospitalName ?? null,
      headerAddress: settingsForm.headerAddress ?? null,
      headerPhone: settingsForm.headerPhone ?? null,
      headerEmail: settingsForm.headerEmail ?? null,
      signatureText: settingsForm.signatureText ?? null,
      signatureImage: settingsForm.signatureImage ?? null,
      footerText: settingsForm.footerText ?? null,
      pageSize: settingsForm.pageSize,
      marginTop: settingsForm.marginTop,
      marginRight: settingsForm.marginRight,
      marginBottom: settingsForm.marginBottom,
      marginLeft: settingsForm.marginLeft,
      headerHeight: settingsForm.headerHeight,
      footerHeight: settingsForm.footerHeight,
      showHeader: settingsForm.showHeader,
      showQr: settingsForm.showQr,
      showSignature: settingsForm.showSignature,
      showFooter: settingsForm.showFooter,
    };
    try {
      await updateSettings.mutateAsync({ data: input });
      toast({ title: L.settingsSaved });
      setShowHeaderDlg(false);
      setShowPageDlg(false);
    } catch { toast({ title: L.settingsSaveFailed, variant: "destructive" }); }
  };

  // ── Quick break helpers
  const handleTakeBreak = async (minutes: number) => {
    const end = new Date(Date.now() + minutes * 60 * 1000);
    try {
      await updateStatusRx.mutateAsync({ data: { status: "busy", breakUntil: end.toISOString() } });
      await refetchQ();
      toast({ title: `Break started — ${minutes} min`, description: `Resume by ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` });
    } catch { toast({ title: "Failed to start break", variant: "destructive" }); }
  };
  const handleEndBreak = async () => {
    try {
      await updateStatusRx.mutateAsync({ data: { status: "online" } });
      await refetchQ();
      toast({ title: "Break ended — status set to Available" });
    } catch { toast({ title: "Failed to end break", variant: "destructive" }); }
  };

  // ── Auth guard
  if (!import.meta.env.DEV && (isLoading || !user)) return <div className="min-h-screen flex items-center justify-center">{L.loading}</div>;

  // ── Print view
  if (mode === "saved" && savedRx) {
    return <PrintView rx={savedRx} doctor={doctor} settings={settingsForm} qrDataUrl={qrDataUrl} adminQrEnabled={adminQrEnabled} nextPatientLabel={pendingNext ? `#${pendingNext.serialNo} ${pendingNext.patientName}` : null} onNewRx={handleNewRx} onBack={() => setMode("write")} onDuplicate={handleDuplicate} L={L} />;
  }

  /* ── RENDER ──────────────────────────────────────────────────────── */
  return (
    <div className="rx-shell rx-reference-mode h-screen min-w-0 flex flex-col bg-background overflow-hidden">

      {/* ══ REFERENCE-STYLE HEADER ═════════════════════════════════════ */}
      <header className="rx-topbar rx-reference-header min-w-0 shrink-0 border-b bg-background px-3 py-2 print:hidden relative">
        <div className="rx-doctor-identity rx-doctor-identity-left min-w-0">
          <div className="rx-screen-doctor-brand">
            <div className="rx-screen-doctor-mark" aria-hidden="true">℞</div>
            <div className="min-w-0">
              <p className="rx-screen-doctor-name text-base font-bold text-blue-800 dark:text-blue-300">{screenHName}</p>
              <p className="text-[11px] text-foreground">{screenHDegree || "M.B.B.S."}</p>
              <p className="text-[11px] text-muted-foreground">{screenHDesignation || doctor?.specialtyName || "Medical Specialist"}</p>
              {screenHBmdc && <p className="text-[11px] text-muted-foreground">BMDC: {screenHBmdc}</p>}
            </div>
          </div>
        </div>

        <div className="rx-doctor-identity rx-doctor-identity-right min-w-0 text-right">
          <p className="rx-screen-clinic-label">{isBn ? "চেম্বার ও যোগাযোগ" : "CHAMBER & CONTACT"}</p>
          {screenHHospital && <p className="font-semibold text-foreground">{screenHHospital}</p>}
          {screenHAddress && <p className="text-[11px] text-muted-foreground">{screenHAddress}</p>}
          {screenHPhone && <p className="text-[11px] text-muted-foreground">{screenHPhone}</p>}
          {screenHEmail && <p className="text-[11px] text-muted-foreground">{screenHEmail}</p>}
        </div>
        <div className="rx-reference-patient-summary grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
          <div className="min-w-0">
            <span className="rx-field-caption">{isBn ? "রোগী" : "Patient"}</span>
            <p className="truncate text-sm font-bold">{patient.name || (isBn ? "রোগীর নাম লিখুন" : "Patient name")}</p>
          </div>
          <div>
            <span className="rx-field-caption">{L.age}</span>
            <p className="text-sm font-medium">{patient.age || "—"} {patient.age ? patient.ageUnit : ""}</p>
          </div>
          <div>
            <span className="rx-field-caption">{L.gender}</span>
            <p className="text-sm font-medium">{patient.sex === "F" ? L.female : patient.sex === "O" ? L.other : L.male}</p>
          </div>
          <div>
            <span className="rx-field-caption">{L.date}</span>
            <p className="text-sm font-medium">{patient.date || "—"}</p>
          </div>
        </div>
      </header>

      {/* ══ TOP MENU TOOLBAR ═══════════════════════════════════════════ */}
      <div className="rx-toolbar rx-reference-toolbar flex min-w-0 w-full shrink-0 items-center border-b bg-muted/20 px-2 py-1 print:hidden">
       <div className="rx-reference-toolbar-scroll flex min-w-0 max-w-full items-center gap-1 overflow-x-auto">
         <Button size="sm" className="h-7 shrink-0 px-2 text-xs gap-1 bg-teal-600 hover:bg-teal-700" onClick={handleNewRx}>
           <Plus className="h-3.5 w-3.5" />{L.navNewRx}
         </Button>
         <NavBtn href="/doctor/dashboard" icon={<LayoutDashboard className="h-3 w-3" />} label={L.navDashboard} />
          <NavBtn href="/doctor/prescriptions" icon={<ClipboardList className="h-3 w-3" />} label="Prescription Management" />
         <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs gap-1" onClick={() => setShowHeaderDlg(true)}>
           <Settings2 className="h-3.5 w-3.5" /><span>{L.headerSettings}</span>
         </Button>
         <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs gap-1" onClick={() => setShowPageDlg(true)}>
           <FileCog className="h-3.5 w-3.5" /><span>{L.pageSetup}</span>
         </Button>
         <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs gap-1" onClick={handlePreview}>
           <Eye className="h-3.5 w-3.5" />{L.preview}
         </Button>
         <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs gap-1" onClick={() => handleSave(true, "final")} disabled={createRx.isPending || updateRx.isPending}>
           <Printer className="h-3.5 w-3.5" />{savePrintLabel}
         </Button>
         <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
           <Save className="h-3.5 w-3.5" />{saveOnlyLabel}
         </Button>
         <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs gap-1" onClick={() => handleSave(false, "draft")} disabled={createRx.isPending || updateRx.isPending}>
           <Save className="h-3.5 w-3.5" />{saveDraftLabel}
         </Button>
         <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={lang === "en" ? "Switch to Bangla" : "Switch to English"} onClick={() => setLang(lang === "en" ? "bn" : "en")}>
           <Languages className="h-3.5 w-3.5" />
         </Button>
         <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={toggleTheme}>
           {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
         </Button>
         <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs gap-1" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`${patient.name || "Patient"} — ${diagnosis || L.diagnosisDx}`)}`, "_blank", "noopener,noreferrer")}>
           Share
         </Button>
       </div>
       <div className="rx-reference-toolbar-secondary ml-auto flex shrink-0 items-center gap-1 pl-2">
        {/* ── Quick break controls ── */}
        {isOnBreak ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1 shrink-0 border-green-400 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-400"
            onClick={handleEndBreak}
            disabled={updateStatusRx.isPending}
          >
            <Coffee className="h-3 w-3" />
            <span className="hidden sm:inline">End Break</span>
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1 shrink-0 border-amber-400 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400"
                disabled={updateStatusRx.isPending}
              >
                <Coffee className="h-3 w-3" />
                <span className="hidden sm:inline">Take Break</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel className="text-xs">Break Duration</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {[5, 10, 15, 30, 45, 60].map(min => (
                <DropdownMenuItem key={min} className="text-sm gap-2" onClick={() => handleTakeBreak(min)}>
                  <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                  {min < 60 ? `${min} minutes` : "1 hour"}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1 shrink-0">
              <Calculator className="h-3 w-3" />
              <span>Calculator</span>
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs">Calculators</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {CALCULATOR_REGISTRY.length > 0 ? (
              CALCULATOR_REGISTRY.map(calculator => (
                <DropdownMenuItem key={calculator.key} className="text-sm gap-2" onClick={() => setActiveCalculatorKey(calculator.key)}>
                  <Calculator className="h-3.5 w-3.5 text-muted-foreground" />
                  {calculator.label}
                </DropdownMenuItem>
              ))
            ) : (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No calculators configured yet.</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
       </div>

      {/* ══ QUEUE SUMMARY — shared workspace strip ═══════════════════ */}
      <section className="rx-queue-strip shrink-0 border-b px-3 py-2 print:hidden" aria-label={L.queueSummary}>
        <div className="rx-queue-summary mx-auto max-w-6xl min-w-0 border rounded-xl bg-background overflow-hidden shadow-sm">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 border-b bg-teal-600/10">
            <span className="text-sm font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">{L.queueSummary}</span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
              <span className={cn("text-[10px] font-medium px-1.5 rounded-full border",
                isDayEnded ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                  : isOnBreak ? "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800"
                  : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:border-green-800"
              )}>
                {isDayEnded ? L.statusDayEnded : isOnBreak ? L.statusOnBreak : L.statusAvailable}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />{L.liveTag}
              </span>
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5 items-center p-2 border-b">
            <Button
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => queueAction("next")}
              disabled={isOnBreak || isDayEnded || callNext.isPending || (queueWaiting.length === 0 && !queueServing)}
            >
              <ChevronRight className="h-3 w-3 mr-0.5" />{L.next}
            </Button>
            {queueServing && <>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => queueAction("seen", queueServing.id)}>
                <UserCheck className="h-3 w-3 mr-0.5" />{L.seen}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => queueAction("skip", queueServing.id)}>
                <SkipForward className="h-3 w-3 mr-0.5" />{L.skip}
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => queueAction("recall", queueServing.id)}>
                <RotateCcw className="h-3 w-3 mr-0.5" />{L.recall}
              </Button>
            </>}
            {queueWaiting[0] && <span className="min-w-0 max-w-full flex-1 truncate text-xs text-muted-foreground">{L.nextColon} #{queueWaiting[0].serialNo} {queueWaiting[0].patientName}</span>}
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-1.5 p-2 sm:grid-cols-4 lg:grid-cols-6">
            <div className="min-w-0 rounded bg-teal-600/10 px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground truncate">{L.nowServingShort}</div>
              <div className="text-base font-bold text-teal-700 dark:text-teal-400 truncate">{queueServing ? `#${queueServing.serialNo}` : "—"}</div>
            </div>
              <div className="min-w-0 rounded bg-muted px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground truncate">{L.nextShort}</div>
              <div className="text-base font-bold truncate">{queueWaiting[0] ? `#${queueWaiting[0].serialNo}` : "—"}</div>
            </div>
             <div className="min-w-0 rounded bg-blue-600/10 px-2 py-1.5">
               <div className="text-[10px] text-muted-foreground truncate">{isBn ? "পরামর্শ চলছে" : "In Consultation"}</div>
               <div className="text-base font-bold text-blue-700 dark:text-blue-400">{queueServing ? 1 : 0}</div>
             </div>
            <div className="min-w-0 rounded bg-muted px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">{L.waitingShort}</div>
              <div className="text-base font-bold">{queueWaiting.length}</div>
            </div>
            <div className="min-w-0 rounded bg-green-600/10 px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">{L.completedCount}</div>
              <div className="text-base font-bold text-green-700 dark:text-green-400">{qCompleted}</div>
            </div>
            <div className="min-w-0 rounded bg-muted px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">{L.totalAppts}</div>
              <div className="text-base font-bold">{qTotalToday}</div>
            </div>
            {qAvgConsultMs > 0 && (
              <div className="min-w-0 rounded bg-muted/60 px-2 py-1.5">
                <div className="text-[10px] text-muted-foreground">{L.avgWaitTime}</div>
                <div className="text-sm font-semibold">{Math.round(qAvgConsultMs / 60000)}m</div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ══ TWO-COLUMN BODY ═══════════════════════════════════════════ */}
      <div className="rx-workspace relative flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden lg:flex-row">

        {/* ── LEFT PANEL — Patient Info ──────────────────────────── */}
        <aside className="rx-context-panel flex h-[45vh] w-full min-w-0 flex-col border-r bg-muted/10 shrink-0 overflow-hidden lg:h-auto lg:w-[30%] xl:w-[30%]">
          <ScrollArea className="flex-1">
            <div className="p-2 space-y-1.5 text-xs">

              {/* Load Patient button */}
              <button
                type="button"
                onClick={() => setShowLoadPatient(v => !v)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium transition-colors"
              >
                <span className="flex items-center gap-1"><Search className="h-3 w-3" />{L.loadPatient}</span>
                {showLoadPatient ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>

              {/* Patient search panel */}
              {showLoadPatient && (
                <div className="border rounded bg-background p-2 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                    <Input
                      type="date"
                      className="h-6 text-xs flex-1"
                      value={loaderDate}
                      onChange={e => setLoaderDate(e.target.value)}
                    />
                  </div>
                  <Input
                    className="h-6 text-xs"
                    placeholder={L.searchPlaceholder}
                    value={patientSearch}
                    onChange={e => setPatientSearch(e.target.value)}
                  />
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {filteredQ.length > 0 && <p className="text-[10px] text-muted-foreground font-semibold uppercase">{L.queueLabel}</p>}
                    {filteredQ.map(e => (
                      <div key={e.id} className={cn("flex items-start gap-1 rounded border text-xs", e.status === "serving" ? "border-green-400 bg-green-50 dark:bg-green-950/20" : "border-transparent")}>
                        <button type="button" onClick={() => loadFromQueue(e)}
                          className="flex-1 text-left px-2 py-1 hover:bg-primary/10 rounded min-w-0">
                          <span className="font-medium">#{e.serialNo} {e.patientName}</span>
                          {e.status === "serving" && <span className="text-green-600 ml-1">▶</span>}
                          {e.patientPhone && <p className="text-[10px] text-muted-foreground truncate">{e.patientPhone}</p>}
                        </button>
                        {prevRxByPhone.has(e.patientPhone ?? "") && (
                          <button type="button" onClick={() => loadFromQueue(e)}
                            className="shrink-0 flex items-center gap-0.5 px-1 py-1 text-[9px] text-teal-700 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded hover:bg-teal-100 transition-colors mt-0.5 mr-0.5 whitespace-nowrap">
                            <RotateCcw className="h-2.5 w-2.5" />{L.continueRx}
                          </button>
                        )}
                      </div>
                    ))}
                    {filteredA.length > 0 && <p className="text-[10px] text-muted-foreground font-semibold uppercase mt-1">{L.apptLabel}</p>}
                    {filteredA.map(a => (
                      <div key={a.id} className="flex items-start gap-1 rounded border border-transparent text-xs">
                        <button type="button" onClick={() => loadFromAppt(a)}
                          className="flex-1 text-left px-2 py-1 hover:bg-primary/10 rounded min-w-0">
                          <span className="font-medium">#{a._serial} {a.patientName}</span>
                          {a.patientPhone && <p className="text-[10px] text-muted-foreground truncate">{a.patientPhone}</p>}
                        </button>
                        {prevRxByPhone.has(a.patientPhone ?? "") && (
                          <button type="button" onClick={() => loadFromAppt(a)}
                            className="shrink-0 flex items-center gap-0.5 px-1 py-1 text-[9px] text-teal-700 bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded hover:bg-teal-100 transition-colors mt-0.5 mr-0.5 whitespace-nowrap">
                            <RotateCcw className="h-2.5 w-2.5" />{L.continueRx}
                          </button>
                        )}
                      </div>
                    ))}
                    {filteredP.length > 0 && <p className="text-[10px] text-muted-foreground font-semibold uppercase mt-1">{L.patientsLabel}</p>}
                    {filteredP.slice(0, 8).map(p => (
                      <button key={`p${p.id}`} type="button" onClick={() => { loadFromPatient(p); setShowLoadPatient(false); }}
                        className="w-full text-left px-2 py-1 rounded hover:bg-primary/10 border border-transparent text-xs flex items-start gap-1">
                        <RotateCcw className="h-2.5 w-2.5 text-teal-600 shrink-0 mt-0.5" />
                        <span className="min-w-0">
                          <span className="font-medium">{p.patientName}</span>
                          {p.patientPhone && <p className="text-[10px] text-muted-foreground truncate">{p.patientPhone}</p>}
                        </span>
                      </button>
                    ))}
                    {filteredQ.length === 0 && filteredA.length === 0 && filteredP.length === 0 && (
                      <p className="text-muted-foreground text-[10px] py-2 text-center">{L.noPatientFound}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Patient fields */}
              <div className="rx-patient-info-card">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  {patient.photoUrl ? (
                    <img src={storageUrl(patient.photoUrl) ?? patient.photoUrl} alt={patient.name} className="h-7 w-7 rounded-full object-cover border border-border shrink-0" />
                  ) : patient.name ? (
                    <div className="h-7 w-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-semibold text-muted-foreground">{patient.name.charAt(0).toUpperCase()}</span>
                    </div>
                  ) : null}
                  <label className="text-[10px] text-muted-foreground font-semibold">{L.patientName}</label>
                </div>
                <Input className="h-6 text-xs" placeholder={L.typeNamePlaceholder} value={patient.name} onChange={e => setPatient(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-[10px] text-muted-foreground font-semibold">{L.age}</label>
                  <div className="flex gap-1 mt-0.5">
                    <Input className="h-6 text-xs flex-1 min-w-0" type="number" placeholder="25" value={patient.age} onChange={e => setPatient(p => ({ ...p, age: e.target.value }))} />
                    <select className="h-6 text-xs border rounded bg-background px-1" value={patient.ageUnit} onChange={e => setPatient(p => ({ ...p, ageUnit: e.target.value }))}>
                      <option value="Y">Y</option><option value="M">M</option><option value="D">D</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground font-semibold">{L.gender}</label>
                  <select className="h-6 w-full text-xs border rounded bg-background px-1 mt-0.5" value={patient.sex} onChange={e => setPatient(p => ({ ...p, sex: e.target.value }))}>
                    <option value="M">{L.male}</option><option value="F">{L.female}</option><option value="O">{L.other}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-semibold">{L.mobile}</label>
                <Input className="h-6 text-xs mt-0.5" placeholder="01XXXXXXXXX" value={patient.phone} onChange={e => setPatient(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground font-semibold">{L.address}</label>
                <Input className="h-6 text-xs mt-0.5" placeholder={L.addressPlaceholder} value={patient.address} onChange={e => setPatient(p => ({ ...p, address: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <div>
                  <label className="text-[10px] text-muted-foreground font-semibold">{L.regNo}</label>
                  <Input className="h-6 text-xs mt-0.5" placeholder={L.regNo} value={patient.regNo} onChange={e => setPatient(p => ({ ...p, regNo: e.target.value }))} />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground font-semibold">{L.date}</label>
                  <Input className="h-6 text-xs mt-0.5" type="date" value={patient.date} onChange={e => setPatient(p => ({ ...p, date: e.target.value }))} />
                </div>
              </div>
              </div>

              <Separator className="my-1" />

              {/* Vitals */}
              <div className="rx-vitals-card">
                <div className="flex items-center gap-1 mb-0.5">
                  <Activity className="h-3 w-3 text-teal-700 dark:text-teal-400" />
                  <label className="text-[10px] font-bold text-teal-700 dark:text-teal-400">{L.vitals}</label>
                  {(patient.bp || patient.weight || patient.height || patient.pulse || patient.temp) && (
                    <span className="text-[9px] text-green-600">● {L.assistantTag}</span>
                  )}
                </div>
                  <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
                  <div>
                    <label className="text-[9px] text-muted-foreground">BP (mmHg)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="120/80" value={patient.bp} onChange={e => setPatient(p => ({ ...p, bp: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">Pulse (bpm)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="72" value={patient.pulse} onChange={e => setPatient(p => ({ ...p, pulse: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">Temp (°F)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="98.6" value={patient.temp} onChange={e => setPatient(p => ({ ...p, temp: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">Weight (kg)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="65" value={patient.weight} onChange={e => setPatient(p => ({ ...p, weight: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">Height (cm)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="170" value={patient.height} onChange={e => setPatient(p => ({ ...p, height: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">SpO2 (%)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="98" value={patient.spo2} onChange={e => setPatient(p => ({ ...p, spo2: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">Hb (g/dL)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="13.5" value={patient.hb} onChange={e => setPatient(p => ({ ...p, hb: e.target.value }))} />
                  </div>
                  <div>
                    <label className="text-[9px] text-muted-foreground">Sugar (mmol/L)</label>
                    <Input className="h-6 text-xs mt-0.5" placeholder="5.6" value={patient.sugar} onChange={e => setPatient(p => ({ ...p, sugar: e.target.value }))} />
                  </div>
                </div>
              </div>

              <Separator className="my-1" />
              <div>
                <label className="text-[10px] font-bold text-teal-700 dark:text-teal-400">{L.attachments}</label>
                <div className="flex flex-col gap-1 mt-0.5">
                  {patient.labReportUrl && (
                    <button type="button" className="text-[10px] text-blue-600 dark:text-blue-400 underline flex items-center gap-1 text-left" onClick={() => downloadObject(patient.labReportUrl, "lab-report")}>
                      <FileDown className="h-3 w-3" /> {L.labReport}
                    </button>
                  )}
                  {patient.prescriptionUploadUrl && (
                    <button type="button" className="text-[10px] text-blue-600 dark:text-blue-400 underline flex items-center gap-1 text-left" onClick={() => downloadObject(patient.prescriptionUploadUrl, "previous-prescription")}>
                      <FileDown className="h-3 w-3" /> {L.previousRx}
                    </button>
                  )}
                  {/* Investigation report upload */}
                  <label className={cn(
                    "flex items-center gap-1 text-[10px] cursor-pointer px-1.5 py-1 rounded border transition-colors w-full",
                    reportUploading
                      ? "border-muted text-muted-foreground opacity-60 pointer-events-none"
                      : "border-dashed border-teal-300 text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/20",
                  )}>
                    <Upload className="h-3 w-3 shrink-0" />
                    <span>{reportUploading ? L.uploading : L.uploadReport}</span>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      className="hidden"
                      disabled={reportUploading}
                      onChange={e => {
                        const file = e.target.files?.[0];
                        if (file) { uploadReport(file); e.target.value = ""; }
                      }}
                    />
                  </label>
                </div>
              </div>

              <Separator className="my-1" />

               {/* Diagnosis sits immediately above C/C in the clinical panel. */}
               <div className="rx-diagnosis-field rounded-lg border border-teal-100 bg-teal-50/50 p-3 dark:border-teal-900 dark:bg-teal-950/20">
                 <label className="text-sm text-green-700 dark:text-green-400 font-semibold uppercase tracking-wide">{L.diagnosisDx}</label>
                 <Input id="diagnosis-field" className="h-8 text-sm mt-0.5" placeholder={L.diagnosisPlaceholder} value={diagnosis} onChange={e => setDiagnosis(e.target.value)} />
               </div>

               <Separator className="my-1" />

              {/* C/C — always visible; the existing open state remains available
                  for loaded/draft data and is marked when the field is focused. */}
              <div className="rx-clinical-section rx-cc-section" data-section-open={ccOpen}>
                <div className="flex items-center gap-1 text-xs font-bold text-teal-700 dark:text-teal-400">
                  <span className="flex items-center gap-1">
                    {L.ccLabel}
                    {patient.cc && <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />}
                  </span>
                </div>
                <div className="flex flex-wrap gap-0.5 mt-1 mb-0.5">
                  {(templates["cc"] ?? []).slice(0, 4).map(t => (
                    <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition-colors">
                      {t.title}
                    </button>
                  ))}
                </div>
                <AutoGrowingTextarea
                  className="text-sm min-h-[56px] resize-none"
                  placeholder={L.ccPlaceholder}
                  value={patient.cc}
                  onFocus={() => setCcOpen(true)}
                  onChange={e => setPatient(p => ({ ...p, cc: e.target.value }))}
                />
                <div className="mt-1 flex justify-end">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                    <Save className="h-3 w-3" />{L.save}
                  </Button>
                </div>
              </div>

              <Separator className="my-1" />

              {/* O/E — always visible; preserve the existing text/box mode control. */}
              <div className="rx-clinical-section rx-oe-section" data-section-open={oeOpen}>
                <div className="flex items-center gap-1">
                  <span className="flex-1 flex items-center gap-1 text-xs font-bold text-teal-700 dark:text-teal-400">
                    O/E
                    {patient.oe && <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />}
                  </span>
                  <button type="button"
                    onClick={() => setPatient(p => ({ ...p, oeMode: p.oeMode === "text" ? "box" : "text" }))}
                    className={cn("text-[9px] px-1.5 py-0.5 rounded border transition-colors shrink-0", patient.oeMode === "box" ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border")}>
                    {L.box}
                  </button>
                </div>
                <div className="mt-1">
                  {(templates["oe"] ?? []).slice(0, 2).map(t => (
                    <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition-colors mr-0.5 mb-0.5">
                      {t.title}
                    </button>
                  ))}
                </div>
                <AutoGrowingTextarea
                  className="text-sm min-h-[56px] resize-none mt-0.5"
                  placeholder={L.oePlaceholder}
                  value={patient.oe}
                  onFocus={() => setOeOpen(true)}
                  onChange={e => setPatient(p => ({ ...p, oe: e.target.value }))}
                />
                <div className="mt-1 flex justify-end">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                    <Save className="h-3 w-3" />{L.save}
                  </Button>
                </div>
              </div>

              <Separator className="my-1" />

              {/* IX — always visible and editable. */}
              <div className="rx-clinical-section rx-ix-section" data-section-open={ixOpen}>
                <div className="flex items-center gap-1 text-xs font-bold text-teal-700 dark:text-teal-400">
                  <span className="flex items-center gap-1">
                    {L.ixLabel}
                    {(patient.ixChips.length > 0 || patient.ixCustom) && <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />}
                  </span>
                </div>
                <div className="flex flex-wrap gap-0.5 mt-1">
                  {IX_CHIPS.map(chip => (
                    <button key={chip} type="button"
                      onClick={() => setPatient(p => ({ ...p, ixChips: p.ixChips.includes(chip) ? p.ixChips.filter(x => x !== chip) : [...p.ixChips, chip] }))}
                       className={cn("text-sm px-1.5 py-0.5 rounded border transition-colors", patient.ixChips.includes(chip) ? "bg-teal-600 text-white border-teal-600" : "bg-background border-border hover:border-teal-400")}>
                      {chip}
                    </button>
                  ))}
                </div>
                {(templates["ix"] ?? []).slice(0, 3).map(t => (
                  <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors mr-0.5 mt-0.5">
                    {t.title}
                  </button>
                ))}
                <Input
                  className="h-7 text-sm mt-1"
                  placeholder={L.ixCustomPlaceholder}
                  value={patient.ixCustom}
                  onFocus={() => setIxOpen(true)}
                  onChange={e => setPatient(p => ({ ...p, ixCustom: e.target.value }))}
                />
                <div className="mt-1 flex justify-end">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                    <Save className="h-3 w-3" />{L.save}
                  </Button>
                </div>
              </div>

              <Separator className="my-1" />

              {/* Drug History */}
              <div className="rx-clinical-section rx-drug-history-section">
                <label className="text-xs font-bold text-teal-700 dark:text-teal-400">{L.drugHistory}</label>
                <div className="mt-1">
                  {(templates["drugHistory"] ?? []).slice(0, 3).map(t => (
                    <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition-colors mr-0.5 mb-0.5">
                      {t.title}
                    </button>
                  ))}
                </div>
                <AutoGrowingTextarea className="text-sm min-h-[48px] resize-none mt-0.5" placeholder={L.drugHistoryPlaceholder} value={patient.drugHistory} onChange={e => setPatient(p => ({ ...p, drugHistory: e.target.value }))} />
                <div className="mt-1 flex justify-end">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                    <Save className="h-3 w-3" />{L.save}
                  </Button>
                </div>
              </div>

              <Separator className="my-1" />

              {/* RX QUICK TOOLS — a compact, extensible tool list. */}
              <div className="rounded-lg border border-teal-200 bg-teal-50/50 p-2 dark:border-teal-900 dark:bg-teal-950/20">
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center justify-between text-left"
                  onClick={() => setShowQuickTools(v => !v)}
                  aria-expanded={showQuickTools}
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                    {isBn ? "প্রেসক্রিপশন টুলস" : "RX QUICK TOOLS"}
                  </span>
                  {showQuickTools ? <ChevronUp className="h-3 w-3 text-teal-600 dark:text-teal-400" /> : <ChevronDown className="h-3 w-3 text-teal-600 dark:text-teal-400" />}
                </button>
                {showQuickTools && (
                  <div className="space-y-1.5">
                    {/* Add future tools to quickToolItems without changing this list layout. */}
                    {quickToolItems.map(tool => {
                      const ToolIcon = tool.icon;
                      return (
                        <Button
                          key={tool.key}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 w-full justify-start gap-1.5 bg-background text-xs"
                          onClick={tool.onClick}
                        >
                          <ToolIcon className="h-3 w-3" />
                          {tool.label}
                          <span className="ml-auto text-[10px] text-muted-foreground">{tool.indicator}</span>
                        </Button>
                      );
                    })}
                    {showNewToolNotice && (
                      QUICK_TOOL_REGISTRY.length > 0 ? (
                        <div className="space-y-1.5">
                          {QUICK_TOOL_REGISTRY.map(tool => (
                            <QuickClinicalTool key={tool.key} tool={tool} />
                          ))}
                        </div>
                      ) : (
                        <div className="rounded border border-dashed border-teal-300 bg-background px-2 py-1.5 text-xs text-muted-foreground dark:border-teal-800">
                          {isBn ? "নতুন ক্লিনিক্যাল টুল এখানে যোগ করা যাবে।" : "New clinical tools can be added here."}
                        </div>
                      )
                    )}
                    {visibleMedicineShortcuts.length > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {isBn ? "সাম্প্রতিক ওষুধ" : "Recent medicines"}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {visibleMedicineShortcuts.map(shortcut => (
                            <div key={shortcut.key} className="flex max-w-full items-center rounded border border-teal-200 bg-background text-[10px] dark:border-teal-800">
                              <button
                                type="button"
                                className="min-h-7 max-w-[10rem] truncate px-1.5 text-left hover:bg-muted"
                                onClick={() => useMedicineShortcut(shortcut)}
                                title={shortcut.brandName || shortcut.genericName}
                              >
                                {shortcut.brandName || shortcut.genericName}
                              </button>
                              <button
                                type="button"
                                className="min-h-7 px-1 text-amber-500 hover:text-amber-600"
                                aria-label={shortcut.isFavorite ? L.unfavoriteMedicine : L.favoriteMedicine}
                                title={shortcut.isFavorite ? L.unfavoriteMedicine : L.favoriteMedicine}
                                onClick={() => toggleMedicineFavorite(shortcut.key)}
                              >
                                <Star className={cn("h-2.5 w-2.5", shortcut.isFavorite && "fill-current")} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

            </div>
          </ScrollArea>
        </aside>

        {/* ── CENTER PANEL — Medicine entry + prescription body ─────── */}
        <main className="rx-prescription-panel flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background/30">
          <ScrollArea className="min-w-0 flex-1">
            <div className="rx-prescription-sheet mx-auto w-full min-w-0 max-w-6xl space-y-4 p-3 sm:p-5">
              <img
                src={`${import.meta.env.BASE_URL}stethoscope-watermark.png`}
                alt=""
                aria-hidden="true"
                className="rx-stethoscope-watermark"
              />

              {recoveryDraft && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
                  <div className="min-w-0">
                    <p className="font-semibold">{L.restoreDraft}</p>
                    <p className="text-[10px] opacity-80">{L.restoreDraftHint}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={restoreLocalDraft}>{L.restore}</Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={clearLocalDraft}>{L.discard}</Button>
                  </div>
                </div>
              )}

              {/* ── Queue mini control / Recall mode indicator ── */}
              <div className="flex items-center justify-between">
                {isRecallMode ? (
                  /* ── Recall / Follow-up mode: queue is NOT serving this patient ── */
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded px-2 py-0.5">
                      <RotateCcw className="h-3 w-3" />
                      {followUpDate ? L.followUpConsult : L.recallPatient}
                      {patient.name ? ` — ${patient.name}` : ""}
                    </span>
                    {/* Show actual queue state as a secondary note so the doctor knows who is still in the queue */}
                    {queueServing && (
                      <span className="text-[10px] text-muted-foreground">
                        {L.queueStillServing}: #{queueServing.serialNo} {queueServing.patientName}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] px-2 border-violet-300 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
                      onClick={handleResumeConsultation}
                    >
                      <UserCheck className="h-3 w-3 mr-0.5" />{L.resumeConsult}
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* ══ MEDICINE ENTRY CARD ══════════════════════════════ */}
              <div className={cn("rx-medicine-entry border rounded-xl overflow-hidden shadow-sm", showMedicineComposer && "is-composer-open")}>
                {/* Card header */}
                <div className="rx-medicine-entry-header flex min-w-0 items-center gap-3 bg-teal-700 px-4 py-2.5 text-white dark:bg-teal-800">
                  <div className="flex min-w-0 shrink-0 items-center gap-3">
                    <span className="rx-symbol text-3xl font-serif leading-none text-teal-100">℞</span>
                    <div>
                      <h2 className="text-base font-bold">{isBn ? "Medicine" : "Medicine"} <span className="font-medium text-sm text-teal-100/90">({isBn ? "যোগ / সম্পাদনা" : "Add / Edit"})</span></h2>
                    </div>
                  </div>
                  <div className="rx-inline-medicine-search relative ml-auto flex min-w-0 max-w-[26rem] flex-1 items-center gap-1.5">
                    <Input
                      ref={medInputRef}
                      className="h-8 min-w-0 flex-1 border-white/60 bg-white text-sm text-foreground placeholder:text-muted-foreground"
                      placeholder={isBn ? "Search medicine..." : "Search medicine..."}
                      value={currentMed.brandName}
                      onChange={e => {
                        setSelectedMedicineId(null);
                        setActiveMedSugIndex(-1);
                        setCurrentMed(m => ({ ...m, brandName: e.target.value }));
                      }}
                      onFocus={() => { if (medSug.length > 0) setShowSug(true); }}
                      onKeyDown={handleMedicineInputKeyDown}
                      autoComplete="off"
                      aria-label={L.brandName}
                    />
                    <Button type="button" variant="outline" size="sm" className="h-8 shrink-0 gap-1 border-white/70 bg-white px-2 text-xs text-teal-800 hover:bg-teal-50" onClick={() => setShowSug(v => !v)}>
                      <Search className="h-3.5 w-3.5" /><span className="hidden sm:inline">{isBn ? "Medicine Suggest" : "Medicine Suggest"}</span>
                    </Button>
                    {showSug && medSug.length > 0 && (
                      <div ref={sugRef} className="rx-inline-suggestions absolute left-0 right-0 top-10 z-50 overflow-hidden rounded-lg border bg-background text-foreground shadow-xl">
                        {medSug.map((s, index) => (
                          <button key={s.id} type="button" className={cn("w-full border-b px-3 py-2 text-left text-xs last:border-0", index === activeMedSugIndex ? "bg-teal-50" : "hover:bg-muted")} onClick={() => selectMedSug(s)}>
                            <span className="block font-bold">{s.brandName} {s.strength || ""}</span>
                            <span className="block text-[10px] text-muted-foreground">{s.genericName || ""}{s.dosageForm ? ` · ${s.dosageForm}` : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1 border-teal-200 bg-white px-2 text-xs text-teal-800 hover:bg-teal-50"
                    onClick={() => setShowMedicineComposer(false)}
                    aria-label={isBn ? "ওষুধ লেখার অংশ লুকান" : "Hide medicine composer"}
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{isBn ? "লুকান" : "Hide"}</span>
                  </Button>
                </div>
                <div className="rx-medicine-composer-body p-3 space-y-2.5 bg-background">
                  {editingMedicineId && (
                    <div className="flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
                      <span>{isBn ? "ওষুধ সম্পাদনা করা হচ্ছে" : "Editing medicine"}</span>
                      <button type="button" className="font-medium underline underline-offset-2" onClick={cancelMedicineEdit}>
                        {isBn ? "বাতিল" : "Cancel"}
                      </button>
                    </div>
                  )}

                  {(favoriteMedicineShortcuts.length > 0 || recentMedicineShortcuts.length > 0) && (
                    <div className="space-y-1.5 rounded-md border border-teal-100 bg-teal-50/50 p-2 dark:border-teal-900 dark:bg-teal-950/20">
                      {favoriteMedicineShortcuts.length > 0 && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-300">
                            <Star className="mr-1 inline h-3 w-3 fill-current" />{L.favoriteMedicines}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {favoriteMedicineShortcuts.map(shortcut => (
                              <div key={shortcut.key} className="flex items-center rounded border border-amber-200 bg-background text-xs dark:border-amber-800">
                                <button type="button" className="min-h-8 max-w-[12rem] truncate px-2 text-left hover:bg-muted" onClick={() => useMedicineShortcut(shortcut)}>
                                  {shortcut.brandName || shortcut.genericName}
                                  {shortcut.strength && <span className="ml-1 text-[10px] text-muted-foreground">{shortcut.strength}</span>}
                                </button>
                                <button type="button" className="min-h-8 px-1.5 text-amber-500 hover:text-amber-600" aria-label={L.unfavoriteMedicine} title={L.unfavoriteMedicine} onClick={() => toggleMedicineFavorite(shortcut.key)}>
                                  <Star className="h-3 w-3 fill-current" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {recentMedicineShortcuts.length > 0 && (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{L.recentMedicines}</p>
                          <div className="flex flex-wrap gap-1">
                            {recentMedicineShortcuts.map(shortcut => (
                              <div key={shortcut.key} className="flex items-center rounded border bg-background text-xs">
                                <button type="button" className="min-h-8 max-w-[12rem] truncate px-2 text-left hover:bg-muted" onClick={() => useMedicineShortcut(shortcut)}>
                                  {shortcut.brandName || shortcut.genericName}
                                  {shortcut.strength && <span className="ml-1 text-[10px] text-muted-foreground">{shortcut.strength}</span>}
                                </button>
                                <button type="button" className="min-h-8 px-1.5 text-muted-foreground hover:text-amber-500" aria-label={L.favoriteMedicine} title={L.favoriteMedicine} onClick={() => toggleMedicineFavorite(shortcut.key)}>
                                  <Star className="h-3 w-3" />
                                </button>
                                <button type="button" className="min-h-8 px-1 text-muted-foreground hover:text-destructive" aria-label="Remove from recent medicines" title="Remove from recent medicines" onClick={() => removeMedicineShortcut(shortcut.key)}>
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Brand name autocomplete */}
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-400">{L.brandName}</label>
                      <label className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-muted-foreground">
                        <input type="checkbox" className="h-3 w-3 accent-teal-600" checked={saveMedicineToDb} disabled={selectedMedicineId !== null} onChange={e => setSaveMedicineToDb(e.target.checked)} />
                        Save in DB
                      </label>
                    </div>
                    <div className="relative mt-0.5">
                      <Input
                        className="h-8 text-sm"
                        placeholder={L.medNamePlaceholder}
                        value={currentMed.brandName}
                        onChange={e => {
                          setSelectedMedicineId(null);
                          setActiveMedSugIndex(-1);
                          setCurrentMed(m => ({ ...m, brandName: e.target.value }));
                        }}
                        onFocus={() => { if (medSug.length > 0) setShowSug(true); }}
                        onKeyDown={handleMedicineInputKeyDown}
                        role="combobox"
                        aria-autocomplete="list"
                        aria-expanded={showSug && medSug.length > 0}
                        aria-controls="medicine-suggestions"
                        aria-activedescendant={activeMedSugIndex >= 0 ? `medicine-suggestion-${medSug[activeMedSugIndex]?.id}` : undefined}
                        autoComplete="off"
                      />
                      {showSug && medSug.length > 0 && (
                        <div id="medicine-suggestions" ref={sugRef} role="listbox" className="rx-medicine-suggestions absolute top-full left-0 right-0 z-50 overflow-y-auto rounded-lg border bg-background shadow-lg">
                          {medSug.map((s, index) => (
                            <button
                              key={s.id}
                              id={`medicine-suggestion-${s.id}`}
                              type="button"
                              role="option"
                              aria-selected={index === activeMedSugIndex}
                              onMouseEnter={() => setActiveMedSugIndex(index)}
                              onClick={() => selectMedSug(s)}
                              className={cn(
                                "w-full border-b px-3 py-2.5 text-left text-xs transition-colors last:border-0",
                                index === activeMedSugIndex ? "bg-teal-50 dark:bg-teal-950/40" : "hover:bg-muted",
                              )}
                            >
                              <div className="font-semibold">{s.brandName} {s.strength && <span className="text-muted-foreground">{s.strength}</span>}</div>
                              {s.genericName && <div className="text-muted-foreground text-[10px]">{s.genericName} {s.dosageForm && `· ${s.dosageForm}`}</div>}
                              {s.manufacturer && <div className="text-muted-foreground text-[10px] italic">{s.manufacturer}</div>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedMedicineId !== null && (
                      <div className="rx-selected-medicine mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs dark:border-teal-800 dark:bg-teal-950/30">
                        <span className="font-semibold text-teal-800 dark:text-teal-200">{isBn ? "নির্বাচিত ওষুধ" : "Selected medicine"}</span>
                        <span className="font-bold text-foreground">{currentMed.brandName || currentMed.genericName}</span>
                        {(currentMed.genericName || currentMed.strength || currentMed.dosageForm) && (
                          <span className="text-muted-foreground">
                            {[currentMed.genericName, currentMed.strength, currentMed.dosageForm].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 mt-1">
                      <Input className="h-6 text-xs" placeholder={L.genericName} value={currentMed.genericName} onChange={e => setCurrentMed(m => ({ ...m, genericName: e.target.value }))} />
                      <Input className="h-6 text-xs" placeholder={L.strengthPlaceholder} value={currentMed.strength} onChange={e => setCurrentMed(m => ({ ...m, strength: e.target.value }))} />
                      <Input list="dosage-forms" className="h-6 text-xs" placeholder={L.formPlaceholder} value={currentMed.dosageForm} onChange={e => setCurrentMed(m => ({ ...m, dosageForm: e.target.value }))} />
                      <datalist id="dosage-forms">
                        {DOSE_FORMS.map(f => <option key={f} value={f} />)}
                      </datalist>
                    </div>
                  </div>

                  {/* Dose → Timing → Duration: compact, side-by-side controls on tablet/desktop. */}
                  <div className="rx-dose-grid grid grid-cols-1 gap-2 md:grid-cols-3">
                    <label className="min-w-0 space-y-1">
                      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{L.dose}</span>
                      <div className="rx-quick-options" aria-label={isBn ? "দ্রুত ডোজ নির্বাচন" : "Quick dose options"}>
                        {doseOptions.slice(0, 8).map(option => (
                          <button
                            key={option.id}
                            type="button"
                            className={cn("rx-quick-option", currentMed.dose === option.content && "is-active")}
                            aria-pressed={currentMed.dose === option.content}
                            onClick={() => setCurrentMed(m => ({ ...m, dose: option.content }))}
                          >
                            {option.title}
                          </button>
                        ))}
                      </div>
                      <select
                        className="h-7 w-full min-w-0 rounded border bg-background px-1.5 text-xs"
                        value={selectedDoseTemplate}
                        onChange={e => {
                          if (e.target.value !== CUSTOM_TEMPLATE_VALUE) {
                            setCurrentMed(m => ({ ...m, dose: e.target.value }));
                          }
                        }}
                      >
                        <option value={CUSTOM_TEMPLATE_VALUE}>Manual / Custom</option>
                        {doseOptions.map(option => <option key={option.id} value={option.content}>{option.title}</option>)}
                      </select>
                      <Input
                        className="h-7 w-full text-xs"
                        placeholder={L.customDose}
                        value={currentMed.dose}
                        onChange={e => setCurrentMed(m => ({ ...m, dose: e.target.value }))}
                      />
                    </label>

                    <label className="min-w-0 space-y-1">
                      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{L.timing}</span>
                      <div className="rx-quick-options" aria-label={isBn ? "দ্রুত সময় নির্বাচন" : "Quick timing options"}>
                        {timingOptions.slice(0, 6).map(option => (
                          <button
                            key={option.id}
                            type="button"
                            className={cn("rx-quick-option", currentMed.timing === option.content && "is-active")}
                            aria-pressed={currentMed.timing === option.content}
                            onClick={() => setCurrentMed(m => ({ ...m, timing: option.content }))}
                          >
                            {option.title}
                          </button>
                        ))}
                      </div>
                      <select
                        className="h-7 w-full min-w-0 rounded border bg-background px-1.5 text-xs"
                        value={selectedTimingTemplate}
                        onChange={e => {
                          if (e.target.value !== CUSTOM_TEMPLATE_VALUE) {
                            setCurrentMed(m => ({ ...m, timing: e.target.value }));
                          }
                        }}
                      >
                        <option value={CUSTOM_TEMPLATE_VALUE}>Manual / Custom</option>
                        {timingOptions.map(option => <option key={option.id} value={option.content}>{option.title}</option>)}
                      </select>
                      <Input
                        className="h-7 w-full text-xs"
                        placeholder={L.customTiming}
                        value={currentMed.timing}
                        onChange={e => setCurrentMed(m => ({ ...m, timing: e.target.value }))}
                      />
                    </label>

                    <label className="min-w-0 space-y-1">
                      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">{L.duration}</span>
                      <div className="rx-quick-options" aria-label={isBn ? "দ্রুত মেয়াদ নির্বাচন" : "Quick duration options"}>
                        {durationPresetsDB.slice(0, 9).map(option => {
                          const value = `${option.n}|${option.u}`;
                          const unitLabel = option.u === "D" ? L.dayUnit : option.u === "W" ? L.weekUnit : L.monthUnit;
                          return (
                            <button
                              key={`${option.n}-${option.u}-${option.title}`}
                              type="button"
                              className={cn("rx-quick-option", selectedDurationTemplate === value && "is-active")}
                              aria-pressed={selectedDurationTemplate === value}
                              onClick={() => setCurrentMed(m => ({ ...m, durationNum: option.n, durationUnit: option.u }))}
                            >
                              {option.n ? `${toBengaliDigits(option.n)} ${unitLabel}` : option.title}
                            </button>
                          );
                        })}
                      </div>
                      <select
                        className="h-7 w-full min-w-0 rounded border bg-background px-1.5 text-xs"
                        value={selectedDurationTemplate}
                        onChange={e => {
                          if (e.target.value === CUSTOM_TEMPLATE_VALUE) return;
                          const [durationNum, durationUnit] = e.target.value.split("|");
                          setCurrentMed(m => ({ ...m, durationNum, durationUnit: durationUnit as MedItem["durationUnit"] }));
                        }}
                      >
                        <option value={CUSTOM_TEMPLATE_VALUE}>Manual / Custom</option>
                        {durationPresetsDB.map(option => (
                          <option key={`${option.n}-${option.u}-${option.title}`} value={`${option.n}|${option.u}`}>{option.n ? `${option.n} ${option.u === "D" ? "দিন" : option.u === "W" ? "সপ্তাহ" : "মাস"}` : option.title}</option>
                        ))}
                      </select>
                      <div className="flex min-w-0 gap-1">
                        <Input
                          type="number"
                          min="1"
                          className="h-7 min-w-0 flex-1 text-xs text-center"
                          value={currentMed.durationNum}
                          onChange={e => setCurrentMed(m => ({ ...m, durationNum: e.target.value }))}
                        />
                        <select
                          className="h-7 w-[4.5rem] shrink-0 rounded border bg-background px-1 text-xs"
                          value={currentMed.durationUnit}
                          onChange={e => setCurrentMed(m => ({ ...m, durationUnit: e.target.value as MedItem["durationUnit"] }))}
                        >
                          <option value="D">{L.dayUnit}</option>
                          <option value="W">{L.weekUnit}</option>
                          <option value="M">{L.monthUnit}</option>
                        </select>
                      </div>
                    </label>
                  </div>

                  {/* Instructions */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-400">{L.instructionsOptional}</label>
                    <AutoGrowingTextarea className="text-sm min-h-[40px] resize-none mt-0.5" placeholder={L.instructionsPlaceholder} value={currentMed.instructions} onChange={e => setCurrentMed(m => ({ ...m, instructions: e.target.value }))} />
                    <div className="mt-1 flex justify-end">
                      <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                        <Save className="h-3 w-3" />{L.save}
                      </Button>
                    </div>
                  </div>

                  {/* ADD button */}
                  <button type="button" onClick={editingMedicineId ? updateMedicine : addMedicine}
                    className="rx-add-medicine w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold text-sm transition-colors">
                    {editingMedicineId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                    {editingMedicineId ? (isBn ? "ওষুধ আপডেট করুন" : "UPDATE MEDICINE") : L.addMedicineBtn}
                  </button>
                </div>
              </div>

              {/* ── Medicine list ─────────────────────────────────── */}
              {medicines.length > 0 && (
                <div className="rx-prescribed-list overflow-hidden rounded-xl border shadow-sm">
                  <div className="rx-prescribed-list-header flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-teal-700 dark:text-teal-300">
                      <ClipboardList className="h-3.5 w-3.5" />{L.addedMedicines} ({medicines.length})
                    </h3>
                    <span className="text-[10px] text-muted-foreground">
                      {isBn ? "হ্যান্ডেল ধরে টেনে সাজান" : "Drag by the handle to reorder"}
                    </span>
                  </div>
                  <div className="space-y-2 p-2 sm:p-3">
                    {medicines.map((med, i) => (
                      <div
                        key={med.id}
                        onDragOver={event => {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={event => {
                          event.preventDefault();
                          dropMedicine(med.id);
                        }}
                        onDragEnd={() => setDraggedMedicineId(null)}
                        className={cn(
                          "rx-prescribed-row group flex items-start gap-2.5 rounded-lg border px-2.5 py-2.5 transition-colors sm:gap-3 sm:px-3",
                          draggedMedicineId === med.id && "is-dragged",
                        )}
                      >
                        <span
                          className="rx-prescribed-drag-handle mt-0.5 shrink-0 cursor-grab select-none rounded p-1 text-muted-foreground active:cursor-grabbing"
                          title={isBn ? "টেনে সাজান" : "Drag to reorder"}
                          aria-label={isBn ? "টেনে সাজান" : "Drag to reorder"}
                          role="button"
                          tabIndex={0}
                          draggable
                          onDragStart={event => {
                            setDraggedMedicineId(med.id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", med.id);
                          }}
                          onDragEnd={() => setDraggedMedicineId(null)}
                        >
                          <span aria-hidden="true">⠿</span>
                        </span>
                        <span className="rx-prescribed-number mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                            <span className="rx-prescribed-name text-sm font-bold">{med.brandName || med.genericName}</span>
                            {med.strength && <span className="text-xs font-semibold text-foreground">{med.strength}</span>}
                            {med.dosageForm && <span className="text-xs text-muted-foreground">{med.dosageForm}</span>}
                          </div>
                          {med.genericName && med.brandName && (
                            <div className="mt-0.5 text-xs text-muted-foreground">{med.genericName}</div>
                          )}
                          <div className="rx-prescribed-details mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            {med.dose && <span className="rx-prescribed-detail">{med.dose}</span>}
                            {med.timing && <span className="rx-prescribed-detail">{med.timing}</span>}
                            {med.durationNum && (
                              <span className="rx-prescribed-detail">
                                {med.durationNum} {med.durationUnit === "D" ? L.dayUnit : med.durationUnit === "W" ? L.weekUnit : L.monthUnit}
                              </span>
                            )}
                          </div>
                          {med.instructions && <div className="mt-1 text-xs italic text-muted-foreground">{med.instructions}</div>}
                        </div>
                        <div className="rx-prescribed-actions flex shrink-0 items-center gap-0.5">
                          <button type="button" onClick={() => editMedicine(med)}
                            className="min-h-9 min-w-9 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label={isBn ? "ওষুধ সম্পাদনা" : "Edit medicine"} title={isBn ? "সম্পাদনা" : "Edit"}>
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => moveMedicine(med.id, -1)} disabled={i === 0}
                            className="min-h-9 min-w-9 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:invisible" aria-label={isBn ? "উপরে নিন" : "Move up"} title={isBn ? "উপরে নিন" : "Move up"}>
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => moveMedicine(med.id, 1)} disabled={i === medicines.length - 1}
                            className="min-h-9 min-w-9 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:invisible" aria-label={isBn ? "নিচে নিন" : "Move down"} title={isBn ? "নিচে নিন" : "Move down"}>
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => removeMed(med.id)}
                            className="min-h-9 min-w-9 rounded-md p-2 text-destructive transition-colors hover:bg-destructive/10 hover:text-destructive/80" aria-label={isBn ? "ওষুধ মুছুন" : "Delete medicine"} title={isBn ? "মুছুন" : "Delete"}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button
                type="button"
                className="rx-reference-add-medicine inline-flex items-center gap-1.5 rounded-md border border-teal-600 bg-white px-3 py-1.5 text-sm font-bold text-teal-700 shadow-sm transition-colors hover:bg-teal-50 dark:bg-card dark:text-teal-300"
                onClick={() => {
                  setShowMedicineComposer(true);
                  window.setTimeout(() => medInputRef.current?.focus(), 0);
                }}
              >
                <Plus className="h-4 w-4" />{isBn ? "Add Medicine" : "Add Medicine"}
              </button>

              {/* ── ADVICE ─────────────────────────────────────────── */}
              <div className="rx-notes-card border rounded-xl overflow-hidden shadow-sm">
                <div className="bg-blue-50 dark:bg-blue-950/30 px-3 py-2 border-b">
                  <h3 className="text-xs font-bold text-blue-700 dark:text-blue-300">{L.advice}</h3>
                </div>
                <div className="p-2.5 space-y-1.5">
                  <AutoGrowingTextarea className="text-sm min-h-[56px] resize-none" placeholder={L.advicePlaceholder} value={advice} onChange={e => setAdvice(e.target.value)} />
                   <div className="rx-template-group">
                     <span className="rx-template-group-label">{isBn ? "পরামর্শ টেমপ্লেট" : "ADVICE TEMPLATES"}</span>
                     <div className="flex flex-wrap gap-1">
                       {(templates["advice"] ?? []).map(t => (
                         <button key={`advice-chip-${t.id}`} type="button" onClick={() => applyTemplate(t)}
                           className="text-xs px-2 py-1 rounded border bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800 hover:bg-purple-100 transition-colors">
                           {t.title}
                         </button>
                       ))}
                     </div>
                   </div>
                  <div className="flex flex-wrap gap-1">
                     <span className="text-[10px] text-muted-foreground">{isBn ? "পরামর্শ লিখুন বা টেমপ্লেট বেছে নিন" : "Enter advice or choose a template above"}</span>
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                      <Save className="h-3 w-3" />{L.save}
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── TREATMENT NOTE ───────────────────────────────────── */}
              <div className="rx-notes-card border rounded-xl overflow-hidden shadow-sm">
                <div className="bg-amber-50 dark:bg-amber-950/30 px-3 py-2 border-b">
                  <h3 className="text-xs font-bold text-amber-700 dark:text-amber-300">{L.treatmentNote}</h3>
                </div>
                <div className="p-2.5 space-y-1.5">
                  <AutoGrowingTextarea className="text-sm min-h-[56px] resize-none" placeholder={L.treatmentPlaceholder} value={treatmentNote} onChange={e => setTreatmentNote(e.target.value)} />
                  <div className="flex flex-wrap gap-1">
                    {(templates["protocol"] ?? []).map(t => (
                      <button key={t.id} type="button" onClick={() => applyTemplate(t)}
                        className="text-[9px] px-1.5 py-0.5 rounded border bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800 hover:bg-amber-100 transition-colors">
                        Template · {t.title}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                      <Save className="h-3 w-3" />{L.save}
                    </Button>
                  </div>
                </div>
              </div>
              <div className="rx-followup-card rx-prescription-font flex min-w-0 w-full max-w-full flex-col gap-1.5 rounded-xl border bg-background px-3 py-3">
                 <div className="flex min-w-0 w-full flex-wrap items-center gap-1.5">
                   <label className="text-xs font-bold uppercase tracking-wide text-green-700 dark:text-green-400 whitespace-nowrap">{L.followUpDate}</label>
                   <Input
                     className="h-7 min-w-[8rem] max-w-full flex-1 text-xs sm:max-w-[14rem]"
                     type={followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate) ? "text" : "date"}
                     value={followUpDate}
                     onChange={e => setFollowUpDate(e.target.value)}
                   />
                    <label className="text-[10px] text-muted-foreground font-semibold uppercase whitespace-nowrap">
                      {isBn ? "ফলো-আপ টেমপ্লেট" : "Follow-up Template"}
                   </label>
                   <select
                     className="h-7 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs sm:max-w-[14rem]"
                     value={selectedFollowUpOption}
                     onChange={e => {
                       if (e.target.value === CUSTOM_TEMPLATE_VALUE) {
                         setFollowUpValue("");
                       } else {
                         setFollowUpValue(e.target.value);
                       }
                     }}
                     aria-label={isBn ? "ফলো-আপ বেছে নিন" : "Choose follow-up"}
                   >
                     <option value={CUSTOM_TEMPLATE_VALUE}>Custom</option>
                     {followUpOptions.map(option => (
                       <option key={option} value={option}>{option}</option>
                     ))}
                   </select>
                 </div>
                 <div className="flex min-w-0 items-center gap-1.5">
                   <Input
                     className="h-7 min-w-0 flex-1 text-xs"
                     placeholder={isBn ? "ফলো-আপ লিখুন..." : "Edit follow-up..."}
                     value={followUpValue}
                     onChange={e => setFollowUpValue(e.target.value)}
                     aria-label={isBn ? "ফলো-আপ সম্পাদনা করুন" : "Edit follow-up"}
                   />
                   <Button
                     type="button"
                     variant="outline"
                     size="sm"
                     className="h-7 shrink-0 px-2 text-xs gap-1"
                     onClick={saveFollowUpOption}
                   >
                     <Save className="h-3 w-3" />
                     {isBn ? "সেভ" : "Save"}
                   </Button>
                 </div>
               </div>

              {/* Save buttons (bottom CTA) */}
              <div className="flex flex-wrap gap-2 pb-4">
                <Button className="w-full min-w-0 sm:flex-1 bg-teal-600 hover:bg-teal-700" onClick={() => handleSave(true, "final")} disabled={createRx.isPending || updateRx.isPending}>
                  <Printer className="h-4 w-4 mr-2" />{savePrintLabel}
                </Button>
                <Button variant="outline" className="w-full min-w-0 sm:flex-1" onClick={() => handleSave(false, "final")} disabled={createRx.isPending || updateRx.isPending}>
                  {saveOnlyLabel}
                </Button>
                <Button variant="outline" className="w-full min-w-0 sm:flex-1" onClick={() => handleSave(false, "draft")} disabled={createRx.isPending || updateRx.isPending}>
                  <Save className="h-4 w-4 mr-2" />{saveDraftLabel}
                </Button>
                <Button type="button" variant="outline" className="w-full min-w-0 sm:flex-1" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`${patient.name || "Patient"} — ${diagnosis || L.diagnosisDx}`)}`, "_blank", "noopener,noreferrer")}>
                  Share
                </Button>
              </div>

            </div>
          </ScrollArea>
        </main>

        {/* ── TEMPLATES IN THE LEFT SIDEBAR ─────────────────────────── */}
        {showTemplates && (
         <aside className="absolute inset-y-2 left-2 right-2 z-40 flex w-auto max-w-none flex-col overflow-hidden rounded-lg border bg-background shadow-xl sm:right-auto sm:w-[min(30%,calc(100vw-1rem))] sm:max-w-[calc(100vw-1rem)]" aria-label={L.templates}>
          <div className="px-3 py-2 border-b bg-muted/20">
             <div className="flex flex-wrap items-center justify-between gap-1">
                <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground shrink-0">{L.templates}</h3>
               <div className="flex flex-wrap items-center justify-end gap-1">
                 <button type="button"
                   onClick={() => { const next = !isManageTemplates; setIsManageTemplates(next); if (next) reloadAllTemplates(); }}
                  className={cn("text-xs flex items-center gap-0.5 px-1 py-0.5 rounded transition-colors", isManageTemplates ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary")}>
                  <Settings2 className="h-3 w-3" />{L.tmplManage}
                </button>
                 <button type="button" onClick={() => openNewTemplate()}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-0.5">
                  <PlusCircle className="h-3 w-3" />{L.newBtn}
                </button>
                <button type="button"
                   onClick={() => openNewTemplate("full")}
                  className="text-xs text-teal-700 dark:text-teal-300 hover:text-teal-600 flex items-center gap-0.5">
                  <Save className="h-3 w-3" />{L.saveCurrentTemplate}
                </button>
                <button type="button" onClick={() => setShowTemplates(false)}
                   className="inline-flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close templates">
                  ×
                </button>
              </div>
            </div>
          </div>
          <ScrollArea className="flex-1">
             <div className="p-2 space-y-3 text-sm">

              {/* Queue Summary — enhanced: break/day-end aware, with stats + efficiency */}
              {false && <div className="border rounded bg-background overflow-hidden">
                <div className="flex flex-wrap gap-1.5 items-center p-2 border-b">
                  {/* Next: disabled on break, day-end, or when no patients remain */}
                  <Button
                    size="sm"
                    className="h-6 text-xs px-2"
                    onClick={() => queueAction("next")}
                    disabled={isOnBreak || isDayEnded || callNext.isPending || (queueWaiting.length === 0 && !queueServing)}
                    title={
                      isOnBreak ? (isBn ? "বিরতিতে আছেন" : "On break — end break first")
                        : isDayEnded ? (isBn ? "দিন শেষ" : "Day ended")
                        : (queueWaiting.length === 0 && !queueServing) ? (isBn ? "কিউ খালি" : "Queue empty")
                        : undefined
                    }
                  >
                    <ChevronRight className="h-3 w-3 mr-0.5" />{L.next}
                  </Button>
                  {queueServing && <>
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => queueAction("seen", queueServing?.id)}>
                      <UserCheck className="h-3 w-3 mr-0.5" />{L.seen}
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => queueAction("skip", queueServing?.id)}>
                      <SkipForward className="h-3 w-3 mr-0.5" />{L.skip}
                    </Button>
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => queueAction("recall", queueServing?.id)}>
                      <RotateCcw className="h-3 w-3 mr-0.5" />{L.recall}
                    </Button>
                  </>}
                </div>
                {queueWaiting[0] ? (
                  <div className="px-2 py-1 text-xs text-muted-foreground">{L.nextColon} #{queueWaiting[0].serialNo} {queueWaiting[0].patientName}</div>
                ) : !queueServing && qCompleted > 0 ? (
                  <div className="px-2 py-1 text-xs font-medium text-green-700 dark:text-green-400">
                    ✓ {isBn ? "আজকের কিউ সম্পন্ন" : "Today's Queue Completed"}
                  </div>
                ) : null}
                {/* Header row */}
                <div className="flex items-center justify-between px-2 py-1 bg-teal-600/10 border-b">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-teal-700 dark:text-teal-400">{L.queueSummary}</span>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("text-[9px] font-medium px-1 rounded-full border",
                      isDayEnded ? "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                        : isOnBreak ? "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800"
                        : "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                    )}>
                      {isDayEnded ? L.statusDayEnded : isOnBreak ? L.statusOnBreak : L.statusAvailable}
                    </span>
                    <span className="flex items-center gap-1 text-[9px] text-emerald-600 font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />{L.liveTag}
                    </span>
                  </div>
                </div>

                {/* Break mode panel */}
                {isOnBreak && (
                  <div className="p-2 bg-yellow-50 dark:bg-yellow-950/20 border-b border-yellow-100 dark:border-yellow-900 space-y-1">
                    <div className="flex items-center gap-1.5 text-yellow-800 dark:text-yellow-300">
                      <Coffee className="h-3 w-3 shrink-0" />
                      <span className="text-[10px] font-semibold">{L.breakActive}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-yellow-700 dark:text-yellow-400">
                      <Timer className="h-3 w-3 shrink-0" />
                      <span className="font-mono font-bold text-base leading-none">{breakCdStr ?? "—"}</span>
                    </div>
                    {qBreakUntil && (
                      <div className="text-[9px] text-yellow-600 dark:text-yellow-500">
                        {L.expectedResume}: {new Date(qBreakUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    )}
                    {breakExpired && (
                      <Button size="sm" className="h-5 text-[9px] px-2 mt-0.5 w-full" onClick={async () => {
                        try { await updateStatusRx.mutateAsync({ data: { status: "online" } }); void refetchQ(); } catch {}
                      }}>{L.resumeBreak}</Button>
                    )}
                  </div>
                )}

                {/* Day ended mode */}
                {isDayEnded ? (
                  <div className="p-2 space-y-1">
                    <p className="text-[10px] font-bold text-red-700 dark:text-red-400">• {L.dayEnded}</p>
                    <p className="text-[9px] text-muted-foreground">{L.noMoreAppts}</p>
                    <p className="text-[9px] text-muted-foreground">{L.doctorUnavailable}</p>
                    {qTotalToday > 0 && (
                      <div className="mt-1.5 pt-1.5 border-t space-y-1">
                        <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{L.daySummaryTitle}</div>
                        <div className="grid grid-cols-2 gap-1">
                          <div className="rounded bg-muted px-1.5 py-1">
                            <div className="text-[8px] text-muted-foreground">{L.totalAppts}</div>
                            <div className="text-xs font-bold">{qTotalToday}</div>
                          </div>
                          <div className="rounded bg-green-600/10 px-1.5 py-1">
                            <div className="text-[8px] text-muted-foreground">{L.completedCount}</div>
                            <div className="text-xs font-bold text-green-700 dark:text-green-400">{qCompleted}</div>
                          </div>
                          <div className="rounded bg-amber-600/10 px-1.5 py-1">
                            <div className="text-[8px] text-muted-foreground">{L.skippedCount}</div>
                            <div className="text-xs font-bold">{qSkipped}</div>
                          </div>
                          {qAvgConsultMs > 0 && (
                            <div className="rounded bg-muted px-1.5 py-1">
                              <div className="text-[8px] text-muted-foreground">{L.avgConsultation}</div>
                              <div className="text-xs font-bold">{Math.round(qAvgConsultMs / 60000)}m</div>
                            </div>
                          )}
                        </div>
                        {qFirstPatientTime && (
                          <div className="text-[9px] text-muted-foreground">{L.firstPatient}: <span className="font-medium">{new Date(qFirstPatientTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
                        )}
                        {qLastPatientTime && (
                          <div className="text-[9px] text-muted-foreground">{L.lastPatient}: <span className="font-medium">{new Date(qLastPatientTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Normal / break: stats grid */}
                    <div className="grid grid-cols-2 gap-1 p-1.5">
                      <div className="rounded bg-teal-600/10 px-1.5 py-1">
                        <div className="text-[9px] text-muted-foreground truncate">{L.nowServingShort}</div>
                        <div className="text-sm font-bold text-teal-700 dark:text-teal-400 truncate">{queueServing ? `#${queueServing?.serialNo}` : "—"}</div>
                      </div>
                      <div className="rounded bg-muted px-1.5 py-1">
                        <div className="text-[9px] text-muted-foreground truncate">{L.nextShort}</div>
                        <div className="text-sm font-bold truncate">{queueWaiting[0] ? `#${queueWaiting[0].serialNo}` : "—"}</div>
                      </div>
                      <div className="rounded bg-muted px-1.5 py-1 flex flex-col">
                        <div className="text-[9px] text-muted-foreground">{L.waitingShort}</div>
                        <div className="text-sm font-bold">{queueWaiting.length}</div>
                      </div>
                      <div className="rounded bg-green-600/10 px-1.5 py-1 flex flex-col">
                        <div className="text-[9px] text-muted-foreground">{L.completedCount}</div>
                        <div className="text-sm font-bold text-green-700 dark:text-green-400">{qCompleted}</div>
                      </div>
                      <div className="col-span-2 rounded bg-muted px-1.5 py-1 flex items-center justify-between">
                        <span className="text-[9px] text-muted-foreground">{L.totalAppts}</span>
                        <span className="text-xs font-bold">{qTotalToday}</span>
                      </div>
                      {qAvgConsultMs > 0 && (
                        <div className="col-span-2 rounded bg-muted/60 px-1.5 py-1 flex items-center justify-between">
                          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                            <TrendingUp className="h-2.5 w-2.5" />{L.avgWaitTime}
                          </span>
                          <span className="text-[10px] font-semibold">{Math.round(qAvgConsultMs / 60000)}m</span>
                        </div>
                      )}
                      {qAvgConsultMs > 0 && queueWaiting.length > 0 && (
                        <div className="col-span-2 rounded bg-muted/60 px-1.5 py-1 flex items-center justify-between">
                          <span className="text-[9px] text-muted-foreground">{L.estWaitNext}</span>
                          <span className="text-[10px] font-semibold">~{Math.round((qAvgConsultMs * queueWaiting.length) / 60000)}m</span>
                        </div>
                      )}
                    </div>
                    {/* Queue list */}
                    <div className="border-t">
                      <div className="px-1.5 py-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">{L.todaysQueue}</div>
                      <div className="max-h-28 overflow-y-auto px-1.5 pb-1.5 space-y-0.5">
                        {allQueue.length === 0 ? (
                          <div className="text-[10px] text-muted-foreground py-1">{L.queueEmpty}</div>
                        ) : allQueue.map(e => (
                          <div key={e.id} className={cn("flex items-center gap-1.5 rounded px-1 py-0.5", e.status === "serving" ? "bg-teal-600/10" : "")}>
                            <span className={cn("shrink-0 h-4 min-w-4 px-0.5 rounded-full text-[9px] font-bold flex items-center justify-center", e.status === "serving" ? "bg-teal-600 text-white" : "bg-muted-foreground/20")}>
                              {e.serialNo}
                            </span>
                            <span className="truncate flex-1 text-[10px]">{e.patientName || "—"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>}

              {/* New template form */}
              {showTemplateForm && (
                <div className="border rounded p-2 bg-background space-y-1.5">
                   <select className="w-full h-6 text-sm border rounded bg-background px-1" value={newTmpl.type} onChange={e => {
                     const type = e.target.value;
                     setNewTmpl(t => ({ ...t, type }));
                     if (type === "full" && templateMedicines.length === 0) {
                       setTemplateMedicines(cloneTemplateMedicines(medicines));
                     }
                   }}>
                    <option value="advice">{L.tmplAdvice}</option>
                    <option value="cc">{L.tmplCc}</option>
                    <option value="oe">{L.tmplOe}</option>
                    <option value="ix">{L.tmplIx}</option>
                    <option value="drugHistory">{L.tmplDrugHistory}</option>
                    <option value="dose">{L.tmplDose}</option>
                    <option value="timing">{L.tmplTiming}</option>
                    <option value="duration">{L.tmplDuration}</option>
                    <option value="protocol">{L.tmplProtocol}</option>
                    <option value="treatment">{L.tmplTreatment}</option>
                    <option value="followup">{L.tmplFollowup}</option>
                    <option value="full">{L.tmplFull}</option>
                  </select>
                   <Input className="h-6 text-sm" placeholder={L.tmplTitlePlaceholder} value={newTmpl.title} onChange={e => setNewTmpl(t => ({ ...t, title: e.target.value }))} />
                   <Input className="h-6 text-sm" placeholder={L.tmplDepartmentPlaceholder} value={newTmpl.department} onChange={e => setNewTmpl(t => ({ ...t, department: e.target.value }))} />
                  {newTmpl.type === "duration" ? (() => {
                    const _m = newTmpl.content.match(/^(\d+)/);
                    const _num = _m ? _m[1] : "";
                    const _isM = /M|মাস/i.test(newTmpl.content);
                    const _isW = !_isM && /W|সপ্তাহ/i.test(newTmpl.content);
                    const _unit: "D" | "W" | "M" = _isM ? "M" : _isW ? "W" : "D";
                    const setDur = (n: string, u: "D" | "W" | "M") => setNewTmpl(t => ({ ...t, content: `${n} ${u}` }));
                    return (
                      <div className="flex flex-wrap items-center gap-1 py-1">
                         <Input type="number" min="1" className="h-7 w-16 text-sm text-center"
                          value={_num} onChange={e => setDur(e.target.value, _unit)} />
                        <button type="button" onClick={() => setDur(_num, "D")}
                           className={cn("text-sm px-3 py-1 rounded border transition-colors", _unit === "D" && !durationPresetsDB.some(p => p.n === _num && p.u === "D") ? "bg-teal-600 text-white border-teal-600" : "bg-background border-border hover:border-teal-400")}>
                          {L.dayUnit}
                        </button>
                        <button type="button" onClick={() => setDur(_num, "W")}
                           className={cn("text-sm px-3 py-1 rounded border transition-colors", _unit === "W" && !durationPresetsDB.some(p => p.n === _num && p.u === "W") ? "bg-teal-600 text-white border-teal-600" : "bg-background border-border hover:border-teal-400")}>
                          {L.weekUnit}
                        </button>
                        <button type="button" onClick={() => setDur(_num, "M")}
                           className={cn("text-sm px-3 py-1 rounded border transition-colors", _unit === "M" && !durationPresetsDB.some(p => p.n === _num && p.u === "M") ? "bg-teal-600 text-white border-teal-600" : "bg-background border-border hover:border-teal-400")}>
                          {L.monthUnit}
                        </button>
                        <span className="text-muted-foreground text-[10px] px-0.5 select-none">|</span>
                        {durationPresetsDB.map(p => {
                          const act = _num === p.n && _unit === p.u;
                          return (
                            <button key={p.title} type="button" onClick={() => setDur(p.n, p.u)}
                               className={cn("text-sm px-2 py-1 rounded border transition-colors", act ? "bg-teal-600 text-white border-teal-600" : "bg-background border-border hover:border-teal-400 hover:text-teal-600")}>
                              {p.title}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })() : newTmpl.type === "timing" ? (
                    <div className="flex flex-wrap gap-1 py-1">
                      {(templates["timing"] ?? []).map(t => (
                        <button key={t.id} type="button" onClick={() => setNewTmpl(n => ({ ...n, content: t.content }))}
                           className={cn("text-sm px-2 py-1 rounded border transition-colors", newTmpl.content === t.content ? "bg-teal-600 text-white border-teal-600" : "bg-background border-border hover:border-teal-400 hover:text-teal-600")}>
                          {t.title}
                        </button>
                      ))}
                       <Input className="h-7 w-36 text-sm" placeholder={L.customTiming}
                        value={newTmpl.content}
                        onChange={e => setNewTmpl(n => ({ ...n, content: e.target.value }))} />
                    </div>
                   ) : newTmpl.type === "full" ? (
                     <div className="space-y-1.5 rounded border border-teal-200 bg-teal-50/60 p-1.5 text-teal-900 dark:border-teal-900 dark:bg-teal-950/20 dark:text-teal-100">
                       <div className="flex items-center justify-between gap-2">
                         <span className="text-xs font-semibold">{isBn ? "টেমপ্লেটের ওষুধ" : "Template medicines"}</span>
                         <span className="text-[10px] text-muted-foreground">{templateMedicines.length}</span>
                       </div>
                       {templateMedicines.length === 0 && (
                         <p className="rounded border border-dashed border-teal-300 px-2 py-1 text-xs text-muted-foreground dark:border-teal-800">
                           {isBn ? "নিচের বোতাম দিয়ে এক বা একাধিক ওষুধ যোগ করুন।" : "Add one or more medicines below."}
                         </p>
                       )}
                       <div className="space-y-1.5">
                         {templateMedicines.map((med, index) => (
                           <div key={med.id} className="space-y-1.5 rounded-md border bg-background p-1.5 text-foreground">
                             <div className="flex items-center gap-1">
                               <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                                 {index + 1}. {med.brandName || (isBn ? "নতুন ওষুধ" : "New medicine")}
                               </span>
                               <button
                                 type="button"
                                 onClick={() => removeTemplateMedicine(med.id)}
                                 className="rounded px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10"
                               >
                                 {isBn ? "সরান" : "Remove"}
                               </button>
                             </div>
                             <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
                               <Input
                                 className="h-7 text-sm"
                                 placeholder={L.medNamePlaceholder}
                                 value={med.brandName}
                                 onChange={e => updateTemplateMedicine(med.id, { brandName: e.target.value })}
                               />
                               <Input
                                 className="h-7 text-sm"
                                 placeholder={L.strengthPlaceholder}
                                 value={med.strength}
                                 onChange={e => updateTemplateMedicine(med.id, { strength: e.target.value })}
                               />
                               <Input
                                 className="h-7 text-sm"
                                 placeholder={L.formPlaceholder}
                                 value={med.dosageForm}
                                 onChange={e => updateTemplateMedicine(med.id, { dosageForm: e.target.value })}
                               />
                             </div>
                             <div className="grid grid-cols-1 gap-1 sm:grid-cols-3">
                               <label className="space-y-0.5">
                                 <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{L.dose}</span>
                                 <Input
                                   className="h-7 text-sm"
                                   placeholder="1 tablet"
                                   value={med.dose}
                                   onChange={e => updateTemplateMedicine(med.id, { dose: e.target.value })}
                                 />
                               </label>
                               <label className="space-y-0.5">
                                 <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{L.timing}</span>
                                 <Input
                                   className="h-7 text-sm"
                                   placeholder="1+0+1"
                                   value={med.timing}
                                   onChange={e => updateTemplateMedicine(med.id, { timing: e.target.value })}
                                 />
                               </label>
                               <label className="space-y-0.5">
                                 <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{L.duration}</span>
                                 <div className="flex gap-1">
                                   <Input
                                     type="number"
                                     min="1"
                                     className="h-7 min-w-0 flex-1 text-sm"
                                     placeholder="5"
                                     value={med.durationNum}
                                     onChange={e => updateTemplateMedicine(med.id, { durationNum: e.target.value })}
                                   />
                                   <select
                                     className="h-7 w-[4.5rem] rounded border bg-background px-1 text-xs"
                                     value={med.durationUnit}
                                     onChange={e => updateTemplateMedicine(med.id, { durationUnit: e.target.value as MedItem["durationUnit"] })}
                                   >
                                     <option value="D">{L.dayUnit}</option>
                                     <option value="W">{L.weekUnit}</option>
                                     <option value="M">{L.monthUnit}</option>
                                   </select>
                                 </div>
                               </label>
                             </div>
                           </div>
                         ))}
                       </div>
                       <Button type="button" variant="outline" size="sm" className="h-7 w-full text-xs" onClick={addTemplateMedicine}>
                         <Plus className="mr-1 h-3 w-3" />{isBn ? "ওষুধ যোগ করুন" : "Add medicine"}
                       </Button>
                     </div>
                  ) : (
                     <AutoGrowingTextarea className="text-sm min-h-[48px] resize-none" placeholder={L.tmplContentPlaceholder} value={newTmpl.content} onChange={e => setNewTmpl(t => ({ ...t, content: e.target.value }))} />
                  )}
                   <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input type="checkbox" checked={newTmpl.isFavorite} onChange={e => setNewTmpl(t => ({ ...t, isFavorite: e.target.checked }))} />
                    {L.markFavorite}
                  </label>
                   <div className="flex gap-1">
                      <Button size="sm" className="h-6 text-sm flex-1 bg-teal-600 hover:bg-teal-700" onClick={saveTemplate}>{editingTmplId !== null ? L.update : L.save}</Button>
                      <Button size="sm" variant="outline" className="h-6 text-sm" onClick={cancelTemplateForm}>{L.cancel}</Button>
                  </div>
                </div>
              )}

              {/* Template manager — shows all templates including hidden, with reorder + hide controls */}
              {isManageTemplates && (
                <div className="border rounded bg-background p-2 space-y-2.5">
                  <div className="flex items-center justify-between">
                   <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{L.tmplManage}</span>
                    <button type="button" onClick={restoreDefaultTemplates}
                       className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
                      <RefreshCw className="h-2.5 w-2.5" />{L.tmplRestoreDefaults}
                    </button>
                  </div>
                  {(["advice","cc","oe","ix","drugHistory","dose","timing","duration","protocol","treatment","followup","full"] as const).map(typeKey => {
                     const items: RxTemplate[] = managedTemplatesGrouped[typeKey] ?? [];
                    if (items.length === 0) return null;
                    const typeLabel = typeKey === "advice" ? L.tmplAdvice : typeKey === "cc" ? L.tmplCc
                      : typeKey === "oe" ? L.tmplOe : typeKey === "ix" ? L.tmplIx : typeKey === "drugHistory" ? L.tmplDrugHistory
                      : typeKey === "dose" ? L.tmplDose : typeKey === "timing" ? L.tmplTiming
                      : typeKey === "duration" ? L.tmplDuration : typeKey === "protocol" ? L.tmplProtocol
                      : typeKey === "followup" ? L.tmplFollowup : typeKey === "full" ? L.tmplFull : L.tmplTreatment;
                    return (
                      <div key={typeKey}>
                         <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5 border-b pb-0.5">{typeLabel}</div>
                        <div className="space-y-0.5">
                          {items.map((t: any, i: number) => (
                             <div key={t.id} className={cn("flex items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-muted/40", t.isHidden && "opacity-40")}>
                              <span className="flex-1 truncate">{t.title}</span>
                               {t.isHidden && <span className="text-[10px] border rounded px-0.5 text-muted-foreground shrink-0">hidden</span>}
                              <div className="flex items-center gap-0.5 shrink-0">
                                <button type="button" title={t.isHidden ? L.tmplShow : L.tmplHide}
                                  onClick={() => hideTemplate(t, !t.isHidden)}
                                  className="p-0.5 hover:text-primary">
                                  {t.isHidden ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                                </button>
                                <button type="button" title="Move up" onClick={() => moveTemplate(t, -1)} disabled={i === 0}
                                  className="p-0.5 hover:text-primary disabled:opacity-25">
                                  <ArrowUp className="h-2.5 w-2.5" />
                                </button>
                                <button type="button" title="Move down" onClick={() => moveTemplate(t, 1)} disabled={i === items.length - 1}
                                  className="p-0.5 hover:text-primary disabled:opacity-25">
                                  <ArrowDown className="h-2.5 w-2.5" />
                                </button>
                                <button type="button" title={L.editLabel}
                                  onClick={() => { editTemplate(t); setIsManageTemplates(false); }}
                                  className="p-0.5 hover:text-teal-600">
                                  <Pencil className="h-2.5 w-2.5" />
                                </button>
                                <button type="button" title={L.deleteLabel}
                                  onClick={() => deleteTemplate(t)}
                                  className="p-0.5 hover:text-red-500">
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Generic → Brand */}
              <TemplateSection title={L.genericToBrand} items={[]} onApply={applyTemplate} emptyHint={L.genericToBrandHint} searchPlaceholder={L.genericNamePlaceholder} isSearch onSelectMed={selectMedSug} />

              {/* Protocol */}
              <TemplateSection title={L.treatmentProtocol} icon="•" items={templates["protocol"] ?? []} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* Advice */}
              <TemplateSection title={L.adviceTemplate} icon="•" items={templates["advice"] ?? []} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* C/C */}
              <TemplateSection title={L.ccTemplate} icon="•" items={templates["cc"] ?? []} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* Dose */}
              <TemplateSection title={L.tmplDose} icon="⚖️" items={mergeTemplateOptions(managedDefaultTemplates.filter(t => t.type === "dose" && !t.isHidden), templates["dose"] ?? [])} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* Timing */}
              <TemplateSection title={L.tmplTiming} icon="⏱️" items={mergeTemplateOptions(managedDefaultTemplates.filter(t => t.type === "timing" && !t.isHidden), templates["timing"] ?? [])} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* Duration */}
              <TemplateSection title={L.tmplDuration} icon="•" items={mergeTemplateOptions(managedDefaultTemplates.filter(t => t.type === "duration" && !t.isHidden), templates["duration"] ?? [])} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* O/E */}
              <TemplateSection title={L.oeTemplate} icon="•" items={templates["oe"] ?? []} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* I/X */}
              <TemplateSection title={L.ixTemplate} icon="•" items={templates["ix"] ?? []} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* Full prescription */}
              <TemplateSection title={L.tmplFull} icon="•" items={templates["full"] ?? []} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

              {/* Follow-up */}
              <TemplateSection title={L.tmplFollowup} icon="•" items={mergeTemplateOptions(managedDefaultTemplates.filter(t => t.type === "followup" && !t.isHidden), templates["followup"] ?? [])} onApply={applyTemplate} onEdit={editTemplate} onDelete={deleteTemplate} onFavorite={toggleFavorite} favLabel={L.favorites} editLabel={L.editLabel} deleteLabel={L.deleteLabel} />

            </div>
          </ScrollArea>
        </aside>
        )}

      </div>

      {/* ══ HEADER SETTINGS DIALOG ═══════════════════════════════════ */}
      <Dialog open={showHeaderDlg} onOpenChange={setShowHeaderDlg}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4" />{L.headerSettings}</DialogTitle>
            <DialogDescription>{L.headerSettingsDesc}</DialogDescription>
          </DialogHeader>
          {settingsForm && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-2">
              <div className="space-y-1">
                <Label className="text-xs">{L.hdrName}</Label>
                <Input className="h-8 text-sm" value={settingsForm.headerName ?? ""} placeholder={L.hdrPlaceholderHint} onChange={e => setSettingsForm(s => s ? { ...s, headerName: e.target.value } : s)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L.hdrDegree}</Label>
                <Input className="h-8 text-sm" value={settingsForm.headerDegree ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, headerDegree: e.target.value } : s)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L.hdrDesignation}</Label>
                <Input className="h-8 text-sm" value={settingsForm.headerDesignation ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, headerDesignation: e.target.value } : s)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L.hdrBmdc}</Label>
                <Input className="h-8 text-sm" value={settingsForm.headerBmdc ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, headerBmdc: e.target.value } : s)} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">{L.hdrHospital}</Label>
                <Input className="h-8 text-sm" value={settingsForm.hospitalName ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, hospitalName: e.target.value } : s)} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">{L.hdrAddress}</Label>
                <Input className="h-8 text-sm" value={settingsForm.headerAddress ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, headerAddress: e.target.value } : s)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L.hdrPhone}</Label>
                <Input className="h-8 text-sm" value={settingsForm.headerPhone ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, headerPhone: e.target.value } : s)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L.hdrEmail}</Label>
                <Input className="h-8 text-sm" value={settingsForm.headerEmail ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, headerEmail: e.target.value } : s)} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">{L.hdrSignature}</Label>
                <Input className="h-8 text-sm" value={settingsForm.signatureText ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, signatureText: e.target.value } : s)} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">{L.hdrSignatureImage}</Label>
                <div className="flex items-center gap-3">
                  {settingsForm.signatureImage ? (
                    <div className="flex items-center gap-2">
                      <img src={settingsForm.signatureImage} alt="signature" className="h-10 object-contain border rounded bg-white p-1" />
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSettingsForm(s => s ? { ...s, signatureImage: null } : s)}>{L.remove}</Button>
                    </div>
                  ) : null}
                  <Input
                    type="file"
                    accept="image/*"
                    className="h-8 text-xs file:text-xs"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setSettingsForm(s => s ? { ...s, signatureImage: String(reader.result) } : s);
                      reader.readAsDataURL(file);
                    }}
                  />
                </div>
                  <div className="rx-template-group">
                    <span className="rx-template-group-label">{isBn ? "ফলো-আপ টেমপ্লেট" : "FOLLOW-UP TEMPLATES"}</span>
                    <div className="flex flex-wrap gap-1">
                      {(templates["followup"] ?? []).map(t => (
                        <button key={`followup-template-${t.id}`} type="button" onClick={() => {
                          setFollowUpValue(t.content);
                          setFollowUpDate("");
                        }}
                          className="text-xs px-2 py-1 rounded border bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition-colors">
                          {t.title}
                        </button>
                      ))}
                      {followUpOptions.slice(0, 6).map(option => (
                        <button key={`followup-option-${option}`} type="button" onClick={() => {
                          setFollowUpValue(option);
                          setFollowUpDate("");
                        }}
                          className="text-xs px-2 py-1 rounded border bg-teal-50 dark:bg-teal-950/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800 hover:bg-teal-100 transition-colors">
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowHeaderDlg(false)}>{L.cancel}</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={saveSettings} disabled={updateSettings.isPending}>{L.saveSettings}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ PAGE SETUP DIALOG ════════════════════════════════════════ */}
      <Dialog open={showPageDlg} onOpenChange={setShowPageDlg}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileCog className="h-4 w-4" />{L.pageSetup}</DialogTitle>
            <DialogDescription>{L.pageSetupDesc}</DialogDescription>
          </DialogHeader>
          {settingsForm && (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-xs">{L.psSize}</Label>
                <select className="w-full h-8 text-sm border rounded bg-background px-2"
                  value={settingsForm.pageSize ?? "A4"}
                  onChange={e => setSettingsForm(s => s ? { ...s, pageSize: e.target.value } : s)}>
                  <option value="A4">A4</option>
                  <option value="A5">A5</option>
                  <option value="Letter">Letter</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L.psMargins}</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div><span className="text-[10px] text-muted-foreground">{L.psTop}</span><Input className="h-8 text-sm" type="number" value={settingsForm.marginTop ?? 0} onChange={e => setSettingsForm(s => s ? { ...s, marginTop: Number(e.target.value) } : s)} /></div>
                  <div><span className="text-[10px] text-muted-foreground">{L.psRight}</span><Input className="h-8 text-sm" type="number" value={settingsForm.marginRight ?? 0} onChange={e => setSettingsForm(s => s ? { ...s, marginRight: Number(e.target.value) } : s)} /></div>
                  <div><span className="text-[10px] text-muted-foreground">{L.psBottom}</span><Input className="h-8 text-sm" type="number" value={settingsForm.marginBottom ?? 0} onChange={e => setSettingsForm(s => s ? { ...s, marginBottom: Number(e.target.value) } : s)} /></div>
                  <div><span className="text-[10px] text-muted-foreground">{L.psLeft}</span><Input className="h-8 text-sm" type="number" value={settingsForm.marginLeft ?? 0} onChange={e => setSettingsForm(s => s ? { ...s, marginLeft: Number(e.target.value) } : s)} /></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">{L.psHeaderHeight}</Label>
                  <Input className="h-8 text-sm" type="number" value={settingsForm.headerHeight ?? 0} onChange={e => setSettingsForm(s => s ? { ...s, headerHeight: Number(e.target.value) } : s)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{L.psFooterHeight}</Label>
                  <Input className="h-8 text-sm" type="number" value={settingsForm.footerHeight ?? 0} onChange={e => setSettingsForm(s => s ? { ...s, footerHeight: Number(e.target.value) } : s)} />
                </div>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between"><Label className="text-xs">{L.psShowHeader}</Label><Switch checked={!!settingsForm.showHeader} onCheckedChange={v => setSettingsForm(s => s ? { ...s, showHeader: v } : s)} /></div>
                <div className="flex items-center justify-between"><Label className="text-xs">{L.psShowQr}</Label><Switch checked={!!settingsForm.showQr} onCheckedChange={v => setSettingsForm(s => s ? { ...s, showQr: v } : s)} /></div>
                <div className="flex items-center justify-between"><Label className="text-xs">{L.psShowSignature}</Label><Switch checked={!!settingsForm.showSignature} onCheckedChange={v => setSettingsForm(s => s ? { ...s, showSignature: v } : s)} /></div>
                <div className="flex items-center justify-between"><Label className="text-xs">{L.psShowFooter}</Label><Switch checked={!!settingsForm.showFooter} onCheckedChange={v => setSettingsForm(s => s ? { ...s, showFooter: v } : s)} /></div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{L.psFooterText}</Label>
                <Input className="h-8 text-sm" value={settingsForm.footerText ?? ""} onChange={e => setSettingsForm(s => s ? { ...s, footerText: e.target.value } : s)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPageDlg(false)}>{L.cancel}</Button>
            <Button className="bg-teal-600 hover:bg-teal-700" onClick={saveSettings} disabled={updateSettings.isPending}>{L.saveSettings}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {activeCalculator && (
        <Dialog open onOpenChange={open => { if (!open) setActiveCalculatorKey(null); }}>
          <CalculatorDialog calculator={activeCalculator} />
        </Dialog>
      )}

    </div>
  );
}

/* ── Small helper components ────────────────────────────────────────── */

function QuickClinicalTool({ tool }: { tool: QuickToolDefinition }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const output = tool.calculate(values);

  return (
    <div className="rounded border border-teal-200 bg-background p-2 dark:border-teal-800">
      <div className="text-xs font-semibold text-teal-700 dark:text-teal-300">{tool.label}</div>
      {tool.description && <p className="mt-0.5 text-[10px] text-muted-foreground">{tool.description}</p>}
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
        {tool.fields.map(field => (
          <label key={field.key} className="space-y-0.5 text-[10px] text-muted-foreground">
            <span>{field.label}</span>
            <Input
              className="h-7 text-xs"
              type="number"
              inputMode="decimal"
              placeholder={field.placeholder}
              value={values[field.key] ?? ""}
              onChange={e => setValues(previous => ({ ...previous, [field.key]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      {output && (
        <div className="mt-1.5 rounded bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800 dark:bg-teal-950/30 dark:text-teal-200">
          {output}
        </div>
      )}
    </div>
  );
}

function CalculatorDialog({ calculator }: { calculator: CalculatorDefinition }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Calculator className="h-4 w-4" />
          {calculator.label}
        </DialogTitle>
        {calculator.description && <DialogDescription>{calculator.description}</DialogDescription>}
      </DialogHeader>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {calculator.fields.map(field => (
            <label key={field.key} className="space-y-1 text-sm">
              <span className="text-muted-foreground">{field.label}</span>
              <Input
                type="number"
                inputMode="decimal"
                placeholder={field.placeholder}
                value={values[field.key] ?? ""}
                onChange={e => {
                  setValues(previous => ({ ...previous, [field.key]: e.target.value }));
                  setResult(null);
                }}
              />
            </label>
          ))}
        </div>
        <Button type="button" className="w-full bg-teal-600 hover:bg-teal-700" onClick={() => setResult(calculator.calculate(values))}>
          Calculate
        </Button>
        <div className="min-h-16 rounded-md border bg-muted/30 p-3 text-sm" aria-live="polite">
          <span className="text-muted-foreground">{result ?? "Result will appear here."}</span>
        </div>
      </div>
    </DialogContent>
  );
}

function NavBtn({ href, icon, label, active }: { href: string; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <Link href={href}>
      <span className={cn(
        "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors cursor-pointer",
        active ? "bg-teal-600 text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}>
        {icon}{label}
      </span>
    </Link>
  );
}

function TemplateSection({ title, icon, items, onApply, emptyHint, isSearch, searchPlaceholder, onEdit, onDelete, onFavorite, favLabel, editLabel, deleteLabel, onSelectMed }: {
  title: string; icon?: string; items: RxTemplate[];
  onApply: (t: RxTemplate) => void; emptyHint?: string; isSearch?: boolean; searchPlaceholder?: string;
  onEdit?: (t: RxTemplate) => void; onDelete?: (t: RxTemplate) => void; onFavorite?: (t: RxTemplate) => void;
  favLabel?: string; editLabel?: string; deleteLabel?: string;
  onSelectMed?: (s: MedSuggestion) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [medRes, setMedRes] = useState<MedSuggestion[]>([]);

  const searchMedGeneric = (query: string) => {
    setQ(query);
    if (!isSearch || query.length < 2) { setMedRes([]); return; }
    fetch(`/api/medicines?q=${encodeURIComponent(query)}&limit=8`)
      .then(r => r.json()).then(setMedRes).catch(() => {});
  };

  return (
    <div>
      <button type="button" onClick={() => setOpen(v => !v)}
         className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground mb-1">
        <span>{icon && `${icon} `}{title}</span>
        {open ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
      </button>
      {open && (
        <div className="space-y-0.5">
          {isSearch && (
            <div className="space-y-0.5">
               <Input className="h-6 text-xs" placeholder={searchPlaceholder ?? "Generic name..."} value={q} onChange={e => searchMedGeneric(e.target.value)} />
              {medRes.map(s => (
                <button key={s.id} type="button"
                  onClick={() => { if (onSelectMed) onSelectMed(s); setMedRes([]); setQ(""); }}
                   className="w-full text-left px-1.5 py-0.5 rounded hover:bg-muted text-xs transition-colors">
                  <div className="font-medium">{s.brandName} {s.strength}</div>
                  <div className="text-muted-foreground">{s.genericName}{s.dosageForm ? ` · ${s.dosageForm}` : ""}</div>
                   {s.manufacturer && <div className="text-muted-foreground text-xs italic">{s.manufacturer}</div>}
                </button>
              ))}
            </div>
          )}
          {!isSearch && items.length === 0 && emptyHint && (
             <p className="text-xs text-muted-foreground italic">{emptyHint}</p>
          )}
          {items.map(t => {
            const isCustom = t.id > 0;
            // Show controls: edit is available for ALL templates (incl. builtins); delete/favorite only for custom.
            const hasControls = !!onEdit || (isCustom && !!(onDelete || onFavorite));
            return (
              <div key={t.id} className="group flex items-center gap-1 rounded border border-transparent hover:border-teal-200 hover:bg-teal-50 dark:hover:bg-teal-950/20 transition-colors">
                <button type="button" onClick={() => onApply(t)}
                   className="flex-1 min-w-0 text-left px-2 py-1.5 text-xs hover:text-teal-700 transition-colors flex items-center gap-1">
                  {t.isFavorite
                    ? <Star className="h-2.5 w-2.5 shrink-0 fill-amber-400 text-amber-400" />
                    : <BookOpen className="h-2.5 w-2.5 shrink-0 opacity-60" />}
                  <span className="truncate">{t.title}</span>
                   {t.department && <span className="ml-auto text-[11px] text-muted-foreground shrink-0">{t.department}</span>}
                </button>
                {hasControls && (
                  <div className="flex items-center gap-0.5 pr-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {onFavorite && isCustom && (
                      <button type="button" title={favLabel} onClick={() => onFavorite(t)} className="p-0.5 hover:text-amber-500">
                        <Star className={cn("h-3 w-3", t.isFavorite && "fill-amber-400 text-amber-400")} />
                      </button>
                    )}
                    {onEdit && (
                      <button type="button" title={editLabel} onClick={() => onEdit(t)} className="p-0.5 hover:text-teal-600">
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {onDelete && isCustom && (
                      <button type="button" title={deleteLabel} onClick={() => onDelete(t)} className="p-0.5 hover:text-red-500">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
