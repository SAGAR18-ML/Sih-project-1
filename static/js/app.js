/**
 * HealthPulse EHR - Ayushman Bharat (ABHA) National Healthcare Controller
 */

// Application State
const state = {
  activeProfileId: null,
  profiles: [],
  currentProfile: null,
  activeTab: 'overview',
  activeVitalsMetric: 'bp',
  vitalsData: [],
  labsData: [],
  facilitiesData: [],
  currentFacilityFilter: 'All',
  currentLabFilter: 'All',
  userLocation: { lat: 25.3176, lon: 82.9739 }, // Default Central India / Varanasi coords
  charts: {
    overview: null,
    detailed: null
  },
  qrCodeInstance: null
};

// ==========================================
// INITIALIZATION
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  
  // Initialize user language from localStorage
  const savedLang = localStorage.getItem('healthpulse_lang') || 'en';
  setLanguage(savedLang);

  await loadProfiles();
  getUserLocation();
  lucide.createIcons();
});

function setupEventListeners() {
  // Profile dropdown toggle
  const profDropdownBtn = document.getElementById('profileDropdownBtn');
  const profDropdownMenu = document.getElementById('profileDropdownMenu');
  if (profDropdownBtn && profDropdownMenu) {
    profDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      profDropdownMenu.classList.toggle('hidden');
    });
  }

  // Language dropdown toggle
  const langDropdownBtn = document.getElementById('langDropdownBtn');
  const langDropdownMenu = document.getElementById('langDropdownMenu');
  if (langDropdownBtn && langDropdownMenu) {
    langDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      langDropdownMenu.classList.toggle('hidden');
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    profDropdownMenu?.classList.add('hidden');
    langDropdownMenu?.classList.add('hidden');
    document.getElementById('abhaSearchResults')?.classList.add('hidden');
  });

  // Add new profile button
  const addNewProfileBtn = document.getElementById('addNewProfileBtn');
  if (addNewProfileBtn) {
    addNewProfileBtn.addEventListener('click', () => {
      document.getElementById('profileForm').reset();
      document.getElementById('profFormId').value = '';
      document.getElementById('profileModalTitle').textContent = 'Add Individual / Family Member';
      document.getElementById('deleteProfileBtn').classList.add('hidden');
      openModal('profileModal');
    });
  }

  // Quick Action Buttons
  document.getElementById('quickAddVitalBtn')?.addEventListener('click', () => openModal('addVitalModal'));
  document.getElementById('quickAddMedBtn')?.addEventListener('click', () => openModal('addMedicationModal'));
  document.getElementById('quickAddVisitBtn')?.addEventListener('click', () => openModal('addVisitModal'));
  document.getElementById('openEmergencyModalBtn')?.addEventListener('click', () => {
    loadEmergencyCard();
    openModal('emergencyModal');
  });
  document.getElementById('openExportModalBtn')?.addEventListener('click', () => openModal('exportModal'));
  document.getElementById('editProfileBtn')?.addEventListener('click', openEditProfileModal);

  // Global Universal Search Input (ABHA ID, Mobile, Name)
  const searchInput = document.getElementById('globalSearchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  if (searchInput) {
    searchInput.addEventListener('input', async (e) => {
      const val = e.target.value.trim();
      if (clearSearchBtn) clearSearchBtn.classList.toggle('hidden', !val);
      await handleAbhaSearch(val);
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        clearSearchBtn.classList.add('hidden');
        document.getElementById('abhaSearchResults')?.classList.add('hidden');
      }
    });
  }

  // Pre-fill datetime inputs with current time
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 16);
  const vitalDateInput = document.getElementById('vitalFormDate');
  if (vitalDateInput) vitalDateInput.value = dateStr;
  
  const todayStr = now.toISOString().slice(0, 10);
  ['medFormStartDate', 'labFormDate', 'vacFormDate', 'visitFormDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = todayStr;
  });
}

function changeAppLanguage(langCode) {
  setLanguage(langCode);
  document.getElementById('langDropdownMenu')?.classList.add('hidden');
  
  // Refresh active tab views with localized strings
  if (state.activeProfileId) {
    switchTab(state.activeTab);
  }
}

// ==========================================
// MODAL MANAGEMENT
// ==========================================

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    lucide.createIcons();
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('hidden');
  }
}

window.addEventListener('click', (e) => {
  if (e.target.classList.contains('fixed') && e.target.id.endsWith('Modal')) {
    closeModal(e.target.id);
  }
});

// ==========================================
// TAB SWITCHING
// ==========================================

function switchTab(tabName) {
  state.activeTab = tabName;
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.getAttribute('data-tab') === tabName) {
      btn.classList.add('active-tab');
    } else {
      btn.classList.remove('active-tab');
    }
  });

  document.querySelectorAll('.tab-pane').forEach(pane => {
    pane.classList.remove('active');
  });
  
  const targetPane = document.getElementById(`tab-${tabName}`);
  if (targetPane) {
    targetPane.classList.add('active');
  }

  if (state.activeProfileId) {
    switch (tabName) {
      case 'overview':
        loadOverview();
        break;
      case 'vitals':
        loadVitals();
        break;
      case 'medications':
        loadMedications();
        break;
      case 'conditions':
        loadConditions();
        break;
      case 'labs':
        loadLabs();
        break;
      case 'allergies':
        loadAllergies();
        break;
      case 'vaccines':
        loadVaccines();
        break;
      case 'visits':
        loadVisits();
        break;
      case 'hospitals':
        loadNearbyFacilities();
        break;
      case 'helplines':
        loadHelplines();
        break;
      case 'attachments':
        loadAttachments();
        break;
    }
  }

  lucide.createIcons();
}

