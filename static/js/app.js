/**
 * ADHR (Ayushman Digital Health Record) - National Application Controller
 * Features: Real-Time High-Precision GPS Geolocation & Reverse Geocode,
 * Doctor Clinical Access Card (ABDM QR, Allergies & Full Record),
 * AI Health Assistant (Sahayak), Smart Document AI Extraction & Auto-Update,
 * Settings & Language Manager, Senior Mode, Instant Direct Popups
 */

// Global App State
const state = {
  activeProfileId: null,
  profiles: [],
  currentProfile: null,
  activeVitalsMetric: 'bp',
  vitalsData: [],
  labsData: [],
  facilitiesData: [],
  currentFacilityFilter: 'All',
  currentLabFilter: 'All',
  userLocation: {
    lat: 12.9716,
    lon: 77.5946,
    isLiveGPS: false,
    label: 'Acquiring GPS Location...',
    locality: 'Local Area',
    city: 'Bengaluru',
    state: 'Karnataka'
  },
  seniorMode: localStorage.getItem('adhr_senior_mode') === 'true',
  lastAiText: '',
  charts: {
    overview: null,
    detailed: null
  }
};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupIDValidation();
  setupOtpDigitInputs();
  
  // Initialize Senior Citizen Mode
  if (state.seniorMode) {
    document.body.classList.add('senior-mode');
    updateSeniorModeButtonUI();
  }

  // Initialize user language from localStorage
  const savedLang = localStorage.getItem('healthpulse_lang') || 'en';
  setLanguage(savedLang);

  // Check active mobile session
  const userPhone = localStorage.getItem('adhr_user_phone');
  const authStatus = document.getElementById('settingsAuthStatus');
  if (userPhone && authStatus) {
    authStatus.textContent = `Active (+91 ${userPhone})`;
  }

  await loadProfiles();
  
  // Immediately attempt high-precision satellite GPS lock
  requestAccurateGPS();
  
  lucide.createIcons();
});

// ==========================================
// 🛰️ REAL-TIME HIGH-PRECISION GPS & JUMP-FILTERED ENGINE
// ==========================================

let gpsWatchId = null;
let lastAcceptedFix = null;

// Haversine distance helper (in meters)
function computeHaversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Validates whether an incoming GPS fix is high-accuracy and not an erratic jump.
 * Filters out:
 *  1. Inaccurate fixes (accuracy radius > 65m)
 *  2. Unrealistic speed/teleportation jumps (> 45 m/s or > 160 km/h)
 */
function isValidGPSFix(newFix) {
  const MAX_ACCEPTABLE_ACCURACY_METERS = 65; // Discard cell-tower / coarse fixes
  const MAX_REALISTIC_SPEED_MPS = 45;        // Discard sudden 160+ km/h teleport jumps

  // 1. Accuracy Check
  if (newFix.accuracy > MAX_ACCEPTABLE_ACCURACY_METERS) {
    console.warn(`[GPS Filter] Discarded low-accuracy fix: ±${Math.round(newFix.accuracy)}m (Threshold: ${MAX_ACCEPTABLE_ACCURACY_METERS}m)`);
    return false;
  }

  // 2. Jump / Teleportation Check against last accepted fix
  if (lastAcceptedFix) {
    const distanceMeters = computeHaversineMeters(
      lastAcceptedFix.lat, lastAcceptedFix.lon,
      newFix.lat, newFix.lon
    );
    const timeElapsedSec = (newFix.timestamp - lastAcceptedFix.timestamp) / 1000;

    if (timeElapsedSec > 0 && timeElapsedSec < 10) {
      const calculatedSpeed = distanceMeters / timeElapsedSec;
      if (calculatedSpeed > MAX_REALISTIC_SPEED_MPS && distanceMeters > 150) {
        console.warn(`[GPS Filter] Discarded erratic location jump: moved ${Math.round(distanceMeters)}m in ${timeElapsedSec.toFixed(1)}s (Speed: ${Math.round(calculatedSpeed * 3.6)} km/h)`);
        return false;
      }
    }
  }

  return true;
}

async function processGPSUpdate(pos) {
  const lat = pos.coords.latitude;
  const lon = pos.coords.longitude;
  const accuracy = pos.coords.accuracy;
  const timestamp = pos.timestamp || Date.now();

  const newFix = { lat, lon, accuracy, timestamp };

  if (!isValidGPSFix(newFix)) {
    return;
  }

  lastAcceptedFix = newFix;
  state.userLocation.lat = lat;
  state.userLocation.lon = lon;
  state.userLocation.accuracy = Math.round(accuracy);
  state.userLocation.isLiveGPS = true;

  const locSubtitle = document.getElementById('facilitiesLocSubtitle');

  try {
    const res = await fetch(`/api/location/reverse-geocode?lat=${lat}&lon=${lon}`);
    const geoData = await res.json();
    if (geoData.success) {
      state.userLocation.label = geoData.formatted;
      state.userLocation.locality = geoData.locality;
      state.userLocation.city = geoData.city;
      state.userLocation.state = geoData.state;
    } else {
      state.userLocation.label = `Live Satellite GPS (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E &bull; &plusmn;${Math.round(accuracy)}m)`;
    }
  } catch (e) {
    state.userLocation.label = `Live GPS (${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E)`;
  }

  if (locSubtitle) locSubtitle.textContent = state.userLocation.label;

  await loadNearbyFacilities();
  updateSOSModalInfo();
}

function requestAccurateGPS() {
  const locSubtitle = document.getElementById('facilitiesLocSubtitle');
  if (locSubtitle) locSubtitle.textContent = 'Acquiring high-accuracy satellite GPS lock...';

  if (!navigator.geolocation) {
    console.warn('Geolocation is not supported by this browser.');
    loadNearbyFacilities();
    return;
  }

  const geoOptions = {
    enableHighAccuracy: true, // Forces hardware GPS + Wi-Fi/Cellular positioning
    timeout: 15000,           // 15s timeout to allow GPS hardware lock
    maximumAge: 0             // Strictly no stale cached positions
  };

  // Immediate initial fix
  navigator.geolocation.getCurrentPosition(
    processGPSUpdate,
    (err) => {
      console.warn('Initial GPS lock notice:', err.message);
      if (locSubtitle && !state.userLocation.isLiveGPS) {
        locSubtitle.textContent = 'Using default district location (GPS permission required)';
      }
      loadNearbyFacilities();
      updateSOSModalInfo();
    },
    geoOptions
  );

  // Clear any existing watcher and start continuous high-precision GPS lock
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    processGPSUpdate,
    (err) => {
      console.warn('GPS continuous tracker update:', err.code, err.message);
    },
    geoOptions
  );
}
window.requestAccurateGPS = requestAccurateGPS;

// ==========================================
// 🩺 VIBRANT DOCTOR CLINICAL ACCESS CARD ENGINE
// ==========================================

