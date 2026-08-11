const state = {
  dashboard: null,
  searchResults: [],
  scanPhotoDataUrl: '',
  latestScanText: '',
  latestExtraction: null,
  latestOcrDiagnostics: [],
  editingRecordId: null,
  authToken: localStorage.getItem('carecompass-token') || '',
  currentUser: JSON.parse(localStorage.getItem('carecompass-user') || 'null'),
  activeAccountUsername: '',
  viewingSelf: true,
  familyAccounts: [],
  dashboardRequestSeq: 0,
  activeTab: localStorage.getItem('carecompass-active-tab') || 'dashboard'
};

let apiDiscoveryPromise = null;

function isNativeApp() {
  return Boolean(window.Capacitor);
}

function getStoredApiBase() {
  return String(localStorage.getItem('carecompass-api-base') || '').trim().replace(/\/$/, '');
}

function setStoredApiBase(value) {
  const normalized = String(value || '').trim().replace(/\/$/, '');
  if (normalized) {
    localStorage.setItem('carecompass-api-base', normalized);
  } else {
    localStorage.removeItem('carecompass-api-base');
  }
}

function getApiCandidates() {
  const fromWindow = String(window.CARECOMPASS_API_BASE || '').trim().replace(/\/$/, '');
  const fromQuery = String(new URLSearchParams(window.location.search).get('apiBase') || '').trim().replace(/\/$/, '');
  const fromStorage = getStoredApiBase();
  const candidates = [
    fromWindow,
    fromQuery,
    fromStorage,
    'http://10.0.2.2:3000',
    'http://10.0.2.2:3001',
    'http://192.168.1.7:3001',
    'http://192.168.1.7:3000',
    'http://192.168.1.10:3000',
    'http://192.168.1.10:3001',
    'http://192.168.0.7:3001',
    'http://192.168.0.7:3000',
    'http://192.168.0.10:3001',
    'http://192.168.0.10:3000'
  ].filter(Boolean);

  return [...new Set(candidates)];
}

async function canReachApi(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);

  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return Boolean(res.ok && data.status === 'ok');
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function discoverAndStoreApiBase() {
  if (!isNativeApp()) {
    return '';
  }

  const stored = getStoredApiBase();
  if (stored) {
    const reachable = await canReachApi(stored);
    if (reachable) {
      return stored;
    }
  }

  const candidates = getApiCandidates();
  const results = await Promise.all(candidates.map(async (candidate) => ({
    candidate,
    reachable: await canReachApi(candidate)
  })));

  for (const result of results) {
    if (result.reachable) {
      setStoredApiBase(result.candidate);
      return result.candidate;
    }
  }

  return '';
}

async function ensureApiBase() {
  if (!isNativeApp()) {
    return '';
  }

  if (!apiDiscoveryPromise) {
    apiDiscoveryPromise = discoverAndStoreApiBase().finally(() => {
      apiDiscoveryPromise = null;
    });
  }

  return apiDiscoveryPromise;
}

function resolveApiUrl(url) {
  const raw = String(url || '');
  if (!raw) {
    return raw;
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  if (!raw.startsWith('/')) {
    return raw;
  }

  const base = getStoredApiBase();
  return base ? `${base}${raw}` : raw;
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

async function fetchJson(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (state.authToken) {
    headers.Authorization = `Bearer ${state.authToken}`;
  }

  const isRelativeUrl = String(url || '').startsWith('/');
  if (isRelativeUrl && isNativeApp()) {
    await ensureApiBase();
  }

  let res;
  try {
    res = await fetch(resolveApiUrl(url), { ...options, headers });
  } catch (error) {
    if (isRelativeUrl && isNativeApp()) {
      await ensureApiBase();
      try {
        res = await fetch(resolveApiUrl(url), { ...options, headers });
      } catch (retryError) {
        return {
          success: false,
          _networkError: true,
          message: 'Unable to connect to the server. Please check backend availability and try again.'
        };
      }
    } else {
      return {
        success: false,
        _networkError: true,
        message: 'Unable to connect to the server. Please try again in a moment.'
      };
    }
  }

  if (!res) {
    return {
      success: false,
      _networkError: true,
      message: 'Unable to connect to the server. Please try again in a moment.'
    };
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const noApiBase = !getStoredApiBase();
    if (isRelativeUrl && isNativeApp() && noApiBase && !data.message) {
      return {
        success: false,
        _networkError: true,
        message: 'Cannot find the backend server. Make sure phone and backend are on the same Wi-Fi network.'
      };
    }

    return {
      success: false,
      _networkError: false,
      message: data.message || `Request failed (${res.status})`
    };
  }

  if (res.status === 401 && !url.startsWith('/api/auth/')) {
    clearAuthSession('Your session expired. Please login again.');
  }

  return { ...data, _networkError: false };
}

function redirectToLogin(message = '') {
  const next = encodeURIComponent('/');
  const query = message ? `?next=${next}&message=${encodeURIComponent(message)}` : `?next=${next}`;
  window.location.href = `/login.html${query}`;
}

function updateActiveUserLabel() {
  const label = document.getElementById('activeUserLabel');
  if (!label) {
    return;
  }
  label.textContent = state.currentUser ? `${state.currentUser.displayName || state.currentUser.username}` : 'Not signed in';
}

function updateViewingAccountLabel() {
  const label = document.getElementById('viewingAccountLabel');
  if (!label || !state.dashboard?.viewingAccount) {
    if (label) {
      label.hidden = true;
      label.textContent = '';
    }
    return;
  }

  if (state.dashboard.viewingAccount.isSelf) {
    label.hidden = true;
    label.textContent = '';
    return;
  }

  label.hidden = false;
  label.textContent = `Viewing: ${state.dashboard.viewingAccount.displayName}`;
}

function setStatus(message, type = 'info') {
  const status = document.getElementById('appStatus');
  if (!status) {
    return;
  }

  if (!message) {
    status.hidden = true;
    status.textContent = '';
    status.style.borderColor = '#bfdbfe';
    status.style.background = '#eff6ff';
    status.style.color = '#1e3a8a';
    return;
  }

  const styles = {
    info: { border: '#bfdbfe', bg: '#eff6ff', color: '#1e3a8a' },
    success: { border: '#86efac', bg: '#f0fdf4', color: '#166534' },
    warning: { border: '#facc15', bg: '#fef9c3', color: '#713f12' },
    error: { border: '#fca5a5', bg: '#fef2f2', color: '#991b1b' }
  };

  const mode = styles[type] || styles.info;
  status.hidden = false;
  status.textContent = message;
  status.style.borderColor = mode.border;
  status.style.background = mode.bg;
  status.style.color = mode.color;
}

function setReadOnlyMode(isReadOnly) {
  const mutatingFormIds = [
    'recordForm',
    'metricForm',
    'planForm',
    'medicineReminderForm',
    'visitReminderForm',
    'familyForm',
    'familyAccountLinkForm'
  ];

  mutatingFormIds.forEach((formId) => {
    const form = document.getElementById(formId);
    if (!form) {
      return;
    }

    form.querySelectorAll('input, textarea, button, select').forEach((element) => {
      element.disabled = isReadOnly;
    });
  });

  const searchInput = document.getElementById('searchInput');
  const searchButton = document.getElementById('searchButton');
  if (searchInput) searchInput.disabled = false;
  if (searchButton) searchButton.disabled = false;

  const chatInput = document.getElementById('chatInput');
  const chatButton = document.getElementById('chatButton');
  if (chatInput) chatInput.disabled = false;
  if (chatButton) chatButton.disabled = false;

  const notice = document.getElementById('viewModeNotice');
  if (notice) {
    notice.hidden = !isReadOnly;
  }
}

function getActiveAccountQuery() {
  if (!state.activeAccountUsername) {
    return '';
  }
  return `account=${encodeURIComponent(state.activeAccountUsername)}`;
}

function showAppShell() {
  const appShell = document.getElementById('appShell');
  if (appShell) appShell.hidden = false;
  updateActiveUserLabel();
  setActiveTab(state.activeTab || 'dashboard');
}

function clearAuthSession(message) {
  state.authToken = '';
  state.currentUser = null;
  state.dashboard = null;
  state.activeTab = 'dashboard';
  localStorage.removeItem('carecompass-token');
  localStorage.removeItem('carecompass-user');
  resetRecordEditor(true);
  redirectToLogin(message || 'Please login to continue.');
}

function setActiveTab(tabName) {
  const nextTab = String(tabName || 'dashboard');
  state.activeTab = nextTab;
  localStorage.setItem('carecompass-active-tab', nextTab);

  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    const isActive = panel.getAttribute('data-tab-panel') === nextTab;
    panel.classList.toggle('is-active', isActive);
  });

  document.querySelectorAll('[data-tab-target]').forEach((button) => {
    const isActive = button.getAttribute('data-tab-target') === nextTab;
    button.classList.toggle('is-active', isActive);
  });
}

