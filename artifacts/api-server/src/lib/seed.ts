import { db, usersTable, doctorsTable, departmentsTable, menuItemsTable, countriesTable, citiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { hashPassword } from "./password";

const DEFAULT_DEPARTMENTS = [
  { name: "General Medicine",       icon: "💊", description: "Primary care and internal medicine" },
  { name: "Surgery",                icon: "✂️", description: "General and specialist surgical procedures" },
  { name: "Cardiology",             icon: "🫀", description: "Heart and cardiovascular system" },
  { name: "Orthopedics",            icon: "🦴", description: "Bones, joints, and musculoskeletal system" },
  { name: "Gynecology & Obstetrics",icon: "🤰", description: "Women's reproductive health and pregnancy" },
  { name: "Pediatrics",             icon: "👶", description: "Medical care for infants, children and adolescents" },
  { name: "Neurology",              icon: "🧠", description: "Brain, spinal cord and nervous system" },
  { name: "Dermatology",            icon: "🧴", description: "Skin, hair and nail conditions" },
  { name: "Ophthalmology",          icon: "👁️", description: "Eye care and vision disorders" },
  { name: "ENT",                    icon: "👂", description: "Ear, nose and throat diseases" },
  { name: "Psychiatry",             icon: "🧩", description: "Mental health and behavioral disorders" },
  { name: "Urology",                icon: "💧", description: "Urinary tract and male reproductive system" },
  { name: "Endocrinology",          icon: "🧬", description: "Hormonal and metabolic disorders" },
  { name: "Gastroenterology",       icon: "🫃", description: "Digestive system and gastrointestinal tract" },
  { name: "Pulmonology",            icon: "🫁", description: "Lungs and respiratory system" },
  { name: "Nephrology",             icon: "🩻", description: "Kidney diseases and renal care" },
  { name: "Oncology",               icon: "🎗️", description: "Cancer diagnosis and treatment" },
  { name: "Rheumatology",           icon: "💪", description: "Arthritis and autoimmune diseases" },
  { name: "Dentistry",              icon: "🦷", description: "Oral health, teeth and gums" },
  { name: "Radiology",              icon: "🩻", description: "Medical imaging and diagnostics" },
  { name: "Anesthesiology",         icon: "💉", description: "Anesthesia and pain management" },
  { name: "Emergency Medicine",     icon: "🚑", description: "Acute and emergency care" },
  { name: "Hematology",             icon: "🩸", description: "Blood disorders and diseases" },
  { name: "Physiotherapy",          icon: "🏃", description: "Physical rehabilitation and therapy" },
  { name: "Hepatology",             icon: "🫀", description: "Liver, gallbladder and pancreas" },
];

// Priority countries with flag emoji, ISO code, and dial code.
// The "complete list" requested: 18 priority countries + ~50 more common ones.
const DEFAULT_COUNTRIES = [
  // Priority list
  { name: "Bangladesh",      code: "BD", dialCode: "+880", flag: "🇧🇩" },
  { name: "India",           code: "IN", dialCode: "+91",  flag: "🇮🇳" },
  { name: "United States",   code: "US", dialCode: "+1",   flag: "🇺🇸" },
  { name: "United Kingdom",  code: "GB", dialCode: "+44",  flag: "🇬🇧" },
  { name: "Canada",          code: "CA", dialCode: "+1",   flag: "🇨🇦" },
  { name: "Australia",       code: "AU", dialCode: "+61",  flag: "🇦🇺" },
  { name: "Germany",         code: "DE", dialCode: "+49",  flag: "🇩🇪" },
  { name: "France",          code: "FR", dialCode: "+33",  flag: "🇫🇷" },
  { name: "Italy",           code: "IT", dialCode: "+39",  flag: "🇮🇹" },
  { name: "Japan",           code: "JP", dialCode: "+81",  flag: "🇯🇵" },
  { name: "Singapore",       code: "SG", dialCode: "+65",  flag: "🇸🇬" },
  { name: "Malaysia",        code: "MY", dialCode: "+60",  flag: "🇲🇾" },
  { name: "UAE",             code: "AE", dialCode: "+971", flag: "🇦🇪" },
  { name: "Saudi Arabia",    code: "SA", dialCode: "+966", flag: "🇸🇦" },
  { name: "Qatar",           code: "QA", dialCode: "+974", flag: "🇶🇦" },
  { name: "Kuwait",          code: "KW", dialCode: "+965", flag: "🇰🇼" },
  { name: "Oman",            code: "OM", dialCode: "+968", flag: "🇴🇲" },
  { name: "New Zealand",     code: "NZ", dialCode: "+64",  flag: "🇳🇿" },
  // Extended list
  { name: "Pakistan",        code: "PK", dialCode: "+92",  flag: "🇵🇰" },
  { name: "Sri Lanka",       code: "LK", dialCode: "+94",  flag: "🇱🇰" },
  { name: "Nepal",           code: "NP", dialCode: "+977", flag: "🇳🇵" },
  { name: "Maldives",        code: "MV", dialCode: "+960", flag: "🇲🇻" },
  { name: "Myanmar",         code: "MM", dialCode: "+95",  flag: "🇲🇲" },
  { name: "Thailand",        code: "TH", dialCode: "+66",  flag: "🇹🇭" },
  { name: "Indonesia",       code: "ID", dialCode: "+62",  flag: "🇮🇩" },
  { name: "Philippines",     code: "PH", dialCode: "+63",  flag: "🇵🇭" },
  { name: "Vietnam",         code: "VN", dialCode: "+84",  flag: "🇻🇳" },
  { name: "China",           code: "CN", dialCode: "+86",  flag: "🇨🇳" },
  { name: "South Korea",     code: "KR", dialCode: "+82",  flag: "🇰🇷" },
  { name: "Hong Kong",       code: "HK", dialCode: "+852", flag: "🇭🇰" },
  { name: "Taiwan",          code: "TW", dialCode: "+886", flag: "🇹🇼" },
  { name: "Bahrain",         code: "BH", dialCode: "+973", flag: "🇧🇭" },
  { name: "Jordan",          code: "JO", dialCode: "+962", flag: "🇯🇴" },
  { name: "Turkey",          code: "TR", dialCode: "+90",  flag: "🇹🇷" },
  { name: "Egypt",           code: "EG", dialCode: "+20",  flag: "🇪🇬" },
  { name: "Nigeria",         code: "NG", dialCode: "+234", flag: "🇳🇬" },
  { name: "South Africa",    code: "ZA", dialCode: "+27",  flag: "🇿🇦" },
  { name: "Kenya",           code: "KE", dialCode: "+254", flag: "🇰🇪" },
  { name: "Ethiopia",        code: "ET", dialCode: "+251", flag: "🇪🇹" },
  { name: "Ghana",           code: "GH", dialCode: "+233", flag: "🇬🇭" },
  { name: "Spain",           code: "ES", dialCode: "+34",  flag: "🇪🇸" },
  { name: "Netherlands",     code: "NL", dialCode: "+31",  flag: "🇳🇱" },
  { name: "Sweden",          code: "SE", dialCode: "+46",  flag: "🇸🇪" },
  { name: "Norway",          code: "NO", dialCode: "+47",  flag: "🇳🇴" },
  { name: "Denmark",         code: "DK", dialCode: "+45",  flag: "🇩🇰" },
  { name: "Switzerland",     code: "CH", dialCode: "+41",  flag: "🇨🇭" },
  { name: "Ireland",         code: "IE", dialCode: "+353", flag: "🇮🇪" },
  { name: "Portugal",        code: "PT", dialCode: "+351", flag: "🇵🇹" },
  { name: "Greece",          code: "GR", dialCode: "+30",  flag: "🇬🇷" },
  { name: "Poland",          code: "PL", dialCode: "+48",  flag: "🇵🇱" },
  { name: "Russia",          code: "RU", dialCode: "+7",   flag: "🇷🇺" },
  { name: "Brazil",          code: "BR", dialCode: "+55",  flag: "🇧🇷" },
  { name: "Argentina",       code: "AR", dialCode: "+54",  flag: "🇦🇷" },
  { name: "Mexico",          code: "MX", dialCode: "+52",  flag: "🇲🇽" },
  { name: "Colombia",        code: "CO", dialCode: "+57",  flag: "🇨🇴" },
];

// Cities per country (code → city names)
const DEFAULT_CITIES: Record<string, string[]> = {
  BD: ["Dhaka", "Chittagong", "Sylhet", "Rajshahi", "Khulna", "Barisal", "Rangpur", "Mymensingh", "Comilla", "Narayanganj", "Gazipur"],
  IN: ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bangalore", "Hyderabad", "Ahmedabad", "Pune", "Jaipur", "Lucknow", "Surat"],
  US: ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "San Jose"],
  GB: ["London", "Birmingham", "Manchester", "Leeds", "Glasgow", "Sheffield", "Bradford", "Liverpool", "Edinburgh", "Bristol"],
  CA: ["Toronto", "Montreal", "Vancouver", "Calgary", "Edmonton", "Ottawa", "Winnipeg", "Quebec City", "Hamilton"],
  AU: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra", "Hobart"],
  DE: ["Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart", "Düsseldorf", "Leipzig"],
  FR: ["Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg", "Bordeaux"],
  AE: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah", "Fujairah"],
  SA: ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam", "Khobar", "Tabuk"],
  SG: ["Singapore"],
  MY: ["Kuala Lumpur", "George Town", "Johor Bahru", "Ipoh", "Kota Kinabalu", "Kuching"],
  PK: ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Peshawar"],
  LK: ["Colombo", "Kandy", "Galle", "Jaffna", "Negombo"],
  QA: ["Doha", "Al Rayyan", "Al Wakrah", "Al Khor"],
  KW: ["Kuwait City", "Hawalli", "Salmiya", "Farwaniya"],
  OM: ["Muscat", "Salalah", "Sohar", "Nizwa"],
  JP: ["Tokyo", "Osaka", "Yokohama", "Nagoya", "Sapporo", "Kobe", "Kyoto"],
  NZ: ["Auckland", "Wellington", "Christchurch", "Hamilton", "Tauranga"],
};

