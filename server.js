const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const USERS_DB_PATH = path.join(DATA_DIR, 'users.json');

const DEFAULT_RECORDS = [
  {
    id: 1,
    type: 'Prescription',
    hospital: 'Apollo Hospitals',
    doctor: 'Dr. Sharma',
    specialization: 'Endocrinology',
    diagnosis: 'Type 2 Diabetes',
    medicines: ['Metformin 500mg', 'Vitamin D3'],
    tests: ['HbA1c', 'Lipid Panel'],
    visitDate: '2026-07-02',
    followUpDate: '2026-07-16',
    disease: 'Diabetes',
    summary: 'Reviewed sugar control and medication adjustment.'
  },
  {
    id: 2,
    type: 'Blood Test',
    hospital: 'Yashoda Hospital',
    doctor: 'Dr. Rao',
    specialization: 'Cardiology',
    diagnosis: 'Hypertension follow-up',
    medicines: ['Amlodipine 5mg'],
    tests: ['BP Monitoring', 'Cholesterol'],
    visitDate: '2026-06-20',
    followUpDate: '2026-07-05',
    disease: 'Hypertension',
    summary: 'Blood pressure remained stable with current dosage.'
  },
  {
    id: 3,
    type: 'MRI Report',
    hospital: 'AIG Hospitals',
    doctor: 'Dr. Nair',
    specialization: 'Orthopedics',
    diagnosis: 'Knee pain review',
    medicines: ['Ibuprofen'],
    tests: ['MRI Scan'],
    visitDate: '2026-05-12',
    followUpDate: '2026-05-26',
    disease: 'Joint Pain',
    summary: 'Physical therapy advised and review scheduled.'
  }
];

const DEFAULT_PATIENT = {
  id: 'patient-001',
  name: 'Ananya Rao',
  age: 31,
  emergencyContact: 'Raghav Rao',
  bloodGroup: 'A+',
  allergies: ['Penicillin'],
  chronicDiseases: ['Diabetes', 'Hypertension']
};

const MEDICINE_DICTIONARY = {
  metformin: ['metformin', 'metfornin', 'metforrnin', 'metfomin'],
  amlodipine: ['amlodipine', 'amiodipine', 'amlodpine'],
  ibuprofen: ['ibuprofen', 'ibruprofen', 'ibuprofem'],
  aspirin: ['aspirin', 'aspiin'],
  digoxin: ['digoxin', 'digoxine'],
  atorvastatin: ['atorvastatin', 'atorvastin', 'atorvastin'],
  paracetamol: ['paracetamol', 'paracetanol', 'paracetemol'],
  acetaminophen: ['acetaminophen', 'acetaminophan'],
  amoxicillin: ['amoxicillin', 'amoxycillin', 'amoxicilin'],
  telmisartan: ['telmisartan', 'telmisartan', 'telmisartin'],
  losartan: ['losartan', 'losatan'],
  rosuvastatin: ['rosuvastatin', 'rosuvastin'],
  pantoprazole: ['pantoprazole', 'pantaprazole', 'pantoprazol'],
  levothyroxine: ['levothyroxine', 'levothyroxin', 'thyronorm'],
  vitamin: ['vitamin', 'vit d', 'vitd', 'vit d3']
};

const PRESCRIPTION_ABBREVIATIONS = {
  rx: 'prescription',
  tab: 'tablet',
  cap: 'capsule',
  syp: 'syrup',
  syr: 'syrup',
  od: 'once daily',
  bid: 'twice daily',
  bd: 'twice daily',
  tid: 'three times daily',
  tds: 'three times daily',
  qid: 'four times daily',
  qhs: 'nightly',
  hs: 'at bedtime',
  sos: 'if needed',
  prn: 'if needed',
  stat: 'immediately',
  ac: 'before food',
  pc: 'after food'
};

const ICD_10_LOOKUP = [
  { code: 'E11', aliases: ['type 2 diabetes', 'diabetes', 'diabetic', 'high sugar', 'glucose high'], label: 'Type 2 Diabetes Mellitus' },
  { code: 'I10', aliases: ['hypertension', 'high bp', 'high blood pressure', 'bp high'], label: 'Essential (primary) hypertension' },
  { code: 'E78.5', aliases: ['dyslipidemia', 'lipid disorder', 'high cholesterol', 'cholesterol'], label: 'Hyperlipidemia, unspecified' },
  { code: 'E03.9', aliases: ['hypothyroidism', 'thyroid disorder', 'low thyroid'], label: 'Hypothyroidism, unspecified' },
  { code: 'K21.9', aliases: ['acid reflux', 'reflux', 'gastritis', 'acidity'], label: 'Gastro-esophageal reflux disease without esophagitis' },
  { code: 'J06.9', aliases: ['urti', 'upper respiratory infection', 'respiratory infection', 'cold cough'], label: 'Acute upper respiratory infection, unspecified' },
  { code: 'R50.9', aliases: ['fever', 'viral fever'], label: 'Fever, unspecified' },
  { code: 'M25.50', aliases: ['joint pain', 'arthralgia', 'body pain', 'back pain'], label: 'Pain in joint, unspecified' }
];

const DIAGNOSIS_HINTS = [
  { pattern: /\b(diabet(?:es|ic)?|hba1c|glucose|metformin)\b/i, label: 'Diabetes' },
  { pattern: /\b(hypertension|high\s*b\.?p\.?|amlodipine|telmisartan|losartan)\b/i, label: 'Hypertension' },
  { pattern: /\b(cholesterol|lipid|ldl|statin|atorvastatin|rosuvastatin)\b/i, label: 'Dyslipidemia' },
  { pattern: /\b(fever|viral|paracetamol|acetaminophen)\b/i, label: 'Fever / Viral illness' },
  { pattern: /\b(urti|cough|cold|sore throat|infection|amoxicillin)\b/i, label: 'Respiratory infection' },
  { pattern: /\b(gastritis|acidity|reflux|pantoprazole)\b/i, label: 'Gastritis / Acid reflux' },
  { pattern: /\b(arthralgia|joint pain|back pain|ibuprofen)\b/i, label: 'Pain / Inflammation' },
  { pattern: /\b(hypothyroid|thyroid|tsh|levothyroxine|thyronorm)\b/i, label: 'Hypothyroidism' }
];


const DEFAULT_METRIC_READINGS = [
  { metric: 'Blood Pressure', value: '122/80', date: '2026-08-05', time: 'Morning' },
  { metric: 'Blood Sugar', value: '108 mg/dL', date: '2026-08-05', time: 'Morning' },
  { metric: 'Weight', value: '68 kg', date: '2026-08-04', time: 'Evening' },
  { metric: 'Heart Rate', value: '74 bpm', date: '2026-08-05', time: 'Morning' }
];