// ==========================================
// PROFILES API & ABHA MANAGEMENT
// ==========================================

async function loadProfiles() {
  try {
    const res = await fetch('/api/profiles');
    state.profiles = await res.json();

    if (state.profiles.length === 0) {
      return;
    }

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
      <button onclick="selectProfile(${p.id})" class="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 transition-colors ${isSelected ? 'bg-orange-50/70 font-bold text-orange-900' : 'text-slate-700'}">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded-md bg-indigo-600 text-white flex items-center justify-center font-black text-[10px]">
            ${initials}
          </div>
          <div class="text-left">
            <div class="truncate max-w-[130px] font-bold">${p.full_name}</div>
            <div class="text-[10px] text-slate-400 font-mono">${p.abha_number || 'ABHA: N/A'}</div>
          </div>
        </div>
        ${isSelected ? '<i data-lucide="check" class="w-3.5 h-3.5 text-orange-600"></i>' : ''}
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
  switchTab(state.activeTab);
}

function updateHeroDemographics() {
  const p = state.currentProfile;
  if (!p) return;

  const initials = p.full_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  // Header Avatar & Name
  document.getElementById('headerAvatar').textContent = initials;
  document.getElementById('headerProfileName').textContent = p.full_name;

  // Hero Card
  document.getElementById('heroAvatar').textContent = initials;
  document.getElementById('heroName').textContent = p.full_name;
  document.getElementById('heroPrimaryBadge').classList.toggle('hidden', !p.is_primary);
  document.getElementById('heroBloodGroup').textContent = p.blood_group || 'Unknown';
  document.getElementById('heroABHANumber').textContent = p.abha_number || '14-XXXX-XXXX-XXXX';
  document.getElementById('heroABHAAddress').textContent = p.abha_address || 'citizen@abdm';
  document.getElementById('heroPMJAY').textContent = p.ration_card_pmjay_id ? `PM-JAY: ${p.ration_card_pmjay_id}` : 'PM-JAY Covered';
  document.getElementById('heroDOB').textContent = p.date_of_birth;
  document.getElementById('heroAge').textContent = p.age ?? calculateAge(p.date_of_birth);
  document.getElementById('heroGender').textContent = p.gender;
  document.getElementById('heroPHC').textContent = p.assigned_phc || 'PHC Chandauli';
  document.getElementById('heroLocation').textContent = `${p.district || 'Varanasi'}, ${p.state || 'UP'}`;
}

// Live Search for ABHA ID
async function handleAbhaSearch(query) {
  const resultsContainer = document.getElementById('abhaSearchResults');
  if (!resultsContainer) return;

  if (!query || query.length < 2) {
    resultsContainer.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(`/api/abha/lookup?query=${encodeURIComponent(query)}`);
    const matches = await res.json();

    if (matches.length === 0) {
      resultsContainer.innerHTML = '<div class="px-4 py-3 text-xs text-slate-400 text-center">No ABHA record or patient found matching search.</div>';
    } else {
      resultsContainer.innerHTML = matches.map(m => `
        <button onclick="selectProfile(${m.id}); document.getElementById('abhaSearchResults').classList.add('hidden');" class="w-full text-left px-3 py-2 hover:bg-orange-50/70 border-b border-slate-100 last:border-0 flex items-center justify-between">
          <div>
            <div class="text-xs font-bold text-slate-900">${m.full_name}</div>
            <div class="text-[10px] text-slate-500 font-mono">ABHA: <strong class="text-orange-700">${m.abha_number}</strong> &bull; Phone: ${m.phone || 'N/A'}</div>
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
  document.getElementById('profFormPMJAY').value = p.ration_card_pmjay_id || '';
  document.getElementById('profFormVillage').value = p.village_town || '';
  document.getElementById('profFormDistrict').value = p.district || '';
  document.getElementById('profFormState').value = p.state || 'Uttar Pradesh';
  document.getElementById('profFormPHC').value = p.assigned_phc || '';
  document.getElementById('profFormECName').value = p.emergency_contact_name || '';
  document.getElementById('profFormECPhone').value = p.emergency_contact_phone || '';
  document.getElementById('profFormECRel').value = p.emergency_contact_relation || '';
  document.getElementById('profFormOrganDonor').checked = !!p.organ_donor;
  document.getElementById('profFormIsPrimary').checked = !!p.is_primary;

  document.getElementById('profileModalTitle').textContent = 'Edit ABHA Citizen Details';
  document.getElementById('deleteProfileBtn').classList.remove('hidden');
  openModal('profileModal');
}

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
    ration_card_pmjay_id: document.getElementById('profFormPMJAY').value,
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

// ==========================================
// OVERVIEW TAB
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
      bpBadge.className = `px-2 py-0.5 text-[11px] font-bold rounded-md ${v.bp_category?.badge || 'bg-emerald-500 text-white'}`;
      document.getElementById('overviewBPDate').textContent = v.recorded_at_facility ? `Recorded at: ${v.recorded_at_facility}` : `Recorded: ${v.recorded_date}`;

      document.getElementById('overviewHRVal').textContent = v.heart_rate || '--';
      document.getElementById('overviewGlucoseVal').textContent = v.blood_glucose ? v.blood_glucose.toFixed(1) : '--';
      document.getElementById('overviewGlucoseType').textContent = `${v.glucose_type || 'Fasting'} (${v.blood_glucose ? (v.blood_glucose < 100 ? 'Normal' : v.blood_glucose < 126 ? 'Elevated' : 'High') : 'Normal'})`;

      document.getElementById('overviewBMIVal').textContent = v.bmi ? v.bmi.toFixed(1) : '--';
      document.getElementById('overviewWeightVal').textContent = v.weight || '--';
      const bmiBadge = document.getElementById('overviewBMIBadge');
      bmiBadge.textContent = v.bmi_category?.category || 'Normal weight';
      bmiBadge.className = `px-2 py-0.5 text-[11px] font-bold rounded-md ${v.bmi_category?.badge || 'bg-emerald-500 text-white'}`;
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
          label: 'Systolic BP (mmHg)',
          data: systolic,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 4
        },
        {
          label: 'Diastolic BP (mmHg)',
          data: diastolic,
          borderColor: '#f97316',
          backgroundColor: 'rgba(249, 115, 22, 0.1)',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 4
        },
        {
          label: 'Heart Rate (BPM)',
          data: heartRate,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } }
      },
      scales: {
        y: { min: 40, max: 160, grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } }
      }
    }
  });
}

function renderOverviewMeds(meds) {
  const container = document.getElementById('overviewMedsList');
  if (!container) return;

  const activeMeds = meds.filter(m => m.status === 'Active');
  if (activeMeds.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-3 text-center">No active prescriptions.</div>';
    return;
  }

  container.innerHTML = activeMeds.slice(0, 4).map(m => `
    <div class="flex items-center justify-between p-2 rounded-xl border ${m.taken_today ? 'bg-emerald-50/50 border-emerald-200' : 'bg-slate-50 border-slate-200'} transition-all">
      <div class="flex items-center gap-2">
        <button onclick="toggleMedTaken(${m.id})" class="w-5 h-5 rounded-md flex items-center justify-center transition-all ${m.taken_today ? 'bg-emerald-600 text-white' : 'border-2 border-slate-300 hover:border-emerald-500'}">
          ${m.taken_today ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : ''}
        </button>
        <div>
          <div class="text-xs font-bold text-slate-800 ${m.taken_today ? 'line-through text-slate-500' : ''}">${m.medication_name}</div>
          <div class="text-[10px] text-slate-500">${m.dosage} &bull; ${m.frequency}</div>
        </div>
      </div>
      <span class="text-[9px] font-bold px-2 py-0.5 rounded-full ${m.taken_today ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-50 text-amber-700'}">
        ${m.taken_today ? 'Taken' : 'Due'}
      </span>
    </div>
  `).join('');
}

function renderOverviewConditions(conditions) {
  const container = document.getElementById('overviewConditionsList');
  if (!container) return;

  if (conditions.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-3 text-center">No diagnosed medical conditions.</div>';
    return;
  }

  container.innerHTML = conditions.slice(0, 3).map(c => `
    <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
      <div class="flex items-center justify-between font-bold text-slate-800">
        <span>${c.condition_name}</span>
        <span class="text-[10px] px-1.5 py-0.5 rounded ${c.status === 'Active' ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}">${c.status}</span>
      </div>
      <div class="text-[11px] text-slate-500 mt-1 line-clamp-1">${c.treatment_plan || c.notes || 'Routine follow-up'}</div>
    </div>
  `).join('');
}

function renderOverviewUpcoming(visits, vaccines) {
  const container = document.getElementById('overviewUpcomingList');
  if (!container) return;

  const items = [];
  visits.forEach(v => {
    if (v.follow_up_date) {
      items.push({ title: `PHC Visit: ${v.doctor_name}`, date: v.follow_up_date, type: 'visit' });
    }
  });
  vaccines.forEach(vac => {
    if (vac.next_due_date) {
      items.push({ title: `Vaccine Due: ${vac.vaccine_name}`, date: vac.next_due_date, type: 'vaccine' });
    }
  });

  if (items.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-3 text-center">No upcoming follow-up dates.</div>';
    return;
  }

  container.innerHTML = items.slice(0, 3).map(item => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-teal-50/50 border border-teal-200 text-xs">
      <div class="flex items-center gap-2">
        <i data-lucide="${item.type === 'visit' ? 'stethoscope' : 'syringe'}" class="w-3.5 h-3.5 text-teal-600"></i>
        <span class="font-semibold text-slate-800">${item.title}</span>
      </div>
      <span class="text-[10px] font-bold text-teal-700">${item.date}</span>
    </div>
  `).join('');
}

function renderOverviewRecentLabs(labs) {
  const container = document.getElementById('overviewRecentLabsList');
  if (!container) return;

  if (labs.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-400 py-3 text-center">No lab test records found.</div>';
    return;
  }

  container.innerHTML = labs.slice(0, 3).map(l => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
      <div>
        <div class="font-bold text-slate-800 truncate max-w-[140px]">${l.test_name}</div>
        <div class="text-[10px] text-slate-500">${l.test_date} &bull; Ref: ${l.reference_range || 'N/A'}</div>
      </div>
      <div class="text-right">
        <div class="font-black text-slate-900">${l.result_value} <span class="text-[10px] text-slate-500 font-normal">${l.unit || ''}</span></div>
        <span class="text-[9px] font-bold px-1.5 py-0.2 rounded ${l.status === 'Normal' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${l.status}</span>
      </div>
    </div>
  `).join('');
}

// ==========================================
// NEARBY HOSPITALS & PHC GPS LOCATOR
// ==========================================

function getUserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        state.userLocation = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (state.activeTab === 'hospitals') loadNearbyFacilities();
      },
      (err) => {
        console.warn('Geolocation disabled or failed, using default coords:', err);
      }
    );
  }
}

function refreshUserLocation() {
  getUserLocation();
  loadNearbyFacilities();
}

async function loadNearbyFacilities() {
  try {
    const url = `/api/facilities/nearby?lat=${state.userLocation.lat}&lon=${state.userLocation.lon}${state.currentFacilityFilter !== 'All' ? '&type=' + state.currentFacilityFilter : ''}`;
    const res = await fetch(url);
    state.facilitiesData = await res.json();
    renderFacilities();
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading facilities:', err);
  }
}

function filterFacilities(type) {
  state.currentFacilityFilter = type;
  document.querySelectorAll('.fac-filter-btn').forEach(btn => {
    if (btn.textContent.includes(type) || (type === 'All' && btn.textContent.includes('All'))) {
      btn.className = 'fac-filter-btn active px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 text-white';
    } else {
      btn.className = 'fac-filter-btn px-3 py-1.5 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700';
    }
  });
  loadNearbyFacilities();
}

function renderFacilities() {
  const container = document.getElementById('facilitiesGrid');
  if (!container) return;

  if (state.facilitiesData.length === 0) {
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No healthcare facilities found matching filter.</div>';
    return;
  }

  container.innerHTML = state.facilitiesData.map(f => `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-all">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div>
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-orange-50 text-orange-700 border border-orange-200">
              ${f.facility_type}
            </span>
            <h3 class="font-bold text-slate-900 text-sm mt-1">${f.facility_name}</h3>
            <span class="text-xs text-slate-500">${f.district}, ${f.state}</span>
          </div>
          <div class="text-right">
            <span class="text-xs font-black text-indigo-700 block">${f.distance_km} km</span>
            <span class="text-[9px] text-slate-400">from you</span>
          </div>
        </div>

        <div class="mt-4 space-y-1.5 text-xs text-slate-600">
          <div class="flex items-center gap-1.5">
            <i data-lucide="map-pin" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
            <span class="truncate">${f.address}</span>
          </div>
          <div class="flex items-center gap-1.5">
            <i data-lucide="phone" class="w-3.5 h-3.5 text-slate-400 shrink-0"></i>
            <span><strong>Phone:</strong> ${f.phone}</span>
          </div>
          ${f.has_24x7_emergency ? `
            <div class="flex items-center gap-1.5 text-red-700 font-semibold">
              <i data-lucide="shield-alert" class="w-3.5 h-3.5"></i>
              <span>24x7 Emergency Services Available</span>
            </div>
          ` : ''}
          ${f.has_ayushman_pmjay ? `
            <div class="flex items-center gap-1.5 text-green-700 font-semibold">
              <i data-lucide="check-circle" class="w-3.5 h-3.5"></i>
              <span>Ayushman PM-JAY Empanelled</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="mt-5 pt-3 border-t border-slate-100 flex items-center gap-2">
        <a href="tel:${f.emergency_phone || f.phone}" class="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-bold text-white bg-green-600 hover:bg-green-700 rounded-xl transition-all shadow-xs">
          <i data-lucide="phone-call" class="w-3.5 h-3.5"></i>
          <span>Call Hospital</span>
        </a>
        <a href="${f.directions_url}" target="_blank" class="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all border border-indigo-200">
          <i data-lucide="navigation" class="w-3.5 h-3.5"></i>
          <span>Get Directions</span>
        </a>
      </div>
    </div>
  `).join('');
}

// ==========================================
// EMERGENCY HELPLINES TAB
// ==========================================

async function loadHelplines() {
  try {
    const res = await fetch('/api/emergency/helplines');
    const helplines = await res.json();
    const container = document.getElementById('helplinesGrid');
    if (!container) return;

    container.innerHTML = helplines.map(h => `
      <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-all">
        <div>
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-500 uppercase tracking-wider">${h.category}</span>
            <span class="px-2.5 py-1 text-sm font-black rounded-xl bg-red-100 text-red-800">${h.number}</span>
          </div>
          <h3 class="font-bold text-slate-900 text-sm mt-2">${currentLang === 'hi' ? h.title_hi : h.title}</h3>
          <p class="text-xs text-slate-500 mt-1">${h.description}</p>
        </div>

        <div class="mt-5 pt-3 border-t border-slate-100">
          <a href="tel:${h.number.split(' ')[0]}" class="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-all shadow-md shadow-red-200">
            <i data-lucide="phone-call" class="w-4 h-4"></i>
            <span>Dial ${h.number} (Toll-Free)</span>
          </a>
        </div>
      </div>
    `).join('');

    lucide.createIcons();
  } catch (err) {
    console.error('Error loading helplines:', err);
  }
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
    tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-8 text-center text-slate-400">No vitals entries logged yet. Click "+ Log Vitals" to record.</td></tr>';
    return;
  }

  tbody.innerHTML = state.vitalsData.map(v => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="px-4 py-3">
        <div class="font-semibold text-slate-800">${v.recorded_date}</div>
        <div class="text-[10px] text-slate-400">${v.recorded_at_facility || 'PHC'}</div>
      </td>
      <td class="px-4 py-3">
        ${v.systolic && v.diastolic ? `
          <div class="font-bold text-slate-900">${v.systolic}/${v.diastolic} <span class="text-[10px] font-normal text-slate-400">mmHg</span></div>
          <span class="text-[10px] px-1.5 py-0.2 rounded font-bold ${v.bp_category.badge}">${currentLang === 'hi' ? v.bp_category.category_hi : v.bp_category.category}</span>
        ` : '--'}
      </td>
      <td class="px-4 py-3 font-bold text-slate-800">${v.heart_rate ? v.heart_rate + ' bpm' : '--'}</td>
      <td class="px-4 py-3 font-bold text-slate-800">${v.blood_glucose ? `${v.blood_glucose} mg/dL (${v.glucose_type})` : '--'}</td>
      <td class="px-4 py-3">${v.spo2 ? v.spo2 + '%' : '--'}</td>
      <td class="px-4 py-3">${v.temperature ? v.temperature + '°F' : '--'}</td>
      <td class="px-4 py-3">
        ${v.weight ? `
          <span class="font-bold">${v.weight} kg</span>
          ${v.bmi ? `<div class="text-[10px] text-slate-500 font-semibold">BMI: ${v.bmi} (${currentLang === 'hi' ? v.bmi_category?.category_hi : v.bmi_category?.category})</div>` : ''}
        ` : '--'}
      </td>
      <td class="px-4 py-3 text-slate-500 truncate max-w-[150px]">${v.notes || '-'}</td>
      <td class="px-4 py-3 text-right">
        <button onclick="deleteVital(${v.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete entry">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
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

function renderDetailedVitalsChart() {
  const ctx = document.getElementById('detailedVitalsChart');
  if (!ctx) return;

  if (state.charts.detailed) {
    state.charts.detailed.destroy();
  }

  const chronological = [...state.vitalsData].reverse();
  const labels = chronological.map(v => v.recorded_date);

  let datasets = [];
  const statsContainer = document.getElementById('vitalsChartStats');

  if (state.activeVitalsMetric === 'bp') {
    datasets = [
      {
        label: 'Systolic BP (mmHg)',
        data: chronological.map(v => v.systolic),
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        tension: 0.3,
        borderWidth: 2
      },
      {
        label: 'Diastolic BP (mmHg)',
        data: chronological.map(v => v.diastolic),
        borderColor: '#f97316',
        backgroundColor: 'rgba(249, 115, 22, 0.1)',
        tension: 0.3,
        borderWidth: 2
      }
    ];
    if (statsContainer && chronological.length > 0) {
      const avgSys = Math.round(chronological.reduce((acc, c) => acc + (c.systolic || 0), 0) / chronological.length);
      const avgDia = Math.round(chronological.reduce((acc, c) => acc + (c.diastolic || 0), 0) / chronological.length);
      statsContainer.innerHTML = `<span>Average BP: <strong class="text-slate-900">${avgSys}/${avgDia} mmHg</strong></span>`;
    }
  } else if (state.activeVitalsMetric === 'hr') {
    datasets = [{
      label: 'Heart Rate (BPM)',
      data: chronological.map(v => v.heart_rate),
      borderColor: '#4f46e5',
      backgroundColor: 'rgba(79, 70, 229, 0.1)',
      tension: 0.3,
      borderWidth: 2
    }];
  } else if (state.activeVitalsMetric === 'glucose') {
    datasets = [{
      label: 'Blood Glucose (mg/dL)',
      data: chronological.map(v => v.blood_glucose),
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      tension: 0.3,
      borderWidth: 2
    }];
  } else if (state.activeVitalsMetric === 'weight') {
    datasets = [
      {
        label: 'Weight (kg)',
        data: chronological.map(v => v.weight),
        borderColor: '#0d9488',
        backgroundColor: 'rgba(13, 148, 136, 0.1)',
        tension: 0.3,
        borderWidth: 2
      },
      {
        label: 'BMI',
        data: chronological.map(v => v.bmi),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
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
        y: { grid: { color: '#f1f5f9' }, ticks: { font: { size: 10 } } },
        x: { grid: { display: false }, ticks: { font: { size: 10 } } }
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
  } catch (err) {
    alert('Error logging vitals: ' + err.message);
  }
}

async function deleteVital(id) {
  if (!confirm('Delete this vital record?')) return;
  try {
    await fetch(`/api/vitals/${id}`, { method: 'DELETE' });
    await loadVitals();
  } catch (err) {
    alert('Failed to delete vital: ' + err.message);
  }
}

// ==========================================
// MEDICATIONS TAB
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
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No medications logged. Click "+ Add Medicine" to add prescriptions.</div>';
    return;
  }

  container.innerHTML = meds.map(m => `
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between hover:shadow-md transition-all">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center shrink-0">
              <i data-lucide="pill" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-sm">${m.medication_name}</h3>
              <span class="text-xs font-semibold text-teal-700">${m.dosage} &bull; ${m.form}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${m.status === 'Active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}">
            ${m.status}
          </span>
        </div>

        <div class="mt-4 space-y-1.5 text-xs text-slate-600">
          <div class="flex items-center gap-1.5">
            <i data-lucide="repeat" class="w-3.5 h-3.5 text-slate-400"></i>
            <span><strong>Frequency:</strong> ${m.frequency}</span>
          </div>
          ${m.instructions ? `
            <div class="flex items-center gap-1.5">
              <i data-lucide="info" class="w-3.5 h-3.5 text-slate-400"></i>
              <span>${m.instructions}</span>
            </div>
          ` : ''}
          ${m.prescribed_by ? `
            <div class="flex items-center gap-1.5">
              <i data-lucide="user-check" class="w-3.5 h-3.5 text-slate-400"></i>
              <span>Prescriber: ${m.prescribed_by}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
        <button onclick="toggleMedTaken(${m.id})" class="flex items-center gap-1.5 text-xs font-bold ${m.taken_today ? 'text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg' : 'text-slate-600 hover:text-emerald-600'}">
          <i data-lucide="${m.taken_today ? 'check-circle-2' : 'circle'}" class="w-4 h-4 text-emerald-600"></i>
          <span>${m.taken_today ? 'Taken Today' : 'Mark as Taken'}</span>
        </button>
        <button onclick="deleteMedication(${m.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
        </button>
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
  } catch (err) {
    alert('Error saving medication: ' + err.message);
  }
}

async function toggleMedTaken(id) {
  try {
    await fetch(`/api/medications/${id}/toggle-taken`, { method: 'POST' });
    if (state.activeTab === 'overview') {
      loadOverview();
    } else {
      loadMedications();
    }
  } catch (err) {
    console.error('Error toggling medication:', err);
  }
}

async function deleteMedication(id) {
  if (!confirm('Delete this medication record?')) return;
  try {
    await fetch(`/api/medications/${id}`, { method: 'DELETE' });
    await loadMedications();
  } catch (err) {
    alert('Failed to delete medication: ' + err.message);
  }
}

// ==========================================
// CONDITIONS TAB
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
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <i data-lucide="stethoscope" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-sm">${c.condition_name}</h3>
              <span class="text-xs text-slate-500">Diagnosed: ${c.diagnosed_date || 'N/A'}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 text-[10px] font-bold rounded-full ${c.status === 'Active' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">
            ${c.status} (${c.severity})
          </span>
        </div>

        <div class="mt-4 space-y-2 text-xs text-slate-600">
          ${c.treatment_plan ? `
            <div class="p-3 bg-slate-50 rounded-xl border border-slate-100">
              <strong class="text-slate-800 block mb-0.5">Treatment & Advice:</strong>
              <span>${c.treatment_plan}</span>
            </div>
          ` : ''}
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
        <button onclick="deleteCondition(${c.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
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
  } catch (err) {
    alert('Error saving condition: ' + err.message);
  }
}

async function deleteCondition(id) {
  if (!confirm('Delete this condition?')) return;
  try {
    await fetch(`/api/conditions/${id}`, { method: 'DELETE' });
    await loadConditions();
  } catch (err) {
    alert('Failed to delete condition: ' + err.message);
  }
}

// ==========================================
// ALLERGIES TAB
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
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No allergies recorded for this individual.</div>';
    return;
  }

  container.innerHTML = allergies.map(a => `
    <div class="bg-white rounded-2xl border ${a.severity === 'Severe' ? 'border-red-300 bg-red-50/20' : 'border-slate-200'} p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl ${a.severity === 'Severe' ? 'bg-red-100 text-red-700' : 'bg-rose-50 text-rose-600'} flex items-center justify-center shrink-0">
              <i data-lucide="shield-alert" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-sm">${a.allergen}</h3>
              <span class="text-xs text-slate-500">${a.allergy_type} Allergen</span>
            </div>
          </div>
          <span class="px-2.5 py-0.5 text-[10px] font-black rounded-full ${a.severity === 'Severe' ? 'bg-red-600 text-white animate-pulse' : 'bg-amber-100 text-amber-800'}">
            ${a.severity}
          </span>
        </div>

        <div class="mt-4 space-y-2 text-xs">
          <div class="p-2.5 bg-white border border-slate-200 rounded-xl">
            <strong class="text-slate-900 block mb-0.5">Reaction Symptoms:</strong>
            <span class="text-slate-700 font-medium">${a.reaction}</span>
          </div>
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
        <button onclick="deleteAllergy(${a.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
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
  } catch (err) {
    alert('Error saving allergy: ' + err.message);
  }
}

async function deleteAllergy(id) {
  if (!confirm('Delete this allergy record?')) return;
  try {
    await fetch(`/api/allergies/${id}`, { method: 'DELETE' });
    await loadAllergies();
  } catch (err) {
    alert('Failed to delete allergy: ' + err.message);
  }
}

// ==========================================
// LAB RESULTS TAB
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
      btn.className = 'lab-cat-pill active px-3 py-1.5 text-xs font-bold rounded-lg bg-slate-900 text-white transition-all';
    } else {
      btn.className = 'lab-cat-pill px-3 py-1.5 text-xs font-bold rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 transition-all';
    }
  });
  loadLabs();
}

function renderLabs() {
  const tbody = document.getElementById('labsTableBody');
  if (!tbody) return;

  if (state.labsData.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-8 text-center text-slate-400">No lab results found. Click "+ Log Lab Test" to add reports.</td></tr>';
    return;
  }

  tbody.innerHTML = state.labsData.map(l => `
    <tr class="hover:bg-slate-50 transition-colors">
      <td class="px-4 py-3">
        <div class="font-bold text-slate-900">${l.test_name}</div>
        <span class="text-[10px] text-slate-400 font-semibold uppercase">${l.category}</span>
      </td>
      <td class="px-4 py-3 font-semibold text-slate-700">${l.test_date}</td>
      <td class="px-4 py-3 font-black text-slate-900 text-sm">
        ${l.result_value} <span class="text-xs text-slate-500 font-normal">${l.unit || ''}</span>
      </td>
      <td class="px-4 py-3 text-slate-600 font-medium">${l.reference_range || '-'}</td>
      <td class="px-4 py-3">
        <span class="px-2 py-0.5 text-[10px] font-bold rounded-md ${
          l.status === 'Normal' ? 'bg-emerald-100 text-emerald-800' :
          l.status === 'High' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
        }">${l.status}</span>
      </td>
      <td class="px-4 py-3 text-slate-600">
        <div>${l.ordered_by || 'PHC Doctor'}</div>
      </td>
      <td class="px-4 py-3 text-slate-500 truncate max-w-[150px]">${l.notes || '-'}</td>
      <td class="px-4 py-3 text-right">
        <button onclick="deleteLabResult(${l.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
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
  } catch (err) {
    alert('Error saving lab result: ' + err.message);
  }
}

async function deleteLabResult(id) {
  if (!confirm('Delete this lab report?')) return;
  try {
    await fetch(`/api/lab-results/${id}`, { method: 'DELETE' });
    await loadLabs();
  } catch (err) {
    alert('Failed to delete lab result: ' + err.message);
  }
}

// ==========================================
// VACCINATIONS TAB
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
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="flex items-center gap-2.5">
            <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <i data-lucide="syringe" class="w-5 h-5"></i>
            </div>
            <div>
              <h3 class="font-bold text-slate-900 text-sm">${v.vaccine_name}</h3>
              <span class="text-xs font-semibold text-indigo-700">${v.dose_number}</span>
            </div>
          </div>
          <span class="px-2 py-0.5 text-[10px] font-bold rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200">
            Administered
          </span>
        </div>

        <div class="mt-4 space-y-1 text-xs text-slate-600">
          <div><strong>Date:</strong> ${v.administered_date}</div>
          ${v.next_due_date ? `<div class="text-teal-700 font-bold"><strong>Next Due:</strong> ${v.next_due_date}</div>` : ''}
          ${v.administered_by ? `<div>Staff: ${v.administered_by}</div>` : ''}
          ${v.clinic_site ? `<div>Site: ${v.clinic_site}</div>` : ''}
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
        <button onclick="deleteVaccine(${v.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
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
  } catch (err) {
    alert('Error saving vaccine: ' + err.message);
  }
}