// Default header menu items seeded when the table is empty.
// These replace the previously hardcoded items in PublicLayout.
const DEFAULT_HEADER_ITEMS = [
  { label: "Home",          titleBn: "হোম",              url: "/",               location: "header", menuType: "internal",  visibility: "public",     displayOrder: 10 },
  { label: "Find a Doctor", titleBn: "ডাক্তার খুঁজুন",   url: "/doctors",        location: "header", menuType: "internal",  visibility: "public",     displayOrder: 20 },
  { label: "Shop",          titleBn: "শপ",               url: "/shop",           location: "header", menuType: "internal",  visibility: "public",     displayOrder: 30 },
  { label: "Track Queue",   titleBn: "কিউ ট্র্যাক",      url: "/track",          location: "header", menuType: "internal",  visibility: "public",     displayOrder: 40 },
  { label: "Track Order",   titleBn: "অর্ডার ট্র্যাক",  url: "/track-order",    location: "header", menuType: "internal",  visibility: "public",     displayOrder: 50 },
  { label: "Blood Donors",  titleBn: "রক্তদাতা",         url: "/blood-donors",   location: "header", menuType: "internal",  visibility: "public",     displayOrder: 60 },
  { label: "Ambulance",     titleBn: "অ্যাম্বুলেন্স",   url: "/ambulance",      location: "header", menuType: "internal",  visibility: "public",     displayOrder: 70 },
  { label: "Emergency",     titleBn: "জরুরি",            url: "/emergency",      location: "header", menuType: "internal",  visibility: "public",     displayOrder: 80 },
  { label: "Blog",          titleBn: "ব্লগ",             url: "/blog",           location: "header", menuType: "blog",      visibility: "public",     displayOrder: 90 },
  { label: "For Doctors",   titleBn: "ডাক্তারদের জন্য", url: "/doctor-register",location: "header", menuType: "internal",  visibility: "public",     displayOrder: 100 },
] as const;