const DEFAULT_PLANS = [
  { name: 'Blood pressure', schedule: 'Every day', reminder: '08:00 AM' },
  { name: 'Blood sugar', schedule: 'Every Monday, Wednesday, Friday', reminder: '07:30 AM' },
  { name: 'Weight', schedule: 'Fixed duration: 30 days', reminder: '09:00 PM' }
];

const DEFAULT_MEDICATION_REMINDERS = [
  { medicine: 'Metformin 500mg', time: 'Morning', note: 'After breakfast' },
  { medicine: 'Amlodipine 5mg', time: 'Night', note: 'After dinner' },
  { medicine: 'Vitamin D3', time: 'Morning', note: 'With food' }
];

const DEFAULT_VISIT_REMINDERS = [
  { title: 'Follow-up with Dr. Sharma', due: '2026-07-16', type: 'Diabetes review' },
  { title: 'Cardiology review', due: '2026-08-12', type: 'BP monitoring' }
];

const DEFAULT_PROFILES = [
  { name: 'Ananya Rao', relation: 'Self', emergency: 'A+', allergies: ['Penicillin'], medicines: ['Metformin'] },
  { name: 'Raghav Rao', relation: 'Father', emergency: 'O+', allergies: [], medicines: ['Amlodipine'] }
];

const sessions = new Map();

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildDefaultUserData(displayName) {
  const patientName = displayName || DEFAULT_PATIENT.name;
  const data = {
    patient: {
      ...deepClone(DEFAULT_PATIENT),
      id: `patient-${Date.now()}`,
      name: patientName,
      emergencyContact: patientName
    },
    records: [],
    metrics: [],
    plans: [],
    medicationReminders: [],
    visitReminders: [],
    linkedAccounts: [],
    profiles: [
      {
        name: patientName,
        relation: 'Self',
        emergency: DEFAULT_PATIENT.bloodGroup,
        allergies: deepClone(DEFAULT_PATIENT.allergies),
        medicines: []
      }
    ]
  };

  return data;
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadUsersDb() {
  ensureDataDir();
  if (!fs.existsSync(USERS_DB_PATH)) {
    const initialDb = { users: {} };
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(initialDb, null, 2));
    return initialDb;
  }

  try {
    const raw = fs.readFileSync(USERS_DB_PATH, 'utf8');
    const parsed = JSON.parse(raw || '{"users":{}}');
    return parsed && parsed.users ? parsed : { users: {} };
  } catch (error) {
    return { users: {} };
  }
}

function saveUsersDb() {
  ensureDataDir();
  fs.writeFileSync(USERS_DB_PATH, JSON.stringify(usersDb, null, 2));
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(String(password || '')).digest('hex');
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeAccountIdentifier(value) {
  return String(value || '').trim().replace(/^@+/, '');
}

function findUserByIdentifier(identifier) {
  const normalizedInput = normalizeUsername(normalizeAccountIdentifier(identifier));
  if (!normalizedInput) {
    return null;
  }

  if (usersDb.users[normalizedInput]) {
    return { username: normalizedInput, entry: usersDb.users[normalizedInput] };
  }

  const matches = Object.entries(usersDb.users).filter(([, userEntry]) => {
    const display = normalizeUsername(userEntry?.displayName || '');
    return display === normalizedInput;
  });

  if (matches.length === 1) {
    const [username, entry] = matches[0];
    return { username, entry };
  }

  if (matches.length > 1) {
    return { ambiguous: true };
  }

  return null;
}

function getUserEntry(username) {
  return usersDb.users[normalizeUsername(username)] || null;
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, normalizeUsername(username));
  return token;
}

function clearSession(token) {
  sessions.delete(token);
}

function getAuthToken(req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

function getAuthenticatedUser(req) {
  const token = getAuthToken(req);
  const username = sessions.get(token);
  if (!username) {
    return null;
  }

  const entry = usersDb.users[username];
  if (!entry) {
    sessions.delete(token);
    return null;
  }

  if (!entry.data) {
    entry.data = buildDefaultUserData(entry.displayName || username);
    saveUsersDb();
  }

  if (!Array.isArray(entry.data.linkedAccounts)) {
    entry.data.linkedAccounts = [];
    saveUsersDb();
  }

  return {
    token,
    username,
    displayName: entry.displayName || username,
    data: entry.data
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function requireAuth(req, res) {
  const authUser = getAuthenticatedUser(req);
  if (!authUser) {
    sendJson(res, 401, { success: false, message: 'Authentication required' });
    return null;
  }
  return authUser;
}

const usersDb = loadUsersDb();

function serveStaticFile(filePath, res) {
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      });
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml'
    };

    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end(content);
  });
}

function summarizeHealth(userData) {
  const metrics = userData.metrics || [];
  const records = userData.records || [];
  const medicationReminders = userData.medicationReminders || [];
  const avgBP = metrics.find((item) => item.metric === 'Blood Pressure')?.value || 'N/A';
  const weight = metrics.find((item) => item.metric === 'Weight')?.value || 'N/A';

  if (records.length === 0 && metrics.length === 0 && medicationReminders.length === 0) {
    return {
      monthlyNarrative: 'Welcome. No records have been added yet. Start by scanning your first report or logging a health reading.',
      riskLevel: 'Unknown',
      nextBestAction: 'Use Document Scanner to save your first report and set medicine reminders.'
    };
  }

  return {
    monthlyNarrative: `Your blood pressure trend remains stable at ${avgBP}. Weight is currently ${weight}. You have ${records.length} recent records and ${medicationReminders.length ? 'active medication reminders set for this profile' : 'no medication reminders set yet'}.`,
    riskLevel: 'Stable',
    nextBestAction: 'Continue evening tracking and keep the July 16 diabetes follow-up on your calendar.'
  };
}

function buildFamilyAccounts(authUser) {
  const linked = Array.isArray(authUser.data.linkedAccounts) ? authUser.data.linkedAccounts : [];
  const seen = new Set([authUser.username]);
  const accounts = [
    {
      username: authUser.username,
      displayName: authUser.displayName,
      relation: 'Self',
      isSelf: true
    }
  ];

  linked.forEach((item) => {
    const linkedUsername = normalizeUsername(item?.username);
    if (!linkedUsername || seen.has(linkedUsername)) {
      return;
    }

    const linkedEntry = usersDb.users[linkedUsername];
    if (!linkedEntry) {
      return;
    }

    if (!linkedEntry.data) {
      linkedEntry.data = buildDefaultUserData(linkedEntry.displayName || linkedUsername);
      saveUsersDb();
    }

    seen.add(linkedUsername);
    accounts.push({
      username: linkedUsername,
      displayName: linkedEntry.displayName || linkedUsername,
      relation: String(item?.relation || 'Family'),
      isSelf: false
    });
  });

  return accounts;
}