async function deleteVaccine(id) {
  if (!confirm('Delete this vaccine record?')) return;
  try {
    await fetch(`/api/immunizations/${id}`, { method: 'DELETE' });
    await loadVaccines();
  } catch (err) {
    alert('Failed to delete vaccine: ' + err.message);
  }
}

// ==========================================
// DOCTOR VISITS TAB
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
    <div class="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="font-bold text-slate-900 text-base">${v.doctor_name}</h3>
            <span class="px-2 py-0.5 text-xs font-semibold bg-orange-50 text-orange-700 rounded-md">${v.clinic_hospital || 'PHC'}</span>
          </div>
          <div class="text-xs text-slate-500 mt-0.5">Visit Date: <strong>${v.visit_date}</strong></div>
        </div>
        ${v.follow_up_date ? `
          <div class="px-3 py-1 bg-teal-50 border border-teal-200 rounded-xl text-teal-800 text-xs font-bold flex items-center gap-1.5 self-start">
            <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
            <span>Follow-up: ${v.follow_up_date}</span>
          </div>
        ` : ''}
      </div>

      <div class="mt-4 space-y-2 text-xs">
        <div>
          <strong class="text-slate-900 block mb-0.5">Reason for Visit:</strong>
          <span class="text-slate-700 font-medium">${v.reason_for_visit}</span>
        </div>
        ${v.recommendations ? `
          <div class="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl text-indigo-900">
            <strong class="text-indigo-950 block mb-1">Doctor's Advice & Prescription:</strong>
            <span>${v.recommendations}</span>
          </div>
        ` : ''}
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100 flex justify-end">
        <button onclick="deleteVisit(${v.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
          <i data-lucide="trash-2" class="w-4 h-4"></i>
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
  } catch (err) {
    alert('Error saving consultation: ' + err.message);
  }
}

