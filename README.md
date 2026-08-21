# HealthPulse EHR - Personal & Family Health Records Management System

A modern, fully functional, and private Electronic Health Record (EHR) / Personal Health Record (PHR) web application built with Python (Flask), SQLite, Tailwind CSS, Lucide Icons, and Chart.js.

---

## Key Features

1. **Multi-Profile & Family Health Management**
   - Manage records for multiple individuals (Self, Spouse, Children, Elderly Parents).
   - Track demographics, DOB, calculated age, blood type, organ donor status, insurance provider & policy number, emergency contacts.

2. **Vitals & Biometric Tracking with Trend Analytics**
   - Record Blood Pressure (Systolic / Diastolic), Heart Rate (BPM), Blood Glucose (Fasting / Post-meal / Random), Oxygen Saturation ($SpO_2$), Temperature, Weight, Height, and auto-computed BMI.
   - Clinical risk categorization with color coding (e.g. Stage 1/2 Hypertension, Hypertensive Crisis, BMI classification).
   - Interactive Chart.js trend charts with metric toggles (BP, Pulse, Glucose, Weight/BMI).

3. **Medications & Daily Prescription Adherence**
   - Track medication names, dosages, forms (Tablets, Inhalers, Capsules), frequencies, prescribing physicians, and refill dates.
   - Interactive "Mark Taken Today" checklist to log daily adherence.

4. **Medical Conditions & Chronic Illnesses**
   - Log diagnoses, onset date, severity (Mild, Moderate, Severe), status (Active, Managed, In Remission, Resolved), treating doctor, and treatment plans.

5. **Diagnostic Lab Results & Pathology**
   - Structured panels: Lipid Panel, Complete Blood Count (CBC), Biochemistry, Renal Function (KFT), Endocrine (HbA1c), Urinalysis, Imaging.
   - Parameter values with reference ranges and status badges (*Normal*, *Low*, *High*, *Critical*).

6. **Allergies & Severe Reaction Alerts**
   - Track Drug, Food, Environmental, and Insect allergies.
   - Prominent, persistent **Emergency Red Warning Banner** on dashboard for severe/anaphylactic allergies.

7. **Immunization & Vaccine Registry**
   - Record vaccines, doses, administered dates, batch/lot numbers, administering clinics, and upcoming booster due dates.

8. **Doctor Consultations & Clinical Encounters**
   - Log appointment dates, doctors, specialties, clinic names, chief complaints, diagnoses, physician recommendations, and follow-up reminders.

9. **Surgeries & Major Procedures**
   - Record operative procedures, dates, hospitals, operating surgeons, type (Elective / Emergency), and recovery notes.

10. **Medical Documents & File Storage**
    - Securely upload, download, and preview PDF lab reports, medical scans, and discharge documents.

11. **Emergency Medical ID Card & QR Code**
    - Instant one-click printable wallet-size Emergency Medical Card with blood type, critical allergies, active medications, ICE contacts, and QR code.

12. **Complete JSON Backup & Restore**
    - One-click export of complete health profiles to structured JSON format and seamless JSON restoration.

---

## Quick Start Guide

### Option 1: Quick Launch (Windows)
Double-click `run.bat` or run in PowerShell:
```powershell
.\run.ps1
```

### Option 2: Manual Terminal Startup
```bash
# 1. Navigate to the project directory
cd "C:\Users\SAGAR SINGH\.gemini\antigravity\scratch\health-record-system"

# 2. Activate virtual environment
.\.venv\Scripts\activate

# 3. Run Flask application
python app.py
```
Open your browser and navigate to **`http://127.0.0.1:5000`**.

---

## Running Automated Tests
```powershell
.\.venv\Scripts\python -m unittest discover -s tests -p "test_*.py" -v
```

---

## System Architecture

```
health-record-system/
├── app.py                  # Flask REST API & Web Routes
├── database.py             # SQLite Schema, Indexes, Seed Data & Biometric Calculations
├── requirements.txt        # Python Dependencies
├── run.bat                 # Windows Batch Launcher
├── run.ps1                 # PowerShell Launcher
├── templates/
│   └── index.html          # Responsive Single-Page EHR Web Dashboard
├── static/
│   ├── css/
│   │   └── custom.css      # Custom Styles, Animations & Print Formatting
│   ├── js/
│   │   └── app.js          # Reactive SPA Controller, Chart.js, Modals & CRUD
│   └── uploads/            # Secure Storage for Uploaded Medical Documents
└── tests/
    └── test_app.py         # Automated Unit Tests for APIs and Calculations
```