async function loadDoctorCard() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/doctor-card/${state.activeProfileId}`);
    if (!res.ok) throw new Error('Failed to load doctor card.');
    const data = await res.json();
    const p = data.profile;

    // Render Demographics
    const initials = p.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const avatarEl = document.getElementById('docCardAvatar');
    if (avatarEl) avatarEl.textContent = initials;
    
    const nameEl = document.getElementById('docCardName');
    if (nameEl) nameEl.textContent = p.full_name;

    const bloodEl = document.getElementById('docCardBlood');
    if (bloodEl) bloodEl.textContent = p.blood_group || 'B+';

    const abhaEl = document.getElementById('docCardABHA');
    if (abhaEl) abhaEl.textContent = p.abha_number || '14-5234-8901-2345';

    const abhaAddrEl = document.getElementById('docCardABHAAddress');
    if (abhaAddrEl) abhaAddrEl.textContent = p.abha_address || 'citizen@abdm';

    const ageGenEl = document.getElementById('docCardAgeGender');
    if (ageGenEl) ageGenEl.textContent = `${p.age || calculateAge(p.date_of_birth)} Yrs / ${p.gender}`;

    const insEl = document.getElementById('docCardInsurance');
    if (insEl) insEl.textContent = p.ration_card_pmjay_id ? `PM-JAY ${p.ration_card_pmjay_id} (₹5 Lakh Cover)` : 'PM-JAY ₹5,00,000 Cashless Cover Active';

    // 🚨 Critical Allergies List
    const allergyEl = document.getElementById('docCardAllergiesList');
    if (allergyEl) {
      if (data.allergies && data.allergies.length > 0) {
        allergyEl.innerHTML = data.allergies.map(a => `
          <div class="flex items-center gap-1 mt-0.5">
            <span class="px-1.5 py-0.2 bg-red-600 text-white rounded font-black text-[10px] uppercase">${a.severity}</span>
            <strong>${a.allergen}</strong>: ${a.reaction}
          </div>
        `).join('');
      } else {
        allergyEl.innerHTML = '<span class="text-emerald-800 font-semibold">No known drug or food allergies on record.</span>';
      }
    }

    // 🩺 Active Conditions
    const condList = document.getElementById('docCardConditionsList');
    if (condList) {
      if (data.conditions && data.conditions.length > 0) {
        condList.innerHTML = data.conditions.map(c => `
          <li class="p-1.5 bg-white rounded-xl border border-indigo-100 flex items-center justify-between">
            <div>
              <strong class="text-indigo-950">${c.condition_name}</strong>
              <span class="text-[10px] text-slate-500 block">${c.treatment_plan || 'Managed'}</span>
            </div>
            <span class="text-[9px] px-1.5 py-0.2 bg-indigo-100 text-indigo-800 rounded font-bold">${c.status}</span>
          </li>
        `).join('');
      } else {
        condList.innerHTML = '<li class="text-slate-400 italic">No chronic medical conditions documented.</li>';
      }
    }

    // 💊 Active Medications
    const medsList = document.getElementById('docCardMedsList');
    if (medsList) {
      if (data.medications && data.medications.length > 0) {
        medsList.innerHTML = data.medications.map(m => `
          <li class="p-1.5 bg-white rounded-xl border border-teal-100 flex items-center justify-between">
            <div>
              <strong class="text-teal-950">${m.medication_name}</strong>
              <span class="text-[10px] text-slate-500 block">${m.dosage} &bull; ${m.frequency}</span>
            </div>
            <span class="text-[9px] px-1.5 py-0.2 bg-emerald-100 text-emerald-800 rounded font-bold">${m.status}</span>
          </li>
        `).join('');
      } else {
        medsList.innerHTML = '<li class="text-slate-400 italic">No active daily prescriptions.</li>';
      }
    }

    // 💓 Latest Vitals
    const v = data.latest_vital;
    const vitalsEl = document.getElementById('docCardVitalsText');
    if (vitalsEl) {
      if (v) {
        vitalsEl.innerHTML = `
          <div class="grid grid-cols-2 gap-1.5">
            <div class="p-1.5 bg-white rounded-xl border border-rose-100">
              <span class="text-[10px] text-slate-400 block">Blood Pressure:</span>
              <strong class="text-rose-900">${v.systolic || '--'}/${v.diastolic || '--'} mmHg</strong>
            </div>
            <div class="p-1.5 bg-white rounded-xl border border-rose-100">
              <span class="text-[10px] text-slate-400 block">Pulse / Heart Rate:</span>
              <strong class="text-rose-900">${v.heart_rate || '--'} bpm</strong>
            </div>
            <div class="p-1.5 bg-white rounded-xl border border-rose-100">
              <span class="text-[10px] text-slate-400 block">Blood Glucose:</span>
              <strong class="text-rose-900">${v.blood_glucose || '--'} mg/dL (${v.glucose_type || 'Fasting'})</strong>
            </div>
            <div class="p-1.5 bg-white rounded-xl border border-rose-100">
              <span class="text-[10px] text-slate-400 block">Weight & BMI:</span>
              <strong class="text-rose-900">${v.weight || '--'} kg (BMI: ${v.bmi || '--'})</strong>
            </div>
          </div>
        `;
      } else {
        vitalsEl.innerHTML = '<span class="text-slate-400 italic">No vitals logged yet.</span>';
      }
    }

    // 🧪 Recent Diagnostic Labs
    const labsList = document.getElementById('docCardLabsList');
    if (labsList) {
      if (data.lab_results && data.lab_results.length > 0) {
        labsList.innerHTML = data.lab_results.slice(0, 4).map(l => `
          <li class="p-1.5 bg-white rounded-xl border border-amber-100 flex items-center justify-between">
            <div>
              <strong class="text-slate-800">${l.test_name}</strong>
              <span class="text-[10px] text-slate-400 block">${l.test_date}</span>
            </div>
            <div class="text-right">
              <span class="font-black text-slate-900">${l.result_value} ${l.unit || ''}</span>
              <span class="text-[9px] block font-bold ${l.status === 'Normal' ? 'text-emerald-700' : 'text-amber-700'}">${l.status}</span>
            </div>
          </li>
        `).join('');
      } else {
        labsList.innerHTML = '<li class="text-slate-400 italic">No recent lab test records.</li>';
      }
    }

    // High-Density Sharp ABDM Doctor QR Code
    const qrContainer = document.getElementById('doctorCardQRCode');
    if (qrContainer) {
      qrContainer.innerHTML = '';
      new QRCode(qrContainer, {
        text: data.qr_data_string || `ABDM: ${p.abha_number}`,
        width: 74,
        height: 74,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    }

    lucide.createIcons();
  } catch (err) {
    console.error('Error loading doctor card:', err);
  }
}
window.loadDoctorCard = loadDoctorCard;

function openDoctorCardModal() {
  openModal('doctorCardModal');
}
window.openDoctorCardModal = openDoctorCardModal;

// ==========================================
// SENIOR CITIZEN ACCESSIBILITY / MAGNIFICATION MODE
// ==========================================

function toggleSeniorMode() {
  state.seniorMode = !state.seniorMode;
  localStorage.setItem('adhr_senior_mode', state.seniorMode);
  document.body.classList.toggle('senior-mode', state.seniorMode);
  updateSeniorModeButtonUI();
}
window.toggleSeniorMode = toggleSeniorMode;

function updateSeniorModeButtonUI() {
  const btn = document.getElementById('seniorModeToggleBtn');
  if (!btn) return;
  if (state.seniorMode) {
    btn.className = 'flex items-center gap-1 px-2.5 py-1.5 text-xs font-black text-white bg-amber-700 hover:bg-amber-800 border border-amber-800 rounded-xl transition-all shadow-xs shrink-0 cursor-pointer';
    btn.innerHTML = '<i data-lucide="zoom-out" class="w-3.5 h-3.5"></i><span>A- Normal</span>';
  } else {
    btn.className = 'flex items-center gap-1 px-2 py-1.5 text-xs font-black text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition-all shadow-2xs shrink-0 cursor-pointer';
    btn.innerHTML = '<i data-lucide="zoom-in" class="w-3.5 h-3.5 text-amber-600"></i><span>A+ Senior</span>';
  }
  lucide.createIcons();
}

// ==========================================
// EVENT LISTENERS & DELEGATION
// ==========================================

function setupEventListeners() {
  // Global Event Delegation for all 'View All' & navigation trigger buttons
  document.addEventListener('click', (e) => {
    // 1. Close Button Delegation (Works on phone touch & PC mouse click)
    const closeBtn = e.target.closest('[data-close-modal]');
    if (closeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const modalId = closeBtn.getAttribute('data-close-modal');
      if (modalId) {
        closeModal(modalId);
      }
      return;
    }

    // 2. Navigation Target Buttons
    const navBtn = e.target.closest('[data-nav-target]');
    if (navBtn) {
      e.preventDefault();
      const target = navBtn.getAttribute('data-nav-target');
      if (target) {
        const popupMap = {
          'vitals': 'vitalsPopupModal',
          'medications': 'medsPopupModal',
          'labs': 'labsPopupModal',
          'conditions': 'conditionsPopupModal',
          'allergies': 'allergiesPopupModal',
          'vaccines': 'vaccinesPopupModal',
          'visits': 'visitsPopupModal',
          'hospitals': 'hospitalsPopupModal',
          'upload': 'uploadDocAiModal',
          'doctor_card': 'doctorCardModal'
        };
        if (popupMap[target]) {
          openModal(popupMap[target]);
        }
      }
    }

    // 3. Modal Backdrop Click Closes Modal
    if (e.target.classList.contains('modal-backdrop')) {
      closeModal(e.target.id);
    }
  });

  // Global ESC Key Listener to Close Modals on PC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      closeAllModals();
    }
  });

  // Profile dropdown toggle
  const profDropdownBtn = document.getElementById('profileDropdownBtn');
  const profDropdownMenu = document.getElementById('profileDropdownMenu');
  if (profDropdownBtn && profDropdownMenu) {
    profDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profDropdownMenu.classList.toggle('hidden');
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    profDropdownMenu?.classList.add('hidden');
    document.getElementById('abhaSearchResults')?.classList.add('hidden');
    document.getElementById('mobileAbhaSearchResults')?.classList.add('hidden');
  });

  // Add new profile button
  const addNewProfileBtn = document.getElementById('addNewProfileBtn');
  if (addNewProfileBtn) {
    addNewProfileBtn.addEventListener('click', () => {
      document.getElementById('profileForm').reset();
      document.getElementById('profFormId').value = '';
      document.getElementById('profileModalTitle').textContent = 'Add Individual / ABHA Profile';
      document.getElementById('deleteProfileBtn').classList.add('hidden');
      openModal('profileModal');
    });
  }

  // Desktop Search
  const searchInput = document.getElementById('globalSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
      const val = e.target.value.trim();
      if (clearSearchBtn) clearSearchBtn.classList.toggle('hidden', !val);
      await handleAbhaSearch(val, 'abhaSearchResults');
    });
  }
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearSearchBtn.classList.add('hidden');
      document.getElementById('abhaSearchResults')?.classList.add('hidden');
    });
  }

  // Mobile Search
  const mobileSearchInput = document.getElementById('mobileGlobalSearchInput');
  const mobileClearSearchBtn = document.getElementById('mobileClearSearchBtn');
  if (mobileSearchInput) {
    mobileSearchInput.addEventListener('input', async (e) => {
      const val = e.target.value.trim();
      if (mobileClearSearchBtn) mobileClearSearchBtn.classList.toggle('hidden', !val);
      await handleAbhaSearch(val, 'mobileAbhaSearchResults');
    });
  }
  if (mobileClearSearchBtn) {
    mobileClearSearchBtn.addEventListener('click', () => {
      mobileSearchInput.value = '';
      mobileClearSearchBtn.classList.add('hidden');
      document.getElementById('mobileAbhaSearchResults')?.classList.add('hidden');
    });
  }

  // Pre-fill datetime inputs with current time
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16);
  const vitalDateInput = document.getElementById('vitalFormDate');
  if (vitalDateInput) vitalDateInput.value = dateStr;
  
  const todayStr = now.toISOString().slice(0, 10);
  ['labFormDate', 'vacFormDate', 'visitFormDate', 'visitFormFollowUp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = todayStr;
  });
}

// ==========================================
// STRICT ID & NUMERIC INPUT VALIDATION
// ==========================================

function setupIDValidation() {
  const abhaInput = document.getElementById('profFormABHANumber');
  if (abhaInput) {
    abhaInput.addEventListener('input', (e) => {
      let raw = e.target.value.replace(/\D/g, '').substring(0, 14);
      let formatted = '';
      if (raw.length > 0) formatted += raw.substring(0, 2);
      if (raw.length > 2) formatted += '-' + raw.substring(2, 6);
      if (raw.length > 6) formatted += '-' + raw.substring(6, 10);
      if (raw.length > 10) formatted += '-' + raw.substring(10, 14);
      e.target.value = formatted;
    });
  }

  ['profFormPhone', 'profFormAadhaar', 'profFormECPhone', 'vitalFormSys', 'vitalFormDia', 'vitalFormHR'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
      });
    }
  });
}

function changeAppLanguage(langCode) {
  setLanguage(langCode);
  closeModal('settingsModal');
  
  // Highlight active language button in settings modal
  document.querySelectorAll('.lang-select-option').forEach(btn => {
    if (btn.getAttribute('data-lang') === langCode) {
      btn.className = 'lang-select-option text-left px-3 py-2 rounded-xl font-bold text-emerald-800 border border-emerald-200 bg-white shadow-2xs';
    } else {
      btn.className = 'lang-select-option text-left px-3 py-2 rounded-xl hover:bg-white text-slate-700';
    }
  });

  if (state.activeProfileId) {
    loadOverview();
  }
}
window.changeAppLanguage = changeAppLanguage;

// ==========================================
// MODAL & POPUP MANAGEMENT WITH AUTO DATA FETCH
// ==========================================

function updateActiveNavTab(activeModalId) {
  const tabMapping = {
    'vitalsPopupModal': 'vitals',
    'addVitalModal': 'vitals',
    'doctorCardModal': 'doctor_card',
    'emergencySOSModal': 'sos',
    'hospitalsPopupModal': 'hospitals',
    'aiChatModal': 'ai'
  };

  const activeKey = activeModalId ? tabMapping[activeModalId] || null : null;
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    const key = btn.getAttribute('data-tab-key');
    if (activeKey && key === activeKey) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}
window.updateActiveNavTab = updateActiveNavTab;

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    updateActiveNavTab(modalId);

    const scrollContainer = modal.querySelector('.modal-body') || modal.querySelector('.modal-content-card') || modal;
    if (scrollContainer) {
      scrollContainer.scrollTop = 0;
    }

    // Auto-fetch and render data on direct popup open (safely isolated)
    try {
      if (modalId === 'labsPopupModal') loadLabs();
      else if (modalId === 'conditionsPopupModal') loadConditions();
      else if (modalId === 'allergiesPopupModal') loadAllergies();
      else if (modalId === 'vitalsPopupModal') loadVitals();
      else if (modalId === 'medsPopupModal') loadMedications();
      else if (modalId === 'hospitalsPopupModal') loadNearbyFacilities();
      else if (modalId === 'vaccinesPopupModal') loadVaccines();
      else if (modalId === 'visitsPopupModal') loadVisits();
      else if (modalId === 'emergencySOSModal') updateSOSModalInfo();
      else if (modalId === 'doctorCardModal') loadDoctorCard();
      else if (modalId === 'familyVaultModal') renderFamilyVault();
    } catch (err) {
      console.warn('Auto data fetch notice for modal ' + modalId, err);
    }

    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch (e) {}
    }
  } else {
    console.error('Modal with id ' + modalId + ' not found in DOM');
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
  }
  const anyOpen = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!anyOpen) {
    document.body.classList.remove('modal-open');
    updateActiveNavTab(null);
  } else {
    updateActiveNavTab(anyOpen.id);
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.add('hidden'));
  document.body.classList.remove('modal-open');
  updateActiveNavTab(null);
}
window.closeAllModals = closeAllModals;
window.openModal = openModal;
window.closeModal = closeModal;

function updateSOSModalInfo() {
  const coordsEl = document.getElementById('sosCoordsLabel');
  const locEl = document.getElementById('sosLocationText');
  
  if (coordsEl) {
    coordsEl.textContent = `${state.userLocation.lat.toFixed(4)}° N, ${state.userLocation.lon.toFixed(4)}° E`;
  }
  
  if (locEl) {
    let nearestText = 'Nearest Hospital: 0.8 km';
    if (state.facilitiesData && state.facilitiesData.length > 0) {
      const closest = state.facilitiesData[0];
      nearestText = `Nearest: ${closest.facility_name} (${closest.distance_km} km away)`;
    }
    locEl.innerHTML = `<i data-lucide="map-pin" class="w-4 h-4 text-red-600 shrink-0 mt-0.5"></i><span><strong>${state.userLocation.label}</strong><br><span class="text-red-700 font-bold text-[11px]">${nearestText}</span></span>`;
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { lucide.createIcons(); } catch (e) {}
    }
  }
}

function open108SOSModal() {
  updateSOSModalInfo();
  openModal('emergencySOSModal');
}
window.open108SOSModal = open108SOSModal;
window.closeModal = closeModal;

// ==========================================
// 📄 SMART DOCUMENT UPLOAD & AI OCR EXTRACTION
// ==========================================

function previewSelectedDoc(e) {
  const file = e.target.files[0];
  const badge = document.getElementById('selectedDocNameBadge');
  if (file && badge) {
    badge.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    badge.classList.remove('hidden');
  }
}
window.previewSelectedDoc = previewSelectedDoc;

async function handleAiDocUpload(e) {
  e.preventDefault();
  if (!state.activeProfileId) {
    alert('Please select an active profile first.');
    return;
  }

  const fileInput = document.getElementById('aiDocFileInput');
  const docType = document.getElementById('aiDocCategory').value;
  const notes = document.getElementById('aiDocNotes').value;
  const autoCommit = document.getElementById('aiAutoCommitCheck').checked;

  if (!fileInput.files[0] && !notes.trim()) {
    alert('Please choose a file to upload or enter report notes/text.');
    return;
  }

  const submitBtn = document.getElementById('aiDocSubmitBtn');
  const progressEl = document.getElementById('aiScanProgress');
  const resultArea = document.getElementById('aiExtractionResultArea');
  const recordsList = document.getElementById('extractedRecordsList');

  submitBtn.disabled = true;
  progressEl.classList.remove('hidden');
  resultArea.classList.add('hidden');

  const formData = new FormData();
  formData.append('profile_id', state.activeProfileId);
  formData.append('doc_type', docType);
  formData.append('notes', notes);
  formData.append('auto_update', autoCommit ? 'true' : 'false');
  if (fileInput.files[0]) {
    formData.append('file', fileInput.files[0]);
  }

  try {
    const res = await fetch('/api/ai-extract-document', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    progressEl.classList.add('hidden');
    submitBtn.disabled = false;

    if (!res.ok || data.error) {
      throw new Error(data.error || 'Failed to extract document.');
    }

    // Render Extracted Information
    document.getElementById('extractedCategoryBadge').textContent = data.detected_category;
    let html = '';

    if (data.extracted_labs && data.extracted_labs.length > 0) {
      html += `<div class="font-bold text-slate-900 mb-1">🧪 Blood & Lab Test Parameters Extracted:</div>`;
      data.extracted_labs.forEach(l => {
        html += `
          <div class="flex items-center justify-between p-2 bg-white rounded-xl border border-slate-200">
            <div>
              <span class="font-bold text-slate-800">${l.test_name}</span>
              <span class="text-[10px] text-slate-400 block">${l.category} &bull; Ref: ${l.reference_range}</span>
            </div>
            <div class="text-right">
              <span class="font-black text-slate-900">${l.result_value} ${l.unit}</span>
              <span class="text-[9px] font-bold px-1.5 py-0.2 rounded block bg-emerald-100 text-emerald-800">${l.status}</span>
            </div>
          </div>
        `;
      });
    }

    if (data.extracted_meds && data.extracted_meds.length > 0) {
      html += `<div class="font-bold text-slate-900 mb-1 mt-2">💊 Prescriptions Extracted:</div>`;
      data.extracted_meds.forEach(m => {
        html += `
          <div class="p-2 bg-white rounded-xl border border-slate-200">
            <div class="font-bold text-teal-900">${m.medication_name} ${m.dosage} (${m.form})</div>
            <div class="text-[10px] text-slate-500">${m.frequency} &bull; ${m.instructions}</div>
          </div>
        `;
      });
    }

    recordsList.innerHTML = html;
    resultArea.classList.remove('hidden');

    // Auto Refresh relevant sections in background
    await loadOverview();
    await loadLabs();
    await loadMedications();
    await loadVitals();

    lucide.createIcons();

  } catch (err) {
    progressEl.classList.add('hidden');
    submitBtn.disabled = false;
    alert('Document processing error: ' + err.message);
  }
}
window.handleAiDocUpload = handleAiDocUpload;

// ==========================================
// ✨ ADHR AI HEALTH SAHAYAK (CHATBOT) ENGINE
// ==========================================

function openAIChatModal() {
  openModal('aiChatModal');
}
window.openAIChatModal = openAIChatModal;

function sendAiPrompt(promptText) {
  const input = document.getElementById('aiQueryInput');
  if (input) {
    input.value = promptText;
    document.getElementById('aiChatForm')?.dispatchEvent(new Event('submit'));
  }
}
window.sendAiPrompt = sendAiPrompt;

async function handleSendAiMessage(e) {
  e.preventDefault();
  const input = document.getElementById('aiQueryInput');
  const query = input.value.trim();
  if (!query || !state.activeProfileId) return;

  const chatStream = document.getElementById('aiChatStream');
  
  // Render user question bubble
  chatStream.innerHTML += `
    <div class="chat-bubble-user p-3 max-w-[85%] shadow-2xs">
      <p class="font-medium text-white">${escapeHTML(query)}</p>
    </div>
  `;
  
  // Clear input & scroll down
  input.value = '';
  chatStream.scrollTop = chatStream.scrollHeight;

  // Add Thinking indicator
  const thinkingId = 'thinking-' + Date.now();
  chatStream.innerHTML += `
    <div id="${thinkingId}" class="chat-bubble-ai p-3 max-w-[85%] flex items-center gap-2 text-slate-500 shadow-2xs">
      <i data-lucide="sparkles" class="w-4 h-4 text-emerald-600 animate-spin"></i>
      <span class="animate-pulse">Analyzing clinical vitals, meds & allergies...</span>
    </div>
  `;
  lucide.createIcons();
  chatStream.scrollTop = chatStream.scrollHeight;

  try {
    const res = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile_id: state.activeProfileId,
        message: query,
        lang: currentLang || 'en'
      })
    });
    
    const data = await res.json();
    document.getElementById(thinkingId)?.remove();

    if (data.error) throw new Error(data.error);

    state.lastAiText = data.reply.replace(/###|\*\*|__|💡|⚠️|🛡️|💓|💊|🧪|🏥|👓|✅|⏳/g, '').trim();

    // Render AI Reply with Context Badges & Suggested Action Buttons
    let actionsHtml = '';
    if (data.suggested_actions && data.suggested_actions.length > 0) {
      actionsHtml = `
        <div class="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t border-slate-200/60">
          ${data.suggested_actions.map(act => `
            <button onclick="${act.action}('${act.target || ''}')" class="px-2.5 py-1 text-[11px] font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg border border-emerald-200 transition-all cursor-pointer">
              ${act.title}
            </button>
          `).join('')}
        </div>
      `;
    }

    let contextHtml = '';
    if (data.context_used && data.context_used.length > 0) {
      contextHtml = `
        <div class="mt-2 text-[10px] text-slate-400 font-medium">
          <strong>Context Evaluated:</strong> ${data.context_used.slice(0, 3).join(' • ')}
        </div>
      `;
    }

    chatStream.innerHTML += `
      <div class="chat-bubble-ai p-3.5 max-w-[92%] shadow-xs">
        <div class="flex items-center justify-between mb-1.5 text-emerald-800 font-bold text-xs">
          <span class="flex items-center gap-1"><i data-lucide="sparkles" class="w-3.5 h-3.5"></i> ADHR AI Sahayak</span>
          <button onclick="speakText('${escapeQuotes(state.lastAiText)}')" title="Voice Readout" class="p-1 text-slate-400 hover:text-emerald-700 rounded"><i data-lucide="volume-2" class="w-3.5 h-3.5"></i></button>
        </div>
        <div class="prose prose-xs text-slate-800 font-normal leading-relaxed">
          ${renderMarkdown(data.reply)}
        </div>
        ${contextHtml}
        ${actionsHtml}
      </div>
    `;

    lucide.createIcons();
    chatStream.scrollTop = chatStream.scrollHeight;

  } catch (err) {
    document.getElementById(thinkingId)?.remove();
    chatStream.innerHTML += `
      <div class="chat-bubble-ai p-3 max-w-[85%] text-red-600 border border-red-200 shadow-2xs">
        Error getting response: ${err.message}
      </div>
    `;
    chatStream.scrollTop = chatStream.scrollHeight;
  }
}
window.handleSendAiMessage = handleSendAiMessage;

// ==========================================
// 🎙️ AI SAHAYAK VOICE SPEECH RECOGNITION (STT) & SPEECH SYNTHESIS (TTS)
// ==========================================

let recognitionInstance = null;
let isVoiceListening = false;

function toggleVoiceSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert('Voice speech recognition is not supported in this browser. You can type your query in the chat box!');
    return;
  }

  const voiceBtn = document.getElementById('aiVoiceInputBtn');
  const voiceText = document.getElementById('aiVoiceBtnText');
  const listeningIndicator = document.getElementById('aiVoiceListeningIndicator');
  const queryInput = document.getElementById('aiQueryInput');

  if (isVoiceListening && recognitionInstance) {
    recognitionInstance.stop();
    isVoiceListening = false;
    if (voiceBtn) voiceBtn.classList.remove('voice-mic-active');
    if (voiceText) voiceText.textContent = 'Speak';
    if (listeningIndicator) listeningIndicator.classList.add('hidden');
    return;
  }

  try {
    recognitionInstance = new SpeechRecognition();
    recognitionInstance.lang = currentLang === 'hi' ? 'hi-IN' : 'en-IN';
    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = true;

    recognitionInstance.onstart = () => {
      isVoiceListening = true;
      if (voiceBtn) voiceBtn.classList.add('voice-mic-active');
      if (voiceText) voiceText.textContent = 'Listening...';
      if (listeningIndicator) listeningIndicator.classList.remove('hidden');
    };

    recognitionInstance.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        transcript += event.results[i][0].transcript;
      }
      if (queryInput) queryInput.value = transcript;
    };

    recognitionInstance.onerror = (event) => {
      console.warn('Speech recognition error:', event.error);
      isVoiceListening = false;
      if (voiceBtn) voiceBtn.classList.remove('voice-mic-active');
      if (voiceText) voiceText.textContent = 'Speak';
      if (listeningIndicator) listeningIndicator.classList.add('hidden');
    };

    recognitionInstance.onend = () => {
      isVoiceListening = false;
      if (voiceBtn) voiceBtn.classList.remove('voice-mic-active');
      if (voiceText) voiceText.textContent = 'Speak';
      if (listeningIndicator) listeningIndicator.classList.add('hidden');
      
      // Auto-submit recognized speech query
      if (queryInput && queryInput.value.trim().length > 2) {
        document.getElementById('aiChatForm')?.dispatchEvent(new Event('submit'));
      }
    };

    recognitionInstance.start();
  } catch (err) {
    console.error('Error starting speech recognition:', err);
    isVoiceListening = false;
    if (voiceBtn) voiceBtn.classList.remove('voice-mic-active');
    if (listeningIndicator) listeningIndicator.classList.add('hidden');
  }
}
window.toggleVoiceSpeechRecognition = toggleVoiceSpeechRecognition;

// Text-to-Speech for Senior Citizens & Voice AI
function speakLastAIResponse() {
  if (state.lastAiText) {
    speakText(state.lastAiText);
  } else {
    speakText("Namaste. I am your ADHR AI Health Assistant. How may I help you today?");
  }
}
window.speakLastAIResponse = speakLastAIResponse;

function speakText(text) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/[*_#>]/g, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 0.95;
    utterance.lang = currentLang === 'hi' ? 'hi-IN' : 'en-IN';
    window.speechSynthesis.speak(utterance);
  }
}
window.speakText = speakText;

// ==========================================
// 🔐 MOBILE OTP AUTHENTICATION & ONBOARDING CONTROLLER
// ==========================================

function showAuthStep(stepNumber) {
  document.getElementById('authStep1Phone')?.classList.toggle('hidden', stepNumber !== 1);
  document.getElementById('authStep2Otp')?.classList.toggle('hidden', stepNumber !== 2);
  document.getElementById('authStep3Register')?.classList.toggle('hidden', stepNumber !== 3);
  lucide.createIcons();
}
window.showAuthStep = showAuthStep;

function fillDemoPhone(phone) {
  const input = document.getElementById('authMobileInput');
  if (input) {
    input.value = phone;
  }
}
window.fillDemoPhone = fillDemoPhone;

function autoFillOtp() {
  const code = document.getElementById('simulatedOtpCode')?.textContent || '482910';
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById(`otp${i}`);
    if (el) el.value = code[i - 1] || '';
  }
  document.getElementById('authOtpForm')?.dispatchEvent(new Event('submit'));
}
window.autoFillOtp = autoFillOtp;

function setupOtpDigitInputs() {
  for (let i = 1; i <= 6; i++) {
    const input = document.getElementById(`otp${i}`);
    if (input) {
      input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val.slice(0, 1);
        if (val && i < 6) {
          document.getElementById(`otp${i + 1}`)?.focus();
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value && i > 1) {
          document.getElementById(`otp${i - 1}`)?.focus();
        }
      });
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
        for (let j = 0; j < pasted.length; j++) {
          const target = document.getElementById(`otp${j + 1}`);
          if (target) target.value = pasted[j];
        }
        if (pasted.length === 6) {
          document.getElementById('otp6')?.focus();
        }
      });
    }
  }
}

async function handleSendAuthOtp(e) {
  e.preventDefault();
  const phone = document.getElementById('authMobileInput').value.trim();
  if (phone.length !== 10) {
    alert('Please enter a valid 10-digit mobile number.');
    return;
  }

  const btn = document.getElementById('authGetOtpBtn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to send OTP');

    // Update OTP prompt step
    const subtext = document.getElementById('authOtpSubtext');
    if (subtext) subtext.textContent = `Sent via SMS to +91 ${phone}`;

    const simCode = document.getElementById('simulatedOtpCode');
    if (simCode) simCode.textContent = data.test_otp || '482910';

    showAuthStep(2);
    setTimeout(() => document.getElementById('otp1')?.focus(), 150);
  } catch (err) {
    alert('OTP Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}
window.handleSendAuthOtp = handleSendAuthOtp;

async function handleVerifyAuthOtp(e) {
  e.preventDefault();
  const phone = document.getElementById('authMobileInput').value.trim();
  let otp = '';
  for (let i = 1; i <= 6; i++) {
    otp += (document.getElementById(`otp${i}`)?.value || '');
  }

  if (otp.length !== 6) {
    alert('Please enter the 6-digit OTP code.');
    return;
  }

  const btn = document.getElementById('authVerifyOtpBtn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Verification failed');

    if (data.status === 'LOGIN_SUCCESS') {
      localStorage.setItem('adhr_auth_token', data.token);
      localStorage.setItem('adhr_user_phone', phone);
      
      const authStatus = document.getElementById('settingsAuthStatus');
      if (authStatus) authStatus.textContent = `Active (+91 ${phone})`;

      closeModal('authOnboardingModal');
      await loadProfiles();
      selectProfile(data.profile.id);
    } else if (data.status === 'NEW_USER') {
      showAuthStep(3);
    }
  } catch (err) {
    alert('OTP Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}
window.handleVerifyAuthOtp = handleVerifyAuthOtp;

async function handleCompleteRegistration(e) {
  e.preventDefault();
  const phone = document.getElementById('authMobileInput').value.trim();
  const payload = {
    full_name: document.getElementById('regFullName').value.trim(),
    father_guardian_name: document.getElementById('regFatherName').value.trim(),
    date_of_birth: document.getElementById('regDOB').value,
    gender: document.getElementById('regGender').value,
    blood_group: document.getElementById('regBlood').value,
    phone: phone,
    aadhaar_last_four: document.getElementById('regAadhaar').value.trim(),
    assigned_phc: document.getElementById('regPHC').value.trim() || 'Primary Health Centre (PHC)',
    village_town: document.getElementById('regVillage').value.trim(),
    district: document.getElementById('regDistrict').value.trim() || 'Varanasi',
    state: document.getElementById('regState').value.trim() || 'Uttar Pradesh',
    emergency_contact_name: document.getElementById('regECName').value.trim(),
    emergency_contact_phone: document.getElementById('regECPhone').value.trim(),
    organ_donor: document.getElementById('regOrganDonor').checked
  };

  const btn = document.getElementById('authRegisterSubmitBtn');
  btn.disabled = true;

  try {
    const res = await fetch('/api/auth/register-onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    localStorage.setItem('adhr_auth_token', data.token);
    localStorage.setItem('adhr_user_phone', phone);

    closeModal('authOnboardingModal');
    await loadProfiles();
    selectProfile(data.profile.id);
  } catch (err) {
    alert('Registration Error: ' + err.message);
  } finally {
    btn.disabled = false;
  }
}
window.handleCompleteRegistration = handleCompleteRegistration;

function handleLogout() {
  if (confirm('Are you sure you want to log out from this session?')) {
    localStorage.removeItem('adhr_auth_token');
    localStorage.removeItem('adhr_user_phone');
    closeModal('settingsModal');
    showAuthStep(1);
    openModal('authOnboardingModal');
  }
}
window.handleLogout = handleLogout;

// ==========================================
// 👨‍👩‍👧‍👦 FAMILY VAULT & RELATIONSHIPS CONTROLLER
// ==========================================

function selectFamilyRelation(rel, el) {
  document.getElementById('famMemberRelation').value = rel;
  document.querySelectorAll('.family-relation-chip').forEach(chip => chip.classList.remove('selected'));
  if (el) el.classList.add('selected');
}
window.selectFamilyRelation = selectFamilyRelation;

async function handleSaveFamilyMember(e) {
  e.preventDefault();
  const payload = {
    primary_profile_id: state.activeProfileId,
    relationship: document.getElementById('famMemberRelation').value,
    full_name: document.getElementById('famMemberName').value.trim(),
    father_guardian_name: document.getElementById('famMemberFather').value.trim(),
    date_of_birth: document.getElementById('famMemberDOB').value,
    gender: document.getElementById('famMemberGender').value,
    blood_group: document.getElementById('famMemberBlood').value,
    phone: document.getElementById('famMemberPhone').value.trim(),
    aadhaar_last_four: document.getElementById('famMemberAadhaar').value.trim()
  };

  try {
    const res = await fetch('/api/profiles/add-family-member', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to add family member');

    closeModal('addFamilyMemberModal');
    document.getElementById('familyMemberForm').reset();
    await loadProfiles();
    renderFamilyVault();
    openModal('familyVaultModal');
  } catch (err) {
    alert('Family Member Error: ' + err.message);
  }
}
window.handleSaveFamilyMember = handleSaveFamilyMember;

function renderFamilyVault() {
  const container = document.getElementById('familyVaultMembersList');
  if (!container) return;

  if (!state.profiles || state.profiles.length === 0) {
    container.innerHTML = '<div class="col-span-full py-6 text-center text-slate-400">No family members registered yet.</div>';
    return;
  }

  container.innerHTML = state.profiles.map(p => {
    const initials = p.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const isCurrent = p.id === state.activeProfileId;
    const relationBadge = p.relationship_to_primary || (p.is_primary ? 'Self (Primary)' : 'Family Member');

    return `
      <div class="p-3.5 bg-white rounded-2xl border ${isCurrent ? 'border-emerald-400 ring-2 ring-emerald-500/20' : 'border-slate-200'} shadow-2xs flex items-center justify-between gap-3 hover:shadow-md transition-all">
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-indigo-600 text-white font-black text-sm flex items-center justify-center shrink-0 shadow-xs">
            ${initials}
          </div>
          <div class="min-w-0 truncate">
            <div class="flex items-center gap-1.5">
              <strong class="text-xs sm:text-sm text-slate-900 truncate">${p.full_name}</strong>
              <span class="px-1.5 py-0.2 bg-purple-100 text-purple-800 font-bold text-[9px] rounded">${relationBadge}</span>
            </div>
            <div class="text-[10px] text-slate-400 font-mono mt-0.5 truncate">ABHA: ${p.abha_number || '14-XXXX-XXXX'}</div>
            <div class="text-[10px] text-slate-500">${p.age || calculateAge(p.date_of_birth)} Yrs &bull; ${p.gender} &bull; ${p.blood_group || 'B+'}</div>
          </div>
        </div>
        <button onclick="selectProfile(${p.id}); closeModal('familyVaultModal');" class="px-2.5 py-1 text-xs font-bold rounded-xl transition-all shrink-0 cursor-pointer ${isCurrent ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 border border-slate-200'}">
          ${isCurrent ? 'Active' : 'Switch'}
        </button>
      </div>
    `;
  }).join('');
}
window.renderFamilyVault = renderFamilyVault;

// Simple Markdown parser for AI response rendering
function renderMarkdown(md) {
  return md
    .replace(/^### (.*$)/gim, '<h4 class="font-bold text-slate-900 text-sm mt-1 mb-0.5">$1</h4>')
    .replace(/^#### (.*$)/gim, '<h5 class="font-bold text-slate-800 text-xs mt-1">$1</h5>')
    .replace(/^> (.*$)/gim, '<blockquote class="p-2 my-1 bg-red-50 border-l-3 border-red-500 rounded text-red-900 font-semibold text-xs">$1</blockquote>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/^\- (.*$)/gim, '<li class="ml-3 list-disc text-xs">$1</li>')
    .replace(/\n\n/gim, '<br>');
}

function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeQuotes(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// ==========================================
// CALENDAR & DEVICE REMINDERS SYNC ENGINE
// ==========================================

function openCalendarSyncModal(title, dateStr, location, details) {
  document.getElementById('calModalTitle').textContent = title;
  document.getElementById('calModalDate').textContent = dateStr;
  document.getElementById('calModalDetails').textContent = `${location ? location + ' • ' : ''}${details || 'Ayushman Health Record Reminder'}`;

  const gBtn = document.getElementById('calGoogleBtn');
  if (gBtn) {
    gBtn.onclick = () => {
      addToGoogleCalendar(title, dateStr, location, details);
      closeModal('calendarSyncModal');
    };
  }

  const aBtn = document.getElementById('calAppleBtn');
  if (aBtn) {
    aBtn.onclick = () => {
      downloadICalFile(title, dateStr, location, details);
      closeModal('calendarSyncModal');
    };
  }

  openModal('calendarSyncModal');
}
window.openCalendarSyncModal = openCalendarSyncModal;

function addToGoogleCalendar(title, dateStr, location, details) {
  const cleanDate = dateStr.replace(/-/g, '');
  const startTime = `${cleanDate}T090000Z`;
  const endTime = `${cleanDate}T100000Z`;

  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${startTime}/${endTime}&details=${encodeURIComponent(details || 'Scheduled via ADHR')}&location=${encodeURIComponent(location || 'Health Facility')}&sf=true&output=xml`;
  
  window.open(url, '_blank');
}