function initTabs() {
  document.querySelectorAll('[data-tab-target]').forEach((button) => {
    button.addEventListener('click', () => {
      setActiveTab(button.getAttribute('data-tab-target'));
    });
  });
}

function initQuickActions() {
  document.querySelectorAll('[data-quick-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const tab = button.getAttribute('data-quick-tab');
      if (tab) {
        setActiveTab(tab);
        setStatus(`Opened ${tab.charAt(0).toUpperCase()}${tab.slice(1)} section.`, 'info');
      }
    });
  });
}

async function hydrateAuthSession() {
  if (!state.authToken) {
    redirectToLogin('Please login to access your reports.');
    return false;
  }

  const data = await fetchJson('/api/auth/me');
  if (data._networkError) {
    clearAuthSession('Cannot reach the backend API. Please try again shortly.');
    return false;
  }

  if (!data.success) {
    clearAuthSession('Please login to access your saved reports.');
    return false;
  }

  state.currentUser = data.user;
  state.activeAccountUsername = data.user.username;
  localStorage.setItem('carecompass-user', JSON.stringify(data.user));
  showAppShell();
  return true;
}

function renderDashboard(data) {
  state.dashboard = data;
  state.familyAccounts = data.familyAccounts || [];
  const currentUsername = normalizeUsername(state.currentUser?.username || state.activeAccountUsername);
  const viewedUsername = normalizeUsername(data.viewingAccount?.username || state.activeAccountUsername);

  // Only enter read-only mode when we can confidently prove the viewed account is different.
  if (currentUsername && viewedUsername) {
    state.viewingSelf = viewedUsername === currentUsername;
  } else {
    state.viewingSelf = true;
  }

  if (data.viewingAccount?.username) {
    state.activeAccountUsername = data.viewingAccount.username;
  }

  updateViewingAccountLabel();
  setReadOnlyMode(!state.viewingSelf);

  document.getElementById('todayList').innerHTML = data.summary.medicinesToday
    .map((item) => `<li>${item}</li>`)
    .join('');
  document.getElementById('visitList').innerHTML = data.summary.visits
    .map((item) => `<li>${item}</li>`)
    .join('');
  document.getElementById('testsList').innerHTML = data.summary.pendingTests
    .map((item) => `<li>${item}</li>`)
    .join('');
  document.getElementById('uploadList').innerHTML = data.summary.recentUploads
    .map((item) => `<li>${item}</li>`)
    .join('');
  document.getElementById('aiSummary').textContent = data.summary.aiInsight;
  document.getElementById('riskBadge').textContent = `Risk level: ${data.summary.riskLevel || 'Stable'}`;
  document.getElementById('nextAction').textContent = data.summary.nextBestAction || '';

  document.getElementById('planList').innerHTML = (data.plans || []).length ? data.plans.map((plan) => `
    <div class="result-item">
      <strong>${plan.name}</strong><br />
      ${plan.schedule}<br />
      Reminder: ${plan.reminder}
    </div>
  `).join('') : '<div class="result-item">No recording plans yet. Add one above.</div>';

  document.getElementById('medicineList').innerHTML = (data.medicationReminders || []).length ? data.medicationReminders.map((item) => `
    <div class="result-item">
      <strong>${item.medicine}</strong><br />
      ${item.time} • ${item.note}
    </div>
  `).join('') : '<div class="result-item">No medication reminders yet. Add one above.</div>';

  document.getElementById('visitReminderList').innerHTML = (data.visitReminders || []).length ? data.visitReminders.map((item) => `
    <div class="result-item">
      <strong>${item.title}</strong><br />
      Due: ${item.due} • ${item.type}
    </div>
  `).join('') : '<div class="result-item">No doctor visit reminders yet. Add one above.</div>';

  document.getElementById('metricsList').innerHTML = (data.metrics || []).length ? data.metrics.map((item) => `
    <div class="metric-item">
      <strong>${item.metric}</strong> — ${item.value} (${item.time}, ${item.date})
    </div>
  `).join('') : '<div class="result-item">No readings yet. Log your first reading above.</div>';

  const familyAccountsMarkup = (state.familyAccounts || []).map((account) => `
    <div class="profile-item">
      <strong>${account.displayName}</strong> (${account.relation})<br />
      Username: ${account.username}<br />
      ${account.isSelf ? 'Primary signed-in account' : 'Linked family account'}
      <div class="result-actions">
        <button type="button" class="inline-button secondary" data-switch-account="${account.username}">View this account</button>
      </div>
    </div>
  `).join('');

  const familyProfilesMarkup = (data.profiles || []).length ? data.profiles.map((profile) => `
    <div class="profile-item">
      <strong>${profile.name}</strong> (${profile.relation})<br />
      Blood group: ${profile.emergency}<br />
      Allergies: ${profile.allergies.length ? profile.allergies.join(', ') : 'None'}<br />
      Current medicines: ${profile.medicines.join(', ')}
    </div>
  `).join('') : '<div class="result-item">No local family profiles added yet.</div>';

  document.getElementById('familyList').innerHTML = `${familyAccountsMarkup}${familyProfilesMarkup}`;

  const primaryProfile = (data.profiles || [])[0] || {
    name: data.patient?.name || 'Not available',
    emergency: data.patient?.bloodGroup || 'Unknown',
    allergies: [],
    medicines: []
  };

  document.getElementById('emergencyCard').innerHTML = `
    <div class="result-item"><strong>Primary profile:</strong> ${primaryProfile.name}</div>
    <div class="result-item"><strong>Blood group:</strong> ${primaryProfile.emergency}</div>
    <div class="result-item"><strong>Allergies:</strong> ${primaryProfile.allergies.join(', ') || 'None'}</div>
    <div class="result-item"><strong>Current meds:</strong> ${primaryProfile.medicines.join(', ') || 'None'}</div>
  `;

  document.getElementById('timelineList').innerHTML = (data.records || []).length ? data.records.map((record) => `
    <div class="timeline-step">
      <strong>${record.visitDate}</strong> — ${record.diagnosis} at ${record.hospital}<br />
      Doctor: ${record.doctor} • ${record.type}
      ${state.viewingSelf ? `<div class="result-actions"><button type="button" class="inline-button secondary" data-edit-record-id="${record.id}">Edit report</button></div>` : ''}
    </div>
  `).join('') : '<div class="result-item">No timeline records yet. Save a report to start timeline tracking.</div>';

  renderResults(data.records);
}

