import os
import json
import uuid
import random
import math
from datetime import datetime, date
from werkzeug.utils import secure_filename
from flask import Flask, render_template, request, jsonify, send_from_directory, abort
from database import (
    init_db, get_db_connection, calculate_bmi,
    calculate_bp_category, calculate_bmi_category, haversine_distance, DB_PATH
)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'ayushman-abdm-ehr-secret-key-2026')
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB max upload
ALLOWED_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'csv'}

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def calculate_age(dob_str):
    """Calculate age in years from date string YYYY-MM-DD."""
    try:
        dob = datetime.strptime(dob_str, '%Y-%m-%d').date()
        today = date.today()
        years = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        return years
    except Exception:
        return None

# ==========================================
# PAGE ROUTES
# ==========================================

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ==========================================
# ABHA NATIONAL HEALTH ID & LOOKUP API
# ==========================================

@app.route('/api/abha/lookup', methods=['GET'])
def abha_lookup():
    query = request.args.get('query', '').strip()
    if not query:
        return jsonify([])

    conn = get_db_connection()
    # Search by ABHA number, ABHA address, phone number, or patient name
    profiles = conn.execute("""
        SELECT * FROM profiles
        WHERE abha_number LIKE ?
           OR abha_address LIKE ?
           OR phone LIKE ?
           OR full_name LIKE ?
        LIMIT 10
    """, (f"%{query}%", f"%{query}%", f"%{query}%", f"%{query}%")).fetchall()
    
    result = []
    for p in profiles:
        p_dict = dict(p)
        p_dict['age'] = calculate_age(p['date_of_birth'])
        result.append(p_dict)
        
    conn.close()
    return jsonify(result)

# ==========================================
# PROFILES API
# ==========================================

@app.route('/api/profiles', methods=['GET'])
def get_profiles():
    conn = get_db_connection()
    profiles = conn.execute("SELECT * FROM profiles ORDER BY is_primary DESC, full_name ASC").fetchall()
    
    result = []
    for p in profiles:
        p_dict = dict(p)
        p_dict['age'] = calculate_age(p['date_of_birth'])
        p_dict['vitals_count'] = conn.execute("SELECT COUNT(*) FROM vitals WHERE profile_id = ?", (p['id'],)).fetchone()[0]
        p_dict['conditions_count'] = conn.execute("SELECT COUNT(*) FROM conditions WHERE profile_id = ? AND status = 'Active'", (p['id'],)).fetchone()[0]
        p_dict['medications_count'] = conn.execute("SELECT COUNT(*) FROM medications WHERE profile_id = ? AND status = 'Active'", (p['id'],)).fetchone()[0]
        p_dict['allergies_count'] = conn.execute("SELECT COUNT(*) FROM allergies WHERE profile_id = ?", (p['id'],)).fetchone()[0]
        result.append(p_dict)
        
    conn.close()
    return jsonify(result)

@app.route('/api/profiles/<int:profile_id>', methods=['GET'])
def get_profile(profile_id):
    conn = get_db_connection()
    profile = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    conn.close()
    if not profile:
        return jsonify({'error': 'Profile not found'}), 404
    p_dict = dict(profile)
    p_dict['age'] = calculate_age(profile['date_of_birth'])
    return jsonify(p_dict)