function resolveAccessibleAccount(authUser, requestedAccount) {
  const requestedUsername = normalizeUsername(requestedAccount || authUser.username);
  if (!requestedUsername || requestedUsername === authUser.username) {
    return {
      username: authUser.username,
      displayName: authUser.displayName,
      data: authUser.data,
      isSelf: true
    };
  }

  const linked = Array.isArray(authUser.data.linkedAccounts) ? authUser.data.linkedAccounts : [];
  const hasAccess = linked.some((item) => normalizeUsername(item?.username) === requestedUsername);
  if (!hasAccess) {
    return null;
  }

  const entry = usersDb.users[requestedUsername];
  if (!entry) {
    return null;
  }

  if (!entry.data) {
    entry.data = buildDefaultUserData(entry.displayName || requestedUsername);
    saveUsersDb();
  }

  return {
    username: requestedUsername,
    displayName: entry.displayName || requestedUsername,
    data: entry.data,
    isSelf: false
  };
}

function getDashboardPayload(userData, options = {}) {
  const insight = summarizeHealth(userData);
  const records = (userData.records || []).map(normalizeRecordForResponse);
  const medicationReminders = userData.medicationReminders || [];
  const visitReminders = userData.visitReminders || [];
  const metrics = userData.metrics || [];
  const plans = userData.plans || [];
  const profiles = userData.profiles || [];
  const patient = userData.patient || DEFAULT_PATIENT;

  return {
    patient,
    records,
    metrics,
    plans,
    medicationReminders,
    visitReminders,
    profiles,
    familyAccounts: options.familyAccounts || [],
    viewingAccount: options.viewingAccount || null,
    summary: {
      medicinesToday: medicationReminders.slice(0, 3).map((item) => item.medicine),
      visits: visitReminders.slice(0, 3).map((item) => `${item.due} ${item.title}`),
      pendingTests: records.flatMap((record) => record.tests || []).slice(0, 3),
      recentUploads: records.slice(0, 3).map((record) => `${record.type || 'Report'} - ${record.hospital}`),
      aiInsight: insight.monthlyNarrative,
      riskLevel: insight.riskLevel,
      nextBestAction: insight.nextBestAction
    }
  };
}

function normalizeScanLine(line) {
  return String(line || '')
    .replace(/\r/g, '')
    .replace(/[|]/g, 'I')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/dootor|doetor|dy\.?/gi, 'Doctor')
    .replace(/apolls|mospitals/gi, 'Apollo Hospitals')
    .replace(/\bshama\b|\bshawna\b/gi, 'Sharma')
    .replace(/\bmale\b/gi, '')
    .replace(/\bda\b/gi, '')
    .replace(/\bno\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function expandPrescriptionAbbreviations(text) {
  let expanded = String(text || '');
  Object.entries(PRESCRIPTION_ABBREVIATIONS).forEach(([short, full]) => {
    expanded = expanded.replace(new RegExp(`\\b${short}\\b`, 'gi'), full);
  });
  return expanded;
}

function looksLikeEncodedBlob(value) {
  const text = String(value || '').trim();
  if (!text) {
    return false;
  }

  if (/^data:image\/[a-z]+;base64,/i.test(text)) {
    return true;
  }

  // Long base64-like streams should never be treated as names/diagnosis.
  if (text.length > 60 && /^[A-Za-z0-9+/=\s]+$/.test(text) && /[+/=]/.test(text)) {
    return true;
  }

  return false;
}

function isReadableFieldValue(value) {
  const text = String(value || '').trim();
  if (!text || looksLikeEncodedBlob(text)) {
    return false;
  }

  if (text.length > 160) {
    return false;
  }

  const letterCount = (text.match(/[A-Za-z]/g) || []).length;
  const digitCount = (text.match(/\d/g) || []).length;
  const symbolCount = (text.match(/[^A-Za-z0-9\s,./()%-]/g) || []).length;

  if (letterCount < 2) {
    return false;
  }

  // Heuristic for random OCR junk: too many symbols/digits relative to letters.
  if (digitCount > letterCount * 3 || symbolCount > Math.max(6, Math.floor(letterCount / 2))) {
    return false;
  }

  return true;
}

function sanitizeExtractedString(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return isReadableFieldValue(text) ? text : '';
}

function isPlaceholderProviderValue(value) {
  return /^(r|rx|prescription|tablet|capsule|syrup|medicine|medication)$/i.test(String(value || '').trim());
}

function sanitizeExtractedList(values) {
  return (values || [])
    .map((item) => sanitizeExtractedString(item))
    .filter(Boolean)
    .slice(0, 12);
}

function extractFieldValue(line, prefixes) {
  const prefixPattern = prefixes.join('|');
  const match = line.match(new RegExp(`(?:${prefixPattern})\\s*[:\\-]?\\s*(.+)$`, 'i'));
  return match?.[1]?.trim() || '';
}

function normalizeMedicineEntry(value) {
  const original = expandPrescriptionAbbreviations(String(value || '')).replace(/\r/g, ' ').trim();
  if (!original) {
    return '';
  }

  const withoutInstruction = original
    .replace(/(?:,|;|\s)\s*(?:sig|directions?|instruction|instructions|take|use|apply)\s*[:\-]?\s*.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  const medicineFromText = findMedicineByToken(withoutInstruction);
  if (!medicineFromText) {
    return sanitizeExtractedString(withoutInstruction);
  }

  const dosageMatch = withoutInstruction.match(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|mmol)\b/i);
  const dosage = dosageMatch?.[0] || '';
  const normalized = dosage ? `${medicineFromText} ${dosage}` : medicineFromText;
  return sanitizeExtractedString(normalized) || medicineFromText;
}

function normalizeMedicineEntries(values) {
  return (Array.isArray(values) ? values : String(values || '').split(/[\n,;]+/))
    .map((item) => normalizeMedicineEntry(item))
    .filter(Boolean);
}

function normalizeRecordForResponse(record) {
  if (!record) {
    return record;
  }

  return {
    ...record,
    medicines: normalizeMedicineEntries(record.medicines || [])
  };
}

function inferDiagnosisFromMedicine(medicineText) {
  const lower = String(medicineText || '').toLowerCase();
  const hint = DIAGNOSIS_HINTS.find((item) => item.pattern.test(lower));
  return hint?.label || '';
}

function levenshteinDistance(a, b) {
  const left = String(a || '');
  const right = String(b || '');

  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));

  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[left.length][right.length];
}