function renderResults(results) {
  state.searchResults = results;
  document.getElementById('resultsContainer').innerHTML = (results || []).length ? results.map((record) => `
    <div class="result-item">
      <strong>${record.type}</strong> • ${record.disease}<br />
      ${record.doctor} at ${record.hospital}<br />
      Diagnosis: ${record.diagnosis}<br />
      Medicines: ${record.medicines.join(', ')}
      ${state.viewingSelf ? `<div class="result-actions"><button type="button" class="inline-button secondary" data-edit-record-id="${record.id}">Edit report</button></div>` : ''}
    </div>
  `).join('') : '<div class="result-item">No matching reports found.</div>';
}

function getRecordForm() {
  return document.getElementById('recordForm');
}

function findRecordById(recordId) {
  const allRecords = state.dashboard?.records || [];
  return allRecords.find((record) => String(record.id) === String(recordId)) || null;
}

function updateRecordFormMode() {
  const banner = document.getElementById('recordEditBanner');
  const cancelButton = document.getElementById('cancelEditButton');
  const submitButton = document.getElementById('recordSubmitButton');
  const form = getRecordForm();
  if (!banner || !cancelButton || !submitButton || !form) {
    return;
  }

  const idField = form.querySelector('[name="recordId"]');
  const isEditing = Boolean(state.editingRecordId);

  banner.hidden = !isEditing;
  cancelButton.hidden = !isEditing;
  submitButton.textContent = isEditing ? 'Update report' : 'Save scanned record';
  if (idField) {
    idField.value = isEditing ? String(state.editingRecordId) : '';
  }
}

function resetRecordEditor(resetForm = false) {
  state.editingRecordId = null;
  state.latestScanText = '';
  state.latestExtraction = null;
  state.scanPhotoDataUrl = '';
  state.latestOcrDiagnostics = [];

  const form = getRecordForm();
  if (form && resetForm) {
    form.reset();
  }

  const photo = document.getElementById('photoPreview');
  if (photo) {
    photo.hidden = true;
    photo.removeAttribute('src');
  }

  setDocumentTextValue('');
  renderExtractionReview(null);
  updateRecordFormMode();
}