// Default footer menu items grouped by footer_group.
const DEFAULT_FOOTER_ITEMS = [
  // Quick Links
  { label: "Find a Doctor",   titleBn: "ডাক্তার খুঁজুন",   url: "/doctors",        location: "footer", footerGroup: "quick-links", menuType: "internal", visibility: "public", displayOrder: 10 },
  { label: "Track Queue",     titleBn: "কিউ ট্র্যাক",      url: "/track",          location: "footer", footerGroup: "quick-links", menuType: "internal", visibility: "public", displayOrder: 20 },
  { label: "Track Order",     titleBn: "অর্ডার ট্র্যাক",  url: "/track-order",    location: "footer", footerGroup: "quick-links", menuType: "internal", visibility: "public", displayOrder: 30 },
  { label: "Shop",            titleBn: "শপ",               url: "/shop",           location: "footer", footerGroup: "quick-links", menuType: "internal", visibility: "public", displayOrder: 40 },
  // Services
  { label: "For Doctors",     titleBn: "ডাক্তারদের জন্য", url: "/doctor-register",location: "footer", footerGroup: "services",    menuType: "internal", visibility: "public", displayOrder: 10 },
  { label: "Ambulance Driver",titleBn: "অ্যাম্বুলেন্স ড্রাইভার", url: "/driver",  location: "footer", footerGroup: "services",    menuType: "internal", visibility: "public", displayOrder: 20 },
  { label: "Blood Donors",    titleBn: "রক্তদাতা",         url: "/blood-donors",   location: "footer", footerGroup: "services",    menuType: "internal", visibility: "public", displayOrder: 30 },
  { label: "Ambulance",       titleBn: "অ্যাম্বুলেন্স",   url: "/ambulance",      location: "footer", footerGroup: "services",    menuType: "internal", visibility: "public", displayOrder: 40 },
  // Resources
  { label: "Blog",            titleBn: "ব্লগ",             url: "/blog",           location: "footer", footerGroup: "resources",   menuType: "blog",     visibility: "public", displayOrder: 10 },
  { label: "Emergency",       titleBn: "জরুরি",            url: "/emergency",      location: "footer", footerGroup: "resources",   menuType: "internal", visibility: "public", displayOrder: 20 },
] as const;