function downloadICalFile(title, dateStr, location, details) {
  const cleanDate = dateStr.replace(/-/g, '');
  const startTime = `${cleanDate}T090000Z`;
  const endTime = `${cleanDate}T100000Z`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//National Health Authority//ADHR//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:adhr-${Date.now()}@abdm.gov.in`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${startTime}`,
    `DTEND:${endTime}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${(details || 'ADHR Scheduled Care').replace(/\n/g, '\\n')}`,
    `LOCATION:${location || 'Health Centre'}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder for Scheduled Healthcare Event',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const link = document.createElement('a');
  link.href = window.URL.createObjectURL(blob);
  link.setAttribute('download', `${title.replace(/\s+/g, '_')}_${cleanDate}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function openExternalMapsSearch(query) {
  const lat = state.userLocation.lat;
  const lon = state.userLocation.lon;
  const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}&center=${lat},${lon}`;
  window.open(url, '_blank');
}
window.openExternalMapsSearch = openExternalMapsSearch;

// ==========================================
// PROFILES API & ABHA MANAGEMENT
// ==========================================

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    state.profiles = await res.json();

    if (state.profiles.length === 0) return;

    if (!state.activeProfileId) {
      const primary = state.profiles.find(p => p.is_primary) || state.profiles[0];
      state.activeProfileId = primary.id;
    }

    renderProfileDropdown();
    selectProfile(state.activeProfileId);
  } catch (err) {
    console.error('Failed to load profiles:', err);
  }
}

function renderProfileDropdown() {
  const container = document.getElementById('profileListDropdown');
  if (!container) return;

  container.innerHTML = state.profiles.map(p => {
    const initials = p.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const isSelected = p.id === state.activeProfileId;
    return `
      <button onclick="selectProfile(${p.id})" class="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 transition-colors ${isSelected ? 'bg-emerald-50 font-bold text-emerald-900' : 'text-slate-700'}">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-md bg-emerald-700 text-white flex items-center justify-center font-black text-[10px]">
            ${initials}
          </div>
          <div class="text-left">
            <div class="truncate max-w-[130px] font-bold">${p.full_name}</div>
            <div class="text-[10px] text-slate-400 font-mono">${p.abha_number || 'ABHA: N/A'}</div>
          </div>
        </div>
        ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-600"></i>' : ''}
      </button>
    `;
  }).join('');

  lucide.createIcons();
}

async function selectProfile(profileId) {
  state.activeProfileId = profileId;
  state.currentProfile = state.profiles.find(p => p.id === profileId);

  renderProfileDropdown();
  updateHeroDemographics();
  loadOverview();
}
window.selectProfile = selectProfile;

function updateHeroDemographics() {
  const p = state.currentProfile;
  if (!p) return;

  const initials = p.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  document.getElementById('headerAvatar').textContent = initials;
  document.getElementById('headerProfileName').textContent = p.full_name;

  document.getElementById('heroAvatar').textContent = initials;
  document.getElementById('heroName').textContent = p.full_name;
  document.getElementById('heroPrimaryBadge').classList.toggle('hidden', !p.is_primary);
  document.getElementById('heroBloodGroup').textContent = p.blood_group || 'Unknown';
  document.getElementById('heroABHANumber').textContent = p.abha_number || '14-XXXX-XXXX-XXXX';
  document.getElementById('heroABHAAddress').textContent = p.abha_address || 'citizen@abdm';
  document.getElementById('heroPMJAY').textContent = p.ration_card_pmjay_id ? `PM-JAY: ${p.ration_card_pmjay_id}` : 'PM-JAY ₹5L Cover';
  document.getElementById('heroDOB').textContent = p.date_of_birth;
  document.getElementById('heroAge').textContent = p.age ?? calculateAge(p.date_of_birth);
  document.getElementById('heroGender').textContent = p.gender;
  document.getElementById('heroPHC').textContent = p.assigned_phc || 'Primary Health Centre';
  document.getElementById('heroLocation').textContent = `${p.district || 'Varanasi'}, ${p.state || 'UP'}`;
}

// Live Search for ABHA ID
async function handleAbhaSearch(query, resultContainerId) {
  const resultsContainer = document.getElementById(resultContainerId);
  if (!resultsContainer) return;

  if (!query || query.length < 2) {
    resultsContainer.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/abha/lookup?query=${encodeURIComponent(query)}`);
    const matches = await res.json();

    if (matches.length === 0) {
      resultsContainer.innerHTML = '<div class="px-4 py-3 text-xs text-slate-400 text-center">No ABHA citizen record found.</div>';
    } else {
      resultsContainer.innerHTML = matches.map(m => `
        <button onclick="selectProfile(${m.id}); document.getElementById('${resultContainerId}').classList.add('hidden');" class="w-full text-left px-3 py-2 hover:bg-emerald-50 border-b border-slate-100 last:border-0 flex items-center justify-between">
          <div>
            <div class="text-xs font-bold text-slate-900">${m.full_name}</div>
            <div class="text-[10px] text-slate-500 font-mono">ABHA: <strong class="text-emerald-700">${m.abha_number}</strong> &bull; ${m.phone || 'No phone'}</div>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 bg-slate-100 rounded-md text-slate-600">${m.district || 'India'}</span>
        </button>
      `).join('');
    }
    resultsContainer.classList.remove('hidden');
  } catch (err) {
    console.error('Search error:', err);
  }
}