function populateRecordForm(record) {
  const form = getRecordForm();
  if (!form || !record) {
    return;
  }

  state.editingRecordId = record.id;
  state.latestExtraction = record;
  state.latestScanText = '';

  const mappings = {
    recordId: record.id,
    type: record.type || 'Prescription',
    hospital: record.hospital || '',
    patientName: record.patientName || '',
    doctor: record.doctor || '',
    specialization: record.specialization || '',
    visitDate: record.visitDate || '',
    followUpDate: record.followUpDate || '',
    diagnosis: record.diagnosis || '',
    disease: record.disease || '',
    medicines: (record.medicines || []).join(', '),
    tests: (record.tests || []).join(', '),
    summary: record.summary || '',
    documentText: ''
  };

  Object.entries(mappings).forEach(([name, value]) => {
    const field = form.querySelector(`[name="${name}"]`) || (name === 'documentText' ? document.getElementById('documentText') : null);
    if (field) {
      field.value = value;
    }
  });

  renderExtractionReview({
    summary: 'Editing saved report. Update the values and save to overwrite this record.',
    diagnosis: record.diagnosis || '',
    disease: record.disease || '',
    medicines: record.medicines || [],
    tests: record.tests || []
  });
  setActiveTab('scanner');
  updateRecordFormMode();
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderReviewChips(containerId, values) {
  const container = document.getElementById(containerId);
  if (!container) {
    return;
  }

  const items = (values || []).filter(Boolean);
  container.innerHTML = items.length
    ? items.map((item) => `<span class="review-chip">${item}</span>`).join('')
    : '<span class="review-value">No strong match detected</span>';
}

function renderExtractionReview(extracted) {
  state.latestExtraction = extracted || null;

  const summaryEl = document.getElementById('extractionSummary');
  const statusEl = document.getElementById('extractionStatus');
  const diagnosisEl = document.getElementById('reviewDiagnosis');
  const diseaseEl = document.getElementById('reviewDisease');

  if (!summaryEl || !statusEl || !diagnosisEl || !diseaseEl) {
    return;
  }

  if (!extracted) {
    statusEl.textContent = 'Waiting for scan';
    summaryEl.textContent = 'Run AI extraction to review cleaned medicines, diagnoses, and tests.';
    diagnosisEl.textContent = 'Not available yet';
    diseaseEl.textContent = 'Not available yet';
    renderReviewChips('reviewMedicines', []);
    renderReviewChips('reviewTests', []);
    return;
  }

  const summary = extracted.summary || 'Extraction completed.';
  const hasStrongOutput = Boolean(extracted.diagnosis || extracted.disease || (extracted.medicines || []).length || (extracted.tests || []).length);

  statusEl.textContent = hasStrongOutput ? 'Normalized' : 'Needs review';
  summaryEl.textContent = summary;
  diagnosisEl.textContent = extracted.diagnosis || 'No normalized diagnosis detected';
  diseaseEl.textContent = extracted.disease || 'No normalized disease detected';
  renderReviewChips('reviewMedicines', extracted.medicines || []);
  renderReviewChips('reviewTests', extracted.tests || []);
}

function setDocumentTextValue(value) {
  const textarea = document.getElementById('documentText');
  if (textarea) {
    textarea.value = value;
  }
}

function buildOcrDiagnosticsText(outputs) {
  const lines = ['OCR diagnostics:'];
  outputs.forEach((output, index) => {
    const preview = String(output.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    lines.push(`Pass ${index + 1} [${output.bucket}, psm ${output.psm}] score=${Math.round(output.score)} confidence=${Math.round(output.confidence || 0)} text=${preview || '<empty>'}`);
  });
  return lines.join('\n');
}

function normalizeFieldValue(value) {
  return String(value || '')
    .replace(/^\s*(?:doctor|hospital|diagnosis|disease|medication|medicines|test|tests|summary|specialization|visit date|follow-up date)\s*[:\-]?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeEncodedBlob(value) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }
  if (/^data:image\/[a-z]+;base64,/i.test(text)) {
    return true;
  }
  return text.length > 60 && /^[A-Za-z0-9+/=\s]+$/.test(text) && /[+/=]/.test(text);
}

function isReadableFieldValue(value) {
  const text = String(value || '').trim();
  if (!text || looksLikeEncodedBlob(text) || text.length > 120) {
    return false;
  }

  const letters = (text.match(/[A-Za-z]/g) || []).length;
  const digits = (text.match(/\d/g) || []).length;
  const symbols = (text.match(/[^A-Za-z0-9\s,./()%-]/g) || []).length;

  return letters >= 2 && digits <= letters * 2 && symbols <= Math.max(3, Math.floor(letters / 3));
}

function safeValue(value) {
  const normalized = normalizeFieldValue(value);
  return isReadableFieldValue(normalized) ? normalized : '';
}

function inferDiagnosisFromMedicine(medicineText) {
  const lower = String(medicineText || '').toLowerCase();
  if (/\b(diabet(?:es|ic)?|hba1c|glucose|metformin)\b/i.test(lower)) return 'Diabetes';
  if (/\b(hypertension|high\s*b\.?p\.?|amlodipine|telmisartan|losartan)\b/i.test(lower)) return 'Hypertension';
  if (/\b(cholesterol|lipid|ldl|statin|atorvastatin|rosuvastatin)\b/i.test(lower)) return 'Dyslipidemia';
  if (/\b(gastritis|acidity|reflux|pantoprazole)\b/i.test(lower)) return 'Gastritis / Acid reflux';
  if (/\b(fever|viral|paracetamol|acetaminophen|amoxicillin)\b/i.test(lower)) return 'Fever / Infection';
  if (/\b(arthralgia|joint pain|back pain|ibuprofen)\b/i.test(lower)) return 'Pain / Inflammation';
  if (/\b(hypothyroid|thyroid|tsh|levothyroxine|thyronorm)\b/i.test(lower)) return 'Hypothyroidism';
  return '';
}

function extractMedicineCandidatesFromText(lines) {
  const candidates = [];
  const seen = new Set();

  const medicinePattern = /\b(metformin|amlodipine|ibuprofen|aspirin|digoxin|atorvastatin|rosuvastatin|telmisartan|losartan|pantoprazole|levothyroxine|thyronorm|paracetamol|acetaminophen|amoxicillin|vitamin)\b/i;

  lines.forEach((line) => {
    const hasDosage = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|mmol)\b/i.test(line);
    const hasInstruction = /\b(tab\.?|tablet|cap\.?|capsule|syrup|drops|ointment|take|use|od|bd|tid|qid|hs|prn)\b/i.test(line);
    const hasMedicineToken = medicinePattern.test(line);

    if (!hasDosage && !hasInstruction && !hasMedicineToken) {
      return;
    }

    const cleaned = line
      .replace(/^\s*(?:rx|r\/|medicine|medication|take|use|dose)\s*[:\-]?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleaned) {
      return;
    }

    const key = cleaned.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(cleaned);
    }
  });

  return candidates;
}