function soundex(value) {
  const text = String(value || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (!text) {
    return '';
  }

  const first = text[0];
  const mapping = {
    B: '1', F: '1', P: '1', V: '1',
    C: '2', G: '2', J: '2', K: '2', Q: '2', S: '2', X: '2', Z: '2',
    D: '3', T: '3',
    L: '4',
    M: '5', N: '5',
    R: '6'
  };

  let lastCode = mapping[first] || '';
  let result = first;

  for (let index = 1; index < text.length && result.length < 4; index += 1) {
    const char = text[index];
    const code = mapping[char] || '0';
    if (code !== '0' && code !== lastCode) {
      result += code;
    }
    lastCode = code;
  }

  return `${result}000`.slice(0, 4);
}

function findMedicineByToken(token) {
  const cleaned = String(token || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!cleaned || cleaned.length < 4) {
    return '';
  }

  const exact = Object.entries(MEDICINE_DICTIONARY).find(([, aliases]) => {
    return aliases.some((alias) => cleaned.includes(alias.replace(/[^a-z]/g, '')));
  });
  if (exact) {
    return exact[0];
  }

  let best = '';
  let minDistance = Number.POSITIVE_INFINITY;
  let phoneticMatch = '';
  const tokenSoundex = soundex(cleaned);

  Object.entries(MEDICINE_DICTIONARY).forEach(([medicine, aliases]) => {
    aliases.forEach((alias) => {
      const aliasClean = alias.replace(/[^a-z]/g, '');
      if (Math.abs(aliasClean.length - cleaned.length) > 2) {
        return;
      }
      const distance = levenshteinDistance(cleaned, aliasClean);
      if (distance < minDistance) {
        minDistance = distance;
        best = medicine;
      }
      if (!phoneticMatch && tokenSoundex && soundex(aliasClean) === tokenSoundex) {
        phoneticMatch = medicine;
      }
    });
  });

  const maxDistance = cleaned.length >= 8 ? 2 : 1;
  if (minDistance <= maxDistance) {
    return best;
  }
  return phoneticMatch || '';
}

function normalizeDiagnosisLabel(label) {
  const text = String(label || '').trim();
  if (!text) {
    return '';
  }

  const cleaned = text.toLowerCase();
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const labelSoundex = soundex(cleaned);

  ICD_10_LOOKUP.forEach((entry) => {
    entry.aliases.forEach((alias) => {
      const aliasText = alias.toLowerCase();
      if (cleaned.includes(aliasText) || aliasText.includes(cleaned)) {
        best = entry;
        bestDistance = 0;
        return;
      }

      const distance = levenshteinDistance(cleaned.replace(/[^a-z]/g, ''), aliasText.replace(/[^a-z]/g, ''));
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }

      if (!best && labelSoundex && soundex(aliasText) === labelSoundex) {
        best = entry;
      }
    });
  });

  if (!best) {
    return text;
  }

  const maxDistance = cleaned.length >= 10 ? 4 : 2;
  if (bestDistance <= maxDistance || bestDistance === 0) {
    return `${best.label} (${best.code})`;
  }

  return text;
}

function extractDiagnosisFromFreeText(lines, medicines) {
  const joined = expandPrescriptionAbbreviations(lines.join(' ')).toLowerCase();
  const directHint = DIAGNOSIS_HINTS.find((item) => item.pattern.test(joined));
  if (directHint?.label) {
    return normalizeDiagnosisLabel(directHint.label);
  }

  const medicineHint = inferDiagnosisFromMedicine((medicines || []).join(' '));
  return normalizeDiagnosisLabel(medicineHint || '');
}

function inferAllDiagnoses(lines, medicines) {
  const joined = expandPrescriptionAbbreviations(`${lines.join(' ')} ${(medicines || []).join(' ')}`).toLowerCase();
  const labels = [];

  DIAGNOSIS_HINTS.forEach((hint) => {
    if (hint.pattern.test(joined) && !labels.includes(hint.label)) {
      labels.push(normalizeDiagnosisLabel(hint.label));
    }
  });

  if (labels.length === 0) {
    return '';
  }
  if (labels.length === 1) {
    return labels[0];
  }

  return `${labels[0]} / ${labels[1]}`;
}

function filterLowSignalTests(values) {
  const blocked = new Set(['test', 'tests', 'report', 'reports', 'lab', 'labs', 'profile', 'prof', 'scan']);
  return (values || []).filter((item) => {
    const token = String(item || '').trim().toLowerCase();
    if (!token) {
      return false;
    }
    if (blocked.has(token)) {
      return false;
    }
    return token.length >= 4 || /hba1c|cbc|lft|kft|tsh|ecg|ekg|x-ray|xray|mri/i.test(token);
  });
}

function normalizeTestLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const cleaned = text
    .replace(/^\s*(?:advice|test|tests|lab|labs|investigation|investigations)\s*[:\-]?\s*/i, '')
    .trim();

  if (/h\W*b\W*a\W*1\W*c|hba1c|hb1ac|hbalc/i.test(cleaned)) return 'HbA1c';
  if (/lipid|cholesterol|ldl|hdl|triglyceride/i.test(cleaned)) return 'Lipid Panel';
  if (/cbc|complete\s*blood/i.test(cleaned)) return 'CBC';
  if (/lft|liver\s*function/i.test(cleaned)) return 'LFT';
  if (/kft|renal|kidney\s*function/i.test(cleaned)) return 'KFT';
  if (/tsh|thyroid/i.test(cleaned)) return 'Thyroid Profile';
  if (/x\W*ray|xray|radiograph/i.test(cleaned)) return 'X-Ray';
  if (/mri|scan|imaging/i.test(cleaned)) return 'MRI / Scan';
  if (/ecg|ekg/i.test(cleaned)) return 'ECG';
  if (/blood\s*pressure|\bbp\b/i.test(cleaned)) return 'BP Monitoring';

  return cleaned;
}