export async function seedDepartments() {
  try {
    const existing = await db.select({ id: departmentsTable.id, name: departmentsTable.name, icon: departmentsTable.icon })
      .from(departmentsTable);
    const byName = Object.fromEntries(existing.map(d => [d.name, d]));

    for (const dept of DEFAULT_DEPARTMENTS) {
      const found = byName[dept.name];
      if (!found) {
        await db.insert(departmentsTable).values(dept);
        logger.info(`Seeded department: ${dept.name}`);
      } else if (found.icon !== dept.icon) {
        // Update icon whether missing or outdated
        await db.update(departmentsTable).set({ icon: dept.icon }).where(eq(departmentsTable.id, found.id));
        logger.info(`Updated icon for department: ${dept.name} → ${dept.icon}`);
      }
    }
  } catch (err) {
    logger.warn({ err }, "seed: could not seed departments (non-fatal)");
  }
}

export async function seedCountries() {
  try {
    const existing = await db.select({ id: countriesTable.id, code: countriesTable.code }).from(countriesTable);
    if (existing.length > 0) {
      // Already seeded — skip to avoid duplicates
      return;
    }

    for (const country of DEFAULT_COUNTRIES) {
      const [inserted] = await db.insert(countriesTable).values(country).returning();
      const citiesForCountry = DEFAULT_CITIES[country.code] ?? [];
      for (const cityName of citiesForCountry) {
        await db.insert(citiesTable).values({ name: cityName, countryId: inserted.id });
      }
    }
    logger.info(`Seeded ${DEFAULT_COUNTRIES.length} countries with cities`);
  } catch (err) {
    logger.warn({ err }, "seed: could not seed countries (non-fatal)");
  }
}