function inferDiagnosisFromFreeText(lines, medicines) {
  const joined = `${lines.join(' ')} ${(medicines || []).join(' ')}`;
  const explicit = lines.find((line) => /\b(diagnosis|impression|provisional|condition|problem)\b/i.test(line));
  if (explicit) {
    return explicit.replace(/^\s*(?:diagnosis|impression|provisional|condition|problem)\s*[:\-]?\s*/i, '').trim();
  }

  if (/\b(diabet(?:es|ic)?|hba1c|glucose)\b/i.test(joined)) return 'Diabetes';
  if (/\b(hypertension|high\s*b\.?p\.?)\b/i.test(joined)) return 'Hypertension';
  if (/\b(cholesterol|lipid|ldl)\b/i.test(joined)) return 'Dyslipidemia';
  if (/\b(gastritis|acidity|reflux)\b/i.test(joined)) return 'Gastritis / Acid reflux';
  if (/\b(fever|viral|infection|cough|cold|urti)\b/i.test(joined)) return 'Fever / Infection';
  if (/\b(arthralgia|joint pain|back pain)\b/i.test(joined)) return 'Pain / Inflammation';
  if (/\b(hypothyroid|thyroid|tsh)\b/i.test(joined)) return 'Hypothyroidism';

  return inferDiagnosisFromMedicine(joined);
}

function hydrateFormFromDocumentText(text) {
  const lines = String(text || '')
    .split(/\n+/)
    .map((line) => line.replace(/\r/g, '').trim())
    .filter(Boolean);

  const patientIndex = lines.findIndex((line) => /for\b|full name|patient name|ms\/mr/i.test(line));
  const patientName = patientIndex >= 0 ? lines[patientIndex + 1] || '' : '';
  const doctorLine = lines.find((line) => /doctor|dr\b/i.test(line)) || '';
  const hospitalLine = lines.find((line) => /hospital|apollo|yashoda|aig/i.test(line)) || '';
  const diagnosisLine = lines.find((line) => /diagnosis|condition|problem|review/i.test(line)) || '';
  const medicationCandidates = extractMedicineCandidatesFromText(lines);
  const medicationLine = medicationCandidates[0] || '';
  const testLine = lines.find((line) => /test|lab|report|mri|scan|x-ray|ecg|cholesterol|hba1c|lipid/i.test(line)) || '';
  const diseaseLine = lines.find((line) => /diabetes|hypertension|thyroid|heart|joint|asthma|kidney|cancer|stroke|gastritis|reflux|fever|infection/i.test(line)) || diagnosisLine;
  const inferredDiagnosis = inferDiagnosisFromFreeText(lines, medicationCandidates);

  const fallback = {
    hospital: safeValue(hospitalLine.replace(/^hospital\s*[:\-]?\s*/i, '')) || '',
    patientName: safeValue(patientName) || '',
    doctor: safeValue(doctorLine.replace(/^doctor\s*[:\-]?\s*/i, '')) || '',
    diagnosis: safeValue(diagnosisLine.replace(/^diagnosis\s*[:\-]?\s*/i, '')) || safeValue(inferredDiagnosis) || '',
    disease: safeValue(diseaseLine.replace(/^disease\s*[:\-]?\s*/i, '')) || safeValue(inferredDiagnosis) || '',
    medicines: medicationCandidates.filter((item) => isReadableFieldValue(item)).join(', '),
    tests: safeValue(testLine.replace(/^test\s*[:\-]?\s*/i, '')) || '',
    summary: 'AI extraction completed from uploaded report photo or text.'
  };

  const form = document.getElementById('recordForm');
  if (!form) {
    return;
  }

  Object.entries(fallback).forEach(([name, value]) => {
    const field = form.querySelector(`[name="${name}"]`);
    if (field) {
      field.value = value;
    }
  });
}

function applyExtractedScanValues(extracted) {
  const form = document.getElementById('recordForm');
  if (!form) {
    return;
  }

  const mappings = {
    type: extracted.type || 'Prescription',
    hospital: safeValue(extracted.hospital || ''),
    patientName: safeValue(extracted.patientName || ''),
    doctor: safeValue(extracted.doctor || ''),
    specialization: safeValue(extracted.specialization || ''),
    diagnosis: safeValue(extracted.diagnosis || ''),
    disease: safeValue(extracted.disease || ''),
    medicines: (extracted.medicines || []).filter((item) => isReadableFieldValue(item)).join(', '),
    tests: (extracted.tests || []).filter((item) => isReadableFieldValue(item)).join(', '),
    summary: extracted.summary || 'AI extraction completed from uploaded report photo.'
  };

  Object.entries(mappings).forEach(([name, value]) => {
    const field = form.querySelector(`[name="${name}"]`);
    if (field) {
      field.value = value;
    }
  });

  renderExtractionReview(extracted);
}

async function loadDashboard(accountUsername = state.activeAccountUsername || state.currentUser?.username || '') {
  if (!state.authToken) {
    return;
  }
  if (accountUsername) {
    state.activeAccountUsername = accountUsername;
  }

  const requestSeq = ++state.dashboardRequestSeq;

  const query = getActiveAccountQuery();
  const data = await fetchJson(`/api/dashboard${query ? `?${query}` : ''}`);
  if (requestSeq !== state.dashboardRequestSeq) {
    return;
  }

  if (data?.patient) {
    renderDashboard(data);
  }
}