function dedupeStringsCaseInsensitive(values) {
  const seen = new Set();
  return (values || []).filter((item) => {
    const key = String(item || '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeMedicinesPreferDosage(values) {
  const byRoot = new Map();

  (values || []).forEach((item) => {
    const value = String(item || '').trim();
    if (!value) {
      return;
    }

    const root = value.split(/\s+/)[0].toLowerCase();
    const existing = byRoot.get(root);
    const hasDosage = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|mmol)\b/i.test(value);
    const existingHasDosage = existing ? /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|mmol)\b/i.test(existing) : false;

    if (!existing || (hasDosage && !existingHasDosage)) {
      byRoot.set(root, value);
    }
  });

  return Array.from(byRoot.values());
}

function mergeDiagnosisLabels(primary, secondary) {
  const all = [String(primary || ''), String(secondary || '')]
    .join(' / ')
    .split('/')
    .map((item) => item.trim())
    .filter(Boolean);

  const seen = new Set();
  const labels = [];
  all.forEach((item) => {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      labels.push(item);
    }
  });

  return labels.join(' / ');
}

function extractMedicinesFromNoisyText(lines) {
  const tokens = lines
    .join(' ')
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);

  const found = new Set();

  for (let index = 0; index < tokens.length; index += 1) {
    const one = tokens[index];
    const two = `${tokens[index] || ''}${tokens[index + 1] || ''}`;
    const three = `${tokens[index] || ''}${tokens[index + 1] || ''}${tokens[index + 2] || ''}`;

    [one, two, three].forEach((candidate) => {
      const medicine = findMedicineByToken(candidate);
      if (medicine) {
        found.add(medicine);
      }
    });
  }

  return Array.from(found);
}

function extractTestsFromNoisyText(lines) {
  const joined = lines.join(' ').toLowerCase();
  const hints = [
    { pattern: /h\W*b\W*a\W*1\W*c|hba1c|hb1ac|hbalc/i, label: 'HbA1c' },
    { pattern: /lipid|cholesterol|ldl|hdl|triglyceride/i, label: 'Lipid Panel' },
    { pattern: /cbc|complete\s*blood/i, label: 'CBC' },
    { pattern: /lft|liver\s*function/i, label: 'LFT' },
    { pattern: /kft|renal|kidney\s*function/i, label: 'KFT' },
    { pattern: /tsh|thyroid/i, label: 'Thyroid Profile' },
    { pattern: /x\W*ray|xray|radiograph/i, label: 'X-Ray' },
    { pattern: /mri|scan|imaging/i, label: 'MRI / Scan' },
    { pattern: /ecg|ekg/i, label: 'ECG' },
    { pattern: /blood\s*pressure|\bbp\b/i, label: 'BP Monitoring' }
  ];

  return hints.filter((item) => item.pattern.test(joined)).map((item) => item.label);
}

function inferPatientName(lines) {
  const patientLine = lines.find((line) => /\b(patient\s*name|patient|ms|mr|mrs|miss)\b/i.test(line));
  if (!patientLine) {
    return '';
  }

  const nameMatch = patientLine.match(/(?:patient\s*name|ms|mr|mrs|miss|patient)\s*[:\-]?\s*(.+)$/i);
  if (nameMatch?.[1]) {
    return nameMatch[1].replace(/^name\s*[:\-]?\s*/i, '').trim();
  }

  return patientLine.replace(/\b(patient\s*name|ms|mr|mrs|miss|patient)\b/i, '').replace(/^name\s*[:\-]?\s*/i, '').trim();
}

function extractExplicitPrescriptionLayout(lines) {
  const doctorBlock = lines.find((line) => /^dr\b/i.test(line) || /\b(m\.d\.|md|doctor)\b/i.test(line)) || '';
  const doctorValue = String(doctorBlock || '').replace(/^dr\b\s*/i, '').replace(/,?\s*m\.d\.?/i, '').replace(/\bdoctor\b\s*[:\-]?/i, '').trim();

  const prescriptionStart = lines.findIndex((line) => /^r\/?$/i.test(line));
  const medicineLines = [];
  let visitDate = '';

  if (prescriptionStart >= 0) {
    for (let index = prescriptionStart + 1; index < lines.length; index += 1) {
      const line = lines[index];

      if (/^date\b/i.test(line)) {
        const dateMatch = line.match(/date\s*[:\-]?\s*(.+)$/i);
        if (dateMatch?.[1]) {
          visitDate = dateMatch[1].trim();
        }
        continue;
      }

      if (/^(address|age|tel|telephone|signature|sign)\b/i.test(line)) {
        continue;
      }

      if (isMedicineLikeLine(line)) {
        medicineLines.push(line.replace(/^\s*(?:take|apply|use|dose|doses)\s*[:\-]?\s*/i, '').trim());
      }
    }
  }

  const patientLine = lines.find((line) => /\b(ms|mr|mrs|miss)\b/i.test(line) && /\bpatient\b/i.test(line)) || '';
  const patientName = patientLine ? patientLine.replace(/\b(ms|mr|mrs|miss)\b/i, '').replace(/patient/i, 'Patient').trim() : '';
  const ageMatch = lines.find((line) => /\bage\b/i.test(line));
  const age = ageMatch ? (ageMatch.match(/\bage\s*[:\-]?\s*(\d+)/i)?.[1] || '') : '';

  return {
    doctor: doctorValue,
    patientName,
    age,
    visitDate,
    medicines: medicineLines.filter(Boolean)
  };
}

function isMedicineLikeLine(line) {
  const normalizedLine = expandPrescriptionAbbreviations(line);
  const hasDosage = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|mmol)\b/i.test(normalizedLine);
  const hasMedicationKeyword = /\b(medicine|medication|tablet|capsule|syrup|drops|ointment|vitamin|metformin|amlodipine|ibuprofen|aspirin|digoxin|paracetamol|acetaminophen|amoxicillin|atorvastatin|telmisartan|losartan|rosuvastatin|pantoprazole|levothyroxine)\b/i.test(normalizedLine);
  const isPrescriptionInstruction = /\b(take|apply|suspend|use|dose|doses|once daily|twice daily|three times daily|four times daily|if needed|immediately|at bedtime|nightly)\b/i.test(normalizedLine);
  const firstToken = String(normalizedLine || '').split(/\s+/).slice(0, 2).join(' ');
  const fuzzyMedicine = findMedicineByToken(firstToken) || findMedicineByToken(normalizedLine);
  return hasDosage || Boolean(fuzzyMedicine) || (hasMedicationKeyword && isPrescriptionInstruction) || (isPrescriptionInstruction && !/^\s*(?:r\/|date|doctor|hospital|ms\/mr|address|age|tel|signature)\b/i.test(line));
}

