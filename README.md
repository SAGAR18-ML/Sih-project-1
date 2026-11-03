# Ayushman Digital Health Record (ADHR)
### ABDM-Compliant Personal Health Records & Automated Pre-Consultation Case-Taking Engine

[![Python](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.1.3-green.svg)](https://flask.palletsprojects.com/)
[![ABDM](https://img.shields.io/badge/ABDM-Compliant-orange.svg)](https://abdm.gov.in/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/Unit%20Tests-15%20Passing-brightgreen.svg)](tests/)

---

## 📌 Overview

**Ayushman Digital Health Record (ADHR)** is an Ayushman Bharat Digital Mission (ABDM) aligned Personal Health Record (PHR) and Electronic Health Record (EHR) ecosystem designed for Indian citizens, hospitals, and primary healthcare centers (PHCs/CHCs).

Built for **Smart India Hackathon (SIH 2026)** — *Problem Statement ID: 26047 (Patient Case-Taking Software)*, ADHR eliminates documentation overhead in high-volume Indian OPDs by transforming manual, repetitive case-taking into an automated pre-consultation digital workflow.

---

## 🌟 Key Features

### 1. 🪪 Citizen Identity & Family Vault (ABDM Aligned)
- **14-digit ABHA ID & Virtual Address:** Supports ABHA numbers (`14-5234-8901-2345`) and ABHA handles (`citizen@abdm`).
- **OTP-Based Mobile Onboarding:** Fast 6-digit SMS OTP verification for frictionless login.
- **Family Health Vault:** Multi-profile switching under one family mobile number (Self, Spouse, Children, Senior Parents).
- **PM-JAY Scheme Tracking:** Displays active Ayushman Bharat PM-JAY ₹5,00,000 cashless insurance cover status.

### 2. 🩺 Doctor Clinical Access Card & Instant QR Handshake
- **ABDM Dynamic QR Code:** Doctors can scan the patient's QR code on any browser/device to view a structured 1-page clinical summary in 3 seconds.
- **🚨 Crimson Contraindication Banner:** Prominently alerts attending doctors to severe drug allergies (e.g. Penicillin, NSAIDs) and high-risk conditions before prescribing.
- **Printable A4 OPD Clinical Sheet:** One-click formatted printout for physical hospital records.

### 3. 🚨 108 Emergency SOS & Anti-Jump Satellite GPS Engine
- **Hardware-Filtered Anti-Jump GPS:** Uses velocity thresholds ($\Delta d / \Delta t \le 45\text{ m/s}$) and accuracy filters ($\le 65\text{m}$) to reject erratic cell-tower jumps and lock onto true satellite coordinates.
- **Nearby Facility Routing:** Haversine distance engine calculates nearest PHCs, CHCs, and Ayushman Empanelled Hospitals with 1-tap Google Maps directions.
- **Direct SOS Telephony Links:** Speed-dial buttons for **108** (Ambulance), **102** (Maternal/Child), **112** (Police), and **104** (Health Advice).

### 4. 🤖 AI Health Sahayak & Smart Document Extractor
- **Multilingual Voice Assistant:** Speak in **Hindi** or **English** (powered by Web Speech ASR & SpeechSynthesis) for health questions and voice readout.
- **Smart Document Parser:** Upload photos or PDFs of paper lab reports and prescriptions to extract lab values (Fasting Glucose, HbA1c, CBC, Lipids) automatically.
- **Jan Aushadhi (PMBJP) Generic Mapping:** Suggests equivalent Pradhan Mantri Bharatiya Janaushadhi generic medicines saving patients 70–80% on out-of-pocket pharmacy expenses.

### 5. 📊 Biometric Tracking & Diagnostic Analytics
- **Interactive Vitals Trend Charts:** Chart.js graphs for Blood Pressure, Pulse, Blood Glucose, and Weight/BMI.
- **Automatic Clinical Risk Stratification:** AHA/ACC Blood Pressure staging (Normal, Elevated, Stage 1/2 Hypertension, Crisis) and BMI classification.
- **Vaccination & Immunization Vault:** Track pediatric vaccines and calculate upcoming booster doses.
- **Appointment Scheduling:** 1-tap sync with Google Calendar or downloadable `.ics` reminder files.

### 6. 👴 Senior Citizen Mode & Accessibility
- Dedicated high-contrast accessibility mode with $\ge 18\text{px}$ typography and $\ge 48\text{px}$ touch targets.
- Two-way voice assistance for low-literacy or elderly users.

---

## 🏛️ System Architecture

```
health-record-system/
├── app.py                      # Flask REST API & Web Routes (2,000+ lines)
├── database.py                 # SQLite Schema (WAL Mode), Migrations & Medical Algorithms
├── requirements.txt            # Python Dependencies
├── Dockerfile                  # Production Containerization Image
├── Procfile                    # PaaS Deployment Manifest
├── run.bat / run.ps1           # 1-Click Windows Startup Scripts
│
├── templates/
│   └── index.html              # Modern Responsive Single-Page EHR Web Interface
│
├── static/
│   ├── css/custom.css          # Dual-Mode Responsive CSS (Mobile Bottom Sheets & Desktop Modals)
│   ├── js/app.js               # Frontend Controller, Anti-Jump GPS, Charts, Modals & Voice
│   ├── js/translations.js      # English <-> Hindi Translation Dictionary
│   ├── manifest.json           # PWA Web App Manifest
│   └── sw.js                   # Service Worker Offline Cache Manager
│
├── android-app/                # Native Android Studio Project
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml # Hardware GPS & Telephony Permissions
│   │   └── java/.../MainActivity.java # Hybrid WebView Bridge with Runtime Permissions
│   └── build.gradle            # Android Gradle Build Config (CompileSdk 34, AndroidX)
│
└── tests/
    └── test_app.py             # 15 Automated Unit Test Suites (100% Passing)
```

---

## 🚀 Quick Start Guide

### Prerequisites
- Python 3.10+
- Git

### 1. Clone & Set Up
```bash
git clone https://github.com/SAGAR18-ML/Sih-project-1.git
cd Sih-project-1
```

### 2. Create Virtual Environment & Install Dependencies
```bash
python -m venv .venv

# Windows
.\.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
```

### 3. Run Application
```bash
python app.py
```
Open **`http://127.0.0.1:5000`** in your browser.

---

## 🧪 Running Automated Tests

All 15 test suites run on an isolated test database with zero side effects:
```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

---

## 📱 Mobile & PWA Access
- **Progressive Web App (PWA):** Open the site on Chrome/Edge on Android or Safari on iOS and tap **"Install App"** / **"Add to Home Screen"**.
- **Android Native Shell:** Open the `android-app/` folder in Android Studio and click **Run** to build the APK.

---

## 📜 Compliance & Standards
- **ABDM Standards:** Conforms to National Health Authority (NHA) M1/M2/M3 guidelines.
- **Interoperability:** HL7 FHIR R4 JSON schema compatibility.
- **Privacy:** Built in accordance with India's **Digital Personal Data Protection (DPDP) Act, 2023**.

---

## 📄 License
This project is licensed under the MIT License.
