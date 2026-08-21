import sqlite3
import os
import math
from datetime import datetime, date

DB_PATH = os.path.join(os.path.dirname(__file__), 'health_records.db')

def get_db_connection():
    """Returns a connection to the SQLite database with row factory enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def calculate_bmi(weight_kg, height_cm):
    """Calculates BMI given weight in kg and height in cm."""
    try:
        if weight_kg and height_cm and float(height_cm) > 0:
            height_m = float(height_cm) / 100.0
            return round(float(weight_kg) / (height_m * height_m), 1)
    except (ValueError, TypeError, ZeroDivisionError):
        pass
    return None

def calculate_bp_category(systolic, diastolic):
    """Returns classification and color token for blood pressure."""
    try:
        if systolic is None or diastolic is None or systolic == "" or diastolic == "":
            return {"category": "Unknown", "badge": "bg-slate-400 text-white", "level": "neutral"}
        sys = int(systolic)
        dia = int(diastolic)
        if sys > 180 or dia > 120:
            return {"category": "Hypertensive Crisis", "category_hi": "अति उच्च रक्तचाप संकट", "badge": "bg-red-600 text-white", "level": "danger"}
        elif sys >= 140 or dia >= 90:
            return {"category": "Hypertension Stage 2", "category_hi": "उच्च रक्तचाप चरण २", "badge": "bg-red-500 text-white", "level": "danger"}
        elif (130 <= sys <= 139) or (80 <= dia <= 89):
            return {"category": "Hypertension Stage 1", "category_hi": "उच्च रक्तचाप चरण १", "badge": "bg-amber-500 text-white", "level": "warning"}
        elif (120 <= sys <= 129) and dia < 80:
            return {"category": "Elevated", "category_hi": "सामान्य से अधिक", "badge": "bg-yellow-500 text-slate-900", "level": "caution"}
        elif sys < 120 and dia < 80:
            return {"category": "Normal", "category_hi": "सामान्य", "badge": "bg-emerald-500 text-white", "level": "success"}
        elif sys < 90 or dia < 60:
            return {"category": "Low Blood Pressure", "category_hi": "निम्न रक्तचाप", "badge": "bg-sky-500 text-white", "level": "info"}
    except (ValueError, TypeError):
        pass
    return {"category": "Unknown", "category_hi": "अज्ञात", "badge": "bg-slate-400 text-white", "level": "neutral"}

def calculate_bmi_category(bmi):
    """Returns BMI classification category and color."""
    if bmi is None:
        return {"category": "Unknown", "category_hi": "अज्ञात", "badge": "bg-slate-400 text-white"}
    if bmi < 18.5:
        return {"category": "Underweight", "category_hi": "कम वजन", "badge": "bg-sky-500 text-white"}
    elif 18.5 <= bmi < 25.0:
        return {"category": "Normal weight", "category_hi": "सामान्य वजन", "badge": "bg-emerald-500 text-white"}
    elif 25.0 <= bmi < 30.0:
        return {"category": "Overweight", "category_hi": "अधिक वजन", "badge": "bg-amber-500 text-white"}
    else:
        return {"category": "Obesity", "category_hi": "मोटापा", "badge": "bg-red-500 text-white"}

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in kilometers between two coordinates."""
    R = 6371.0  # Earth radius in kilometers
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = math.sin(dLat / 2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 1)