function extractMedicineLines(lines) {
  const seen = new Set();

  return lines.filter((line) => isMedicineLikeLine(line)).map((line) => {
    const cleanedLine = expandPrescriptionAbbreviations(line)
      .replace(/^\s*(?:medicine|medication)\s*[:\-]?\s*/i, '')
      .replace(/^\s*(?:take|apply|use|dose|doses)\s*[:\-]?\s*/i, '')
      .trim();

    const canonical = normalizeMedicineEntry(cleanedLine);

    const normalized = canonical.toLowerCase();
    if (!canonical || seen.has(normalized)) {
      return '';
    }
    seen.add(normalized);
    return canonical;
  }).filter(Boolean);
}

function extractFromDocument(text) {
  if (looksLikeEncodedBlob(text)) {
    return {
      hospital: '',
      patientName: '',
      doctor: '',
      specialization: '',
      diagnosis: '',
      disease: '',
      medicines: [],
      tests: [],
      visitDate: new Date().toISOString().slice(0, 10),
      followUpDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
      summary: 'Could not extract readable text. Please retake the photo in bright light and run OCR again.'
    };
  }

  const lines = (text || '')
    .split(/\n+/)
    .map((line) => normalizeScanLine(line))
    .map((line) => expandPrescriptionAbbreviations(line))
    .filter(Boolean);

  const explicitLayout = extractExplicitPrescriptionLayout(lines);
  const patientName = inferPatientName(lines) || explicitLayout.patientName || '';
  const doctorLine = lines.find((line) => /doctor|dr\b|m\.d\.?|\bmd\b/i.test(line)) || '';
  const hospitalLine = lines.find((line) => /hospital|apollo|yashoda|aig/i.test(line)) || '';
  const diagnosisLine = lines.find((line) => /diagnosis|condition|problem|review|impression|provisional|advice/i.test(line)) || '';
  const diseaseLine = lines.find((line) => /diabetes|hypertension|thyroid|heart|joint|asthma|kidney|cancer|stroke|gastritis|reflux|fever|infection/i.test(line)) || diagnosisLine;
  const medicines = extractMedicineLines(lines);
  const tests = lines.filter((line) => /test|report|lab|mri|scan|x-ray|ecg|cholesterol|hba1c|lipid/i.test(line));
  const fallbackMedicines = extractMedicinesFromNoisyText(lines);
  const fallbackTests = extractTestsFromNoisyText(lines);

  const hospitalValue = extractFieldValue(hospitalLine, ['hospital', 'apollo']) || '';
  const doctorValue = extractFieldValue(doctorLine, ['doctor', 'dr']) || explicitLayout.doctor || '';
  const mergedMedicines = Array.from(new Set([
    ...(explicitLayout.medicines.length ? explicitLayout.medicines : medicines),
    ...fallbackMedicines
  ]));

  const diagnosisValue = extractFieldValue(diagnosisLine, ['diagnosis', 'condition', 'problem', 'impression', 'provisional']) || extractDiagnosisFromFreeText(lines, mergedMedicines) || '';
  const diseaseValue = extractFieldValue(diseaseLine, ['disease', 'diagnosis', 'condition', 'problem']) || diagnosisValue || '';
  const layoutMedicines = mergedMedicines;
  const inferredTests = [
    ...tests.map((line) => extractFieldValue(line, ['test', 'lab', 'report', 'mri', 'scan', 'x-ray', 'ecg', 'cholesterol', 'hba1c', 'lipid']) || line),
    ...fallbackTests
  ];

  const visitDateLine = lines.find((line) => /\bdate\b/i.test(line));
  const explicitDate = visitDateLine ? (visitDateLine.match(/\bdate\s*[:\-]?\s*(.+)$/i)?.[1] || '') : '';

  const extracted = {
    hospital: sanitizeExtractedString(hospitalValue),
    patientName: sanitizeExtractedString(patientName || ''),
    doctor: sanitizeExtractedString(doctorValue),
    specialization: /mri|scan|x-ray|ecg/i.test(text || '') ? 'Radiology' : '',
    diagnosis: sanitizeExtractedString(normalizeDiagnosisLabel(diagnosisValue)),
    disease: sanitizeExtractedString(normalizeDiagnosisLabel(diseaseValue)),
    medicines: sanitizeExtractedList(dedupeMedicinesPreferDosage(layoutMedicines.length ? layoutMedicines : [])),
    tests: sanitizeExtractedList(dedupeStringsCaseInsensitive(filterLowSignalTests(inferredTests.map((item) => normalizeTestLabel(item))))),
    visitDate: explicitLayout.visitDate || explicitDate || new Date().toISOString().slice(0, 10),
    followUpDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString().slice(0, 10),
    summary: 'AI extraction completed from uploaded report photo or text.'
  };

  if (!extracted.diagnosis && extracted.medicines.length) {
    extracted.diagnosis = normalizeDiagnosisLabel(inferDiagnosisFromMedicine(extracted.medicines.join(' ')));
    extracted.disease = extracted.disease || extracted.diagnosis;
  }

  const combinedDiagnosis = inferAllDiagnoses(lines, extracted.medicines);
  if (combinedDiagnosis) {
    extracted.diagnosis = mergeDiagnosisLabels(extracted.diagnosis, combinedDiagnosis);
    extracted.disease = extracted.disease || extracted.diagnosis;
  }

  if (isPlaceholderProviderValue(extracted.doctor)) {
    extracted.doctor = '';
  }

  const lineQuality = lines.join(' ');
  const alphaCount = (lineQuality.match(/[a-z]/gi) || []).length;
  const hasVeryLowSignal = alphaCount < 12;

  if (!extracted.patientName && !extracted.doctor && !extracted.diagnosis && !extracted.medicines.length && !extracted.tests.length && hasVeryLowSignal) {
    extracted.summary = 'OCR text is too noisy to parse. Retake a clearer photo and run extraction again.';
  } else if (!extracted.patientName && !extracted.doctor && (extracted.medicines.length || extracted.tests.length || extracted.diagnosis)) {
    extracted.summary = 'Partial extraction completed from difficult handwriting. Please verify details before saving.';
  }

  return extracted;
}