function openEditProfileModal() {
  const p = state.currentProfile;
  if (!p) return;

  document.getElementById('profFormId').value = p.id;
  document.getElementById('profFormName').value = p.full_name;
  document.getElementById('profFormABHANumber').value = p.abha_number || '';
  document.getElementById('profFormABHAAddress').value = p.abha_address || '';
  document.getElementById('profFormDOB').value = p.date_of_birth;
  document.getElementById('profFormGender').value = p.gender;
  document.getElementById('profFormBlood').value = p.blood_group || 'B+';
  document.getElementById('profFormPhone').value = p.phone || '';
  document.getElementById('profFormAadhaar').value = p.aadhaar_last_four || '';
  document.getElementById('profFormVillage').value = p.village_town || '';
  document.getElementById('profFormDistrict').value = p.district || '';
  document.getElementById('profFormState').value = p.state || 'Karnataka';
  document.getElementById('profFormPHC').value = p.assigned_phc || '';
  document.getElementById('profFormECName').value = p.emergency_contact_name || '';
  document.getElementById('profFormECPhone').value = p.emergency_contact_phone || '';
  document.getElementById('profFormECRel').value = p.emergency_contact_relation || '';
  document.getElementById('profFormOrganDonor').checked = !!p.organ_donor;
  document.getElementById('profFormIsPrimary').checked = !!p.is_primary;

  document.getElementById('profileModalTitle').textContent = 'Edit ABHA Citizen Profile';
  document.getElementById('deleteProfileBtn').classList.remove('hidden');
  openModal('profileModal');
}
window.openEditProfileModal = openEditProfileModal;