def init_db():
    """Initializes SQLite tables and creates indexes."""
    conn = get_db_connection()
    cursor = conn.cursor()

    # Profiles table with National Health ID (ABHA) support
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        abha_number TEXT UNIQUE,
        abha_address TEXT UNIQUE,
        aadhaar_last_four TEXT,
        ration_card_pmjay_id TEXT,
        full_name TEXT NOT NULL,
        date_of_birth TEXT NOT NULL,
        gender TEXT NOT NULL,
        blood_group TEXT,
        phone TEXT,
        email TEXT,
        village_town TEXT,
        district TEXT,
        state TEXT,
        pincode TEXT,
        rural_urban TEXT DEFAULT 'Rural',
        assigned_phc TEXT,
        emergency_contact_name TEXT,
        emergency_contact_phone TEXT,
        emergency_contact_relation TEXT,
        insurance_provider TEXT DEFAULT 'Ayushman Bharat PM-JAY',
        insurance_policy_number TEXT,
        organ_donor INTEGER DEFAULT 0,
        notes TEXT,
        is_primary INTEGER DEFAULT 0,
        avatar_color TEXT DEFAULT 'indigo',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Vitals table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS vitals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        recorded_date TEXT NOT NULL,
        systolic INTEGER,
        diastolic INTEGER,
        heart_rate INTEGER,
        blood_glucose REAL,
        glucose_type TEXT DEFAULT 'Random',
        spo2 REAL,
        temperature REAL,
        weight REAL,
        height REAL,
        bmi REAL,
        respiratory_rate INTEGER,
        recorded_at_facility TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Medical conditions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS conditions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        condition_name TEXT NOT NULL,
        diagnosed_date TEXT,
        status TEXT DEFAULT 'Active',
        severity TEXT DEFAULT 'Moderate',
        treating_physician TEXT,
        treatment_plan TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Medications table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS medications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        medication_name TEXT NOT NULL,
        dosage TEXT NOT NULL,
        form TEXT DEFAULT 'Tablet',
        frequency TEXT NOT NULL,
        start_date TEXT,
        end_date TEXT,
        prescribed_by TEXT,
        instructions TEXT,
        status TEXT DEFAULT 'Active',
        refill_date TEXT,
        taken_today INTEGER DEFAULT 0,
        last_taken_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Allergies table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS allergies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        allergen TEXT NOT NULL,
        allergy_type TEXT DEFAULT 'Drug',
        reaction TEXT NOT NULL,
        severity TEXT DEFAULT 'Moderate',
        diagnosed_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Lab results table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS lab_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        test_name TEXT NOT NULL,
        category TEXT DEFAULT 'Biochemistry',
        test_date TEXT NOT NULL,
        ordered_by TEXT,
        lab_name TEXT,
        result_value TEXT NOT NULL,
        unit TEXT,
        reference_range TEXT,
        status TEXT DEFAULT 'Normal',
        notes TEXT,
        attachment_filename TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Immunizations table (Universal Immunization Programme / Mission Indradhanush)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS immunizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        vaccine_name TEXT NOT NULL,
        dose_number TEXT DEFAULT 'Dose 1',
        administered_date TEXT NOT NULL,
        next_due_date TEXT,
        manufacturer TEXT,
        lot_number TEXT,
        administered_by TEXT,
        clinic_site TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Consultations / Doctor visits table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS consultations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        visit_date TEXT NOT NULL,
        doctor_name TEXT NOT NULL,
        specialty TEXT,
        clinic_hospital TEXT,
        reason_for_visit TEXT NOT NULL,
        diagnosis TEXT,
        clinical_notes TEXT,
        recommendations TEXT,
        follow_up_date TEXT,
        attachment_filename TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Surgeries and procedures table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS surgeries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        procedure_name TEXT NOT NULL,
        surgery_date TEXT NOT NULL,
        hospital TEXT,
        surgeon TEXT,
        type TEXT DEFAULT 'Elective',
        outcome TEXT DEFAULT 'Successful',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Attachments table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL,
        record_type TEXT,
        record_id INTEGER,
        original_filename TEXT NOT NULL,
        stored_filename TEXT NOT NULL,
        file_size INTEGER,
        file_type TEXT,
        description TEXT,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    )
    """)

    # Health Facilities table (PHCs, CHCs, District Hospitals, Blood Banks across India)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS health_facilities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        facility_name TEXT NOT NULL,
        facility_type TEXT NOT NULL, -- 'PHC', 'CHC', 'District Hospital', 'Sub-Centre', 'Blood Bank', 'Medical College'
        state TEXT NOT NULL,
        district TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL,
        emergency_phone TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        has_24x7_emergency INTEGER DEFAULT 1,
        has_ayushman_pmjay INTEGER DEFAULT 1,
        has_blood_bank INTEGER DEFAULT 0,
        doctor_in_charge TEXT
    )
    """)

    # Performance indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_vitals_profile ON vitals(profile_id, recorded_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_meds_profile ON medications(profile_id, status)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_allergies_profile ON allergies(profile_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_labs_profile ON lab_results(profile_id, test_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_consult_profile ON consultations(profile_id, visit_date)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_abha ON profiles(abha_number, abha_address, phone)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_facility_coords ON health_facilities(latitude, longitude, district)")

    conn.commit()

    # Seed demo Indian profile & health facilities if empty
    cursor.execute("SELECT COUNT(*) as count FROM profiles")
    if cursor.fetchone()['count'] == 0:
        seed_demo_data(conn)

    cursor.execute("SELECT COUNT(*) as count FROM health_facilities")
    if cursor.fetchone()['count'] == 0:
        seed_health_facilities(conn)

    conn.close()

