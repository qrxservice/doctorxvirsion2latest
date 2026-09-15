import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export type Lang = "en" | "bn";

const T = {
  en: {
    home: "Home", findDoctor: "Find a Doctor", shop: "Shop",
    trackQueue: "Track Queue", forDoctors: "For Doctors", blog: "Blog", menuLinks: "Menu Links",
    login: "Login", register: "Register", logout: "Logout",
    dashboard: "Dashboard", appointments: "Appointments",
    savedAddresses: "Saved Addresses", wishlist: "Wishlist",
    myDashboard: "My Dashboard", addAddress: "Add Address", editAddress: "Edit Address",
    setAsDefault: "Set as Default", defaultAddress: "Default", deleteAddress: "Delete",
    recipientName: "Recipient Name", altPhone: "Alternate Phone", country: "Country",
    division: "Division/State", district: "District", upazila: "Upazila/City",
    postalCode: "Postal Code", fullAddress: "Full Address", addressLabel: "Label",
    noAddressesYet: "No saved addresses yet", noWishlistYet: "Your wishlist is empty", noOrdersYet: "No orders yet",
    noNotificationsYet: "No notifications yet", markAsRead: "Mark as read",
    totalOrders: "Total Orders", pendingOrders: "Pending Orders", area: "Area",
    profilePicture: "Profile Picture", emergencyContact: "Emergency Contact",
    nationality: "Nationality", preferredLanguage: "Preferred Language",
    addToCart: "Add to Cart", removeFromWishlist: "Remove", useThisAddress: "Use this address",
    orNewAddress: "Or enter a new address",
    myOrdersDesc: "Track and review your past shop orders", savedAddressesDesc: "Manage your saved shipping addresses",
    cancel: "Cancel", downloadPrescription: "Download",
    queue: "Queue", prescriptions: "Prescriptions",
    patients: "Patients", profile: "Profile", settings: "Settings",
    bookAppointment: "Book Appointment", viewDetails: "View Details",
    online: "Online", offline: "Offline", busy: "Busy", vacation: "Vacation",
    onBreak: "On Break", returnIn: "Return in",
    switchLang: "বাংলা",
    // Prescription
    patientInfo: "Patient Information",
    loadFromQueue: "Load from Queue",
    todayAppointments: "Today's Appointments",
    searchPatient: "Search patient...",
    name: "Name", age: "Age", phone: "Phone", gender: "Gender",
    vitals: "Vitals", chiefComplaint: "Chief Complaint",
    examination: "Examination", diagnosis: "Diagnosis",
    medicines: "Medicines", investigations: "Investigations",
    advice: "Advice", followUp: "Follow-up Date",
    notes: "Private Notes", savePrescription: "Save Prescription",
    newPrescription: "New Prescription", printSavePdf: "Print / Save PDF",
    serving: "Now Serving", waiting: "Waiting", next: "Next Patient",
    skip: "Skip", markSeen: "Mark Seen", recall: "Recall",
    queuePanel: "Queue Panel",
    // Subscription
    subFree: "Free (1–5 years BMDC)", sub500: "৳500 (6–10 years)", sub1000: "৳1000 (>10 years)",
    // Auth / account menu
    createAccount: "Create Account", myOrders: "My Orders",
    adminDashboard: "Admin Dashboard", doctorDashboard: "Doctor Dashboard",
    userMenu: "User", logOut: "Log out",
    switchToLight: "Switch to Light Mode", switchToDark: "Switch to Dark Mode",
    // Dashboard chrome
    notifications: "Notifications", markAllRead: "Mark all read",
    noNotifications: "No notifications", loading: "Loading...",
    roleAdmin: "Admin", roleDoctor: "Doctor", roleAssistant: "Assistant", rolePatient: "Patient",
    // Dashboard nav
    liveQueue: "Live Queue", notices: "Notices", availability: "Availability",
    friends: "Friends", messages: "Messages", assistants: "Assistants",
    myProfile: "My Profile", bookings: "Bookings", allDoctors: "All Doctors",
    pendingApprovals: "Pending Approvals", subscriptions: "Subscriptions",
    reviews: "Reviews", emailLogs: "Email Logs", smsLogs: "SMS Logs",
    departments: "Departments", specialties: "Specialties",
    locations: "Locations", banners: "Banners",
    adminHub: "Admin Hub", advertisements: "Advertisements",
    prescriptionRepo: "Prescriptions", auditLogs: "Audit Logs",
    dataMigration: "Data Migration", patientTimeline: "Patient Timeline",
    dataImport: "Data Import",
    queueDevices: "Display Devices",
    allRightsReserved: "All rights reserved.",
    // Login page
    signIn: "Sign In", signInDesc: "Enter your credentials to access your dashboard",
    email: "Email", password: "Password", signingIn: "Signing in...",
    testCredentials: "Test credentials:", notRegistered: "Not registered?",
    registerAsDoctor: "Register as Doctor",
    loginFailed: "Login failed", invalidCredentials: "Invalid email or password.",
    // Register page
    createAnAccount: "Create an Account",
    registerSubtitle: "Join to book appointments and order from our shop",
    signUp: "Sign Up", signUpDesc: "Free account — no subscription needed",
    fullName: "Full Name", fullNamePlaceholder: "Your full name",
    emailAddress: "Email Address", optional: "(optional)",
    min6chars: "Min. 6 characters", creatingAccount: "Creating account...",
    alreadyHaveAccount: "Already have an account?", signInLink: "Sign in",
    areYouDoctor: "Are you a doctor?",
    fillRequired: "Please fill in all required fields",
    passwordMin: "Password must be at least 6 characters",
    accountCreated: "Account created!", welcomeQrx: "Welcome to QRX.",
    registrationFailed: "Registration failed",
    // Password reset & account
    changePassword: "Change Password", currentPassword: "Current Password",
    newPassword: "New Password", confirmPassword: "Confirm New Password",
    passwordsDoNotMatch: "Passwords do not match",
    passwordChanged: "Password changed successfully",
    passwordChangeFailed: "Failed to change password",
    currentPasswordWrong: "Current password is incorrect",
    saving: "Saving...", saved: "Saved",
    forgotPassword: "Forgot password?",
    forgotPasswordDesc: "Enter your email and we'll send you a reset link",
    sendResetLink: "Send Reset Link", sending: "Sending...",
    resetLinkSent: "If an account exists for that email, a reset link has been sent.",
    backToLogin: "Back to login",
    resetPassword: "Reset Password",
    resetPasswordDesc: "Choose a new password for your account",
    passwordResetSuccess: "Password reset — you can now sign in",
    resetLinkInvalid: "This reset link is invalid or has expired",
    accountSettingsDesc: "Manage your account and password",
    accountInfo: "Account Information",
    tvDisplay: "TV Display",
    nextPatientCalled: "Next patient called", noWaitingPatients: "No waiting patients",
    markedSeen: "Marked as seen", patientSkipped: "Patient skipped",
    patientRecalled: "Patient recalled", errorGeneric: "Something went wrong",
    noPatientServing: "No patient is being served right now",
    completedToday: "Completed Today",
    // Queue display
    patientQueueDisplay: "Patient Queue Display",
    connectingToQueue: "Connecting to queue...",
    queueDisplayHint: "Add ?doctorId=1 to the URL to show a specific doctor's queue",
    doctorOnBreak: "Doctor on Break", estimatedReturn: "Estimated return:",
    pleaseWaitReturn: "Please wait — the doctor will return shortly",
    noPatientCurrently: "No patient currently", waitingQueue: "Waiting Queue",
    patientsWaitingSuffix: "patient(s) waiting", noPatientsWaiting: "No patients waiting",
    nextUp: "Next", autoRefresh: "Auto-refreshes every 10 seconds", liveUpdates: "Live updates via WebSocket",
    // Patient portal
    myAppointments: "My Appointments", myPrescriptions: "My Prescriptions",
    myAppointmentsDesc: "View all your booked appointments",
    myPrescriptionsDesc: "View your prescriptions and scan QR codes",
    profileDesc: "Update your personal information and password",
    welcomeBack: "Welcome back",
    totalAppointments: "Total Appointments", totalPrescriptions: "Total Prescriptions",
    upcomingAppointments: "Upcoming Appointments", recentPrescriptions: "Recent Prescriptions",
    pastAppointments: "Past Appointments",
    noUpcomingAppointments: "No upcoming appointments",
    noAppointmentsYet: "No appointments yet", bookFirstAppointment: "Book your first appointment with a doctor",
    noPrescriptions: "No prescriptions yet", noPrescriptionsDesc: "Prescriptions from your doctor visits will appear here",
    addPhonePrompt: "Add your phone number to view appointments & prescriptions",
    addPhoneDesc: "Appointments are linked to your phone number. Add it in your profile to see them here.",
    updateProfile: "Update Profile", saveChanges: "Save Changes",
    quickActions: "Quick Actions", viewAll: "View all",
    dateOfBirth: "Date of Birth", bloodGroup: "Blood Group", address: "Address",
    selectGender: "Select gender", selectBloodGroup: "Select blood group",
    showQr: "Show QR", verify: "Verify", scanToVerify: "Scan to verify this prescription",
    // Nav extras
    trackOrder: "Track Order", emergency: "Emergency", emergencyContacts: "Emergency Contacts",
    paymentGateways: "Payment Gateways", shopManagement: "Shop Management", toolsManagement: "Tools Management",
    // Status / buttons
    unavailable: "Unavailable", trackAppointment: "Track Appointment",
    searching: "Searching...", tracking: "Tracking...",
    // Track Order page
    trackOrderTitle: "Track Your Order",
    trackOrderSubtitle: "Enter your phone number and order number to track your delivery status.",
    orderNumber: "Order Number",
    orderNumberPlaceholder: "Enter your order number (e.g. 12)",
    phonePlaceholder: "Enter your phone number used at checkout",
    trackOrderBtn: "Track Order",
    enterBothFields: "Please enter both phone number and order number.",
    orderNotFound: "Order not found. Please check your phone number and order number.",
    orderTrackFailed: "Unable to track order. Please try again.",
    orderStagePlaced: "Order Placed",
    orderStageProcessing: "Processing",
    orderStageShipped: "Shipped",
    orderStageDelivered: "Delivered",
    orderCancelledMsg: "This order has been cancelled.",
    orderItemsTitle: "Order Items",
    totalAmount: "Total Amount",
    placedOn: "Placed on",
    qty: "Qty",
    // Emergency contacts page
    emergencyDirTitle: "Emergency Contact Directory",
    emergency247Badge: "24/7 Emergency Help",
    emergencyDirDesc: "Find ambulances, oxygen suppliers, blood donors, emergency doctors, and hospital contacts near you — one tap to call.",
    allCategories: "All Categories",
    allCountries: "All Countries",
    allDivisions: "All Divisions",
    allDistricts: "All Districts",
    allUpazilas: "All Upazilas",
    nearestToMe: "Nearest to Me",
    availableNow: "Available Now",
    reportIncorrect: "Report incorrect number",
    reportThanks: "Thanks — we'll review this number.",
    reportFailed: "Failed to submit report",
    clearFilter: "Clear",
    noEmergencyFound: "No emergency contacts found for these filters.",
    nearMeHint: "Showing results sorted by priority and availability near your detected location. Set your division/district above for the most accurate match.",
    searchAreaPlaceholder: "Search area...",
    priority: "Priority",
    adminVerified: "Admin verified",
    driverLabel: "Driver",
    vehicleLabel: "Vehicle",
    // Track Order — status badge labels and misc
    orderPrefix: "Order",
    productFallback: "Product",
    statusPending: "Pending",
    statusConfirmed: "Confirmed",
    statusProcessing: "Processing",
    statusShipped: "Shipped",
    statusDelivered: "Delivered",
    statusCancelled: "Cancelled",
  },
  bn: {
    home: "হোম", findDoctor: "ডাক্তার খুঁজুন", shop: "শপ",
    trackQueue: "কিউ ট্র্যাক", forDoctors: "ডাক্তারদের জন্য", blog: "ব্লগ", menuLinks: "মেনু লিংক",
    login: "লগইন", register: "নিবন্ধন", logout: "লগআউট",
    dashboard: "ড্যাশবোর্ড", appointments: "অ্যাপয়েন্টমেন্ট",
    savedAddresses: "সংরক্ষিত ঠিকানা", wishlist: "উইশলিস্ট",
    myDashboard: "আমার ড্যাশবোর্ড", addAddress: "ঠিকানা যোগ করুন", editAddress: "ঠিকানা সম্পাদনা করুন",
    setAsDefault: "ডিফল্ট হিসেবে সেট করুন", defaultAddress: "ডিফল্ট", deleteAddress: "মুছুন",
    recipientName: "প্রাপকের নাম", altPhone: "বিকল্প ফোন", country: "দেশ",
    division: "বিভাগ", district: "জেলা", upazila: "উপজেলা/শহর",
    postalCode: "পোস্টাল কোড", fullAddress: "সম্পূর্ণ ঠিকানা", addressLabel: "লেবেল",
    noAddressesYet: "কোনো সংরক্ষিত ঠিকানা নেই", noWishlistYet: "আপনার উইশলিস্ট খালি", noOrdersYet: "কোনো অর্ডার নেই",
    noNotificationsYet: "কোনো নোটিফিকেশন নেই", markAsRead: "পঠিত হিসেবে চিহ্নিত করুন",
    totalOrders: "মোট অর্ডার", pendingOrders: "মুলতুবি অর্ডার", area: "এলাকা",
    profilePicture: "প্রোফাইল ছবি", emergencyContact: "জরুরি যোগাযোগ",
    nationality: "জাতীয়তা", preferredLanguage: "পছন্দের ভাষা",
    addToCart: "কার্টে যোগ করুন", removeFromWishlist: "সরান", useThisAddress: "এই ঠিকানা ব্যবহার করুন",
    orNewAddress: "অথবা নতুন ঠিকানা লিখুন",
    myOrdersDesc: "আপনার অতীত অর্ডারগুলো দেখুন", savedAddressesDesc: "আপনার সংরক্ষিত ঠিকানাগুলো পরিচালনা করুন",
    cancel: "বাতিল", downloadPrescription: "ডাউনলোড",
    queue: "কিউ", prescriptions: "প্রেসক্রিপশন",
    patients: "রোগী", profile: "প্রোফাইল", settings: "সেটিংস",
    bookAppointment: "অ্যাপয়েন্টমেন্ট করুন", viewDetails: "বিস্তারিত দেখুন",
    online: "অনলাইন", offline: "অফলাইন", busy: "ব্যস্ত", vacation: "ছুটিতে",
    onBreak: "বিরতিতে", returnIn: "ফিরবেন",
    switchLang: "English",
    // Prescription
    patientInfo: "রোগীর তথ্য",
    loadFromQueue: "কিউ থেকে লোড করুন",
    todayAppointments: "আজকের অ্যাপয়েন্টমেন্ট",
    searchPatient: "রোগী খুঁজুন...",
    name: "নাম", age: "বয়স", phone: "ফোন", gender: "লিঙ্গ",
    vitals: "ভাইটালস", chiefComplaint: "মূল অভিযোগ",
    examination: "পরীক্ষা", diagnosis: "রোগ নির্ণয়",
    medicines: "ওষুধ", investigations: "পরীক্ষা-নিরীক্ষা",
    advice: "পরামর্শ", followUp: "ফলো-আপ তারিখ",
    notes: "প্রাইভেট নোট", savePrescription: "প্রেসক্রিপশন সেভ করুন",
    newPrescription: "নতুন প্রেসক্রিপশন", printSavePdf: "প্রিন্ট / PDF সেভ করুন",
    serving: "এখন দেখা হচ্ছে", waiting: "অপেক্ষারত", next: "পরবর্তী রোগী",
    skip: "বাদ দিন", markSeen: "দেখা হয়েছে", recall: "ডাকুন",
    queuePanel: "কিউ প্যানেল",
    subFree: "বিনামূল্যে (১–৫ বছর)", sub500: "৳৫০০ (৬–১০ বছর)", sub1000: "৳১০০০ (>১০ বছর)",
    // Auth / account menu
    createAccount: "অ্যাকাউন্ট তৈরি করুন", myOrders: "আমার অর্ডার",
    adminDashboard: "অ্যাডমিন ড্যাশবোর্ড", doctorDashboard: "ডাক্তার ড্যাশবোর্ড",
    userMenu: "ব্যবহারকারী", logOut: "লগআউট",
    switchToLight: "লাইট মোডে যান", switchToDark: "ডার্ক মোডে যান",
    // Dashboard chrome
    notifications: "নোটিফিকেশন", markAllRead: "সব পঠিত করুন",
    noNotifications: "কোনো নোটিফিকেশন নেই", loading: "লোড হচ্ছে...",
    roleAdmin: "অ্যাডমিন", roleDoctor: "ডাক্তার", roleAssistant: "সহকারী", rolePatient: "পেশেন্ট",
    // Dashboard nav
    liveQueue: "লাইভ কিউ", notices: "নোটিশ", availability: "সময়সূচী",
    friends: "বন্ধু", messages: "বার্তা", assistants: "সহকারী",
    myProfile: "আমার প্রোফাইল", bookings: "বুকিং", allDoctors: "সকল ডাক্তার",
    pendingApprovals: "অনুমোদন বাকি", subscriptions: "সাবস্ক্রিপশন",
    reviews: "রিভিউ", emailLogs: "ইমেইল লগ", smsLogs: "এসএমএস লগ",
    departments: "বিভাগ", specialties: "বিশেষত্ব",
    locations: "অবস্থান", banners: "ব্যানার",
    adminHub: "অ্যাডমিন হাব", advertisements: "বিজ্ঞাপন",
    prescriptionRepo: "প্রেসক্রিপশন", auditLogs: "অডিট লগ",
    dataMigration: "ডেটা মাইগ্রেশন", patientTimeline: "রোগীর টাইমলাইন",
    dataImport: "ডেটা ইম্পোর্ট",
    queueDevices: "ডিসপ্লে ডিভাইস",
    allRightsReserved: "সর্বস্বত্ব সংরক্ষিত।",
    // Login page
    signIn: "সাইন ইন", signInDesc: "আপনার ড্যাশবোর্ডে প্রবেশ করতে তথ্য দিন",
    email: "ইমেইল", password: "পাসওয়ার্ড", signingIn: "সাইন ইন হচ্ছে...",
    testCredentials: "টেস্ট ক্রেডেনশিয়াল:", notRegistered: "নিবন্ধিত নন?",
    registerAsDoctor: "ডাক্তার হিসেবে নিবন্ধন",
    loginFailed: "লগইন ব্যর্থ", invalidCredentials: "ভুল ইমেইল বা পাসওয়ার্ড।",
    // Register page
    createAnAccount: "একটি অ্যাকাউন্ট তৈরি করুন",
    registerSubtitle: "অ্যাপয়েন্টমেন্ট বুক করতে এবং শপ থেকে অর্ডার করতে যোগ দিন",
    signUp: "সাইন আপ", signUpDesc: "ফ্রি অ্যাকাউন্ট — কোনো সাবস্ক্রিপশন লাগবে না",
    fullName: "পূর্ণ নাম", fullNamePlaceholder: "আপনার পূর্ণ নাম",
    emailAddress: "ইমেইল ঠিকানা", optional: "(ঐচ্ছিক)",
    min6chars: "সর্বনিম্ন ৬ অক্ষর", creatingAccount: "অ্যাকাউন্ট তৈরি হচ্ছে...",
    alreadyHaveAccount: "ইতিমধ্যে অ্যাকাউন্ট আছে?", signInLink: "সাইন ইন",
    areYouDoctor: "আপনি কি ডাক্তার?",
    fillRequired: "অনুগ্রহ করে সব প্রয়োজনীয় তথ্য পূরণ করুন",
    passwordMin: "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে",
    changePassword: "পাসওয়ার্ড পরিবর্তন", currentPassword: "বর্তমান পাসওয়ার্ড",
    newPassword: "নতুন পাসওয়ার্ড", confirmPassword: "নতুন পাসওয়ার্ড নিশ্চিত করুন",
    passwordsDoNotMatch: "পাসওয়ার্ড মিলছে না",
    passwordChanged: "পাসওয়ার্ড সফলভাবে পরিবর্তিত হয়েছে",
    passwordChangeFailed: "পাসওয়ার্ড পরিবর্তন ব্যর্থ হয়েছে",
    currentPasswordWrong: "বর্তমান পাসওয়ার্ড ভুল",
    saving: "সংরক্ষণ হচ্ছে...", saved: "সংরক্ষিত",
    forgotPassword: "পাসওয়ার্ড ভুলে গেছেন?",
    forgotPasswordDesc: "আপনার ইমেইল দিন, আমরা একটি রিসেট লিঙ্ক পাঠাব",
    sendResetLink: "রিসেট লিঙ্ক পাঠান", sending: "পাঠানো হচ্ছে...",
    resetLinkSent: "যদি এই ইমেইলে অ্যাকাউন্ট থাকে, একটি রিসেট লিঙ্ক পাঠানো হয়েছে।",
    backToLogin: "লগইনে ফিরে যান",
    resetPassword: "পাসওয়ার্ড রিসেট",
    resetPasswordDesc: "আপনার অ্যাকাউন্টের জন্য নতুন পাসওয়ার্ড নির্বাচন করুন",
    passwordResetSuccess: "পাসওয়ার্ড রিসেট হয়েছে — এখন সাইন ইন করতে পারেন",
    resetLinkInvalid: "এই রিসেট লিঙ্কটি অবৈধ বা মেয়াদোত্তীর্ণ",
    accountSettingsDesc: "আপনার অ্যাকাউন্ট এবং পাসওয়ার্ড পরিচালনা করুন",
    accountInfo: "অ্যাকাউন্ট তথ্য",
    tvDisplay: "টিভি ডিসপ্লে",
    nextPatientCalled: "পরবর্তী রোগী ডাকা হয়েছে", noWaitingPatients: "অপেক্ষমাণ রোগী নেই",
    markedSeen: "দেখা হয়েছে চিহ্নিত", patientSkipped: "রোগী বাদ দেওয়া হয়েছে",
    patientRecalled: "রোগী পুনরায় ডাকা হয়েছে", errorGeneric: "কিছু একটা ভুল হয়েছে",
    noPatientServing: "এই মুহূর্তে কোনো রোগী দেখা হচ্ছে না",
    completedToday: "আজ সম্পন্ন",
    accountCreated: "অ্যাকাউন্ট তৈরি হয়েছে!", welcomeQrx: "QRX-এ স্বাগতম।",
    registrationFailed: "নিবন্ধন ব্যর্থ",
    // Queue display
    patientQueueDisplay: "রোগীর সিরিয়াল প্রদর্শন",
    connectingToQueue: "কিউতে সংযোগ হচ্ছে...",
    queueDisplayHint: "নির্দিষ্ট ডাক্তারের কিউ দেখাতে URL-এ ?doctorId=1 যোগ করুন",
    doctorOnBreak: "ডাক্তার বিরতিতে", estimatedReturn: "ফিরে আসার সম্ভাব্য সময়:",
    pleaseWaitReturn: "অনুগ্রহ করে অপেক্ষা করুন — ডাক্তার শীঘ্রই ফিরবেন",
    noPatientCurrently: "এখন কোনো রোগী নেই", waitingQueue: "অপেক্ষমাণ কিউ",
    patientsWaitingSuffix: "জন অপেক্ষমাণ", noPatientsWaiting: "কোনো রোগী অপেক্ষমাণ নেই",
    nextUp: "পরবর্তী", autoRefresh: "প্রতি ১০ সেকেন্ডে স্বয়ংক্রিয় রিফ্রেশ", liveUpdates: "ওয়েবসকেটের মাধ্যমে লাইভ আপডেট",
    // Patient portal
    myAppointments: "আমার অ্যাপয়েন্টমেন্ট", myPrescriptions: "আমার প্রেসক্রিপশন",
    myAppointmentsDesc: "আপনার সকল অ্যাপয়েন্টমেন্ট দেখুন",
    myPrescriptionsDesc: "প্রেসক্রিপশন দেখুন এবং QR কোড স্ক্যান করুন",
    profileDesc: "ব্যক্তিগত তথ্য ও পাসওয়ার্ড আপডেট করুন",
    welcomeBack: "স্বাগতম",
    totalAppointments: "মোট অ্যাপয়েন্টমেন্ট", totalPrescriptions: "মোট প্রেসক্রিপশন",
    upcomingAppointments: "আসন্ন অ্যাপয়েন্টমেন্ট", recentPrescriptions: "সাম্প্রতিক প্রেসক্রিপশন",
    pastAppointments: "পূর্ববর্তী অ্যাপয়েন্টমেন্ট",
    noUpcomingAppointments: "কোনো আসন্ন অ্যাপয়েন্টমেন্ট নেই",
    noAppointmentsYet: "এখনো কোনো অ্যাপয়েন্টমেন্ট নেই", bookFirstAppointment: "একজন ডাক্তারের সাথে প্রথম অ্যাপয়েন্টমেন্ট করুন",
    noPrescriptions: "এখনো কোনো প্রেসক্রিপশন নেই", noPrescriptionsDesc: "ডাক্তারের দেওয়া প্রেসক্রিপশন এখানে দেখাবে",
    addPhonePrompt: "অ্যাপয়েন্টমেন্ট ও প্রেসক্রিপশন দেখতে ফোন নম্বর যোগ করুন",
    addPhoneDesc: "অ্যাপয়েন্টমেন্ট ফোন নম্বর দিয়ে যুক্ত থাকে। প্রোফাইলে যোগ করুন।",
    updateProfile: "প্রোফাইল আপডেট করুন", saveChanges: "পরিবর্তন সংরক্ষণ করুন",
    quickActions: "দ্রুত কাজ", viewAll: "সব দেখুন",
    dateOfBirth: "জন্ম তারিখ", bloodGroup: "রক্তের গ্রুপ", address: "ঠিকানা",
    selectGender: "লিঙ্গ নির্বাচন করুন", selectBloodGroup: "রক্তের গ্রুপ নির্বাচন করুন",
    showQr: "QR দেখুন", verify: "যাচাই করুন", scanToVerify: "প্রেসক্রিপশন যাচাই করতে স্ক্যান করুন",
    // Nav extras
    trackOrder: "অর্ডার ট্র্যাক", emergency: "জরুরি", emergencyContacts: "জরুরি যোগাযোগ",
    paymentGateways: "পেমেন্ট গেটওয়ে", shopManagement: "শপ ম্যানেজমেন্ট", toolsManagement: "টুলস ম্যানেজমেন্ট",
    // Status / buttons
    unavailable: "অনুপলব্ধ", trackAppointment: "অ্যাপয়েন্টমেন্ট ট্র্যাক",
    searching: "খোঁজা হচ্ছে...", tracking: "ট্র্যাক হচ্ছে...",
    // Track Order page
    trackOrderTitle: "আপনার অর্ডার ট্র্যাক করুন",
    trackOrderSubtitle: "ডেলিভারির অবস্থা জানতে ফোন নম্বর ও অর্ডার নম্বর দিন।",
    orderNumber: "অর্ডার নম্বর",
    orderNumberPlaceholder: "আপনার অর্ডার নম্বর দিন (যেমন ১২)",
    phonePlaceholder: "চেকআউটে ব্যবহৃত ফোন নম্বর দিন",
    trackOrderBtn: "অর্ডার ট্র্যাক করুন",
    enterBothFields: "অনুগ্রহ করে ফোন নম্বর ও অর্ডার নম্বর উভয়ই দিন।",
    orderNotFound: "অর্ডার পাওয়া যায়নি। ফোন নম্বর ও অর্ডার নম্বর যাচাই করুন।",
    orderTrackFailed: "অর্ডার ট্র্যাক করা যাচ্ছে না। আবার চেষ্টা করুন।",
    orderStagePlaced: "অর্ডার দেওয়া হয়েছে",
    orderStageProcessing: "প্রক্রিয়াধীন",
    orderStageShipped: "পাঠানো হয়েছে",
    orderStageDelivered: "ডেলিভারি হয়েছে",
    orderCancelledMsg: "এই অর্ডারটি বাতিল করা হয়েছে।",
    orderItemsTitle: "অর্ডারের পণ্য",
    totalAmount: "মোট পরিমাণ",
    placedOn: "তৈরি হয়েছে",
    qty: "পরিমাণ",
    // Emergency contacts page
    emergencyDirTitle: "জরুরি যোগাযোগ ডিরেক্টরি",
    emergency247Badge: "২৪/৭ জরুরি সহায়তা",
    emergencyDirDesc: "কাছের অ্যাম্বুলেন্স, অক্সিজেন সরবরাহকারী, রক্তদাতা, জরুরি ডাক্তার ও হাসপাতাল খুঁজুন — এক ট্যাপে কল করুন।",
    allCategories: "সব ক্যাটাগরি",
    allCountries: "সব দেশ",
    allDivisions: "সব বিভাগ",
    allDistricts: "সব জেলা",
    allUpazilas: "সব উপজেলা",
    nearestToMe: "আমার কাছের",
    availableNow: "এখন পাওয়া যাচ্ছে",
    reportIncorrect: "ভুল নম্বর রিপোর্ট করুন",
    reportThanks: "ধন্যবাদ — আমরা এই নম্বরটি যাচাই করব।",
    reportFailed: "রিপোর্ট জমা দিতে ব্যর্থ",
    clearFilter: "পরিষ্কার",
    noEmergencyFound: "এই ফিল্টারে কোনো জরুরি যোগাযোগ পাওয়া যায়নি।",
    nearMeHint: "আপনার অবস্থানের কাছের ফলাফল দেখানো হচ্ছে। সঠিক ফলাফলের জন্য উপরে বিভাগ/জেলা নির্বাচন করুন।",
    searchAreaPlaceholder: "এলাকা খুঁজুন...",
    priority: "অগ্রাধিকার",
    adminVerified: "অ্যাডমিন যাচাইকৃত",
    driverLabel: "চালক",
    vehicleLabel: "যানবাহন",
    // Track Order — status badge labels and misc
    orderPrefix: "অর্ডার",
    productFallback: "পণ্য",
    statusPending: "মুলতুবি",
    statusConfirmed: "নিশ্চিত",
    statusProcessing: "প্রক্রিয়াধীন",
    statusShipped: "পাঠানো হয়েছে",
    statusDelivered: "ডেলিভারি হয়েছে",
    statusCancelled: "বাতিল",
  }
} as const;