async function handleSaveProfile(e) {
  e.preventDefault();
  const id = document.getElementById('profFormId').value;
  const payload = {
    full_name: document.getElementById('profFormName').value,
    abha_number: document.getElementById('profFormABHANumber').value,
    abha_address: document.getElementById('profFormABHAAddress').value,
    date_of_birth: document.getElementById('profFormDOB').value,
    gender: document.getElementById('profFormGender').value,
    blood_group: document.getElementById('profFormBlood').value,
    phone: document.getElementById('profFormPhone').value,
    aadhaar_last_four: document.getElementById('profFormAadhaar').value,
    village_town: document.getElementById('profFormVillage').value,
    district: document.getElementById('profFormDistrict').value,
    state: document.getElementById('profFormState').value,
    assigned_phc: document.getElementById('profFormPHC').value,
    emergency_contact_name: document.getElementById('profFormECName').value,
    emergency_contact_phone: document.getElementById('profFormECPhone').value,
    emergency_contact_relation: document.getElementById('profFormECRel').value,
    organ_donor: document.getElementById('profFormOrganDonor').checked ? 1 : 0,
    is_primary: document.getElementById('profFormIsPrimary').checked ? 1 : 0
  };

  try {
    if (id) {
      await fetch(`/api/profiles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      state.activeProfileId = data.id;
    }
    closeModal('profileModal');
    await loadProfiles();
  } catch (err) {
    alert('Error saving profile: ' + err.message);
  }
}
window.handleSaveProfile = handleSaveProfile;

async function handleDeleteCurrentProfile() {
  if (!confirm(`Are you sure you want to delete profile "${state.currentProfile.full_name}"?`)) return;
  try {
    await fetch(`/api/profiles/${state.currentProfile.id}`, { method: 'DELETE' });
    closeModal('profileModal');
    state.activeProfileId = null;
    await loadProfiles();
  } catch (err) {
    alert('Failed to delete profile: ' + err.message);
  }
}
window.handleDeleteCurrentProfile = handleDeleteCurrentProfile;

// ==========================================
// OVERVIEW TAB & DIRECT CARD RENDERING
// ==========================================

async function loadOverview() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/overview/${state.activeProfileId}`);
    const data = await res.json();

    // Render severe allergy warning
    const severeAllergies = data.allergies.filter(a => a.severity === 'Severe');
    const allergyBanner = document.getElementById('severeAllergyAlertBanner');
    if (allergyBanner) {
      if (severeAllergies.length > 0) {
        allergyBanner.classList.remove('hidden');
        document.getElementById('severeAllergyListText').textContent = severeAllergies.map(a => `${a.allergen} (${a.reaction})`).join(', ');
      } else {
        allergyBanner.classList.add('hidden');
      }
    }

    // Top Vitals Cards
    const v = data.latest_vital;
    if (v) {
      document.getElementById('overviewBPVal').textContent = (v.systolic && v.diastolic) ? `${v.systolic}/${v.diastolic}` : '--/--';
      const bpBadge = document.getElementById('overviewBPBadge');
      bpBadge.textContent = v.bp_category?.category || 'Normal';
      bpBadge.className = `px-2 py-0.5 text-[9px] font-bold rounded-md ${v.bp_category?.badge || 'bg-emerald-500 text-white'}`;
      document.getElementById('overviewBPDate').textContent = v.recorded_at_facility ? `${v.recorded_at_facility}` : `${v.recorded_date}`;

      document.getElementById('overviewHRVal').textContent = v.heart_rate || '--';
      document.getElementById('overviewGlucoseVal').textContent = v.blood_glucose ? v.blood_glucose.toFixed(1) : '--';
      document.getElementById('overviewGlucoseType').textContent = `${v.glucose_type || 'Fasting'} (${v.blood_glucose ? (v.blood_glucose < 100 ? 'Normal' : v.blood_glucose < 126 ? 'Elevated' : 'High') : 'Normal'})`;

      document.getElementById('overviewBMIVal').textContent = v.bmi ? v.bmi.toFixed(1) : '--';
      document.getElementById('overviewWeightVal').textContent = v.weight || '--';
      const bmiBadge = document.getElementById('overviewBMIBadge');
      bmiBadge.textContent = v.bmi_category?.category || 'Normal weight';
      bmiBadge.className = `px-2 py-0.5 text-[9px] font-bold rounded-md ${v.bmi_category?.badge || 'bg-emerald-500 text-white'}`;
    }

    renderOverviewChart(data.vitals_chart);
    renderOverviewMeds(data.medications);
    renderOverviewConditions(data.conditions);
    renderOverviewUpcoming(data.upcoming_visits, data.upcoming_vaccines);
    renderOverviewRecentLabs(data.recent_labs);

    lucide.createIcons();
  } catch (err) {
    console.error('Error loading overview:', err);
  }
}

function renderOverviewChart(chartData) {
  const ctx = document.getElementById('overviewTrendsChart');
  if (!ctx) return;

  if (state.charts.overview) {
    state.charts.overview.destroy();
  }

  const labels = chartData.map(d => d.recorded_date.split(' ')[0]);
  const systolic = chartData.map(d => d.systolic);
  const diastolic = chartData.map(d => d.diastolic);
  const heartRate = chartData.map(d => d.heart_rate);

  state.charts.overview = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Systolic (mmHg)',
          data: systolic,
          borderColor: '#e11d48',
          backgroundColor: 'rgba(225, 29, 72, 0.08)',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2.5
        },
        {
          label: 'Diastolic (mmHg)',
          data: diastolic,
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.08)',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2.5
        },
        {
          label: 'Heart Rate (BPM)',
          data: heartRate,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.08)',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 10, font: { size: 9 } } }
      },
      scales: {
        y: { min: 40, max: 160, grid: { color: '#f8fafc' }, ticks: { font: { size: 9 } } },
        x: { grid: { display: false }, ticks: { font: { size: 9 } } }
      }
    }
  });
}

