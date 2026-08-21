import unittest
import json
import os
import sys

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from database import calculate_bmi, calculate_bp_category, calculate_bmi_category, haversine_distance, init_db, get_db_connection
from app import app

class TestAyushmanABHAHealthSystem(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()
        with app.app_context():
            init_db()

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

if __name__ == '__main__':
    unittest.main()