document.getElementById('searchButton').addEventListener('click', async () => {
  const term = document.getElementById('searchInput').value.trim();
  const query = getActiveAccountQuery();
  const data = await fetchJson(`/api/search?q=${encodeURIComponent(term)}${query ? `&${query}` : ''}`);
  renderResults(data.results || []);
  setStatus(`Found ${(data.results || []).length} result(s).`, 'info');
});

const scanPhotoInput = document.getElementById('scanPhotoInput');
const scanPhotoButton = document.getElementById('scanPhotoButton');
const photoPreview = document.getElementById('photoPreview');

scanPhotoButton.addEventListener('click', () => {
  scanPhotoInput.click();
});

async function preprocessImageForOcr(file, originalDataUrl) {
  const source = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(3.2, 2400 / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return {
      original: originalDataUrl,
      base: await file.arrayBuffer(),
      grayscale: await file.arrayBuffer(),
      highContrast: await file.arrayBuffer(),
      adaptive: await file.arrayBuffer()
    };
  }

  ctx.drawImage(source, 0, 0, width, height);

  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = width;
  baseCanvas.height = height;
  const baseCtx = baseCanvas.getContext('2d');
  if (!baseCtx) {
    return {
      original: originalDataUrl,
      base: await file.arrayBuffer(),
      grayscale: await file.arrayBuffer(),
      highContrast: await file.arrayBuffer(),
      adaptive: await file.arrayBuffer()
    };
  }
  baseCtx.drawImage(canvas, 0, 0);

  const grayscaleCanvas = document.createElement('canvas');
  grayscaleCanvas.width = width;
  grayscaleCanvas.height = height;
  const grayCtx = grayscaleCanvas.getContext('2d');
  if (!grayCtx) {
    return {
      original: originalDataUrl,
      base: baseCanvas.toDataURL('image/jpeg', 0.98),
      grayscale: baseCanvas.toDataURL('image/jpeg', 0.98),
      highContrast: baseCanvas.toDataURL('image/jpeg', 0.98),
      adaptive: baseCanvas.toDataURL('image/jpeg', 0.98)
    };
  }
  grayCtx.filter = 'grayscale(100%) contrast(125%) brightness(104%)';
  grayCtx.drawImage(canvas, 0, 0);

  const highContrastCanvas = document.createElement('canvas');
  highContrastCanvas.width = width;
  highContrastCanvas.height = height;
  const highCtx = highContrastCanvas.getContext('2d');
  if (!highCtx) {
    return {
      original: originalDataUrl,
      base: baseCanvas.toDataURL('image/jpeg', 0.98),
      grayscale: grayscaleCanvas.toDataURL('image/jpeg', 0.98),
      highContrast: baseCanvas.toDataURL('image/jpeg', 0.98),
      adaptive: baseCanvas.toDataURL('image/jpeg', 0.98)
    };
  }
  highCtx.filter = 'grayscale(100%) contrast(180%) brightness(112%)';
  highCtx.drawImage(canvas, 0, 0);

  const adaptiveCanvas = document.createElement('canvas');
  adaptiveCanvas.width = width;
  adaptiveCanvas.height = height;
  const adaptiveCtx = adaptiveCanvas.getContext('2d');
  if (!adaptiveCtx) {
    return {
      original: originalDataUrl,
      base: baseCanvas.toDataURL('image/jpeg', 0.98),
      grayscale: grayscaleCanvas.toDataURL('image/jpeg', 0.98),
      highContrast: highContrastCanvas.toDataURL('image/jpeg', 0.98),
      adaptive: baseCanvas.toDataURL('image/jpeg', 0.98)
    };
  }
  adaptiveCtx.drawImage(canvas, 0, 0);
  const imageData = adaptiveCtx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round((data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114));
    const threshold = gray > 165 ? 255 : 0;
    const boosted = gray > 100 ? Math.min(255, gray + 40) : Math.max(0, gray - 15);
    const value = threshold || boosted;
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  adaptiveCtx.putImageData(imageData, 0, 0);

  function cropCanvasToDataUrl(sourceCanvas, crop) {
    const croppedCanvas = document.createElement('canvas');
    const cropX = Math.max(0, Math.floor(sourceCanvas.width * crop.x));
    const cropY = Math.max(0, Math.floor(sourceCanvas.height * crop.y));
    const cropWidth = Math.max(1, Math.floor(sourceCanvas.width * crop.width));
    const cropHeight = Math.max(1, Math.floor(sourceCanvas.height * crop.height));
    croppedCanvas.width = cropWidth;
    croppedCanvas.height = cropHeight;
    const croppedCtx = croppedCanvas.getContext('2d');
    if (!croppedCtx) {
      return sourceCanvas.toDataURL('image/jpeg', 0.98);
    }
    croppedCtx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return croppedCanvas.toDataURL('image/jpeg', 0.98);
  }

  const regions = {
    headerRight: cropCanvasToDataUrl(baseCanvas, { x: 0.42, y: 0.02, width: 0.54, height: 0.23 }),
    patientBlock: cropCanvasToDataUrl(grayscaleCanvas, { x: 0.08, y: 0.28, width: 0.82, height: 0.26 }),
    prescriptionBody: cropCanvasToDataUrl(grayscaleCanvas, { x: 0.08, y: 0.46, width: 0.82, height: 0.35 }),
    footer: cropCanvasToDataUrl(baseCanvas, { x: 0.18, y: 0.80, width: 0.68, height: 0.16 })
  };

  return {
    original: originalDataUrl,
    base: baseCanvas.toDataURL('image/jpeg', 0.98),
    grayscale: grayscaleCanvas.toDataURL('image/jpeg', 0.98),
    highContrast: highContrastCanvas.toDataURL('image/jpeg', 0.98),
    adaptive: adaptiveCanvas.toDataURL('image/jpeg', 0.98),
    regions
  };
}