def seed_demo_data(conn):
    """Populates the database with realistic sample Indian health records for demonstration."""
    cursor = conn.cursor()

    # Seed Primary Profile 1: Ramesh Kumar (Rural Family Head, Ayushman Bharat beneficiary)
    cursor.execute("""
    INSERT INTO profiles (
        abha_number, abha_address, aadhaar_last_four, ration_card_pmjay_id,
        full_name, date_of_birth, gender, blood_group, phone, email,
        village_town, district, state, pincode, rural_urban, assigned_phc,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        insurance_provider, insurance_policy_number, organ_donor, notes, is_primary, avatar_color
    ) VALUES (
        '14-5234-8901-2345', 'ramesh.kumar@abdm', '4892', 'PMJAY-UP-88239102',
        'Ramesh Kumar (रमेश कुमार)', '1982-07-15', 'Male', 'B+', '+91 98765 43210', 'ramesh.kumar82@email.com',
        'Gram Rampur, Post Chandauli', 'Varanasi', 'Uttar Pradesh', '221001', 'Rural', 'Primary Health Centre (PHC) Chandauli',
        'Sunita Devi', '+91 98765 43211', 'Spouse (पत्नी)',
        'Ayushman Bharat PM-JAY (₹5 Lakh Cover)', 'AB-PMJAY-UP-9923', 1, 'Farmer, non-smoker, managing borderline hypertension.', 1, 'indigo'
    )
    """)
    ramesh_id = cursor.lastrowid

    # Seed Profile 2: Sunita Devi (Wife / Mother, Maternal care)
    cursor.execute("""
    INSERT INTO profiles (
        abha_number, abha_address, aadhaar_last_four, ration_card_pmjay_id,
        full_name, date_of_birth, gender, blood_group, phone, email,
        village_town, district, state, pincode, rural_urban, assigned_phc,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        insurance_provider, insurance_policy_number, organ_donor, notes, is_primary, avatar_color
    ) VALUES (
        '14-7821-4309-8812', 'sunita.devi@abdm', '9103', 'PMJAY-UP-88239102-02',
        'Sunita Devi (सुनीता देवी)', '1986-11-20', 'Female', 'O+', '+91 98765 43211', 'sunita.devi@email.com',
        'Gram Rampur, Post Chandauli', 'Varanasi', 'Uttar Pradesh', '221001', 'Rural', 'Primary Health Centre (PHC) Chandauli',
        'Ramesh Kumar', '+91 98765 43210', 'Husband (पति)',
        'Ayushman Bharat PM-JAY', 'AB-PMJAY-UP-9923-02', 0, 'Registered under Janani Suraksha Yojana.', 0, 'emerald'
    )
    """)
    sunita_id = cursor.lastrowid

    # Seed Profile 3: Aarav Kumar (Child, Universal Immunization / Mission Indradhanush)
    cursor.execute("""
    INSERT INTO profiles (
        abha_number, abha_address, aadhaar_last_four, ration_card_pmjay_id,
        full_name, date_of_birth, gender, blood_group, phone, email,
        village_town, district, state, pincode, rural_urban, assigned_phc,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        insurance_provider, insurance_policy_number, organ_donor, notes, is_primary, avatar_color
    ) VALUES (
        '14-9912-3045-6677', 'aarav.kumar@abdm', '7741', 'PMJAY-UP-88239102-03',
        'Aarav Kumar (आरव कुमार)', '2019-04-10', 'Male', 'B+', '+91 98765 43210', 'ramesh.kumar82@email.com',
        'Gram Rampur, Post Chandauli', 'Varanasi', 'Uttar Pradesh', '221001', 'Rural', 'Primary Health Centre (PHC) Chandauli',
        'Ramesh Kumar', '+91 98765 43210', 'Father (पिता)',
        'Ayushman Bharat PM-JAY Family Cover', 'AB-PMJAY-UP-9923-03', 0, 'Pediatric profile, peanut allergy.', 0, 'sky'
    )
    """)
    aarav_id = cursor.lastrowid

    # Seed Ramesh's Vitals History (from rural health camps & PHC checks)
    vitals_data = [
        (ramesh_id, '2026-05-12 09:30', 134, 86, 74, 110.0, 'Fasting', 98.0, 98.4, 72.0, 172.0, 24.3, 16, 'PHC Chandauli Health Checkup', 'PHC Chandauli'),
        (ramesh_id, '2026-06-18 10:15', 130, 84, 70, 105.0, 'Fasting', 98.5, 98.6, 71.5, 172.0, 24.2, 15, 'Routine check by ASHA worker', 'Anganwadi Centre Rampur'),
        (ramesh_id, '2026-07-14 18:45', 126, 82, 72, 138.0, 'Post-meal', 99.0, 98.6, 71.0, 172.0, 24.0, 16, 'Post dinner reading at home', 'Home Check'),
        (ramesh_id, '2026-08-02 08:30', 124, 80, 68, 98.0, 'Fasting', 99.0, 98.4, 70.8, 172.0, 23.9, 14, 'Community Health Centre monthly camp', 'CHC Chandauli'),
        (ramesh_id, '2026-08-20 09:00', 120, 78, 66, 94.0, 'Fasting', 99.0, 98.5, 70.5, 172.0, 23.8, 14, 'Blood pressure and glucose well controlled', 'PHC Chandauli')
    ]
    for v in vitals_data:
        cursor.execute("""
        INSERT INTO vitals (
            profile_id, recorded_date, systolic, diastolic, heart_rate, blood_glucose,
            glucose_type, spo2, temperature, weight, height, bmi, respiratory_rate, notes, recorded_at_facility
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, v)

    # Seed Conditions
    cursor.execute("""
    INSERT INTO conditions (profile_id, condition_name, diagnosed_date, status, severity, treating_physician, treatment_plan, notes)
    VALUES (?, 'Borderline Hypertension (उच्च रक्तचाप)', '2024-02-10', 'Managed', 'Mild', 'Dr. Anand Verma (MBBS, PHC Medical Officer)', 'Low salt diet, 45 min daily brisk walking, monthly BP check at PHC.', 'Well controlled through diet and lifestyle.')
    """, (ramesh_id,))

    cursor.execute("""
    INSERT INTO conditions (profile_id, condition_name, diagnosed_date, status, severity, treating_physician, treatment_plan, notes)
    VALUES (?, 'Seasonal Dust & Pollen Allergy (मौसमी एलर्जी)', '2022-03-15', 'Active', 'Mild', 'Dr. Priya Sharma (CHC Chandauli)', 'Cetirizine 10mg PRN during harvesting season.', 'Dust triggers sneezing and itchy eyes.')
    """, (ramesh_id,))

    # Seed Medications
    cursor.execute("""
    INSERT INTO medications (
        profile_id, medication_name, dosage, form, frequency, start_date, end_date,
        prescribed_by, instructions, status, refill_date, taken_today
    ) VALUES (
        ?, 'Amlodipine (एम्लोडिपिन)', '5 mg', 'Tablet', 'Once daily in morning (रोज सुबह एक गोली)',
        '2024-03-01', NULL, 'Dr. Anand Verma (PHC In-charge)', 'Take after breakfast with water (नाश्ते के बाद)', 'Active', '2026-10-01', 1
    )
    """, (ramesh_id,))

    cursor.execute("""
    INSERT INTO medications (
        profile_id, medication_name, dosage, form, frequency, start_date, end_date,
        prescribed_by, instructions, status, refill_date, taken_today
    ) VALUES (
        ?, 'Cetirizine (सिट्रीजीन)', '10 mg', 'Tablet', 'As needed at bedtime (जरूरत पड़ने पर रात में)',
        '2025-01-10', NULL, 'Dr. Priya Sharma', 'Take when allergy symptoms appear (एलर्जी होने पर लें)', 'Active', '2026-11-15', 0
    )
    """, (ramesh_id,))

    # Seed Allergies
    cursor.execute("""
    INSERT INTO allergies (profile_id, allergen, allergy_type, reaction, severity, diagnosed_date, notes)
    VALUES (?, 'Penicillin / Amoxicillin (पेनिसिलिन)', 'Drug', 'Severe Hives, facial swelling, difficulty breathing (गंभीर एलर्जी / सांस फूलना)', 'Severe', '2018-09-12', 'CRITICAL / अत्यंत महत्वपूर्ण: Do not give any Penicillin or Amoxycillin antibiotics. Give alternative.')
    """, (ramesh_id,))

    cursor.execute("""
    INSERT INTO allergies (profile_id, allergen, allergy_type, reaction, severity, diagnosed_date, notes)
    VALUES (?, 'Peanuts (मूंगफली)', 'Food', 'Throat swelling, breathing tightness (गला बंद होना)', 'Severe', '2022-08-10', 'Keep emergency oral antihistamine handy.')
    """, (aarav_id,))

    # Seed Lab Results
    labs = [
        (ramesh_id, 'Fasting Blood Glucose (फास्टिंग ब्लड शुगर)', 'Biochemistry', '2026-08-02', 'Dr. Anand Verma', 'CHC Diagnostic Lab', '94.0', 'mg/dL', '70 - 100 mg/dL', 'Normal', 'Optimal glucose level.'),
        (ramesh_id, 'Lipid Profile - Total Cholesterol', 'Lipid', '2026-06-15', 'Dr. Anand Verma', 'District Hospital Varanasi', '182', 'mg/dL', '< 200 mg/dL', 'Normal', 'Normal range.'),
        (ramesh_id, 'Lipid Profile - Triglycerides', 'Lipid', '2026-06-15', 'Dr. Anand Verma', 'District Hospital Varanasi', '125', 'mg/dL', '< 150 mg/dL', 'Normal', 'Controlled.'),
        (ramesh_id, 'Hemoglobin (Hb - हीमोग्लोबिन)', 'Hematology', '2026-08-02', 'Dr. Anand Verma', 'CHC Diagnostic Lab', '14.8', 'g/dL', '13.5 - 17.5 g/dL', 'Normal', 'Healthy red cell count.'),
        (ramesh_id, 'Serum Creatinine (किडनी फंक्शन)', 'Renal', '2026-06-15', 'Dr. Anand Verma', 'District Hospital Varanasi', '0.90', 'mg/dL', '0.70 - 1.20 mg/dL', 'Normal', 'Healthy kidney filtration.')
    ]
    for lab in labs:
        cursor.execute("""
        INSERT INTO lab_results (profile_id, test_name, category, test_date, ordered_by, lab_name, result_value, unit, reference_range, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, lab)

    # Seed Immunizations (Universal Immunization Programme)
    vaccines = [
        (ramesh_id, 'COVID-19 Vaccine (Covishield - 2 Doses + Precaution)', 'Booster', '2023-04-10', None, 'Serum Institute of India', 'COV-8821', 'ANM Sangeeta', 'PHC Chandauli', 'All 3 doses completed on CoWIN.'),
        (ramesh_id, 'Tetanus Toxoid (TT / Td Booster)', 'Booster (10-yr)', '2022-05-18', '2032-05-18', 'Serum Institute of India', 'TT-4019', 'ANM Sangeeta', 'PHC Chandauli', 'Tetanus protection up to date.'),
        (aarav_id, 'MR (Measles-Rubella) Dose 2', 'Dose 2', '2024-10-15', None, 'Serum Institute of India', 'MR-9921', 'ANM Sangeeta', 'Sub-Centre Rampur', 'Completed under Mission Indradhanush.'),
        (aarav_id, 'DPT Booster 2 (5-6 Years)', 'Booster', '2025-04-20', None, 'Biological E', 'DPT-3321', 'ANM Sangeeta', 'PHC Chandauli', 'School entry dose completed.')
    ]
    for v in vaccines:
        cursor.execute("""
        INSERT INTO immunizations (profile_id, vaccine_name, dose_number, administered_date, next_due_date, manufacturer, lot_number, administered_by, clinic_site, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, v)

    # Seed Consultations
    cursor.execute("""
    INSERT INTO consultations (
        profile_id, visit_date, doctor_name, specialty, clinic_hospital,
        reason_for_visit, diagnosis, clinical_notes, recommendations, follow_up_date
    ) VALUES (
        ?, '2026-08-02', 'Dr. Anand Verma, MBBS', 'General Medicine / Medical Officer', 'Primary Health Centre (PHC) Chandauli',
        'Routine Monthly NCD Screening (गैर-संचारी रोग जांच)', 'Controlled Hypertension, normal blood sugar',
        'Patient feels active and healthy. Blood pressure 124/80 mmHg. Lungs clear. Advised on low sodium intake.',
        '1. Continue Amlodipine 5mg daily. 2. Avoid extra salt in food. 3. Visit next month for routine check.',
        '2026-09-02'
    )
    """, (ramesh_id,))

    conn.commit()

def seed_health_facilities(conn):
    """Populates representative government healthcare facilities (PHCs, CHCs, District Hospitals) across India."""
    cursor = conn.cursor()
    facilities = [
        # Uttar Pradesh / Varanasi region
        ('Primary Health Centre (PHC) Chandauli', 'PHC', 'Uttar Pradesh', 'Chandauli', 'NH-19, Chandauli Town', '+91 5412 260120', '108', 25.2612, 83.2678, 1, 1, 0, 'Dr. Anand Verma'),
        ('Community Health Centre (CHC) Chandauli', 'CHC', 'Uttar Pradesh', 'Chandauli', 'Main Road, Chandauli', '+91 5412 260230', '108', 25.2650, 83.2710, 1, 1, 1, 'Dr. R. K. Singh'),
        ('Pandit Deen Dayal Upadhyay Government Hospital', 'District Hospital', 'Uttar Pradesh', 'Varanasi', 'Pandeypur, Varanasi', '+91 542 2585234', '108', 25.3410, 82.9920, 1, 1, 1, 'Dr. S. K. Upadhyay'),
        ('Sir Sunderlal Hospital (IMS-BHU)', 'Medical College Hospital', 'Uttar Pradesh', 'Varanasi', 'BHU Campus, Varanasi', '+91 542 2307500', '108', 25.2750, 82.9980, 1, 1, 1, 'Medical Superintendent'),
        
        # Delhi-NCR region
        ('All India Institute of Medical Sciences (AIIMS)', 'Apex Hospital', 'Delhi', 'New Delhi', 'Sri Aurobindo Marg, Ansari Nagar, New Delhi', '+91 11 26588500', '108 / 112', 28.5672, 77.2100, 1, 1, 1, 'Director AIIMS'),
        ('Safdarjung Hospital & Vardhman Mahavir Medical College', 'District Hospital', 'Delhi', 'New Delhi', 'Ring Road, Opposite AIIMS, New Delhi', '+91 11 26165060', '108', 28.5685, 77.2070, 1, 1, 1, 'Medical Superintendent'),
        ('Dr. Ram Manohar Lohia Hospital (RML)', 'District Hospital', 'Delhi', 'New Delhi', 'Baba Kharak Singh Marg, New Delhi', '+91 11 23365525', '108', 28.6245, 77.2015, 1, 1, 1, 'Dr. A. K. Sharma'),

        # Maharashtra (Mumbai / Pune / Rural)
        ('KEM Hospital & Seth G.S. Medical College', 'Medical College Hospital', 'Maharashtra', 'Mumbai', 'Acharya Donde Marg, Parel, Mumbai', '+91 22 24107000', '108', 19.0028, 72.8424, 1, 1, 1, 'Dean KEM Hospital'),
        ('Primary Health Centre (PHC) Khed', 'PHC', 'Maharashtra', 'Pune', 'Khed-Rajgurunagar, Pune District', '+91 2135 222108', '108', 18.8570, 73.8980, 1, 1, 0, 'Dr. V. Patil'),
        ('District Hospital Aundh', 'District Hospital', 'Maharashtra', 'Pune', 'Aundh Camp, Pune', '+91 20 27280420', '108', 18.5750, 73.8040, 1, 1, 1, 'Civil Surgeon Pune'),

        # Bihar
        ('Patna Medical College and Hospital (PMCH)', 'Medical College Hospital', 'Bihar', 'Patna', 'Ashok Rajpath, Patna', '+91 612 2300080', '108', 25.6200, 85.1610, 1, 1, 1, 'Superintendent PMCH'),
        ('Primary Health Centre (PHC) Danapur', 'PHC', 'Bihar', 'Patna', 'Danapur Cantonment, Patna', '+91 612 241108', '108', 25.6320, 85.0450, 1, 1, 0, 'Dr. M. K. Yadav'),

        # Tamil Nadu
        ('Rajiv Gandhi Government General Hospital', 'Medical College Hospital', 'Tamil Nadu', 'Chennai', 'EVR Periyar Salai, Park Town, Chennai', '+91 44 25305000', '108', 13.0827, 80.2707, 1, 1, 1, 'Dean RGGGH'),
        ('Primary Health Centre (PHC) Sriperumbudur', 'PHC', 'Tamil Nadu', 'Kanchipuram', 'Bangalore Highway, Sriperumbudur', '+91 44 27162230', '108', 12.9690, 79.9440, 1, 1, 0, 'Dr. S. Ramanathan'),

        # West Bengal
        ('Calcutta Medical College and Hospital', 'Medical College Hospital', 'West Bengal', 'Kolkata', '88 College Street, Kolkata', '+91 33 22551600', '108', 22.5744, 88.3639, 1, 1, 1, 'Superintendent MCH'),
        ('Primary Health Centre (PHC) Singur', 'PHC', 'West Bengal', 'Hooghly', 'Singur, Hooghly District', '+91 33 2630120', '108', 22.8120, 88.2310, 1, 1, 0, 'Dr. B. Das')
    ]

    for f in facilities:
        cursor.execute("""
        INSERT INTO health_facilities (
            facility_name, facility_type, state, district, address, phone, emergency_phone,
            latitude, longitude, has_24x7_emergency, has_ayushman_pmjay, has_blood_bank, doctor_in_charge
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, f)

    conn.commit()