function answerChat(question, userData) {
  const records = userData.records || [];
  const metrics = userData.metrics || [];
  const medicationReminders = userData.medicationReminders || [];
  const visitReminders = userData.visitReminders || [];
  const q = question.toLowerCase();

  if (!records.length && !metrics.length && !medicationReminders.length && !visitReminders.length) {
    return 'No patient data is saved yet for this account. Add reports, readings, or reminders first.';
  }

  if (q.includes('medicine') || q.includes('medicines')) {
    if (!medicationReminders.length) {
      return 'No medication reminders are set for this user yet.';
    }
    return `You are currently tracking ${medicationReminders.map((item) => item.medicine).join(', ')}. ${medicationReminders[0].medicine} is due in the ${String(medicationReminders[0].time || '').toLowerCase()} with ${medicationReminders[0].note || 'the saved instructions'}.`;
  }
  if (q.includes('diabetes') || q.includes('bp') || q.includes('blood pressure')) {
    const diabetesRecord = records.find((record) => /diabet|hba1c|glucose/i.test(`${record.diagnosis} ${record.disease} ${(record.tests || []).join(' ')} ${(record.medicines || []).join(' ')}`));
    const bpMetric = metrics.find((item) => item.metric === 'Blood Pressure');
    const followUp = visitReminders.find((item) => /diabet|bp|blood pressure/i.test(`${item.title} ${item.type}`)) || visitReminders[0];

    if (!diabetesRecord && !bpMetric && !followUp) {
      return 'I do not see any diabetes or blood-pressure related data saved for this account yet.';
    }

    const parts = [];
    if (bpMetric?.value) {
      parts.push(`Blood pressure is logged as ${bpMetric.value}`);
    }
    if (diabetesRecord?.diagnosis || diabetesRecord?.disease) {
      parts.push(`Recent report mentions ${diabetesRecord.diagnosis || diabetesRecord.disease}`);
    }
    if (followUp) {
      parts.push(`Next visit reminder: ${followUp.title} on ${followUp.due}`);
    }

    return parts.length
      ? `${parts.join('. ')}.`
      : 'I do not see any diabetes or blood-pressure related data saved for this account yet.';
  }
  if (q.includes('doctor') || q.includes('visit')) {
    if (!visitReminders.length) {
      return 'No doctor visit reminders are saved for this user yet.';
    }
    return `Upcoming reminders include ${visitReminders.map((item) => item.title).join(' and ')}.`;
  }
  if (q.includes('report') || q.includes('test')) {
    const pendingTests = records.flatMap((record) => record.tests || []);
    if (!pendingTests.length) {
      return 'No tests or reports are saved yet for this account.';
    }
    return `Pending reports/tests include ${pendingTests.join(', ')}.`;
  }
  return 'I can help you check medicines, visits, reports, and your recent health trend. Try asking about diabetes, blood pressure, or doctor visits.';
}