function renderOverviewMeds(meds) {
  const container = document.getElementById('overviewMedsList');
  if (!container) return;

  const activeMeds = meds.filter(m => m.status === 'Active');
  if (activeMeds.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-2.5 text-center">No active prescriptions.</div>';
    return;
  }

  container.innerHTML = activeMeds.slice(0, 4).map(m => `
    <div class="flex items-center justify-between p-2 rounded-xl border ${m.taken_today ? 'bg-emerald-50/50 border-emerald-200' : 'bg-slate-50 border-slate-200'} transition-all">
      <div class="flex items-center gap-2 min-w-0">
        <button onclick="toggleMedTaken(${m.id})" class="w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-all ${m.taken_today ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300 hover:border-emerald-500'}">
          ${m.taken_today ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : ''}
        </button>
        <div class="truncate">
          <div class="text-xs font-bold text-slate-800 truncate ${m.taken_today ? 'line-through text-slate-500' : ''}">${m.medication_name}</div>
          <div class="text-[10px] text-slate-500 truncate">${m.dosage} &bull; ${m.frequency}</div>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button onclick="openCalendarSyncModal('Medication: ${m.medication_name}', '${new Date().toISOString().slice(0,10)}', 'Home', '${m.dosage} - ${m.instructions || m.frequency}')" title="Sync Reminder" class="p-1 text-slate-400 hover:text-teal-600 rounded">
          <i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i>
        </button>
        <span class="text-[9px] font-bold px-1.5 py-0.2 rounded-full ${m.taken_today ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-50 text-amber-700'}">
          ${m.taken_today ? 'Taken' : 'Due'}
        </span>
      </div>
    </div>
  `).join('');
}

function renderOverviewConditions(conditions) {
  const container = document.getElementById('overviewConditionsList');
  if (!container) return;

  if (conditions.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-2.5 text-center">No diagnosed medical conditions.</div>';
    return;
  }

  container.innerHTML = conditions.slice(0, 3).map(c => `
    <div class="p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
      <div class="flex items-center justify-between font-bold text-slate-800">
        <span class="truncate">${c.condition_name}</span>
        <span class="text-[9px] px-1.5 py-0.2 rounded ${c.status === 'Active' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}">${c.status}</span>
      </div>
      <div class="text-[10px] text-slate-500 mt-0.5 line-clamp-1">${c.treatment_plan || c.notes || 'Routine follow-up'}</div>
    </div>
  `).join('');
}

function renderOverviewUpcoming(visits, vaccines) {
  const container = document.getElementById('overviewUpcomingList');
  if (!container) return;

  const items = [];
  visits.forEach(v => {
    if (v.follow_up_date) {
      items.push({ title: `PHC: ${v.doctor_name}`, date: v.follow_up_date, location: v.clinic_hospital, details: v.reason_for_visit, type: 'visit' });
    }
  });
  vaccines.forEach(vac => {
    if (vac.next_due_date) {
      items.push({ title: `Vac: ${vac.vaccine_name}`, date: vac.next_due_date, location: vac.clinic_site, details: `Dose: ${vac.dose_number}`, type: 'vaccine' });
    }
  });

  if (items.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-2.5 text-center">No upcoming follow-ups.</div>';
    return;
  }

  container.innerHTML = items.slice(0, 3).map(item => `
    <div class="flex items-center justify-between p-2 rounded-xl bg-teal-50/50 border border-teal-200 text-xs">
      <div class="flex items-center gap-1.5 min-w-0">
        <i data-lucide="${item.type === 'visit' ? 'stethoscope' : 'syringe'}" class="w-3.5 h-3.5 text-teal-600 shrink-0"></i>
        <div class="truncate">
          <span class="font-semibold text-slate-800 block truncate">${item.title}</span>
          <span class="text-[10px] text-slate-500">${item.date}</span>
        </div>
      </div>
      <button onclick="openCalendarSyncModal('${item.title}', '${item.date}', '${item.location || 'PHC'}', '${item.details || 'Scheduled Care'}')" class="flex items-center gap-1 px-2 py-0.5 bg-white border border-teal-300 hover:bg-teal-100 rounded-lg text-teal-800 text-[10px] font-bold shrink-0 transition-all">
        <i data-lucide="calendar-plus" class="w-3 h-3 text-teal-600"></i>
        <span>Sync</span>
      </button>
    </div>
  `).join('');
}

function renderOverviewRecentLabs(labs) {
  const container = document.getElementById('overviewRecentLabsList');
  if (!container) return;

  if (labs.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-2.5 text-center">No lab test records found.</div>';
    return;
  }

  container.innerHTML = labs.slice(0, 3).map(l => `
    <div class="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-200 text-xs">
      <div class="min-w-0 truncate">
        <div class="font-bold text-slate-800 truncate">${l.test_name}</div>
        <div class="text-[10px] text-slate-500">${l.test_date}</div>
      </div>
      <div class="text-right shrink-0">
        <div class="font-black text-slate-900">${l.result_value} <span class="text-[9px] text-slate-500 font-normal">${l.unit || ''}</span></div>
        <span class="text-[9px] font-bold px-1.5 py-0.2 rounded ${l.status === 'Normal' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${l.status}</span>
      </div>
    </div>
  `).join('');
}

// ==========================================
// NEARBY HOSPITALS & JAN AUSHADHI KENDRA LOCATOR
// ==========================================

async function loadNearbyFacilities() {
  try {
    let url = `/api/facilities/nearby?lat=${state.userLocation.lat}&lon=${state.userLocation.lon}`;
    if (state.currentFacilityFilter && state.currentFacilityFilter !== 'All') {
      url += `&type=${encodeURIComponent(state.currentFacilityFilter)}`;
    }
    
    const res = await fetch(url);
    if (!res.ok) throw new Error('Facility network error');
    state.facilitiesData = await res.json();
    renderFacilities();
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading facilities:', err);
  }
}
window.loadNearbyFacilities = loadNearbyFacilities;

function filterFacilities(type) {
  state.currentFacilityFilter = type;
  document.querySelectorAll('.fac-filter-btn').forEach(btn => {
    if (btn.textContent.includes(type) || (type === 'All' && btn.textContent.includes('All'))) {
      btn.className = 'fac-filter-btn active px-3 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white shrink-0 shadow-xs';
    } else {
      btn.className = 'fac-filter-btn px-3 py-1 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 shrink-0';
    }
  });
  loadNearbyFacilities();
}
window.filterFacilities = filterFacilities;

function renderFacilities() {
  const container = document.getElementById('facilitiesGrid');
  if (!container) return;

  if (!state.facilitiesData || state.facilitiesData.length === 0) {
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No healthcare facilities found for the current filter.</div>';
    return;
  }

  container.innerHTML = state.facilitiesData.map(f => {
    const isVeryClose = f.distance_km < 15;
    const isJanAushadhi = f.facility_type.includes('Jan Aushadhi');
    const isPharmacy = f.facility_type.includes('Medical Store') || isJanAushadhi;
    const isClinic = f.facility_type.includes('Clinic');

    return `
      <div class="bg-white rounded-2xl border ${isJanAushadhi ? 'border-emerald-300 ring-2 ring-emerald-500/20' : 'border-slate-200'} p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between hover:shadow-md transition-all">
        <div>
          <div class="flex items-start justify-between gap-2">
            <div>
              <div class="flex flex-wrap items-center gap-1">
                <span class="px-2 py-0.5 text-[9px] font-bold rounded-md ${
                  isJanAushadhi ? 'bg-amber-100 text-amber-900 border border-amber-300 font-black' :
                  isPharmacy ? 'bg-teal-50 text-teal-700 border border-teal-200' :
                  isClinic ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                  'bg-emerald-50 text-emerald-800 border border-emerald-200'
                }">
                  ${f.facility_type}
                </span>
                ${isJanAushadhi ? '<span class="px-1.5 py-0.2 bg-emerald-700 text-white font-black text-[8px] rounded">50%-90% OFF</span>' : ''}
              </div>
              <h3 class="font-bold text-slate-900 text-xs sm:text-sm mt-1">${f.facility_name}</h3>
              <span class="text-[11px] text-slate-500">${f.district}, ${f.state}</span>
            </div>
            <div class="text-right shrink-0">
              <span class="text-xs font-black ${isVeryClose ? 'text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-200' : 'text-slate-700'} block">
                ${f.distance_km} km
              </span>
              <span class="text-[9px] text-slate-400">away</span>
            </div>
          </div>

          <div class="mt-2.5 space-y-1 text-xs text-slate-600">
            <div class="flex items-center gap-1.5">
              <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span class="truncate">${f.address}</span>
            </div>
            <div class="flex items-center gap-1.5">
              <i data-lucide="phone" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
              <span><strong>Phone:</strong> ${f.phone}</span>
            </div>
            ${f.has_24x7_emergency ? `
              <div class="flex items-center gap-1.5 text-red-700 font-semibold text-[10px]">
                <i data-lucide="shield-alert" class="w-3.5 h-3.5"></i>
                <span>24x7 Emergency Available</span>
              </div>
            ` : ''}
          </div>
        </div>

        <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center gap-2">
          <a href="tel:${f.emergency_phone || f.phone}" class="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-2xs">
            <i data-lucide="phone-call" class="w-3.5 h-3.5"></i>
            <span>Call</span>
          </a>
          <a href="${f.directions_url}" target="_blank" class="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition-all border border-emerald-200">
            <i data-lucide="navigation" class="w-3.5 h-3.5"></i>
            <span>Directions</span>
          </a>
        </div>
      </div>
    `;
  }).join('');
}

// ==========================================
// VITALS TAB & DETAILED CHARTS
// ==========================================