export async function seedMenuItems() {
  try {
    const existing = await db.select({ id: menuItemsTable.id }).from(menuItemsTable);
    if (existing.length > 0) return; // Already seeded

    const allItems = [
      ...DEFAULT_HEADER_ITEMS.map(i => ({ ...i, openInNewTab: false, isNoFollow: false, isActive: true })),
      ...DEFAULT_FOOTER_ITEMS.map(i => ({ ...i, openInNewTab: false, isNoFollow: false, isActive: true })),
    ];

    for (const item of allItems) {
      await db.insert(menuItemsTable).values(item);
    }
    logger.info(`Seeded ${allItems.length} default menu items`);
  } catch (err) {
    logger.warn({ err }, "seed: could not seed menu items (non-fatal)");
  }
}

export async function seedDefaultUsers() {
  await seedDepartments();
  await seedMenuItems();
  await seedCountries();
  try {
    // 1. Seed admin
    const [existingAdmin] = await db.select().from(usersTable).where(eq(usersTable.email, "admin@doctorx.com.bd"));
    if (!existingAdmin) {
      await db.insert(usersTable).values({ email: "admin@doctorx.com.bd", password: await hashPassword("admin123"), name: "Admin", role: "admin" });
      logger.info("Seeded default admin user");
    }

    // 2. Seed doctor user + doctors table entry (linked)
    let [doctorUser] = await db.select().from(usersTable).where(eq(usersTable.email, "amir@example.com"));
    if (!doctorUser) {
      [doctorUser] = await db.insert(usersTable).values({
        email: "amir@example.com", password: await hashPassword("doctor123"), name: "Dr. Amir Hossain", role: "doctor",
      }).returning();
      logger.info("Seeded default doctor user");
    }

    // Ensure doctor has a doctors table entry and doctorId is linked
    if (doctorUser) {
      let [doctorProfile] = doctorUser.doctorId
        ? await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorUser.doctorId))
        : [];

      if (!doctorProfile) {
        [doctorProfile] = await db.insert(doctorsTable).values({
          name: "Dr. Amir Hossain",
          email: "amir@example.com",
          phone: "01700000000",
          degree: "MBBS, FCPS",
          chamberAddress: "DoctorX Medical Center, Dhaka",
          visitingTime: "Sat-Thu: 10am-2pm",
          consultationFee: 500,
          bmdcNumber: "A-12345",
          bmdcValidityYears: 3,
          approvalStatus: "approved",
          userId: doctorUser.id,
          isVerified: true,
        }).returning();
        logger.info("Seeded default doctor profile");
      }

      if (doctorProfile && doctorUser.doctorId !== doctorProfile.id) {
        await db.update(usersTable)
          .set({ doctorId: doctorProfile.id })
          .where(eq(usersTable.id, doctorUser.id));
        logger.info(`Linked doctor user ${doctorUser.email} → doctors.id=${doctorProfile.id}`);
      }
    }

    // 3. Seed patient
    const [existingPatient] = await db.select().from(usersTable).where(eq(usersTable.email, "patient@example.com"));
    if (!existingPatient) {
      await db.insert(usersTable).values({ email: "patient@example.com", password: await hashPassword("patient123"), name: "Test Patient", role: "patient" });
      logger.info("Seeded default patient user");
    }

  } catch (err) {
    logger.warn({ err }, "seed: could not seed default users (non-fatal)");
  }
}