function buildRecordFromPayload(data, existingRecord = {}) {
  return {
    id: existingRecord.id || Date.now(),
    type: data.type || existingRecord.type || 'Prescription',
    hospital: data.hospital || existingRecord.hospital || 'Self Uploaded',
    patientName: data.patientName || existingRecord.patientName || '',
    doctor: data.doctor || existingRecord.doctor || 'Unknown',
    specialization: data.specialization || existingRecord.specialization || 'General Medicine',
    diagnosis: data.diagnosis || existingRecord.diagnosis || 'Needs review',
    medicines: normalizeMedicineEntries(data.medicines || existingRecord.medicines || []),
    tests: Array.isArray(data.tests)
      ? data.tests.filter(Boolean)
      : String(data.tests || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    visitDate: data.visitDate || existingRecord.visitDate || new Date().toISOString().slice(0, 10),
    followUpDate: data.followUpDate || existingRecord.followUpDate || '',
    disease: data.disease || existingRecord.disease || 'General Health',
    summary: data.summary || existingRecord.summary || 'New document added for review.'
  };
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', app: 'patient-health-management-app' });
    return;
  }

  if (reqUrl.pathname === '/api/auth/register' && req.method === 'POST') {
    readJsonBody(req).then((data) => {
      const username = normalizeUsername(data.username);
      const password = String(data.password || '');
      const displayName = String(data.displayName || username).trim() || username;

      if (!username || password.length < 4) {
        sendJson(res, 400, { success: false, message: 'Username and a password of at least 4 characters are required' });
        return;
      }

      if (usersDb.users[username]) {
        sendJson(res, 409, { success: false, message: 'User already exists' });
        return;
      }

      usersDb.users[username] = {
        username,
        displayName,
        passwordHash: hashPassword(password),
        data: buildDefaultUserData(displayName)
      };
      saveUsersDb();

      const token = createSession(username);
      sendJson(res, 201, {
        success: true,
        token,
        user: { username, displayName }
      });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/auth/login' && req.method === 'POST') {
    readJsonBody(req).then((data) => {
      const username = normalizeUsername(data.username);
      const password = String(data.password || '');
      const entry = getUserEntry(username);

      if (!entry || entry.passwordHash !== hashPassword(password)) {
        sendJson(res, 401, { success: false, message: 'Invalid username or password' });
        return;
      }

      const token = createSession(username);
      sendJson(res, 200, {
        success: true,
        token,
        user: { username, displayName: entry.displayName || username }
      });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/auth/me') {
    const authUser = getAuthenticatedUser(req);
    if (!authUser) {
      sendJson(res, 401, { success: false, message: 'Authentication required' });
      return;
    }

    sendJson(res, 200, {
      success: true,
      user: { username: authUser.username, displayName: authUser.displayName }
    });
    return;
  }

  if (reqUrl.pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = getAuthToken(req);
    if (token) {
      clearSession(token);
    }
    sendJson(res, 200, { success: true });
    return;
  }

  if (reqUrl.pathname === '/api/family/link' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }

    readJsonBody(req).then((data) => {
      const rawIdentifier = data.username;
      const resolved = findUserByIdentifier(rawIdentifier);
      const relation = String(data.relation || 'Family').trim() || 'Family';

      if (!normalizeAccountIdentifier(rawIdentifier)) {
        sendJson(res, 400, { success: false, message: 'Family account username or display name is required.' });
        return;
      }

      if (resolved?.ambiguous) {
        sendJson(res, 409, { success: false, message: 'Multiple accounts use this display name. Please enter the exact username.' });
        return;
      }

      const linkedUsername = normalizeUsername(resolved?.username);

      if (linkedUsername === authUser.username) {
        sendJson(res, 400, { success: false, message: 'You are already linked to your own account.' });
        return;
      }

      const linkedEntry = resolved?.entry || null;
      if (!linkedEntry) {
        sendJson(res, 404, { success: false, message: 'Family account not found. Check the username or ask them to share it exactly.' });
        return;
      }

      authUser.data.linkedAccounts = Array.isArray(authUser.data.linkedAccounts) ? authUser.data.linkedAccounts : [];
      const alreadyLinked = authUser.data.linkedAccounts.some((item) => normalizeUsername(item?.username) === linkedUsername);
      if (alreadyLinked) {
        sendJson(res, 409, { success: false, message: 'This family account is already linked.' });
        return;
      }

      authUser.data.linkedAccounts.push({ username: linkedUsername, relation });
      saveUsersDb();

      sendJson(res, 201, {
        success: true,
        account: {
          username: linkedUsername,
          displayName: linkedEntry.displayName || linkedUsername,
          relation,
          isSelf: false
        }
      });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid family link payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/dashboard') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }

    const account = resolveAccessibleAccount(authUser, reqUrl.searchParams.get('account'));
    if (!account) {
      sendJson(res, 403, { success: false, message: 'You do not have access to this family account.' });
      return;
    }

    sendJson(res, 200, getDashboardPayload(account.data, {
      familyAccounts: buildFamilyAccounts(authUser),
      viewingAccount: {
        username: account.username,
        displayName: account.displayName,
        isSelf: account.isSelf
      }
    }));
    return;
  }

  if (reqUrl.pathname === '/api/search') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    const account = resolveAccessibleAccount(authUser, reqUrl.searchParams.get('account'));
    if (!account) {
      sendJson(res, 403, { success: false, message: 'You do not have access to this family account.' });
      return;
    }

    const query = (reqUrl.searchParams.get('q') || '').toLowerCase();
    const filtered = (account.data.records || []).filter((record) => {
      const haystack = [
        record.type,
        record.hospital,
        record.doctor,
        record.specialization,
        record.diagnosis,
        record.disease,
        record.summary,
        ...(record.medicines || []),
        ...(record.tests || [])
      ].join(' ').toLowerCase();
      return query ? haystack.includes(query) : true;
    });

    sendJson(res, 200, { results: filtered.map(normalizeRecordForResponse) });
    return;
  }

  if (reqUrl.pathname === '/api/chat') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    const account = resolveAccessibleAccount(authUser, reqUrl.searchParams.get('account'));
    if (!account) {
      sendJson(res, 403, { success: false, message: 'You do not have access to this family account.' });
      return;
    }

    const question = reqUrl.searchParams.get('q') || 'What should I know today?';
    sendJson(res, 200, { answer: answerChat(question, account.data) });
    return;
  }

  if (reqUrl.pathname === '/api/scan' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
        const rawText = data.documentText || data.text || '';
        const extracted = extractFromDocument(rawText);
        const record = normalizeRecordForResponse({ id: Date.now(), ...extracted });
        authUser.data.records.unshift(record);
        saveUsersDb();
        sendJson(res, 201, { success: true, extracted, record });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid scan payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/ai-summary') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    sendJson(res, 200, summarizeHealth(authUser.data));
    return;
  }

  if (reqUrl.pathname === '/api/records' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
        const record = normalizeRecordForResponse(buildRecordFromPayload(data));
        authUser.data.records.unshift(record);
        saveUsersDb();
        sendJson(res, 201, { success: true, record });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid payload' });
    });
    return;
  }

  if (reqUrl.pathname.startsWith('/api/records/') && req.method === 'PUT') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
        const id = Number(reqUrl.pathname.split('/').pop());
        const recordIndex = authUser.data.records.findIndex((item) => item.id === id);

        if (recordIndex < 0) {
          sendJson(res, 404, { success: false, message: 'Record not found' });
          return;
        }

        const updatedRecord = normalizeRecordForResponse(buildRecordFromPayload(data, authUser.data.records[recordIndex]));
        authUser.data.records[recordIndex] = updatedRecord;
        saveUsersDb();
        sendJson(res, 200, { success: true, record: updatedRecord });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/metrics' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
        const reading = {
          metric: data.metric || 'Blood Pressure',
          value: data.value || '120/80',
          date: data.date || new Date().toISOString().slice(0, 10),
          time: data.time || 'Morning'
        };
        authUser.data.metrics.unshift(reading);
        saveUsersDb();
        sendJson(res, 201, { success: true, reading });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid metrics payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/plans' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
      const plan = {
        name: String(data.name || '').trim() || 'Health Plan',
        schedule: String(data.schedule || '').trim() || 'Daily',
        reminder: String(data.reminder || '').trim() || '09:00 AM'
      };
      authUser.data.plans = authUser.data.plans || [];
      authUser.data.plans.unshift(plan);
      saveUsersDb();
      sendJson(res, 201, { success: true, plan });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid plan payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/reminders/medication' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
      const reminder = {
        medicine: String(data.medicine || '').trim() || 'Medicine',
        time: String(data.time || '').trim() || 'Morning',
        note: String(data.note || '').trim() || 'As advised'
      };
      authUser.data.medicationReminders = authUser.data.medicationReminders || [];
      authUser.data.medicationReminders.unshift(reminder);
      saveUsersDb();
      sendJson(res, 201, { success: true, reminder });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid medication reminder payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/reminders/visits' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
      const reminder = {
        title: String(data.title || '').trim() || 'Doctor follow-up',
        due: String(data.due || '').trim() || new Date().toISOString().slice(0, 10),
        type: String(data.type || '').trim() || 'General review'
      };
      authUser.data.visitReminders = authUser.data.visitReminders || [];
      authUser.data.visitReminders.unshift(reminder);
      saveUsersDb();
      sendJson(res, 201, { success: true, reminder });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid visit reminder payload' });
    });
    return;
  }

  if (reqUrl.pathname === '/api/profiles' && req.method === 'POST') {
    const authUser = requireAuth(req, res);
    if (!authUser) {
      return;
    }
    readJsonBody(req).then((data) => {
      const parseList = (value) => String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

      const profile = {
        name: String(data.name || '').trim() || 'Family member',
        relation: String(data.relation || '').trim() || 'Family',
        emergency: String(data.emergency || '').trim() || 'Unknown',
        allergies: parseList(data.allergies),
        medicines: parseList(data.medicines)
      };

      authUser.data.profiles = authUser.data.profiles || [];
      authUser.data.profiles.push(profile);
      saveUsersDb();
      sendJson(res, 201, { success: true, profile });
    }).catch(() => {
      sendJson(res, 400, { success: false, message: 'Invalid family profile payload' });
    });
    return;
  }

  const safePath = reqUrl.pathname === '/' ? '/index.html' : reqUrl.pathname;
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (filePath.startsWith(PUBLIC_DIR)) {
    serveStaticFile(filePath, res);
  } else {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Patient health app running at http://${HOST}:${PORT}`);
});