async function loadVitals() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/vitals/${state.activeProfileId}`);
    state.vitalsData = await res.json();

    renderVitalsTable();
    renderDetailedVitalsChart();
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading vitals:', err);
  }
}

function renderVitalsTable() {
  const tbody = document.getElementById('vitalsTableBody');
  if (!tbody) return;

  if (state.vitalsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">No vitals entries logged yet. Click "+ Log Vitals".</td></tr>';
    return;
  }

  tbody.innerHTML = state.vitalsData.map(v => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="px-3.5 py-2.5">
        <div class="font-semibold text-slate-800">${v.recorded_date}</div>
        <div class="text-[10px] text-slate-400">${v.recorded_at_facility || 'PHC'}</div>
      </td>
      <td class="px-3.5 py-2.5">
        ${v.systolic && v.diastolic ? `
          <div class="font-bold text-slate-900">${v.systolic}/${v.diastolic} <span class="text-[9px] font-normal text-slate-400">mmHg</span></div>
          <span class="text-[9px] px-1.5 py-0.2 rounded font-bold ${v.bp_category.badge}">${currentLang === 'hi' ? v.bp_category.category_hi : v.bp_category.category}</span>
        ` : '--'}
      </td>
      <td class="px-3.5 py-2.5 font-bold text-slate-800">${v.heart_rate ? v.heart_rate + ' bpm' : '--'}</td>
      <td class="px-3.5 py-2.5 font-bold text-slate-800">${v.blood_glucose ? `${v.blood_glucose} mg/dL` : '--'}</td>
      <td class="px-3.5 py-2.5">
        ${v.weight ? `
          <span class="font-bold">${v.weight} kg</span>
          ${v.bmi ? `<div class="text-[9px] text-slate-500 font-semibold">BMI: ${v.bmi}</div>` : ''}
        ` : '--'}
      </td>
      <td class="px-3.5 py-2.5 text-right">
        <button onclick="deleteVital(${v.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

function changeVitalsMetric(metric) {
  state.activeVitalsMetric = metric;
  document.querySelectorAll('.vitals-metric-btn').forEach(btn => {
    if (btn.id === `metricBtn-${metric}`) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  renderDetailedVitalsChart();
}
window.changeVitalsMetric = changeVitalsMetric;

function renderDetailedVitalsChart() {
  const ctx = document.getElementById('detailedVitalsChart');
  if (!ctx) return;

  if (state.charts.detailed) {
    state.charts.detailed.destroy();
  }

  const chronological = [...state.vitalsData].reverse();
  const labels = chronological.map(v => v.recorded_date.split(' ')[0]);

  let datasets = [];
  const statsContainer = document.getElementById('vitalsChartStats');

  if (state.activeVitalsMetric === 'bp') {
    datasets = [
      {
        label: 'Systolic (mmHg)',
        data: chronological.map(v => v.systolic),
        borderColor: '#e11d48',
        backgroundColor: 'rgba(225, 29, 72, 0.08)',
        tension: 0.3,
        borderWidth: 2
      },
      {
        label: 'Diastolic (mmHg)',
        data: chronological.map(v => v.diastolic),
        borderColor: '#059669',
        backgroundColor: 'rgba(5, 150, 105, 0.08)',
        tension: 0.3,
        borderWidth: 2
      }
    ];
    if (statsContainer && chronological.length > 0) {
      const avgSys = Math.round(chronological.reduce((acc, c) => acc + (c.systolic || 0), 0) / chronological.length);
      const avgDia = Math.round(chronological.reduce((acc, c) => acc + (c.diastolic || 0), 0) / chronological.length);
      statsContainer.innerHTML = `<span>Avg BP: <strong class="text-slate-900">${avgSys}/${avgDia} mmHg</strong></span>`;
    }
  } else if (state.activeVitalsMetric === 'hr') {
    datasets = [{
      label: 'Heart Rate (BPM)',
      data: chronological.map(v => v.heart_rate),
      borderColor: '#4f46e5',
      backgroundColor: 'rgba(79, 70, 229, 0.08)',
      tension: 0.3,
      borderWidth: 2
    }];
  } else if (state.activeVitalsMetric === 'glucose') {
    datasets = [{
      label: 'Blood Glucose (mg/dL)',
      data: chronological.map(v => v.blood_glucose),
      borderColor: '#d97706',
      backgroundColor: 'rgba(217, 119, 6, 0.08)',
      tension: 0.3,
      borderWidth: 2
    }];
  } else if (state.activeVitalsMetric === 'weight') {
    datasets = [
      {
        label: 'Weight (kg)',
        data: chronological.map(v => v.weight),
        borderColor: '#0d9488',
        backgroundColor: 'rgba(13, 148, 136, 0.08)',
        tension: 0.3,
        borderWidth: 2
      }
    ];
  }

  state.charts.detailed = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { grid: { color: '#f8fafc' }, ticks: { font: { size: 9 } } },
        x: { grid: { display: false }, ticks: { font: { size: 9 } } }
      }
    }
  });
}

async function handleSaveVital(e) {
  e.preventDefault();
  const payload = {
    profile_id: state.activeProfileId,
    recorded_date: document.getElementById('vitalFormDate').value,
    systolic: document.getElementById('vitalFormSys').value,
    diastolic: document.getElementById('vitalFormDia').value,
    heart_rate: document.getElementById('vitalFormHR').value,
    spo2: document.getElementById('vitalFormSpO2').value,
    blood_glucose: document.getElementById('vitalFormGlucose').value,
    glucose_type: document.getElementById('vitalFormGlucoseType').value,
    weight: document.getElementById('vitalFormWeight').value,
    height: document.getElementById('vitalFormHeight').value,
    recorded_at_facility: document.getElementById('vitalFormFacility').value,
    notes: document.getElementById('vitalFormNotes').value
  };

  try {
    await fetch('/api/vitals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('addVitalModal');
    document.getElementById('vitalForm').reset();
    await loadVitals();
    await loadOverview();
  } catch (err) {
    alert('Error logging vitals: ' + err.message);
  }
}
window.handleSaveVital = handleSaveVital;

async function deleteVital(id) {
  if (!confirm('Delete this vital record?')) return;
  try {
    await fetch(`/api/vitals/${id}`, { method: 'DELETE' });
    await loadVitals();
    await loadOverview();
  } catch (err) {
    alert('Failed to delete vital: ' + err.message);
  }
}
window.deleteVital = deleteVital;

// ==========================================
// MEDICATIONS & PRESCRIPTIONS
// ==========================================

async function loadMedications() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/medications/${state.activeProfileId}`);
    const meds = await res.json();
    renderMedications(meds);
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading medications:', err);
  }
}

