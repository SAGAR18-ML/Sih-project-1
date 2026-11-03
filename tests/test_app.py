import unittest
import json
import os
import sys

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import database
from database import calculate_bmi, calculate_bp_category, calculate_bmi_category, haversine_distance, init_db, get_db_connection
from app import app

TEST_DB = os.path.join(os.path.dirname(__file__), 'test_health_records.db')

class TestAyushmanABHAHealthSystem(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        database.DB_PATH = TEST_DB
        for f in [TEST_DB, f"{TEST_DB}-wal", f"{TEST_DB}-shm"]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass
        with app.app_context():
            init_db()

    @classmethod
    def tearDownClass(cls):
        database.DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'health_records.db')
        for f in [TEST_DB, f"{TEST_DB}-wal", f"{TEST_DB}-shm"]:
            if os.path.exists(f):
                try:
                    os.remove(f)
                except Exception:
                    pass

    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_bmi_calculation(self):
        bmi = calculate_bmi(70.5, 172)
        self.assertAlmostEqual(bmi, 23.8, places=1)
        self.assertEqual(calculate_bmi_category(23.8)['category'], 'Normal weight')
        self.assertEqual(calculate_bmi_category(23.8)['category_hi'], 'सामान्य वजन')

    def test_bp_categorization(self):
        cat = calculate_bp_category(118, 76)
        self.assertEqual(cat['category'], 'Normal')
        self.assertEqual(cat['category_hi'], 'सामान्य')

        elevated = calculate_bp_category(124, 78)
        self.assertEqual(elevated['category'], 'Elevated')
        self.assertEqual(elevated['category_hi'], 'सामान्य से अधिक')

        crisis = calculate_bp_category(190, 125)
        self.assertEqual(crisis['category'], 'Hypertensive Crisis')
        self.assertEqual(crisis['category_hi'], 'अति उच्च रक्तचाप संकट')

    def test_haversine_distance(self):
        # Distance between Varanasi (25.3176, 82.9739) and Chandauli (25.2612, 83.2678) ~ 30 km
        dist = haversine_distance(25.3176, 82.9739, 25.2612, 83.2678)
        self.assertTrue(25 <= dist <= 35)

    def test_abha_lookup_api(self):
        # Search for Ramesh Kumar by ABHA number
        res = self.client.get('/api/abha/lookup?query=14-5234-8901-2345')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertGreater(len(data), 0)
        self.assertIn('Ramesh', data[0]['full_name'])

        # Search by phone number
        phone_res = self.client.get('/api/abha/lookup?query=98765')
        self.assertEqual(phone_res.status_code, 200)
        self.assertGreater(len(phone_res.get_json()), 0)

    def test_nearby_facilities_api(self):
        # Get facilities near Varanasi / Chandauli
        res = self.client.get('/api/facilities/nearby?lat=25.3176&lon=82.9739')
        self.assertEqual(res.status_code, 200)
        facilities = res.get_json()
        self.assertTrue(isinstance(facilities, list))
        self.assertGreater(len(facilities), 0)
        self.assertIn('distance_km', facilities[0])
        self.assertIn('facility_name', facilities[0])

    def test_emergency_helplines_api(self):
        res = self.client.get('/api/emergency/helplines')
        self.assertEqual(res.status_code, 200)
        helplines = res.get_json()
        self.assertTrue(isinstance(helplines, list))
        self.assertTrue(any(h['number'] == '108' for h in helplines))
        self.assertTrue(any(h['number'] == '102' for h in helplines))
        self.assertTrue(any(h['number'] == '112' for h in helplines))

    def test_create_and_delete_profile(self):
        payload = {
            'full_name': 'Aarti Sharma',
            'abha_number': '14-1122-3344-5566',
            'date_of_birth': '1992-05-18',
            'gender': 'Female',
            'blood_group': 'A+',
            'phone': '+91 98765 00000',
            'district': 'Patna',
            'state': 'Bihar'
        }
        res = self.client.post('/api/profiles', json=payload)
        self.assertEqual(res.status_code, 201)
        new_id = res.get_json()['id']

        # Get profile
        get_res = self.client.get(f'/api/profiles/{new_id}')
        self.assertEqual(get_res.status_code, 200)
        self.assertEqual(get_res.get_json()['full_name'], 'Aarti Sharma')

        # Clean up
        del_res = self.client.delete(f'/api/profiles/{new_id}')
        self.assertEqual(del_res.status_code, 200)

    def test_emergency_card_api(self):
        profiles = self.client.get('/api/profiles').get_json()
        pid = profiles[0]['id']

        res = self.client.get(f'/api/emergency/{pid}')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('profile', data)
        self.assertIn('abha_number', data['profile'])
        self.assertIn('allergies', data)
        self.assertIn('conditions', data)
        self.assertIn('medications', data)

    def test_export_and_import_json(self):
        profiles = self.client.get('/api/profiles').get_json()
        pid = profiles[0]['id']

        export_res = self.client.get(f'/api/export/json/{pid}')
        self.assertEqual(export_res.status_code, 200)
        export_data = export_res.get_json()
        self.assertEqual(export_data['export_version'], '2.0_ABDM_INDIA')

        # Import test
        import_res = self.client.post('/api/import/json', json=export_data)
        self.assertEqual(import_res.status_code, 201)
        imported_id = import_res.get_json()['id']
        self.client.delete(f'/api/profiles/{imported_id}')

    def test_ai_chat_api(self):
        profiles = self.client.get('/api/profiles').get_json()
        pid = profiles[0]['id']

        # Ensure allergy exists for test profile
        self.client.post('/api/allergies', json={
            'profile_id': pid,
            'allergen': 'Penicillin',
            'allergy_type': 'Drug',
            'reaction': 'Anaphylaxis and Severe Hives',
            'severity': 'Severe',
            'notes': 'Do not administer beta-lactams'
        })

        # Query about allergies
        res = self.client.post('/api/ai-chat', json={
            'profile_id': pid,
            'message': 'What are my allergy risks? Is Penicillin safe?'
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('reply', data)
        self.assertIn('context_used', data)
        self.assertIn('suggested_actions', data)
        self.assertIn('Penicillin', data['reply'])

        # Query about vitals / BP
        bp_res = self.client.post('/api/ai-chat', json={
            'profile_id': pid,
            'message': 'Analyze my blood pressure and vitals trend'
        })
        self.assertEqual(bp_res.status_code, 200)
        bp_data = bp_res.get_json()
        self.assertIn('Blood Pressure', bp_data['reply'])


    def test_ai_extract_document_api(self):
        profiles = self.client.get('/api/profiles').get_json()
        pid = profiles[0]['id']

        # Test simulated Blood Report extraction & auto-commit
        res = self.client.post('/api/ai-extract-document', data={
            'profile_id': pid,
            'doc_type': 'lab',
            'notes': 'Complete Blood Count: Hemoglobin 14.2 g/dL, Platelet 245000 /mcL',
            'auto_update': 'true'
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertTrue(data['auto_updated'])
        self.assertGreater(len(data['extracted_labs']), 0)
        self.assertIn('Blood Reports / Lab Tests', data['updated_sections'])

    def test_doctor_card_api(self):
        profiles = self.client.get('/api/profiles').get_json()
        pid = profiles[0]['id']

        res = self.client.get(f'/api/doctor-card/{pid}')
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('profile', data)
        self.assertIn('allergies', data)
        self.assertIn('conditions', data)
        self.assertIn('medications', data)
        self.assertIn('qr_data_string', data)
        self.assertIn('ABDM_EHR_v2', data['qr_data_string'])

    def test_auth_send_and_verify_otp(self):
        # 1. Send OTP
        res = self.client.post('/api/auth/send-otp', json={'phone': '9876543210'})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['phone'], '9876543210')
        self.assertEqual(data['test_otp'], '482910')

        # 2. Verify OTP for existing user
        verify_res = self.client.post('/api/auth/verify-otp', json={'phone': '9876543210', 'otp': '482910'})
        self.assertEqual(verify_res.status_code, 200)
        verify_data = verify_res.get_json()
        self.assertTrue(verify_data['success'])
        self.assertIn('profile', verify_data)

    def test_auth_register_onboard(self):
        # Register a new citizen
        payload = {
            'full_name': 'Ananya Sharma',
            'father_guardian_name': 'Kailash Sharma',
            'date_of_birth': '1996-05-14',
            'gender': 'Female',
            'blood_group': 'O+',
            'phone': '9988776655',
            'aadhaar_last_four': '7823',
            'village_town': 'Rampur',
            'district': 'Varanasi',
            'state': 'Uttar Pradesh',
            'assigned_phc': 'PHC Chandauli'
        }
        res = self.client.post('/api/auth/register-onboard', json=payload)
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['status'], 'REGISTER_SUCCESS')
        self.assertIn('14-', data['profile']['abha_number'])
        self.assertEqual(data['profile']['full_name'], 'Ananya Sharma')

    def test_add_family_member_api(self):
        profiles = self.client.get('/api/profiles').get_json()
        primary_id = profiles[0]['id']

        # Add Spouse to household
        res = self.client.post('/api/profiles/add-family-member', json={
            'primary_profile_id': primary_id,
            'relationship': 'Spouse',
            'full_name': 'Sunita Kumar',
            'date_of_birth': '1984-08-20',
            'gender': 'Female',
            'blood_group': 'A+'
        })
        self.assertEqual(res.status_code, 201)
        data = res.get_json()
        self.assertTrue(data['success'])
        self.assertEqual(data['profile']['relationship_to_primary'], 'Spouse')
        self.assertIn('14-', data['profile']['abha_number'])

if __name__ == '__main__':
    unittest.main()