async function deleteVisit(id) {
  if (!confirm('Delete this consultation?')) return;
  try {
    await fetch(`/api/consultations/${id}`, { method: 'DELETE' });
    await loadVisits();
  } catch (err) {
    alert('Failed to delete consultation: ' + err.message);
  }
}

// ==========================================
// DOCUMENTS TAB
// ==========================================

async function loadAttachments() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/attachments/${state.activeProfileId}`);
    const attachments = await res.json();
    renderAttachments(attachments);
    lucide.createIcons();
  } catch (err) {
    console.error('Error loading attachments:', err);
  }
}

function renderAttachments(attachments) {
  const container = document.getElementById('attachmentsGrid');
  if (!container) return;

  if (attachments.length === 0) {
    container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400">No documents uploaded. Click "Upload Document" to store lab scans or PDFs.</div>';
    return;
  }

  container.innerHTML = attachments.map(a => `
    <div class="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col justify-between hover:shadow-md transition-all">
      <div>
        <div class="flex items-start justify-between gap-2">
          <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center font-black text-xs uppercase shrink-0">
            ${a.file_type || 'FILE'}
          </div>
          <button onclick="deleteAttachment(${a.id})" class="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>

        <div class="mt-3">
          <h4 class="font-bold text-slate-900 text-xs truncate" title="${a.original_filename}">${a.original_filename}</h4>
          <span class="text-[10px] text-slate-400">${(a.file_size / 1024).toFixed(1)} KB &bull; ${a.uploaded_at.split(' ')[0]}</span>
          ${a.description ? `<p class="text-xs text-slate-600 mt-1 line-clamp-2">${a.description}</p>` : ''}
        </div>
      </div>

      <div class="mt-4 pt-3 border-t border-slate-100">
        <a href="${a.url}" target="_blank" class="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-all">
          <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
          <span>View / Download</span>
        </a>
      </div>
    </div>
  `).join('');
}

async function handleUploadFile(e) {
  e.preventDefault();
  const fileInput = document.getElementById('uploadFileSelect');
  if (!fileInput.files[0]) return;

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('profile_id', state.activeProfileId);
  formData.append('description', document.getElementById('uploadFileDesc').value);

  try {
    const res = await fetch('/api/attachments/upload', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Upload failed');
    closeModal('uploadDocumentModal');
    document.getElementById('uploadForm').reset();
    await loadAttachments();
  } catch (err) {
    alert('Upload error: ' + err.message);
  }
}

async function deleteAttachment(id) {
  if (!confirm('Delete this document?')) return;
  try {
    await fetch(`/api/attachments/${id}`, { method: 'DELETE' });
    await loadAttachments();
  } catch (err) {
    alert('Failed to delete attachment: ' + err.message);
  }
}

// ==========================================
// EMERGENCY ABHA MEDICAL CARD
// ==========================================

async function loadEmergencyCard() {
  if (!state.activeProfileId) return;

  try {
    const res = await fetch(`/api/emergency/${state.activeProfileId}`);
    const data = await res.json();
    const p = data.profile;

    document.getElementById('emCardName').textContent = p.full_name;
    document.getElementById('emCardABHA').textContent = p.abha_number || '14-5234-8901-2345';
    document.getElementById('emCardABHAAddr').textContent = p.abha_address || 'citizen@abdm';
    document.getElementById('emCardDOB').textContent = p.date_of_birth;
    document.getElementById('emCardBlood').textContent = p.blood_group || 'B+';

    // Allergies
    const allergiesContainer = document.getElementById('emCardAllergies');
    if (data.allergies.length > 0) {
      allergiesContainer.innerHTML = data.allergies.map(a => `
        <div>&bull; <strong>${a.allergen}</strong> (${a.severity}): ${a.reaction}</div>
      `).join('');
    } else {
      allergiesContainer.innerHTML = '<span class="text-slate-600 font-normal">No known severe drug or food allergies.</span>';
    }

    // Conditions
    const condContainer = document.getElementById('emCardConditions');
    if (data.conditions.length > 0) {
      condContainer.innerHTML = data.conditions.map(c => `<li>&bull; ${c.condition_name} (${c.status})</li>`).join('');
    } else {
      condContainer.innerHTML = '<li class="text-slate-400 italic">None documented</li>';
    }

    // Medications
    const medsContainer = document.getElementById('emCardMeds');
    if (data.medications.length > 0) {
      medsContainer.innerHTML = data.medications.map(m => `<li>&bull; ${m.medication_name} - ${m.dosage}</li>`).join('');
    } else {
      medsContainer.innerHTML = '<li class="text-slate-400 italic">No active prescriptions</li>';
    }

    // ICE Contact
    document.getElementById('emCardICEContact').textContent = p.emergency_contact_name ? `${p.emergency_contact_name} (${p.emergency_contact_relation || 'ICE'})` : 'Not set';
    document.getElementById('emCardICEPhone').textContent = p.emergency_contact_phone || 'N/A';

    // Render Official ABHA QR Code
    const qrContainer = document.getElementById('emQRCode');
    qrContainer.innerHTML = '';
    const abhaQRString = `ABHA HEALTH ID\nABHA No: ${p.abha_number}\nABHA Address: ${p.abha_address}\nName: ${p.full_name}\nDOB: ${p.date_of_birth}\nBlood: ${p.blood_group}\nICE: ${p.emergency_contact_name} (${p.emergency_contact_phone})\nAllergies: ${data.allergies.map(a => a.allergen).join(', ')}`;
    
    new QRCode(qrContainer, {
      text: abhaQRString,
      width: 72,
      height: 72,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M
    });

  } catch (err) {
    console.error('Error loading emergency card:', err);
  }
}

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
    dlAnchor.setAttribute("download", `Ayushman_ABHA_Record_${state.currentProfile.full_name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
  } catch (err) {
    alert('Export error: ' + err.message);
  }
}

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
      alert('ABHA health record backup imported successfully!');
      closeModal('exportModal');
      await loadProfiles();
      selectProfile(result.id);
    } catch (err) {
      alert('Failed to parse and import backup JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
}

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