function renderMedications(meds) {
  const container = document.getElementById('medicationsGrid');
  if (!container) return;

  if (meds.length === 0) {
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No medications logged. Click "+ Add Medicine".</div>';
    return;
  }

  container.innerHTML = meds.map(m => `
    <div class="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between hover:shadow-md transition-all">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <i data-lucide="pill" class="w-4 h-4"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-xs sm:text-sm">${m.medication_name}</h3>
              <span class="text-[11px] font-semibold text-teal-800">${m.dosage} &bull; ${m.form}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 text-[9px] font-bold rounded-full ${m.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
            ${m.status}
          </span>
        </div>

        <div class="mt-2.5 space-y-1 text-xs text-slate-600">
          <div class="flex items-center gap-1.5">
            <i data-lucide="repeat" class="w-3.5 h-3.5 text-slate-400"></i>
            <span><strong>Freq:</strong> ${m.frequency}</span>
          </div>
          ${m.instructions ? `
            <div class="flex items-center gap-1.5">
              <i data-lucide="info" class="w-3.5 h-3.5 text-slate-400"></i>
              <span>${m.instructions}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between">
        <button onclick="toggleMedTaken(${m.id})" class="flex items-center gap-1 text-xs font-bold ${m.taken_today ? 'text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg' : 'text-slate-600 hover:text-emerald-600'}">
          <i data-lucide="${m.taken_today ? 'check-circle-2' : 'circle'}" class="w-4 h-4 text-emerald-600"></i>
          <span>${m.taken_today ? 'Taken Today' : 'Mark Taken'}</span>
        </button>
        <div class="flex items-center gap-1">
          <button onclick="openCalendarSyncModal('Medication: ${m.medication_name}', '${new Date().toISOString().slice(0,10)}', 'Home', '${m.dosage} - ${m.frequency}')" class="p-1 text-slate-400 hover:text-teal-600 transition-colors" title="Sync Reminder">
            <i data-lucide="calendar-plus" class="w-3.5 h-3.5"></i>
          </button>
          <button onclick="deleteMedication(${m.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

async function handleSaveMedication(e) {
  e.preventDefault();
  const payload = {
    profile_id: state.activeProfileId,
    medication_name: document.getElementById('medFormName').value,
    dosage: document.getElementById('medFormDosage').value,
    form: document.getElementById('medFormForm').value,
    frequency: document.getElementById('medFormFreq').value,
    prescribed_by: document.getElementById('medFormDoctor').value,
    instructions: document.getElementById('medFormInstructions').value
  };

  try {
    await fetch('/api/medications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('addMedicationModal');
    document.getElementById('medicationForm').reset();
    await loadMedications();
    await loadOverview();
  } catch (err) {
    alert('Error saving medication: ' + err.message);
  }
}
window.handleSaveMedication = handleSaveMedication;

async function toggleMedTaken(id) {
  try {
    await fetch(`/api/medications/${id}/toggle-taken`, { method: 'POST' });
    loadOverview();
    loadMedications();
  } catch (err) {
    console.error('Error toggling medication:', err);
  }
}
window.toggleMedTaken = toggleMedTaken;

async function deleteMedication(id) {
  if (!confirm('Delete this medication record?')) return;
  try {
    await fetch(`/api/medications/${id}`, { method: 'DELETE' });
    await loadMedications();
    await loadOverview();
  } catch (err) {
    alert('Failed to delete medication: ' + err.message);
  }
}
window.deleteMedication = deleteMedication;

// ==========================================
// CONDITIONS & DIAGNOSES
// ==========================================

async function loadConditions() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/conditions/${state.activeProfileId}`);
    const conditions = await res.json();
    renderConditions(conditions);
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading conditions:', err);
  }
}

function renderConditions(conditions) {
  const container = document.getElementById('conditionsGrid');
  if (!container) return;

  if (conditions.length === 0) {
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No medical conditions recorded.</div>';
    return;
  }

  container.innerHTML = conditions.map(c => `
    <div class="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <i data-lucide="stethoscope" class="w-4 h-4"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-xs sm:text-sm">${c.condition_name}</h3>
              <span class="text-[11px] text-slate-500">${c.diagnosed_date || 'N/A'}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 text-[9px] font-bold rounded-full ${c.status === 'Active' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
            ${c.status}
          </span>
        </div>

        <div class="mt-2.5 text-xs text-slate-600">
          ${c.treatment_plan ? `
            <div class="p-2 bg-slate-50 rounded-xl border border-slate-100">
              <strong class="text-slate-800 block mb-0.5 text-[11px]">Advice:</strong>
              <span class="text-[11px]">${c.treatment_plan}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="mt-2.5 pt-2 border-t border-slate-100 flex justify-end">
        <button onclick="deleteCondition(${c.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `).join('');
}

async function handleSaveCondition(e) {
  e.preventDefault();
  const payload = {
    profile_id: state.activeProfileId,
    condition_name: document.getElementById('condFormName').value,
    status: document.getElementById('condFormStatus').value,
    severity: document.getElementById('condFormSeverity').value,
    treatment_plan: document.getElementById('condFormPlan').value
  };

  try {
    await fetch('/api/conditions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('addConditionModal');
    document.getElementById('conditionForm').reset();
    await loadConditions();
    await loadOverview();
  } catch (err) {
    alert('Error saving condition: ' + err.message);
  }
}
window.handleSaveCondition = handleSaveCondition;

async function deleteCondition(id) {
  if (!confirm('Delete this condition?')) return;
  try {
    await fetch(`/api/conditions/${id}`, { method: 'DELETE' });
    await loadConditions();
    await loadOverview();
  } catch (err) {
    alert('Failed to delete condition: ' + err.message);
  }
}
window.deleteCondition = deleteCondition;

// ==========================================
// ALLERGIES & DRUG REACTIONS
// ==========================================

async function loadAllergies() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/allergies/${state.activeProfileId}`);
    const allergies = await res.json();
    renderAllergies(allergies);
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading allergies:', err);
  }
}

function renderAllergies(allergies) {
  const container = document.getElementById('allergiesGrid');
  if (!container) return;

  if (allergies.length === 0) {
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No allergies recorded.</div>';
    return;
  }

  container.innerHTML = allergies.map(a => `
    <div class="bg-white rounded-2xl border ${a.severity === 'Severe' ? 'border-red-300 bg-red-50/20' : 'border-slate-200'} p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl ${a.severity === 'Severe' ? 'bg-red-100 text-red-700' : 'bg-rose-50 text-rose-600'} flex items-center justify-center shrink-0">
              <i data-lucide="shield-alert" class="w-4 h-4"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-xs sm:text-sm">${a.allergen}</h3>
              <span class="text-[11px] text-slate-500">${a.allergy_type} Allergen</span>
            </div>
          </div>
          <span class="px-2 py-0.5 text-[9px] font-black rounded-full ${a.severity === 'Severe' ? 'bg-red-600 text-white animate-pulse' : 'bg-amber-100 text-amber-800'}">
            ${a.severity}
          </span>
        </div>

        <div class="mt-2.5 text-xs">
          <div class="p-2 bg-white border border-slate-200 rounded-xl">
            <strong class="text-slate-900 block mb-0.5 text-[11px]">Reaction:</strong>
            <span class="text-slate-700 font-medium text-[11px]">${a.reaction}</span>
          </div>
        </div>
      </div>

      <div class="mt-2.5 pt-2 border-t border-slate-100 flex justify-end">
        <button onclick="deleteAllergy(${a.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `).join('');
}

async function handleSaveAllergy(e) {
  e.preventDefault();
  const payload = {
    profile_id: state.activeProfileId,
    allergen: document.getElementById('allergyFormAllergen').value,
    allergy_type: document.getElementById('allergyFormType').value,
    severity: document.getElementById('allergyFormSeverity').value,
    reaction: document.getElementById('allergyFormReaction').value,
    notes: document.getElementById('allergyFormNotes').value
  };

  try {
    await fetch('/api/allergies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('addAllergyModal');
    document.getElementById('allergyForm').reset();
    await loadAllergies();
    await loadOverview();
  } catch (err) {
    alert('Error saving allergy: ' + err.message);
  }
}
window.handleSaveAllergy = handleSaveAllergy;

async function deleteAllergy(id) {
  if (!confirm('Delete this allergy record?')) return;
  try {
    await fetch(`/api/allergies/${id}`, { method: 'DELETE' });
    await loadAllergies();
    await loadOverview();
  } catch (err) {
    alert('Failed to delete allergy: ' + err.message);
  }
}
window.deleteAllergy = deleteAllergy;

// ==========================================
// DIAGNOSTIC LAB RESULTS
// ==========================================

async function loadLabs() {
  if (!state.activeProfileId) return;

  try {
    const url = `/api/lab-results/${state.activeProfileId}${state.currentLabFilter !== 'All' ? '?category=' + state.currentLabFilter : ''}`;
    const res = await fetch(url);
    state.labsData = await res.json();
    renderLabs();
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading labs:', err);
  }
}

function filterLabs(cat) {
  state.currentLabFilter = cat;
  document.querySelectorAll('.lab-cat-pill').forEach(btn => {
    if (btn.textContent.includes(cat) || (cat === 'All' && btn.textContent.includes('All'))) {
      btn.className = 'lab-cat-pill active px-3 py-1 text-xs font-bold rounded-lg bg-emerald-700 text-white shrink-0 shadow-xs';
    } else {
      btn.className = 'lab-cat-pill px-3 py-1 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 shrink-0';
    }
  });
  loadLabs();
}
window.filterLabs = filterLabs;

function renderLabs() {
  const tbody = document.getElementById('labsTableBody');
  if (!tbody) return;

  if (state.labsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-slate-400">No lab results found. Click "+ Log Test" or "AI OCR Upload".</td></tr>';
    return;
  }

  tbody.innerHTML = state.labsData.map(l => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="px-3.5 py-2.5">
        <div class="font-bold text-slate-900">${l.test_name}</div>
        <span class="text-[9px] text-slate-400 font-semibold uppercase">${l.category}</span>
      </td>
      <td class="px-3.5 py-2.5 font-semibold text-slate-700">${l.test_date}</td>
      <td class="px-3.5 py-2.5 font-black text-slate-900 text-xs sm:text-sm">
        ${l.result_value} <span class="text-[10px] text-slate-500 font-normal">${l.unit || ''}</span>
      </td>
      <td class="px-3.5 py-2.5 text-slate-600 font-medium">${l.reference_range || '-'}</td>
      <td class="px-3.5 py-2.5">
        <span class="px-2 py-0.5 text-[9px] font-bold rounded-md ${
          l.status === 'Normal' ? 'bg-emerald-100 text-emerald-800' :
          l.status === 'High' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
        }">${l.status}</span>
      </td>
      <td class="px-3.5 py-2.5 text-right">
        <button onclick="deleteLabResult(${l.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

async function handleSaveLab(e) {
  e.preventDefault();
  const payload = {
    profile_id: state.activeProfileId,
    test_name: document.getElementById('labFormName').value,
    category: document.getElementById('labFormCategory').value,
    test_date: document.getElementById('labFormDate').value,
    result_value: document.getElementById('labFormVal').value,
    unit: document.getElementById('labFormUnit').value,
    status: document.getElementById('labFormStatus').value
  };

  try {
    await fetch('/api/lab-results', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('addLabModal');
    document.getElementById('labForm').reset();
    await loadLabs();
    await loadOverview();
  } catch (err) {
    alert('Error saving lab result: ' + err.message);
  }
}
window.handleSaveLab = handleSaveLab;

async function deleteLabResult(id) {
  if (!confirm('Delete this lab report?')) return;
  try {
    await fetch(`/api/lab-results/${id}`, { method: 'DELETE' });
    await loadLabs();
    await loadOverview();
  } catch (err) {
    alert('Failed to delete lab result: ' + err.message);
  }
}
window.deleteLabResult = deleteLabResult;

// ==========================================
// VACCINATIONS & IMMUNIZATION
// ==========================================

async function loadVaccines() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/immunizations/${state.activeProfileId}`);
    const vaccines = await res.json();
    renderVaccines(vaccines);
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading vaccines:', err);
  }
}

function renderVaccines(vaccines) {
  const container = document.getElementById('vaccinesGrid');
  if (!container) return;

  if (vaccines.length === 0) {
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No vaccination records found.</div>';
    return;
  }

  container.innerHTML = vaccines.map(v => `
    <div class="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <i data-lucide="syringe" class="w-4 h-4"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-xs sm:text-sm">${v.vaccine_name}</h3>
              <span class="text-[11px] font-semibold text-indigo-800">${v.dose_number}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 text-[9px] font-bold rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200">
            Administered
          </span>
        </div>

        <div class="mt-2.5 space-y-1 text-xs text-slate-600">
          <div><strong>Date:</strong> ${v.administered_date}</div>
          ${v.next_due_date ? `<div class="text-teal-700 font-bold">Next: ${v.next_due_date}</div>` : ''}
          ${v.administered_by ? `<div>By: ${v.administered_by}</div>` : ''}
        </div>
      </div>

      <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
        ${v.next_due_date ? `
          <button onclick="openCalendarSyncModal('Next Dose: ${v.vaccine_name}', '${v.next_due_date}', '${v.clinic_site || 'PHC'}', 'Vaccination Schedule')" class="flex items-center gap-1 text-[11px] font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 px-2 py-0.5 rounded-lg">
            <i data-lucide="calendar-plus" class="w-3.5 h-3.5 text-teal-600"></i>
            <span>Set Reminder</span>
          </button>
        ` : '<span></span>'}
        <button onclick="deleteVaccine(${v.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `).join('');
}

async function handleSaveVaccine(e) {
  e.preventDefault();
  const payload = {
    profile_id: state.activeProfileId,
    vaccine_name: document.getElementById('vacFormName').value,
    dose_number: document.getElementById('vacFormDose').value,
    administered_date: document.getElementById('vacFormDate').value,
    administered_by: document.getElementById('vacFormStaff').value,
    clinic_site: document.getElementById('vacFormClinic').value
  };

  try {
    await fetch('/api/immunizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('addVaccineModal');
    document.getElementById('vaccineForm').reset();
    await loadVaccines();
    await loadOverview();
  } catch (err) {
    alert('Error saving vaccine: ' + err.message);
  }
}
window.handleSaveVaccine = handleSaveVaccine;

async function deleteVaccine(id) {
  if (!confirm('Delete this vaccine record?')) return;
  try {
    await fetch(`/api/immunizations/${id}`, { method: 'DELETE' });
    await loadVaccines();
    await loadOverview();
  } catch (err) {
    alert('Failed to delete vaccine: ' + err.message);
  }
}
window.deleteVaccine = deleteVaccine;

// ==========================================
// DOCTOR VISITS & CONSULTATIONS
// ==========================================

async function loadVisits() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/consultations/${state.activeProfileId}`);
    const visits = await res.json();
    renderVisits(visits);
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading consultations:', err);
  }
}

function renderVisits(visits) {
  const container = document.getElementById('visitsTimeline');
  if (!container) return;

  if (visits.length === 0) {
    container.innerHTML = '<div class="py-12 text-center text-slate-400">No doctor consultations logged yet.</div>';
    return;
  }

  container.innerHTML = visits.map(v => `
    <div class="bg-white rounded-2xl border border-slate-200 p-3.5 sm:p-4 shadow-2xs flex flex-col justify-between">
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-1.5">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-slate-900 text-xs sm:text-sm">${v.doctor_name}</h3>
            <span class="px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-800 rounded-md">${v.clinic_hospital || 'PHC'}</span>
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">Date: <strong>${v.visit_date}</strong></div>
        </div>
        ${v.follow_up_date ? `
          <div class="px-2 py-0.5 bg-teal-50 border border-teal-200 rounded-lg text-teal-800 text-[11px] font-bold flex items-center gap-1 self-start">
            <i data-lucide="calendar" class="w-3 h-3 text-teal-600"></i>
            <span>Follow-up: ${v.follow_up_date}</span>
          </div>
        ` : ''}
      </div>

      <div class="mt-2.5 space-y-1 text-xs">
        <div>
          <strong class="text-slate-900 block mb-0.5 text-[11px]">Reason:</strong>
          <span class="text-slate-700 font-medium text-[11px]">${v.reason_for_visit}</span>
        </div>
        ${v.recommendations ? `
          <div class="p-2 bg-indigo-50/50 border border-indigo-100 rounded-xl text-indigo-900">
            <strong class="text-indigo-950 block mb-0.5 text-[11px]">Advice & Prescription:</strong>
            <span class="text-[11px]">${v.recommendations}</span>
          </div>
        ` : ''}
      </div>

      <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
        ${v.follow_up_date ? `
          <button onclick="openCalendarSyncModal('Dr. Follow-up: ${v.doctor_name}', '${v.follow_up_date}', '${v.clinic_hospital || 'PHC'}', '${v.reason_for_visit}')" class="flex items-center gap-1.5 text-xs font-bold text-teal-800 bg-teal-50 hover:bg-teal-100 px-2.5 py-1 rounded-xl transition-all">
            <i data-lucide="calendar-plus" class="w-3.5 h-3.5 text-teal-600"></i>
            <span>Sync to Calendar</span>
          </button>
        ` : '<span></span>'}
        <button onclick="deleteVisit(${v.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    </div>
  `).join('');
}

async function handleSaveVisit(e) {
  e.preventDefault();
  const payload = {
    profile_id: state.activeProfileId,
    doctor_name: document.getElementById('visitFormDoctor').value,
    clinic_hospital: document.getElementById('visitFormClinic').value,
    visit_date: document.getElementById('visitFormDate').value,
    reason_for_visit: document.getElementById('visitFormReason').value,
    recommendations: document.getElementById('visitFormRecs').value,
    follow_up_date: document.getElementById('visitFormFollowUp').value
  };

  try {
    await fetch('/api/consultations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeModal('addVisitModal');
    document.getElementById('visitForm').reset();
    await loadVisits();
    await loadOverview();
  } catch (err) {
    alert('Error saving consultation: ' + err.message);
  }
}
window.handleSaveVisit = handleSaveVisit;

async function deleteVisit(id) {
  if (!confirm('Delete this consultation?')) return;
  try {
    await fetch(`/api/consultations/${id}`, { method: 'DELETE' });
    await loadVisits();
    await loadOverview();
  } catch (err) {
    alert('Failed to delete consultation: ' + err.message);
  }
}
window.deleteVisit = deleteVisit;

// ==========================================
// EXPORT & RESTORE JSON
// ==========================================

async function exportHealthJSON() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/export/json/${state.activeProfileId}`);
    const data = await res.json();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `ADHR_Record_${state.currentProfile.full_name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  } catch (err) {
    alert('Export error: ' + err.message);
  }
}
window.exportHealthJSON = exportHealthJSON;

async function importHealthJSON(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const payload = JSON.parse(event.target.result);
      const res = await fetch('/api/import/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Import failed');
      alert('ADHR health record backup imported successfully!');
      closeModal('exportModal');
      await loadProfiles();
      selectProfile(result.id);
    } catch (err) {
      alert('Failed to import backup JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}
window.importHealthJSON = importHealthJSON;

function calculateAge(dobStr) {
  try {
    const dob = new Date(dobStr);
    const diff_ms = Date.now() - dob.getTime();
    const age_dt = new Date(diff_ms);
    return Math.abs(age_dt.getUTCFullYear() - 1970);
  } catch (e) {
    return 'N/A';
  }
}