type TKey = keyof typeof T.en;

interface LangContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
  isBn: boolean;
}

const LanguageContext = createContext<LangContextValue>({
  lang: "en", setLang: () => {}, t: (k) => k, isBn: false,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem("rxm_lang");
      if (saved === "bn" || saved === "en") return saved;
    } catch {}
    return "en";
  });

  // Sync lang to <html lang="..."> so CSS :lang(bn) and html[lang="bn"] rules fire.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // IP-based default: Bangladesh IP → Bangla, international → English.
  // Only applies when the user has not explicitly chosen a language yet.
  useEffect(() => {
    try {
      if (localStorage.getItem("rxm_lang")) return;
    } catch {}
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}api/locations/detect`)
      .then((r) => r.json())
      .then((d: { country?: string; detected?: boolean }) => {
        if (cancelled) return;
        try {
          if (localStorage.getItem("rxm_lang")) return;
        } catch {}
        // Only treat as Bangladesh when the backend positively detected the IP
        // (detected: true). The backend returns { country: "BD", detected: false }
        // as its uncertain fallback — do not treat that as a confirmed BD visit.
        // Per spec: if country detection fails → English default.
        const confirmed = d?.detected === true;
        const detectedLang = confirmed && d?.country === "BD" ? "bn" : "en";
        setLangState(detectedLang);
        // Only persist a positively detected result so that a returning visitor
        // whose first load was uncertain gets a fresh detection next time.
        if (confirmed) {
          try {
            localStorage.setItem("rxm_lang", detectedLang);
          } catch {}
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Total network failure: use English as the safe fallback per spec.
        // Do NOT persist so the next load retries detection.
        try {
          if (localStorage.getItem("rxm_lang")) return;
        } catch {}
        setLangState("en");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    document.documentElement.lang = l;
    try { localStorage.setItem("rxm_lang", l); } catch {}
  };

  const t = (key: TKey): string => T[lang][key] ?? T.en[key] ?? key;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t, isBn: lang === "bn" }}>
      {children}
    </LanguageContext.Provider>
  );
}

export const useLanguage = () => useContext(LanguageContext);
export { T };