function scoreOcrText(text) {
  const value = String(text || '');
  if (!value.trim()) {
    return 0;
  }

  const words = value.split(/\s+/).filter(Boolean);
  const alphaWords = words.filter((word) => /[a-zA-Z]{3,}/.test(word)).length;
  const medicineHits = (value.match(/\b(metformin|amlodipine|ibuprofen|aspirin|digoxin|atorvastatin|rosuvastatin|telmisartan|losartan|pantoprazole|levothyroxine|thyronorm|paracetamol|acetaminophen|amoxicillin|tablet|capsule|syrup|dose|od|bd|tid)\b/gi) || []).length;
  const diagnosisHits = (value.match(/\b(diagnosis|impression|condition|diabetes|hypertension|thyroid|fever|infection|pain|cholesterol|hba1c|lipid)\b/gi) || []).length;
  const structureHits = (value.match(/\b(patient name|patient|age\/dob|date|rx|sig|disp|refill|phone|address|prescriber|doctor|m\.d\.)\b/gi) || []).length;
  const lineCount = value.split(/\n+/).filter((line) => line.trim().length > 2).length;
  const noisePenalty = (value.match(/[~`^_=]{2,}|\b[a-z]{1,2}\b/gi) || []).length;

  return (alphaWords * 2) + (medicineHits * 5) + (diagnosisHits * 4) + (structureHits * 6) + Math.min(lineCount, 18) - noisePenalty;
}

function mergeOcrTexts(texts) {
  const seen = new Set();
  const merged = [];

  texts.forEach((text) => {
    String(text || '')
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .forEach((line) => {
        const key = line.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(line);
        }
      });
  });

  return merged.join('\n');
}

async function runBestOcrPass(preprocessedImage) {
  const passes = [
    { bucket: 'full', image: preprocessedImage.original, psm: 3 },
    { bucket: 'full', image: preprocessedImage.original, psm: 6 },
    { bucket: 'full', image: preprocessedImage.base, psm: 6 },
    { bucket: 'full', image: preprocessedImage.grayscale, psm: 6 },
    { bucket: 'full', image: preprocessedImage.grayscale, psm: 4 },
    { bucket: 'full', image: preprocessedImage.highContrast, psm: 11 },
    { bucket: 'full', image: preprocessedImage.adaptive, psm: 4 },
    { bucket: 'full', image: preprocessedImage.adaptive, psm: 12 },
    { bucket: 'header', image: preprocessedImage.regions.headerRight, psm: 6 },
    { bucket: 'patient', image: preprocessedImage.regions.patientBlock, psm: 6 },
    { bucket: 'body', image: preprocessedImage.regions.prescriptionBody, psm: 6 },
    { bucket: 'body', image: preprocessedImage.regions.prescriptionBody, psm: 4 },
    { bucket: 'footer', image: preprocessedImage.regions.footer, psm: 6 }
  ];

  const outputs = await Promise.all(passes.map(async (pass) => {
    const result = await window.Tesseract.recognize(pass.image, 'eng', {
      psm: pass.psm,
      oem: 1,
      preserve_interword_spaces: 1,
      tessedit_char_blacklist: '{}[]<>~',
      logger: () => {}
    });

    const text = String(result?.data?.text || '').replace(/\r/g, '').trim();
    return {
      bucket: pass.bucket,
      psm: pass.psm,
      text,
      confidence: result?.data?.confidence || 0,
      score: scoreOcrText(text) + (result?.data?.confidence || 0)
    };
  }));

  state.latestOcrDiagnostics = outputs;

  const bestByBucket = new Map();
  outputs.forEach((output) => {
    const existing = bestByBucket.get(output.bucket);
    if (!existing || output.score > existing.score) {
      bestByBucket.set(output.bucket, output);
    }
  });

  const bestFull = bestByBucket.get('full')?.text || '';
  const combined = mergeOcrTexts([
    bestByBucket.get('header')?.text || '',
    bestByBucket.get('patient')?.text || '',
    bestByBucket.get('body')?.text || '',
    bestByBucket.get('footer')?.text || ''
  ]);

  const combinedScore = scoreOcrText(combined);
  const fullScore = scoreOcrText(bestFull);

  return combinedScore > fullScore ? combined : bestFull;
}

async function runOcrOnUploadedPhoto(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = typeof reader.result === 'string' ? reader.result : '';
    state.scanPhotoDataUrl = dataUrl;
    photoPreview.src = state.scanPhotoDataUrl;
    photoPreview.hidden = false;

    if (!window.Tesseract) {
      setDocumentTextValue(`Photo report selected: ${file.name}\nOCR library is still loading. Please tap Run AI extraction again.`);
      return;
    }

    try {
      document.getElementById('chatAnswer').textContent = 'Reading report image...';
      setDocumentTextValue('Running OCR...');

      const preprocessedImage = await preprocessImageForOcr(file, dataUrl);
      const bestOcrText = await runBestOcrPass(preprocessedImage);
      const text = String(bestOcrText || '')
        .trim()
        .replace(/\r/g, '');
      if (text) {
        state.latestScanText = text;
        setDocumentTextValue(text);
        hydrateFormFromDocumentText(text);
        renderExtractionReview({
          summary: 'OCR completed. Run AI extraction to normalize medicines, diagnosis, and tests.',
          diagnosis: '',
          disease: '',
          medicines: extractMedicineCandidatesFromText(text.split(/\n+/)),
          tests: []
        });
        document.getElementById('chatAnswer').textContent = 'Photo OCR completed. You can now run AI extraction.';
      } else {
        state.latestScanText = '';
        setDocumentTextValue(buildOcrDiagnosticsText(state.latestOcrDiagnostics));
        renderExtractionReview(null);
        document.getElementById('chatAnswer').textContent = 'OCR did not detect readable text. Diagnostics were written into the OCR text box.';
      }
    } catch (error) {
      console.error(error);
      state.latestScanText = '';
      setDocumentTextValue(`OCR failed: ${error?.message || 'Unknown error'}`);
      renderExtractionReview(null);
      document.getElementById('chatAnswer').textContent = 'OCR could not read the image. Please paste the report text manually or try another photo.';
    }
  };

  reader.readAsDataURL(file);
}

scanPhotoInput.addEventListener('change', async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  await runOcrOnUploadedPhoto(file);
});

document.getElementById('chatButton').addEventListener('click', async () => {
  const question = document.getElementById('chatInput').value.trim();
  const query = getActiveAccountQuery();
  const data = await fetchJson(`/api/chat?q=${encodeURIComponent(question)}${query ? `&${query}` : ''}`);
  document.getElementById('chatAnswer').textContent = data.answer || 'Login required.';
  if (data.answer) {
    setStatus('Assistant response updated.', 'info');
  }
});

document.getElementById('recordForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const recordId = payload.recordId;
  delete payload.recordId;

  const isEditing = Boolean(recordId);
  const data = await fetchJson(isEditing ? `/api/records/${recordId}` : '/api/records', {
    method: isEditing ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (data.success) {
    await loadDashboard();
    resetRecordEditor(true);
    document.getElementById('chatAnswer').textContent = isEditing ? 'Saved changes to the report.' : 'Saved new scanned record.';
    setStatus(isEditing ? 'Report updated successfully.' : 'Report saved successfully.', 'success');
  }
});

document.getElementById('cancelEditButton').addEventListener('click', () => {
  resetRecordEditor(true);
});

document.addEventListener('click', (event) => {
  const switchAccountButton = event.target.closest('[data-switch-account]');
  if (switchAccountButton) {
    const username = String(switchAccountButton.getAttribute('data-switch-account') || '');
    if (username) {
      void loadDashboard(username);
      setActiveTab('dashboard');
      setStatus('Switched account view.', 'info');
    }
    return;
  }

  const button = event.target.closest('[data-edit-record-id]');
  if (!button) {
    return;
  }

  if (!state.viewingSelf) {
    document.getElementById('chatAnswer').textContent = 'Switch back to your own account to edit records.';
    setStatus('Read-only mode: switch to your account to edit.', 'warning');
    return;
  }

  const record = findRecordById(button.getAttribute('data-edit-record-id'));
  if (record) {
    populateRecordForm(record);
  }
});

document.getElementById('scanButton').addEventListener('click', async () => {
  const text = state.latestScanText || document.getElementById('documentText').value.trim();
  if (!text || /^running ocr/i.test(text) || /^ocr diagnostics:/i.test(text) || /^ocr failed:/i.test(text)) {
    renderExtractionReview({
      summary: 'OCR did not produce usable text yet. Upload the image again or paste the text manually before running AI extraction.',
      diagnosis: '',
      disease: '',
      medicines: [],
      tests: []
    });
    document.getElementById('chatAnswer').textContent = 'AI extraction was skipped because OCR text is empty or diagnostic-only.';
    setStatus('No usable OCR text found. Paste text or retake photo.', 'warning');
    return;
  }
  const data = await fetchJson('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      documentText: text,
      documentImage: state.scanPhotoDataUrl || ''
    })
  });
  if (data.success) {
    state.latestScanText = text;
    applyExtractedScanValues(data.extracted);
    await loadDashboard();
    document.getElementById('chatAnswer').textContent = `AI extraction completed: ${data.extracted.diagnosis}`;
    setStatus('AI extraction completed.', 'success');
  }
});

document.getElementById('metricForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const data = await fetchJson('/api/metrics', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (data.success) {
    await loadDashboard();
    form.reset();
    setStatus('Reading logged successfully.', 'success');
  }
});

document.getElementById('planForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const data = await fetchJson('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (data.success) {
    await loadDashboard();
    form.reset();
    setStatus('Recording plan added.', 'success');
  }
});

document.getElementById('medicineReminderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const data = await fetchJson('/api/reminders/medication', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (data.success) {
    await loadDashboard();
    form.reset();
    setStatus('Medication reminder added.', 'success');
  }
});

document.getElementById('visitReminderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const data = await fetchJson('/api/reminders/visits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (data.success) {
    await loadDashboard();
    form.reset();
    setStatus('Doctor visit reminder added.', 'success');
  }
});

document.getElementById('familyForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const data = await fetchJson('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (data.success) {
    await loadDashboard();
    form.reset();
    setStatus('Family member profile added.', 'success');
  }
});

document.getElementById('familyAccountLinkForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const data = await fetchJson('/api/family/link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!data.success) {
    document.getElementById('chatAnswer').textContent = `${data.message || 'Unable to link this family account.'} Use username, @username, or exact display name.`;
    setStatus('Could not link family account. Check username and try again.', 'error');
    return;
  }

  document.getElementById('chatAnswer').textContent = `Linked account ${data.account.displayName}. Click View this account in Family Accounts.`;
  setStatus(`Linked family account: ${data.account.displayName}.`, 'success');
  form.reset();
  await loadDashboard(state.currentUser?.username || '');
  setActiveTab('families');
});

document.getElementById('switchToSelfButton').addEventListener('click', async () => {
  await loadDashboard(state.currentUser?.username || '');
  setActiveTab('dashboard');
  setStatus('Switched back to your account.', 'success');
});

document.getElementById('logoutButton').addEventListener('click', async () => {
  await fetchJson('/api/auth/logout', { method: 'POST' });
  clearAuthSession('Logged out. Login again to access your reports.');
});

async function bootApp() {
  renderExtractionReview(null);
  initTabs();
  initQuickActions();
  setActiveTab(state.activeTab || 'dashboard');
  if (isNativeApp()) {
    await ensureApiBase();
  }
  const authed = await hydrateAuthSession();
  if (authed) {
    await loadDashboard();
    setStatus('Welcome back. Use quick actions to get started.', 'info');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  if (window.Capacitor) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => registration.unregister());
    }).catch(() => {});
    return;
  }

  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.warn('Service worker registration failed:', error);
    }
  });
}

registerServiceWorker();
bootApp();