@app.route('/api/profiles', methods=['POST'])
def create_profile():
    data = request.json or {}
    required_fields = ['full_name', 'date_of_birth', 'gender']
    for field in required_fields:
        if not data.get(field):
            return jsonify({'error': f'Field {field} is required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    
    is_primary = 1 if data.get('is_primary') else 0
    if is_primary:
        cursor.execute("UPDATE profiles SET is_primary = 0")

    avatar_colors = ['indigo', 'emerald', 'sky', 'purple', 'rose', 'amber']
    avatar_color = data.get('avatar_color', avatar_colors[len(conn.execute("SELECT id FROM profiles").fetchall()) % len(avatar_colors)])

    # Generate or format ABHA Number
    abha_no = data.get('abha_number')
    if not abha_no:
        abha_no = f"14-{random.randint(1000,9999)}-{random.randint(1000,9999)}-{random.randint(1000,9999)}"

    abha_addr = data.get('abha_address') or f"{data.get('full_name', 'citizen').lower().replace(' ', '')}{random.randint(10,99)}@abdm"

    cursor.execute("""
    INSERT INTO profiles (
        abha_number, abha_address, aadhaar_last_four, ration_card_pmjay_id,
        full_name, date_of_birth, gender, blood_group, phone, email,
        village_town, district, state, pincode, rural_urban, assigned_phc,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        insurance_provider, insurance_policy_number, organ_donor, notes, is_primary, avatar_color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        abha_no,
        abha_addr,
        data.get('aadhaar_last_four', ''),
        data.get('ration_card_pmjay_id', ''),
        data.get('full_name').strip(),
        data.get('date_of_birth').strip(),
        data.get('gender'),
        data.get('blood_group', 'B+'),
        data.get('phone', ''),
        data.get('email', ''),
        data.get('village_town', ''),
        data.get('district', ''),
        data.get('state', 'Uttar Pradesh'),
        data.get('pincode', ''),
        data.get('rural_urban', 'Rural'),
        data.get('assigned_phc', 'Primary Health Centre (PHC)'),
        data.get('emergency_contact_name', ''),
        data.get('emergency_contact_phone', ''),
        data.get('emergency_contact_relation', ''),
        data.get('insurance_provider', 'Ayushman Bharat PM-JAY'),
        data.get('insurance_policy_number', ''),
        1 if data.get('organ_donor') else 0,
        data.get('notes', ''),
        is_primary,
        avatar_color
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'abha_number': abha_no, 'message': 'ABHA Health Profile created successfully'}), 201

@app.route('/api/profiles/<int:profile_id>', methods=['PUT'])
def update_profile(profile_id):
    data = request.json or {}
    conn = get_db_connection()
    cursor = conn.cursor()
    
    if data.get('is_primary'):
        cursor.execute("UPDATE profiles SET is_primary = 0")

    cursor.execute("""
    UPDATE profiles SET
        abha_number = ?, abha_address = ?, aadhaar_last_four = ?, ration_card_pmjay_id = ?,
        full_name = ?, date_of_birth = ?, gender = ?, blood_group = ?, phone = ?, email = ?,
        village_town = ?, district = ?, state = ?, pincode = ?, rural_urban = ?, assigned_phc = ?,
        emergency_contact_name = ?, emergency_contact_phone = ?, emergency_contact_relation = ?,
        insurance_provider = ?, insurance_policy_number = ?, organ_donor = ?, notes = ?, is_primary = ?
    WHERE id = ?
    """, (
        data.get('abha_number'),
        data.get('abha_address'),
        data.get('aadhaar_last_four'),
        data.get('ration_card_pmjay_id'),
        data.get('full_name'),
        data.get('date_of_birth'),
        data.get('gender'),
        data.get('blood_group'),
        data.get('phone'),
        data.get('email'),
        data.get('village_town'),
        data.get('district'),
        data.get('state'),
        data.get('pincode'),
        data.get('rural_urban'),
        data.get('assigned_phc'),
        data.get('emergency_contact_name'),
        data.get('emergency_contact_phone'),
        data.get('emergency_contact_relation'),
        data.get('insurance_provider'),
        data.get('insurance_policy_number'),
        1 if data.get('organ_donor') else 0,
        data.get('notes'),
        1 if data.get('is_primary') else 0,
        profile_id
    ))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Profile updated successfully'})

@app.route('/api/profiles/<int:profile_id>', methods=['DELETE'])
def delete_profile(profile_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Profile deleted successfully'})

# ==========================================
# DASHBOARD OVERVIEW API
# ==========================================

@app.route('/api/overview/<int:profile_id>', methods=['GET'])
def get_overview(profile_id):
    conn = get_db_connection()
    profile = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    if not profile:
        conn.close()
        return jsonify({'error': 'Profile not found'}), 404

    profile_data = dict(profile)
    profile_data['age'] = calculate_age(profile['date_of_birth'])

    # Latest Vitals
    latest_vital = conn.execute("""
        SELECT * FROM vitals WHERE profile_id = ? ORDER BY recorded_date DESC LIMIT 1
    """, (profile_id,)).fetchone()
    latest_vital_dict = dict(latest_vital) if latest_vital else None
    if latest_vital_dict:
        latest_vital_dict['bp_category'] = calculate_bp_category(latest_vital_dict.get('systolic'), latest_vital_dict.get('diastolic'))
        latest_vital_dict['bmi_category'] = calculate_bmi_category(latest_vital_dict.get('bmi'))

    # Recent Vitals History (for mini chart)
    vitals_history = conn.execute("""
        SELECT recorded_date, systolic, diastolic, heart_rate, blood_glucose, weight, bmi, spo2
        FROM vitals WHERE profile_id = ? ORDER BY recorded_date ASC LIMIT 15
    """, (profile_id,)).fetchall()
    vitals_chart = [dict(v) for v in vitals_history]

    # Active Conditions
    conditions = conn.execute("""
        SELECT * FROM conditions WHERE profile_id = ? ORDER BY status ASC, condition_name ASC
    """, (profile_id,)).fetchall()

    # Active Medications
    medications = conn.execute("""
        SELECT * FROM medications WHERE profile_id = ? ORDER BY status ASC, medication_name ASC
    """, (profile_id,)).fetchall()

    # Allergies (especially severe)
    allergies = conn.execute("""
        SELECT * FROM allergies WHERE profile_id = ? ORDER BY 
        CASE severity WHEN 'Severe' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END
    """, (profile_id,)).fetchall()

    # Upcoming Appointments / Consultations
    upcoming_visits = conn.execute("""
        SELECT * FROM consultations WHERE profile_id = ? AND (follow_up_date >= date('now') OR follow_up_date IS NOT NULL)
        ORDER BY follow_up_date ASC LIMIT 3
    """, (profile_id,)).fetchall()

    # Upcoming Vaccines due
    upcoming_vaccines = conn.execute("""
        SELECT * FROM immunizations WHERE profile_id = ? AND next_due_date IS NOT NULL
        ORDER BY next_due_date ASC LIMIT 3
    """, (profile_id,)).fetchall()

    # Recent Lab results
    recent_labs = conn.execute("""
        SELECT * FROM lab_results WHERE profile_id = ? ORDER BY test_date DESC LIMIT 5
    """, (profile_id,)).fetchall()

    conn.close()

    return jsonify({
        'profile': profile_data,
        'latest_vital': latest_vital_dict,
        'vitals_chart': vitals_chart,
        'conditions': [dict(c) for c in conditions],
        'medications': [dict(m) for m in medications],
        'allergies': [dict(a) for a in allergies],
        'upcoming_visits': [dict(v) for v in upcoming_visits],
        'upcoming_vaccines': [dict(vc) for vc in upcoming_vaccines],
        'recent_labs': [dict(l) for l in recent_labs]
    })

# ==========================================
# VITALS API
# ==========================================

@app.route('/api/vitals/<int:profile_id>', methods=['GET'])
def get_vitals(profile_id):
    conn = get_db_connection()
    vitals = conn.execute("""
        SELECT * FROM vitals WHERE profile_id = ? ORDER BY recorded_date DESC
    """, (profile_id,)).fetchall()
    
    result = []
    for v in vitals:
        v_dict = dict(v)
        v_dict['bp_category'] = calculate_bp_category(v_dict.get('systolic'), v_dict.get('diastolic'))
        v_dict['bmi_category'] = calculate_bmi_category(v_dict.get('bmi'))
        result.append(v_dict)
        
    conn.close()
    return jsonify(result)

@app.route('/api/vitals', methods=['POST'])
def add_vital():
    data = request.json or {}
    profile_id = data.get('profile_id')
    if not profile_id:
        return jsonify({'error': 'Profile ID is required'}), 400

    recorded_date = data.get('recorded_date') or datetime.now().strftime('%Y-%m-%d %H:%M')
    systolic = int(data.get('systolic')) if data.get('systolic') else None
    diastolic = int(data.get('diastolic')) if data.get('diastolic') else None
    heart_rate = int(data.get('heart_rate')) if data.get('heart_rate') else None
    blood_glucose = float(data.get('blood_glucose')) if data.get('blood_glucose') else None
    glucose_type = data.get('glucose_type', 'Random')
    spo2 = float(data.get('spo2')) if data.get('spo2') else None
    temperature = float(data.get('temperature')) if data.get('temperature') else None
    weight = float(data.get('weight')) if data.get('weight') else None
    height = float(data.get('height')) if data.get('height') else None
    respiratory_rate = int(data.get('respiratory_rate')) if data.get('respiratory_rate') else None
    notes = data.get('notes', '')
    recorded_at_facility = data.get('recorded_at_facility', 'PHC / Health Centre')

    conn = get_db_connection()
    cursor = conn.cursor()
    
    if not height:
        prev = cursor.execute("SELECT height FROM vitals WHERE profile_id = ? AND height IS NOT NULL ORDER BY recorded_date DESC LIMIT 1", (profile_id,)).fetchone()
        if prev and prev['height']:
            height = prev['height']
            
    bmi = calculate_bmi(weight, height)

    cursor.execute("""
    INSERT INTO vitals (
        profile_id, recorded_date, systolic, diastolic, heart_rate, blood_glucose,
        glucose_type, spo2, temperature, weight, height, bmi, respiratory_rate, notes, recorded_at_facility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        profile_id, recorded_date, systolic, diastolic, heart_rate, blood_glucose,
        glucose_type, spo2, temperature, weight, height, bmi, respiratory_rate, notes, recorded_at_facility
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Vitals recorded successfully', 'bmi': bmi}), 201

@app.route('/api/vitals/<int:vital_id>', methods=['DELETE'])
def delete_vital(vital_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM vitals WHERE id = ?", (vital_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Vital record deleted'})

# ==========================================
# MEDICATIONS API
# ==========================================

@app.route('/api/medications/<int:profile_id>', methods=['GET'])
def get_medications(profile_id):
    conn = get_db_connection()
    meds = conn.execute("""
        SELECT * FROM medications WHERE profile_id = ? 
        ORDER BY CASE status WHEN 'Active' THEN 1 WHEN 'Paused' THEN 2 ELSE 3 END, medication_name ASC
    """, (profile_id,)).fetchall()
    conn.close()
    return jsonify([dict(m) for m in meds])

@app.route('/api/medications', methods=['POST'])
def add_medication():
    data = request.json or {}
    if not data.get('profile_id') or not data.get('medication_name') or not data.get('dosage'):
        return jsonify({'error': 'Profile, medication name, and dosage are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO medications (
        profile_id, medication_name, dosage, form, frequency, start_date, end_date,
        prescribed_by, instructions, status, refill_date, taken_today
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('profile_id'),
        data.get('medication_name').strip(),
        data.get('dosage').strip(),
        data.get('form', 'Tablet'),
        data.get('frequency', 'Once daily'),
        data.get('start_date') or date.today().strftime('%Y-%m-%d'),
        data.get('end_date'),
        data.get('prescribed_by', 'PHC Medical Officer'),
        data.get('instructions', ''),
        data.get('status', 'Active'),
        data.get('refill_date'),
        0
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Medication added successfully'}), 201

@app.route('/api/medications/<int:med_id>/toggle-taken', methods=['POST'])
def toggle_medication_taken(med_id):
    conn = get_db_connection()
    cursor = conn.cursor()
    med = cursor.execute("SELECT taken_today FROM medications WHERE id = ?", (med_id,)).fetchone()
    if not med:
        conn.close()
        return jsonify({'error': 'Medication not found'}), 404
        
    new_status = 0 if med['taken_today'] else 1
    today_str = date.today().strftime('%Y-%m-%d')
    cursor.execute("UPDATE medications SET taken_today = ?, last_taken_date = ? WHERE id = ?", (new_status, today_str if new_status else None, med_id))
    conn.commit()
    conn.close()
    return jsonify({'taken_today': new_status})

@app.route('/api/medications/<int:med_id>', methods=['DELETE'])
def delete_medication(med_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM medications WHERE id = ?", (med_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Medication deleted'})

# ==========================================
# CONDITIONS API
# ==========================================

@app.route('/api/conditions/<int:profile_id>', methods=['GET'])
def get_conditions(profile_id):
    conn = get_db_connection()
    conditions = conn.execute("""
        SELECT * FROM conditions WHERE profile_id = ? 
        ORDER BY CASE status WHEN 'Active' THEN 1 WHEN 'Managed' THEN 2 WHEN 'Remission' THEN 3 ELSE 4 END, condition_name ASC
    """, (profile_id,)).fetchall()
    conn.close()
    return jsonify([dict(c) for c in conditions])

@app.route('/api/conditions', methods=['POST'])
def add_condition():
    data = request.json or {}
    if not data.get('profile_id') or not data.get('condition_name'):
        return jsonify({'error': 'Profile ID and Condition name are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO conditions (
        profile_id, condition_name, diagnosed_date, status, severity, treating_physician, treatment_plan, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('profile_id'),
        data.get('condition_name').strip(),
        data.get('diagnosed_date'),
        data.get('status', 'Active'),
        data.get('severity', 'Moderate'),
        data.get('treating_physician', ''),
        data.get('treatment_plan', ''),
        data.get('notes', '')
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Condition added successfully'}), 201

@app.route('/api/conditions/<int:condition_id>', methods=['DELETE'])
def delete_condition(condition_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM conditions WHERE id = ?", (condition_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Condition deleted'})

# ==========================================
# ALLERGIES API
# ==========================================

@app.route('/api/allergies/<int:profile_id>', methods=['GET'])
def get_allergies(profile_id):
    conn = get_db_connection()
    allergies = conn.execute("""
        SELECT * FROM allergies WHERE profile_id = ? 
        ORDER BY CASE severity WHEN 'Severe' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END, allergen ASC
    """, (profile_id,)).fetchall()
    conn.close()
    return jsonify([dict(a) for a in allergies])

@app.route('/api/allergies', methods=['POST'])
def add_allergy():
    data = request.json or {}
    if not data.get('profile_id') or not data.get('allergen') or not data.get('reaction'):
        return jsonify({'error': 'Profile ID, Allergen, and Reaction are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO allergies (
        profile_id, allergen, allergy_type, reaction, severity, diagnosed_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('profile_id'),
        data.get('allergen').strip(),
        data.get('allergy_type', 'Drug'),
        data.get('reaction').strip(),
        data.get('severity', 'Moderate'),
        data.get('diagnosed_date'),
        data.get('notes', '')
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Allergy record added'}), 201

@app.route('/api/allergies/<int:allergy_id>', methods=['DELETE'])
def delete_allergy(allergy_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM allergies WHERE id = ?", (allergy_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Allergy deleted'})

# ==========================================
# LAB RESULTS API
# ==========================================

@app.route('/api/lab-results/<int:profile_id>', methods=['GET'])
def get_lab_results(profile_id):
    conn = get_db_connection()
    category = request.args.get('category')
    if category and category != 'All':
        labs = conn.execute("""
            SELECT * FROM lab_results WHERE profile_id = ? AND category = ? ORDER BY test_date DESC, test_name ASC
        """, (profile_id, category)).fetchall()
    else:
        labs = conn.execute("""
            SELECT * FROM lab_results WHERE profile_id = ? ORDER BY test_date DESC, test_name ASC
        """, (profile_id,)).fetchall()
    conn.close()
    return jsonify([dict(l) for l in labs])

@app.route('/api/lab-results', methods=['POST'])
def add_lab_result():
    data = request.json or {}
    if not data.get('profile_id') or not data.get('test_name') or not data.get('result_value'):
        return jsonify({'error': 'Profile ID, test name, and result value are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO lab_results (
        profile_id, test_name, category, test_date, ordered_by, lab_name,
        result_value, unit, reference_range, status, notes, attachment_filename
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('profile_id'),
        data.get('test_name').strip(),
        data.get('category', 'Biochemistry'),
        data.get('test_date') or date.today().strftime('%Y-%m-%d'),
        data.get('ordered_by', 'PHC Medical Officer'),
        data.get('lab_name', 'Government CHC Diagnostic Lab'),
        data.get('result_value').strip(),
        data.get('unit', ''),
        data.get('reference_range', ''),
        data.get('status', 'Normal'),
        data.get('notes', ''),
        data.get('attachment_filename')
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Lab result logged successfully'}), 201

@app.route('/api/lab-results/<int:lab_id>', methods=['DELETE'])
def delete_lab_result(lab_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM lab_results WHERE id = ?", (lab_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Lab result deleted'})

# ==========================================
# IMMUNIZATIONS API
# ==========================================

@app.route('/api/immunizations/<int:profile_id>', methods=['GET'])
def get_immunizations(profile_id):
    conn = get_db_connection()
    vaccines = conn.execute("""
        SELECT * FROM immunizations WHERE profile_id = ? ORDER BY administered_date DESC
    """, (profile_id,)).fetchall()
    conn.close()
    return jsonify([dict(v) for v in vaccines])

@app.route('/api/immunizations', methods=['POST'])
def add_immunization():
    data = request.json or {}
    if not data.get('profile_id') or not data.get('vaccine_name'):
        return jsonify({'error': 'Profile ID and Vaccine Name are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO immunizations (
        profile_id, vaccine_name, dose_number, administered_date, next_due_date,
        manufacturer, lot_number, administered_by, clinic_site, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('profile_id'),
        data.get('vaccine_name').strip(),
        data.get('dose_number', 'Dose 1'),
        data.get('administered_date') or date.today().strftime('%Y-%m-%d'),
        data.get('next_due_date'),
        data.get('manufacturer', 'Serum Institute of India / Bharat Biotech'),
        data.get('lot_number', ''),
        data.get('administered_by', 'ANM / ASHA Worker'),
        data.get('clinic_site', 'PHC / Sub-Centre'),
        data.get('notes', '')
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Immunization record added'}), 201

@app.route('/api/immunizations/<int:imm_id>', methods=['DELETE'])
def delete_immunization(imm_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM immunizations WHERE id = ?", (imm_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Immunization deleted'})

# ==========================================
# CONSULTATIONS / DOCTOR VISITS API
# ==========================================

@app.route('/api/consultations/<int:profile_id>', methods=['GET'])
def get_consultations(profile_id):
    conn = get_db_connection()
    visits = conn.execute("""
        SELECT * FROM consultations WHERE profile_id = ? ORDER BY visit_date DESC
    """, (profile_id,)).fetchall()
    conn.close()
    return jsonify([dict(v) for v in visits])

@app.route('/api/consultations', methods=['POST'])
def add_consultation():
    data = request.json or {}
    if not data.get('profile_id') or not data.get('doctor_name') or not data.get('reason_for_visit'):
        return jsonify({'error': 'Profile ID, Doctor name, and reason for visit are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO consultations (
        profile_id, visit_date, doctor_name, specialty, clinic_hospital,
        reason_for_visit, diagnosis, clinical_notes, recommendations, follow_up_date, attachment_filename
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('profile_id'),
        data.get('visit_date') or date.today().strftime('%Y-%m-%d'),
        data.get('doctor_name').strip(),
        data.get('specialty', 'Medical Officer / General Physician'),
        data.get('clinic_hospital', 'Primary Health Centre (PHC)'),
        data.get('reason_for_visit').strip(),
        data.get('diagnosis', ''),
        data.get('clinical_notes', ''),
        data.get('recommendations', ''),
        data.get('follow_up_date'),
        data.get('attachment_filename')
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Consultation logged successfully'}), 201

@app.route('/api/consultations/<int:consult_id>', methods=['DELETE'])
def delete_consultation(consult_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM consultations WHERE id = ?", (consult_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Consultation deleted'})

# ==========================================
# SURGERIES & PROCEDURES API
# ==========================================

@app.route('/api/surgeries/<int:profile_id>', methods=['GET'])
def get_surgeries(profile_id):
    conn = get_db_connection()
    surgeries = conn.execute("""
        SELECT * FROM surgeries WHERE profile_id = ? ORDER BY surgery_date DESC
    """, (profile_id,)).fetchall()
    conn.close()
    return jsonify([dict(s) for s in surgeries])

@app.route('/api/surgeries', methods=['POST'])
def add_surgery():
    data = request.json or {}
    if not data.get('profile_id') or not data.get('procedure_name') or not data.get('surgery_date'):
        return jsonify({'error': 'Profile ID, Procedure name, and Surgery date are required'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO surgeries (
        profile_id, procedure_name, surgery_date, hospital, surgeon, type, outcome, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data.get('profile_id'),
        data.get('procedure_name').strip(),
        data.get('surgery_date'),
        data.get('hospital', 'Government District Hospital'),
        data.get('surgeon', ''),
        data.get('type', 'Elective'),
        data.get('outcome', 'Successful'),
        data.get('notes', '')
    ))
    new_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return jsonify({'id': new_id, 'message': 'Procedure recorded successfully'}), 201

@app.route('/api/surgeries/<int:surg_id>', methods=['DELETE'])
def delete_surgery(surg_id):
    conn = get_db_connection()
    conn.execute("DELETE FROM surgeries WHERE id = ?", (surg_id,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Surgery deleted'})

# ==========================================
# ATTACHMENTS & FILE UPLOADS
# ==========================================

@app.route('/api/attachments/upload', methods=['POST'])
def upload_attachment():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400

    profile_id = request.form.get('profile_id')
    if not profile_id:
        return jsonify({'error': 'Profile ID is required'}), 400

    record_type = request.form.get('record_type', 'general')
    record_id = request.form.get('record_id')
    description = request.form.get('description', '')

    if file and allowed_file(file.filename):
        orig_name = secure_filename(file.filename)
        ext = orig_name.rsplit('.', 1)[1].lower() if '.' in orig_name else ''
        stored_name = f"{uuid.uuid4().hex}_{orig_name}"
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], stored_name)
        file.save(save_path)
        file_size = os.path.getsize(save_path)

        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO attachments (
            profile_id, record_type, record_id, original_filename, stored_filename, file_size, file_type, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            profile_id, record_type, record_id, orig_name, stored_name, file_size, ext, description
        ))
        new_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return jsonify({
            'id': new_id,
            'original_filename': orig_name,
            'stored_filename': stored_name,
            'url': f"/uploads/{stored_name}",
            'message': 'File uploaded successfully'
        }), 201

    return jsonify({'error': 'File type not permitted'}), 400

@app.route('/api/attachments/<int:profile_id>', methods=['GET'])
def get_attachments(profile_id):
    conn = get_db_connection()
    attachments = conn.execute("""
        SELECT * FROM attachments WHERE profile_id = ? ORDER BY uploaded_at DESC
    """, (profile_id,)).fetchall()
    conn.close()
    
    result = []
    for a in attachments:
        a_dict = dict(a)
        a_dict['url'] = f"/uploads/{a_dict['stored_filename']}"
        result.append(a_dict)
    return jsonify(result)

@app.route('/api/attachments/<int:att_id>', methods=['DELETE'])
def delete_attachment(att_id):
    conn = get_db_connection()
    att = conn.execute("SELECT stored_filename FROM attachments WHERE id = ?", (att_id,)).fetchone()
    if att:
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], att['stored_filename'])
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError:
                pass
        conn.execute("DELETE FROM attachments WHERE id = ?", (att_id,))
        conn.commit()
    conn.close()
    return jsonify({'message': 'Attachment deleted'})

# ==========================================
# NEARBY HOSPITALS & PHC GPS LOCATOR API
# ==========================================

@app.route('/api/facilities/nearby', methods=['GET'])
def get_nearby_facilities():
    try:
        user_lat = float(request.args.get('lat', 25.3176)) # Default Varanasi / Central India coords
        user_lon = float(request.args.get('lon', 82.9739))
    except (ValueError, TypeError):
        user_lat = 25.3176
        user_lon = 82.9739

    facility_type = request.args.get('type')
    query = request.args.get('query', '').strip()

    conn = get_db_connection()
    facilities = conn.execute("SELECT * FROM health_facilities").fetchall()
    conn.close()

    result = []
    for f in facilities:
        f_dict = dict(f)
        dist = haversine_distance(user_lat, user_lon, f['latitude'], f['longitude'])
        f_dict['distance_km'] = dist
        f_dict['directions_url'] = f"https://www.google.com/maps/dir/?api=1&destination={f['latitude']},{f['longitude']}"
        
        # Apply filters if provided
        if facility_type and facility_type != 'All' and f_dict['facility_type'] != facility_type:
            continue
        if query and (query.lower() not in f_dict['facility_name'].lower() and query.lower() not in f_dict['district'].lower() and query.lower() not in f_dict['state'].lower()):
            continue

        result.append(f_dict)

    # Sort by distance
    result.sort(key=lambda x: x['distance_km'])
    return jsonify(result)

# ==========================================
# INDIAN NATIONAL EMERGENCY HELPLINES API
# ==========================================

@app.route('/api/emergency/helplines', methods=['GET'])
def get_helplines():
    helplines = [
        {
            'number': '108',
            'title': 'National Ambulance / Emergency Medical Service',
            'title_hi': '108 आपातकालीन एम्बुलेंस सेवा',
            'description': 'Free 24x7 Emergency Ambulance dispatch across all States of India.',
            'category': 'Ambulance',
            'color': 'red'
        },
        {
            'number': '102',
            'title': 'Janani Shishu Suraksha (Maternal & Child Ambulance)',
            'title_hi': '102 जननी शिशु सुरक्षा एम्बुलेंस',
            'description': 'Free emergency transport for pregnant mothers, newborns, and infants to nearest PHC/Hospital.',
            'category': 'Maternal Care',
            'color': 'rose'
        },
        {
            'number': '104',
            'title': 'National & State Health Helpline',
            'title_hi': '104 स्वास्थ्य सूचना व सलाह हेल्पलाइन',
            'description': '24x7 medical advice, blood bank availability, epidemic alerts, and doctor consultations.',
            'category': 'Health Advice',
            'color': 'indigo'
        },
        {
            'number': '112',
            'title': 'National Emergency Response (All-in-One)',
            'title_hi': '112 राष्ट्रीय आपातकालीन नंबर',
            'description': 'Unified emergency response service for Police, Fire, and Medical Emergencies.',
            'category': 'National Emergency',
            'color': 'amber'
        },
        {
            'number': '14555',
            'title': 'Ayushman Bharat PM-JAY Toll-Free Helpline',
            'title_hi': '14555 आयुष्मान भारत योजना हेल्पलाइन',
            'description': 'Inquire about ₹5 Lakh free treatment, eligible hospitals, e-card status, and claims.',
            'category': 'PM-JAY Scheme',
            'color': 'emerald'
        },
        {
            'number': '14416',
            'title': 'Tele-MANAS (Mental Health & Counseling)',
            'title_hi': '14416 टेली-मानस मानसिक स्वास्थ्य हेल्पलाइन',
            'description': 'National 24x7 free tele-mental health counseling in 20+ regional Indian languages.',
            'category': 'Mental Health',
            'color': 'teal'
        }
    ]
    return jsonify(helplines)

# ==========================================
# EMERGENCY MEDICAL ID CARD DATA
# ==========================================

@app.route('/api/emergency/<int:profile_id>', methods=['GET'])
def get_emergency_card(profile_id):
    conn = get_db_connection()
    profile = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    if not profile:
        conn.close()
        return jsonify({'error': 'Profile not found'}), 404

    profile_dict = dict(profile)
    profile_dict['age'] = calculate_age(profile['date_of_birth'])

    # Severe Allergies
    allergies = conn.execute("""
        SELECT allergen, reaction, severity FROM allergies WHERE profile_id = ? ORDER BY 
        CASE severity WHEN 'Severe' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END
    """, (profile_id,)).fetchall()

    # Active Conditions
    conditions = conn.execute("""
        SELECT condition_name, severity, status, treating_physician FROM conditions 
        WHERE profile_id = ? AND status IN ('Active', 'Managed')
    """, (profile_id,)).fetchall()

    # Active Medications
    medications = conn.execute("""
        SELECT medication_name, dosage, frequency, instructions FROM medications 
        WHERE profile_id = ? AND status = 'Active'
    """, (profile_id,)).fetchall()

    # Latest Vitals
    latest_vital = conn.execute("""
        SELECT systolic, diastolic, heart_rate, blood_glucose, recorded_date FROM vitals 
        WHERE profile_id = ? ORDER BY recorded_date DESC LIMIT 1
    """, (profile_id,)).fetchone()

    conn.close()

    return jsonify({
        'profile': profile_dict,
        'allergies': [dict(a) for a in allergies],
        'conditions': [dict(c) for c in conditions],
        'medications': [dict(m) for m in medications],
        'latest_vital': dict(latest_vital) if latest_vital else None,
        'generated_at': datetime.now().strftime('%Y-%m-%d %H:%M')
    })

# ==========================================
# EXPORT / IMPORT JSON BACKUP
# ==========================================

@app.route('/api/export/json/<int:profile_id>', methods=['GET'])
def export_profile_json(profile_id):
    conn = get_db_connection()
    profile = conn.execute("SELECT * FROM profiles WHERE id = ?", (profile_id,)).fetchone()
    if not profile:
        conn.close()
        return jsonify({'error': 'Profile not found'}), 404

    vitals = conn.execute("SELECT * FROM vitals WHERE profile_id = ?", (profile_id,)).fetchall()
    conditions = conn.execute("SELECT * FROM conditions WHERE profile_id = ?", (profile_id,)).fetchall()
    medications = conn.execute("SELECT * FROM medications WHERE profile_id = ?", (profile_id,)).fetchall()
    allergies = conn.execute("SELECT * FROM allergies WHERE profile_id = ?", (profile_id,)).fetchall()
    lab_results = conn.execute("SELECT * FROM lab_results WHERE profile_id = ?", (profile_id,)).fetchall()
    immunizations = conn.execute("SELECT * FROM immunizations WHERE profile_id = ?", (profile_id,)).fetchall()
    consultations = conn.execute("SELECT * FROM consultations WHERE profile_id = ?", (profile_id,)).fetchall()
    surgeries = conn.execute("SELECT * FROM surgeries WHERE profile_id = ?", (profile_id,)).fetchall()
    conn.close()

    export_data = {
        'export_version': '2.0_ABDM_INDIA',
        'export_timestamp': datetime.now().isoformat(),
        'profile': dict(profile),
        'vitals': [dict(v) for v in vitals],
        'conditions': [dict(c) for c in conditions],
        'medications': [dict(m) for m in medications],
        'allergies': [dict(a) for a in allergies],
        'lab_results': [dict(l) for l in lab_results],
        'immunizations': [dict(i) for i in immunizations],
        'consultations': [dict(co) for co in consultations],
        'surgeries': [dict(s) for s in surgeries]
    }
    return jsonify(export_data)

@app.route('/api/import/json', methods=['POST'])
def import_profile_json():
    data = request.json or {}
    profile_data = data.get('profile')
    if not profile_data or not profile_data.get('full_name'):
        return jsonify({'error': 'Invalid backup payload: profile object missing'}), 400

    conn = get_db_connection()
    cursor = conn.cursor()

    abha_no = f"14-{random.randint(1000,9999)}-{random.randint(1000,9999)}-{random.randint(1000,9999)}"
    abha_addr = f"imported_{uuid.uuid4().hex[:6]}@abdm"

    cursor.execute("""
    INSERT INTO profiles (
        abha_number, abha_address, aadhaar_last_four, ration_card_pmjay_id,
        full_name, date_of_birth, gender, blood_group, phone, email,
        village_town, district, state, pincode, rural_urban, assigned_phc,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
        insurance_provider, insurance_policy_number, organ_donor, notes, is_primary, avatar_color
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    """, (
        abha_no,
        abha_addr,
        profile_data.get('aadhaar_last_four', ''),
        profile_data.get('ration_card_pmjay_id', ''),
        profile_data.get('full_name') + " (Imported)",
        profile_data.get('date_of_birth'),
        profile_data.get('gender'),
        profile_data.get('blood_group'),
        profile_data.get('phone'),
        profile_data.get('email'),
        profile_data.get('village_town', ''),
        profile_data.get('district', ''),
        profile_data.get('state', ''),
        profile_data.get('pincode', ''),
        profile_data.get('rural_urban', 'Rural'),
        profile_data.get('assigned_phc', ''),
        profile_data.get('emergency_contact_name'),
        profile_data.get('emergency_contact_phone'),
        profile_data.get('emergency_contact_relation'),
        profile_data.get('insurance_provider'),
        profile_data.get('insurance_policy_number'),
        profile_data.get('organ_donor', 0),
        profile_data.get('notes'),
        profile_data.get('avatar_color', 'purple')
    ))
    new_pid = cursor.lastrowid

    # Insert imported vitals
    for v in data.get('vitals', []):
        cursor.execute("""
        INSERT INTO vitals (
            profile_id, recorded_date, systolic, diastolic, heart_rate, blood_glucose,
            glucose_type, spo2, temperature, weight, height, bmi, respiratory_rate, notes, recorded_at_facility
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            new_pid, v.get('recorded_date'), v.get('systolic'), v.get('diastolic'),
            v.get('heart_rate'), v.get('blood_glucose'), v.get('glucose_type'),
            v.get('spo2'), v.get('temperature'), v.get('weight'), v.get('height'),
            v.get('bmi'), v.get('respiratory_rate'), v.get('notes'), v.get('recorded_at_facility', 'PHC')
        ))

    # Insert imported conditions
    for c in data.get('conditions', []):
        cursor.execute("""
        INSERT INTO conditions (profile_id, condition_name, diagnosed_date, status, severity, treating_physician, treatment_plan, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_pid, c.get('condition_name'), c.get('diagnosed_date'), c.get('status'), c.get('severity'), c.get('treating_physician'), c.get('treatment_plan'), c.get('notes')))

    # Insert imported medications
    for m in data.get('medications', []):
        cursor.execute("""
        INSERT INTO medications (profile_id, medication_name, dosage, form, frequency, start_date, end_date, prescribed_by, instructions, status, refill_date, taken_today)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        """, (new_pid, m.get('medication_name'), m.get('dosage'), m.get('form'), m.get('frequency'), m.get('start_date'), m.get('end_date'), m.get('prescribed_by'), m.get('instructions'), m.get('status'), m.get('refill_date')))

    # Insert imported allergies
    for a in data.get('allergies', []):
        cursor.execute("""
        INSERT INTO allergies (profile_id, allergen, allergy_type, reaction, severity, diagnosed_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (new_pid, a.get('allergen'), a.get('allergy_type'), a.get('reaction'), a.get('severity'), a.get('diagnosed_date'), a.get('notes')))

    # Insert imported lab results
    for l in data.get('lab_results', []):
        cursor.execute("""
        INSERT INTO lab_results (profile_id, test_name, category, test_date, ordered_by, lab_name, result_value, unit, reference_range, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_pid, l.get('test_name'), l.get('category'), l.get('test_date'), l.get('ordered_by'), l.get('lab_name'), l.get('result_value'), l.get('unit'), l.get('reference_range'), l.get('status'), l.get('notes')))

    # Insert imported immunizations
    for i in data.get('immunizations', []):
        cursor.execute("""
        INSERT INTO immunizations (profile_id, vaccine_name, dose_number, administered_date, next_due_date, manufacturer, lot_number, administered_by, clinic_site, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_pid, i.get('vaccine_name'), i.get('dose_number'), i.get('administered_date'), i.get('next_due_date'), i.get('manufacturer'), i.get('lot_number'), i.get('administered_by'), i.get('clinic_site'), i.get('notes')))

    # Insert imported consultations
    for co in data.get('consultations', []):
        cursor.execute("""
        INSERT INTO consultations (profile_id, visit_date, doctor_name, specialty, clinic_hospital, reason_for_visit, diagnosis, clinical_notes, recommendations, follow_up_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_pid, co.get('visit_date'), co.get('doctor_name'), co.get('specialty'), co.get('clinic_hospital'), co.get('reason_for_visit'), co.get('diagnosis'), co.get('clinical_notes'), co.get('recommendations'), co.get('follow_up_date')))

    # Insert imported surgeries
    for s in data.get('surgeries', []):
        cursor.execute("""
        INSERT INTO surgeries (profile_id, procedure_name, surgery_date, hospital, surgeon, type, outcome, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (new_pid, s.get('procedure_name'), s.get('surgery_date'), s.get('hospital'), s.get('surgeon'), s.get('type'), s.get('outcome'), s.get('notes')))

    conn.commit()
    conn.close()

    return jsonify({'id': new_pid, 'message': 'ABHA Health Profile imported successfully'}), 201

# Initialize DB on startup
with app.app_context():
    init_db()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
