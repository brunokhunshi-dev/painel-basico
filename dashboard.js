import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/11.4.0/firebase-app.js";
import {
    getAuth,
    getIdTokenResult,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-auth.js";
import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc,
    deleteDoc,
    getFirestore,
    query,
    where
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

// Configuração Direta e Segura (Igual ao PWA)
const firebaseConfig = {
    apiKey: "AIzaSyAMDeRB1ZOOP919gcbcOoFgAsy6dNy7zS8",
    authDomain: "banco-de-dados-monitor.firebaseapp.com",
    projectId: "banco-de-dados-monitor",
    storageBucket: "banco-de-dados-monitor.firebasestorage.app",
    messagingSenderId: "248039911306",
    appId: "1:248039911306:web:188ffff179b3ffb3ace273"
};

const DASHBOARD_CONFIG = Object.freeze({
    locale: "pt-BR",
    timeZone: "America/Sao_Paulo",
    pageSize: 20,
    maximumRecords: 10000,
    autoRefreshMs: 5 * 60 * 1000,
    defaultMapCenter: [-23.0903, -47.2183],
    defaultMapZoom: 7,
    // Bruno e Eric com acessos Master de Gestão
    administratorEmails: ["eric.lima@advancetintas.com.br", "bruno.souza@advancetintas.com.br"],
    managementTerms: ["admin", "administrador", "diretor", "gerente", "gestor", "coordenador", "supervisor"],
    collections: Object.freeze({
        activities: "atividades",
        clients: "clientes",
        reports: "relatorios",
        promoters: "promotores",
        technicalAssistance: "assistencia",
        managers: "gestores",
        administrators: "administradores",
        trash: "atividades_excluidas"
    })
});

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
    user: null, profile: null, canSeeAll: false,
    professionals: [], professionalMap: new Map(),
    clients: [], clientMap: new Map(),
    activities: [], filteredActivities: [],
    charts: {}, map: null, mapLayers: [], googleRoutePoints: [],
    currentPage: 1, loadedRange: null, loading: false, activitiesLoading: false,
    sessionVersion: 0, toastTimer: null, autoRefreshTimer: null
};

const $ = id => document.getElementById(id);

function safeString(value, fallback = "") { 
    return String(value ?? "").trim() || fallback; 
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function normalizeText(value) { 
    return safeString(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); 
}

function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
    if (typeof value.toDate === "function") { const date = value.toDate(); return Number.isFinite(date.getTime()) ? date : null; }
    if (typeof value.seconds === "number") { const date = new Date(value.seconds * 1000); return Number.isFinite(date.getTime()) ? date : null; }
    const date = new Date(value); 
    return Number.isFinite(date.getTime()) ? date : null;
}

function parseInputDate(value, endOfDay = false) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const suffix = endOfDay ? "T23:59:59.999" : "T00:00:00.000";
    const date = new Date(`${value}${suffix}`); 
    return Number.isFinite(date.getTime()) ? date : null;
}

function dateInputValue(date) {
    const validDate = toDate(date) || new Date();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: DASHBOARD_CONFIG.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(validDate);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(value) {
    const date = toDate(value); 
    if (!date) return "--/--/----";
    return new Intl.DateTimeFormat(DASHBOARD_CONFIG.locale, { timeZone: DASHBOARD_CONFIG.timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatTime(value) {
    const date = toDate(value); 
    if (!date) return "--:--";
    return new Intl.DateTimeFormat(DASHBOARD_CONFIG.locale, { timeZone: DASHBOARD_CONFIG.timeZone, hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDateTime(value) {
    const date = toDate(value); 
    if (!date) return "Não informado";
    return `${formatDate(date)} às ${formatTime(date)}`;
}

function formatCompactDate(value) {
    const date = toDate(value); 
    if (!date) return "--/--";
    return new Intl.DateTimeFormat(DASHBOARD_CONFIG.locale, { timeZone: DASHBOARD_CONFIG.timeZone, day: "2-digit", month: "2-digit" }).format(date);
}

function minutesBetween(start, end) {
    const startDate = toDate(start); 
    const endDate = toDate(end);
    if (!startDate || !endDate || endDate < startDate) return null;
    return Math.round((endDate.getTime() - startDate.getTime()) / 60000);
}

function formatDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0) return "--";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60); 
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
}

function formatNumber(value) { 
    return new Intl.NumberFormat(DASHBOARD_CONFIG.locale).format(Number(value) || 0); 
}

function normalizeStatus(value) {
    const normalized = normalizeText(value);
    if (normalized.includes("conclu")) return "Concluída";
    if (normalized.includes("andamento")) return "Em andamento";
    if (normalized.includes("pendente")) return "Pendente";
    return safeString(value, "Não informado");
}

function statusClass(status) {
    if (status === "Concluída") return "status-concluida";
    if (status === "Em andamento") return "status-andamento";
    if (status === "Pendente") return "status-pendente";
    return "status-outro";
}

function statusColor(status) {
    if (status === "Concluída") return "#0c9b69";
    if (status === "Em andamento") return "#f51e30";
    if (status === "Pendente") return "#dc8c00";
    return "#6f7282";
}

function parseCoordinates(value) {
    if (!value) return null;
    let latitude, longitude;
    if (typeof value === "string") { 
        const parts = value.split(/[;,]/).map(part => Number(part.trim())); 
        [latitude, longitude] = parts; 
    } else if (typeof value === "object") { 
        latitude = Number(value.latitude ?? value.lat ?? value._lat); 
        longitude = Number(value.longitude ?? value.lng ?? value.lon ?? value._long); 
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
    return { lat: latitude, lng: longitude };
}

function initials(name) { 
    return safeString(name, "US").split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase(); 
}

function firstAvailable(source, keys, fallback = "") {
    for (const key of keys) { 
        const value = source?.[key]; 
        if (value !== undefined && value !== null && safeString(value)) return value; 
    } 
    return fallback;
}

function normalizeProfessional(data, id, sourceCollection) {
    const sourceLabel = sourceCollection === DASHBOARD_CONFIG.collections.promoters ? "Promotor Técnico de Vendas" : sourceCollection === DASHBOARD_CONFIG.collections.technicalAssistance ? "Assistência Técnica" : sourceCollection === DASHBOARD_CONFIG.collections.managers ? "Gestão" : sourceCollection === DASHBOARD_CONFIG.collections.administrators ? "Administrador" : "Profissional";
    const name = safeString(firstAvailable(data, ["nome", "name", "nomeCompleto"], "Profissional"));
    const role = safeString(firstAvailable(data, ["cargo", "funcao", "perfil", "tipo", "role"], sourceLabel));
    return {
        id, sourceCollection, raw: data || {}, name, role,
        email: safeString(firstAvailable(data, ["email", "eMail"])),
        phone: safeString(firstAvailable(data, ["telefone", "celular", "whatsapp", "fone"])),
        region: safeString(firstAvailable(data, ["regiao", "regional", "territorio", "cidade", "uf"])),
        status: safeString(firstAvailable(data, ["status", "situacao"], data?.ativo === false ? "Inativo" : "Ativo")),
        photoUrl: safeString(firstAvailable(data, ["fotoUrl", "fotoURL", "photoURL", "imagem", "avatar"])),
        monthlyTarget: Number(firstAvailable(data, ["metaMensal", "meta", "metaVisitas"], 0)) || 0,
        ativo: data?.ativo !== false
    };
}

function normalizeClient(data, id) {
    return {
        id, raw: data || {},
        name: safeString(firstAvailable(data, ["nome", "nomeFantasia", "razaoSocial"], "Cliente não identificado")),
        city: safeString(firstAvailable(data, ["cidade", "municipio"])),
        state: safeString(firstAvailable(data, ["uf", "estado"])),
        address: safeString(firstAvailable(data, ["enderecoCompleto", "endereco", "logradouro"])),
        coordinates: parseCoordinates(data) || parseCoordinates({ lat: data?.lat, lng: data?.lng })
    };
}

function enrichActivity(data, id) {
    const professional = state.professionalMap.get(data.ptvId) || { id: data.ptvId || "sem-profissional", name: safeString(data.ptvNome, "Profissional não localizado"), role: "Profissional", raw: {} };
    const client = state.clientMap.get(data.clienteId) || { id: data.clienteId || "sem-cliente", name: safeString(data.clienteNome, "Cliente não localizado"), city: "", state: "", address: "", coordinates: null, raw: {} };
    const scheduledAt = toDate(data.data ?? data.dataAgendada ?? data.criadoEm);
    const checkinAt = toDate(data.checkinDataHora ?? data.checkinEm);
    const checkoutAt = toDate(data.checkoutDataHora ?? data.checkoutEm);
    const checkinCoordinates = parseCoordinates(data.checkinGps ?? data.checkinCoordenadas);
    const checkoutCoordinates = parseCoordinates(data.checkoutGps ?? data.checkoutCoordenadas);
    const mapCoordinates = checkinCoordinates || client.coordinates || checkoutCoordinates;

    return {
        id, raw: data, professionalId: data.ptvId || professional.id, professional, clientId: data.clienteId || client.id, client,
        scheduledAt, checkinAt, checkoutAt, status: normalizeStatus(data.status), type: safeString(data.objetivo ?? data.tipoAtividade ?? data.tipo, "Visita"),
        note: safeString(data.nota ?? data.observacao ?? data.resumo), reportId: safeString(data.relatorioId),
        checkinAddress: safeString(data.checkinEndereco), checkoutAddress: safeString(data.checkoutEndereco),
        checkinCoordinates, checkoutCoordinates, mapCoordinates, durationMinutes: minutesBetween(checkinAt, checkoutAt)
    };
}

function setLoading(visible, text = "Carregando dados...") {
    state.loading = visible;
    $("dashboard-loading").hidden = !visible;
    $("dashboard-loading-text").textContent = text;
    $("dashboard-btn-atualizar").disabled = visible;
    $("dashboard-btn-aplicar").disabled = visible;
}

function setSyncStatus(type, message) {
    const dot = $("dashboard-sync-dot");
    if(dot) dot.className = `sync-dot ${type ? `is-${type}` : ""}`.trim();
    if($("dashboard-sync-text")) $("dashboard-sync-text").textContent = message;
}

function showToast(message, type = "") {
    const toast = $("dashboard-toast"); 
    clearTimeout(state.toastTimer);
    toast.textContent = message; 
    toast.className = `toast ${type ? `is-${type}` : ""}`.trim();
    toast.hidden = false; 
    state.toastTimer = setTimeout(() => { toast.hidden = true; }, 4300);
}

function errorMessage(error) {
    const code = safeString(error?.code); 
    const rawMessage = safeString(error?.message);
    const messages = {
        "auth/invalid-credential": "E-mail ou senha inválidos.",
        "auth/user-not-found": "Usuário não encontrado.",
        "auth/wrong-password": "E-mail ou senha inválidos.",
        "permission-denied": "Seu usuário não possui permissão de leitura para estes dados."
    };
    return messages[code] || rawMessage || "Não foi possível concluir a operação.";
}

function showLogin() { 
    $("dashboard-login").hidden = false; 
    $("dashboard-shell").hidden = true; 
    $("dashboard-btn-entrar").disabled = false; 
    $("dashboard-btn-entrar").textContent = "Entrar"; 
    setLoading(false); 
    clearInterval(state.autoRefreshTimer); 
    state.autoRefreshTimer = null; 
}

function showDashboard() { 
    $("dashboard-login").hidden = true; 
    $("dashboard-shell").hidden = false; 
}

function resetStateForSession() {
    state.profile = null; state.canSeeAll = false; state.professionals = []; state.professionalMap = new Map();
    state.clients = []; state.clientMap = new Map(); state.activities = []; state.filteredActivities = [];
    state.loadedRange = null; state.activitiesLoading = false; state.currentPage = 1; state.googleRoutePoints = [];
    clearCharts(); clearMapLayers();
}

// === SISTEMA DE LOGS DE ERRO (ALTERAÇÃO 3) ===
async function salvarLogErro(contexto, mensagemErro) {
    try {
        const idLog = "log_" + Date.now();
        await setDoc(doc(db, "logs_sistema", idLog), {
            contexto: contexto,
            erro: String(mensagemErro),
            dataHora: new Date(),
            usuarioId: state.profile?.id || "desconhecido"
        });
        console.warn(`[LOG Registrado] Erro no módulo ${contexto}:`, mensagemErro);
    } catch (e) {
        console.error("Falha ao salvar log de erro na base de dados:", e);
    }
}

async function safeGetProfileFromCollection(collectionName, user) {
    try {
        const uidSnapshot = await getDoc(doc(db, collectionName, user.uid));
        if (uidSnapshot.exists()) return normalizeProfessional(uidSnapshot.data(), uidSnapshot.id, collectionName);
    } catch (error) {}
    try {
        const snapshot = await getDocs(query(collection(db, collectionName), where("email", "==", user.email || "")));
        if (!snapshot.empty) return normalizeProfessional(snapshot.docs[0].data(), snapshot.docs[0].id, collectionName);
    } catch (error) {}
    return null;
}

async function resolveUserAccess(user) {
    let tokenClaims = {};
    try { const token = await getIdTokenResult(user); tokenClaims = token.claims || {}; } catch (e) {}

    const collectionOrder = [DASHBOARD_CONFIG.collections.administrators, DASHBOARD_CONFIG.collections.managers, DASHBOARD_CONFIG.collections.technicalAssistance, DASHBOARD_CONFIG.collections.promoters];
    let profile = null;
    for (const collectionName of collectionOrder) { 
        profile = await safeGetProfileFromCollection(collectionName, user); 
        if (profile) break; 
    }

    const email = normalizeText(user.email);
    const allowlisted = DASHBOARD_CONFIG.administratorEmails.some(item => normalizeText(item) === email);

    if (!profile && allowlisted) { 
        profile = normalizeProfessional({ nome: user.displayName || "Gestor", email: user.email, cargo: "Gestão" }, user.uid, DASHBOARD_CONFIG.collections.managers); 
    }
    
    if (!profile) throw new Error("O e-mail autenticado não foi localizado nas coleções de usuários do aplicativo.");

    const managementText = normalizeText([profile.role, profile.raw?.cargo, profile.raw?.perfil, tokenClaims.role].filter(Boolean).join(" "));
    const managementRole = DASHBOARD_CONFIG.managementTerms.some(term => managementText.includes(normalizeText(term)));
    const managementCollection = [DASHBOARD_CONFIG.collections.administrators, DASHBOARD_CONFIG.collections.managers].includes(profile.sourceCollection);

    return { profile, canSeeAll: allowlisted || managementRole || managementCollection };
}

async function readCollectionSafely(collectionName) {
    try {
        const snapshot = await getDocs(collection(db, collectionName));
        return snapshot.docs.map(doc => ({ id: doc.id, data: doc.data() }));
    } catch (error) { 
        return []; 
    }
}

async function loadReferenceData(sessionVersion) {
    setLoading(true, "Carregando equipe e clientes...");
    const [promoters, assistance, admins, clients] = await Promise.all([
        readCollectionSafely(DASHBOARD_CONFIG.collections.promoters),
        readCollectionSafely(DASHBOARD_CONFIG.collections.technicalAssistance),
        readCollectionSafely(DASHBOARD_CONFIG.collections.administrators),
        readCollectionSafely(DASHBOARD_CONFIG.collections.clients)
    ]);

    if (sessionVersion !== state.sessionVersion) return;

    const professionals = [
        ...promoters.map(item => normalizeProfessional(item.data, item.id, DASHBOARD_CONFIG.collections.promoters)),
        ...assistance.map(item => normalizeProfessional(item.data, item.id, DASHBOARD_CONFIG.collections.technicalAssistance)),
        ...admins.map(item => normalizeProfessional(item.data, item.id, DASHBOARD_CONFIG.collections.administrators))
    ];

    if (!professionals.some(person => person.id === state.profile.id)) {
        professionals.push(state.profile);
    }

    const uniqueProfessionals = Array.from(new Map(professionals.map(person => [person.id, person])).values()).sort((a, b) => a.name.localeCompare(b.name, DASHBOARD_CONFIG.locale));
    state.professionals = state.canSeeAll ? uniqueProfessionals : uniqueProfessionals.filter(person => person.id === state.profile.id);
    state.professionalMap = new Map(uniqueProfessionals.map(person => [person.id, person]));

    state.clients = clients.map(item => normalizeClient(item.data, item.id)).sort((a, b) => a.name.localeCompare(b.name, DASHBOARD_CONFIG.locale));
    state.clientMap = new Map(state.clients.map(client => [client.id, client]));

    populateProfessionalFilter();
    populateFormSelects();
    renderClientsAdminTable();
    renderTeamAdminTable();
}

function populateProfessionalFilter() {
    const select = $("filtro-profissional"); 
    const currentValue = select.value; 
    select.replaceChildren();
    
    const allOption = document.createElement("option"); 
    allOption.value = ""; 
    allOption.textContent = state.canSeeAll ? "Todos os profissionais" : state.profile.name; 
    select.appendChild(allOption);
    
    if (state.canSeeAll) {
        for (const p of state.professionals) { 
            const opt = document.createElement("option"); 
            opt.value = p.id; 
            opt.textContent = `${p.name} — ${p.role}`; 
            select.appendChild(opt); 
        }
        select.disabled = false; 
        if ([...select.options].some(o => o.value === currentValue)) select.value = currentValue;
    } else { 
        select.value = ""; 
        select.disabled = true; 
    }
}

function populateFormSelects() {
    const selCliente = $("v-cliente");
    if (selCliente) {
        selCliente.innerHTML = '<option value="">Selecione um cliente...</option>';
        state.clients.forEach(c => { 
            selCliente.innerHTML += `<option value="${c.id}">${c.name} - ${c.city || ''}</option>`; 
        });
    }
    const selResp = $("v-responsavel");
    if (selResp) {
        selResp.innerHTML = '<option value="">Selecione um técnico...</option>';
        state.professionals.forEach(p => { 
            if(p.ativo) {
                selResp.innerHTML += `<option value="${p.id}">[${p.role}] ${p.name}</option>`; 
            }
        });
    }
}

async function loadMissingClients(activities, sessionVersion) {
    const missingIds = [...new Set(activities.map(a => a.clienteId).filter(id => id && !state.clientMap.has(id)))].slice(0, 200);
    if (!missingIds.length) return;
    
    const results = await Promise.allSettled(missingIds.map(async id => {
        const snap = await getDoc(doc(db, DASHBOARD_CONFIG.collections.clients, id));
        return snap.exists() ? normalizeClient(snap.data(), snap.id) : null;
    }));
    
    if (sessionVersion !== state.sessionVersion) return;
    
    for (const r of results) { 
        if (r.status === "fulfilled" && r.value) {
            state.clientMap.set(r.value.id, r.value);
        }
    }
}

function selectedDateRange() {
    const startValue = $("filtro-data-inicial").value; 
    const endValue = $("filtro-data-final").value;
    const start = parseInputDate(startValue, false); 
    const end = parseInputDate(endValue, true);
    
    if (!start || !end) throw new Error("Informe datas válidas.");
    if (end < start) throw new Error("A data final não pode ser anterior à data inicial.");
    
    return { start, end, startValue, endValue };
}

async function loadActivities({ silent = false } = {}) {
    if (!state.user || !state.profile || state.activitiesLoading) return;
    const range = selectedDateRange(); 
    state.activitiesLoading = true; 
    const sessionVersion = state.sessionVersion;

    if (!silent) setLoading(true, "Carregando atividades...");
    setSyncStatus("loading", "Atualizando dados...");

    try {
        let activityQuery = state.canSeeAll 
            ? query(collection(db, DASHBOARD_CONFIG.collections.activities), where("data", ">=", range.start), where("data", "<=", range.end)) 
            : query(collection(db, DASHBOARD_CONFIG.collections.activities), where("ptvId", "==", state.profile.id));
        
        let snapshot;
        try { 
            snapshot = await getDocs(activityQuery); 
        } catch (error) {
            if (state.canSeeAll && error?.code === "failed-precondition") {
                snapshot = await getDocs(collection(db, DASHBOARD_CONFIG.collections.activities)); 
            } else {
                throw error;
            }
        }

        if (sessionVersion !== state.sessionVersion) return;
        
        let rawActivities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        rawActivities = rawActivities.filter(a => {
            const d = toDate(a.data ?? a.dataAgendada ?? a.criadoEm);
            return d && d >= range.start && d <= range.end && (state.canSeeAll || a.ptvId === state.profile.id);
        });

        await loadMissingClients(rawActivities, sessionVersion);
        if (sessionVersion !== state.sessionVersion) return;

        state.activities = rawActivities.map(a => enrichActivity(a, a.id)).sort((a, b) => (b.scheduledAt?.getTime() || 0) - (a.scheduledAt?.getTime() || 0));
        state.loadedRange = { startValue: range.startValue, endValue: range.endValue };
        state.currentPage = 1;
        
        applyFilters({ resetPage: true });
        setSyncStatus("ok", `Atualizado às ${formatTime(new Date())}`);
    } catch (error) {
        console.error("Erro ao carregar:", error); 
        setSyncStatus("error", "Falha ao atualizar"); 
        showToast(errorMessage(error), "error");
    } finally {
        if (sessionVersion === state.sessionVersion) { 
            state.activitiesLoading = false; 
            if (!silent) setLoading(false); 
        }
    }
}

function applyFilters({ resetPage = false } = {}) {
    const filters = {
        professionalId: $("filtro-profissional").value, 
        status: $("filtro-status").value,
        type: normalizeText($("filtro-tipo").value), 
        clientSearch: normalizeText($("filtro-cliente").value)
    };

    state.filteredActivities = state.activities.filter(a => {
        if (filters.professionalId && a.professionalId !== filters.professionalId) return false;
        if (filters.status && a.status !== filters.status) return false;
        if (filters.type && !normalizeText(a.type).includes(filters.type)) return false;
        if (filters.clientSearch) {
            const txt = normalizeText([a.client.name, a.client.city, a.client.state, a.client.address].join(" "));
            if (!txt.includes(filters.clientSearch)) return false;
        }
        return true;
    });

    if (resetPage) state.currentPage = 1;
    renderDashboard();
}

function renderDashboard() { 
    renderKpis(); 
    renderCharts(); 
    renderMap(); 
    renderRanking(); 
    renderTable(); 
}

function renderKpis() {
    const acts = state.filteredActivities;
    const total = acts.length; 
    const completed = acts.filter(a => a.status === "Concluída").length;
    const inProgress = acts.filter(a => a.status === "Em andamento").length; 
    const pending = acts.filter(a => a.status === "Pendente").length;
    const trainings = acts.filter(a => normalizeText(a.type).includes("treinamento")).length;
    const clients = new Set(acts.map(a => a.clientId).filter(Boolean)).size;
    const durs = acts.map(a => a.durationMinutes).filter(v => Number.isFinite(v));
    const avgDur = durs.length ? Math.round(durs.reduce((s, v) => s + v, 0) / durs.length) : null;

    $("kpi-total").textContent = formatNumber(total); 
    $("kpi-total-sub").textContent = `${formatNumber(clients)} ${clients === 1 ? "cliente" : "clientes"}`;
    $("kpi-concluidas").textContent = formatNumber(completed); 
    $("kpi-concluidas-sub").textContent = `${total ? Math.round((completed / total) * 100) : 0}% de conclusão`;
    $("kpi-andamento").textContent = formatNumber(inProgress); 
    $("kpi-andamento-sub").textContent = inProgress ? "Acompanhamento em tempo real" : "Nenhuma visita aberta";
    $("kpi-pendentes").textContent = formatNumber(pending); 
    $("kpi-pendentes-sub").textContent = pending === 1 ? "Visita agendada" : "Visitas agendadas";
    $("kpi-treinamentos").textContent = formatNumber(trainings); 
    $("kpi-treinamentos-sub").textContent = `${total ? Math.round((trainings / total) * 100) : 0}% das atividades`;
    $("kpi-duracao").textContent = formatDuration(avgDur); 
    $("kpi-duracao-sub").textContent = durs.length ? `${formatNumber(durs.length)} visitas concluídas` : "Sem duração";
}

function clearCharts() { 
    for (const c of Object.values(state.charts)) {
        try { c?.destroy(); } catch (e) {} 
    }
    state.charts = {}; 
}

function destroyChart(name) { 
    try { state.charts[name]?.destroy(); } catch (e) {} 
    delete state.charts[name]; 
}

function chartBaseOptions() { 
    return { 
        responsive: true, 
        maintainAspectRatio: false, 
        animation: { duration: 350 }, 
        interaction: { intersect: false, mode: "index" }, 
        plugins: { 
            legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 18, color: "#646779", font: { family: "Outfit", size: 11, weight: "600" } } }, 
            tooltip: { backgroundColor: "#040438", padding: 11, titleFont: { family: "Outfit", weight: "700" }, bodyFont: { family: "Outfit" }, displayColors: true } 
        }, 
        scales: { 
            x: { grid: { display: false }, ticks: { color: "#7a7d8d", font: { family: "Outfit", size: 10 } } }, 
            y: { beginAtZero: true, grid: { color: "rgba(111,114,130,0.10)" }, ticks: { precision: 0, color: "#7a7d8d", font: { family: "Outfit", size: 10 } } } 
        } 
    }; 
}

function renderCharts() {
    if (typeof window.Chart !== "function") return;
    renderEvolutionChart(); 
    renderStatusChart(); 
    renderTeamChart();
}

function renderEvolutionChart() {
    destroyChart("evolution"); 
    const canvas = $("grafico-evolucao"); 
    const empty = $("grafico-evolucao-vazio");
    
    if (!state.filteredActivities.length) { 
        canvas.hidden = true; empty.hidden = false; return; 
    }
    canvas.hidden = false; empty.hidden = true;

    const buckets = new Map();
    for (const a of state.filteredActivities) {
        if (!a.scheduledAt) continue;
        const key = dateInputValue(a.scheduledAt);
        if (!buckets.has(key)) buckets.set(key, { date: a.scheduledAt, completed: 0, inProgress: 0, pending: 0 });
        const b = buckets.get(key);
        if (a.status === "Concluída") b.completed++; 
        else if (a.status === "Em andamento") b.inProgress++; 
        else if (a.status === "Pendente") b.pending++;
    }
    const ordered = [...buckets.values()].sort((a, b) => a.date - b.date);
    const options = chartBaseOptions(); 
    options.scales.x.stacked = true; 
    options.scales.y.stacked = true; 
    options.scales.x.ticks.maxRotation = 0;
    
    state.charts.evolution = new window.Chart(canvas, {
        type: "bar",
        data: { 
            labels: ordered.map(i => formatCompactDate(i.date)), 
            datasets: [ 
                { label: "Concluídas", data: ordered.map(i => i.completed), backgroundColor: "rgba(12,155,105,0.86)", borderRadius: 4 }, 
                { label: "Em andamento", data: ordered.map(i => i.inProgress), backgroundColor: "rgba(245,30,48,0.86)", borderRadius: 4 }, 
                { label: "Pendentes", data: ordered.map(i => i.pending), backgroundColor: "rgba(220,140,0,0.82)", borderRadius: 4 } 
            ] 
        },
        options
    });
}

function renderStatusChart() {
    destroyChart("status"); 
    const canvas = $("grafico-status"); 
    const empty = $("grafico-status-vazio");
    
    if (!state.filteredActivities.length) { 
        canvas.hidden = true; empty.hidden = false; return; 
    }
    canvas.hidden = false; empty.hidden = true;

    const counts = new Map();
    for (const a of state.filteredActivities) counts.set(a.status, (counts.get(a.status) || 0) + 1);
    const labels = ["Concluída", "Em andamento", "Pendente"].filter(s => counts.has(s));

    state.charts.status = new window.Chart(canvas, {
        type: "doughnut",
        data: { 
            labels, 
            datasets: [{ data: labels.map(l => counts.get(l) || 0), backgroundColor: labels.map(statusColor), borderColor: "#ffffff", borderWidth: 4 }] 
        },
        options: { 
            responsive: true, maintainAspectRatio: false, cutout: "67%", plugins: { legend: { position: "bottom" } } 
        }
    });
}

function teamStatistics() {
    const stats = new Map();
    for (const a of state.filteredActivities) {
        const id = a.professionalId || "sem-profissional";
        if (!stats.has(id)) stats.set(id, { id, professional: a.professional, total: 0, completed: 0, clients: new Set(), durations: [] });
        const i = stats.get(id); i.total++;
        if (a.status === "Concluída") i.completed++;
        if (a.clientId) i.clients.add(a.clientId);
        if (Number.isFinite(a.durationMinutes)) i.durations.push(a.durationMinutes);
    }
    return [...stats.values()].map(i => ({ ...i, clientCount: i.clients.size })).sort((a, b) => b.total - a.total || a.professional.name.localeCompare(b.professional.name));
}

function renderTeamChart() {
    destroyChart("team"); 
    const canvas = $("grafico-equipe"); 
    const empty = $("grafico-equipe-vazio");
    const stats = teamStatistics().slice(0, 12);
    
    if (!stats.length) { 
        canvas.hidden = true; empty.hidden = false; return; 
    }
    canvas.hidden = false; empty.hidden = true;
    
    const options = chartBaseOptions(); 
    options.indexAxis = "y"; 
    options.plugins.legend.display = false;
    
    state.charts.team = new window.Chart(canvas, { 
        type: "bar", 
        data: { 
            labels: stats.map(i => i.professional.name), 
            datasets: [{ label: "Atividades", data: stats.map(i => i.total), backgroundColor: "rgba(4,4,56,0.86)", borderRadius: 7 }] 
        }, 
        options 
    });
}

function initializeMap() {
    if (state.map || typeof window.L !== "object") return;
    state.map = window.L.map("mapa-dashboard", { zoomControl: true }).setView(DASHBOARD_CONFIG.defaultMapCenter, DASHBOARD_CONFIG.defaultMapZoom);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(state.map);
}

function clearMapLayers() {
    if (!state.map) { state.mapLayers = []; return; }
    for (const layer of state.mapLayers) {
        try { state.map.removeLayer(layer); } catch (e) {}
    }
    state.mapLayers = [];
}

function renderMap() {
    initializeMap();
    if (!state.map) return;
    clearMapLayers();
    
    const activities = state.filteredActivities.filter(a => a.mapCoordinates);
    const mode = $("mapa-modo").value;
    const allCoords = activities.map(a => [a.mapCoordinates.lat, a.mapCoordinates.lng]);
    state.googleRoutePoints = [];

    $("map-summary").textContent = activities.length ? `${formatNumber(activities.length)} atividades localizadas.` : "Sem coordenadas.";
    
    if (!activities.length) { 
        state.map.setView(DASHBOARD_CONFIG.defaultMapCenter, DASHBOARD_CONFIG.defaultMapZoom); 
        $("dashboard-btn-google-maps").disabled = true; 
        return; 
    }

    if (mode === "calor" && typeof window.L.heatLayer === "function") {
        const heat = activities.map(a => [a.mapCoordinates.lat, a.mapCoordinates.lng, a.status === "Concluída" ? 0.85 : 0.58]);
        const layer = window.L.heatLayer(heat, { radius: 27, blur: 22, maxZoom: 14 }).addTo(state.map); 
        state.mapLayers.push(layer);
    } else {
        for (const a of activities) {
            const m = window.L.circleMarker([a.mapCoordinates.lat, a.mapCoordinates.lng], { radius: 7, color: "#fff", weight: 2, fillColor: statusColor(a.status), fillOpacity: 0.94 });
            m.bindPopup(`<div class="map-popup"><strong>${escapeHtml(a.client.name)}</strong><span>${escapeHtml(a.professional.name)}</span><span>${escapeHtml(formatDateTime(a.scheduledAt))}</span></div>`);
            m.addTo(state.map); 
            state.mapLayers.push(m);
        }
    }
    if (allCoords.length === 1) {
        state.map.setView(allCoords[0], 14); 
    } else {
        state.map.fitBounds(window.L.latLngBounds(allCoords), { padding: [28, 28], maxZoom: 14 });
    }
    setTimeout(() => state.map?.invalidateSize(), 30);
}

function openGoogleRoute() {
    if (state.googleRoutePoints.length < 2) return;
    const points = state.googleRoutePoints.slice(0, 10);
    const params = new URLSearchParams({ api: "1", origin: `${points[0].lat},${points[0].lng}`, destination: `${points[points.length - 1].lat},${points[points.length - 1].lng}`, travelmode: "driving" });
    if (points.length > 2) params.set("waypoints", points.slice(1, -1).map(p => `${p.lat},${p.lng}`).join("|"));
    window.open(`https://www.google.com/maps/dir/?${params.toString()}`, "_blank");
}

function renderRanking() {
    const container = $("ranking-equipe"); 
    const empty = $("ranking-vazio"); 
    const stats = teamStatistics();
    
    container.replaceChildren();
    if (!stats.length) { empty.hidden = false; return; }
    empty.hidden = true;
    
    stats.slice(0, 12).forEach((item, index) => {
        const btn = document.createElement("button"); 
        btn.type = "button"; 
        btn.className = "ranking-item";
        btn.innerHTML = `
            <span class="ranking-position">${index + 1}</span>
            <span class="ranking-main">
                <strong>${escapeHtml(item.professional.name)}</strong>
                <span>${formatNumber(item.completed)} concluídas · ${formatNumber(item.clientCount)} clientes</span>
            </span>
            <span class="ranking-score">
                <strong>${formatNumber(item.total)}</strong>
                <small>atividades</small>
            </span>
        `;
        btn.addEventListener("click", () => openProfessionalProfile(item.id));
        container.appendChild(btn);
    });
}

function renderTable() {
    const body = $("dashboard-table-body"); 
    const empty = $("table-empty");
    
    // === ALTERAÇÃO 2: Tabela de Agenda consome tudo sem influência dos filtros dos KPIs ===
    const arrayParaTabela = state.activities; 
    
    const count = arrayParaTabela.length; 
    const totalPages = Math.max(1, Math.ceil(count / DASHBOARD_CONFIG.pageSize));
    state.currentPage = Math.min(Math.max(1, state.currentPage), totalPages);

    const start = (state.currentPage - 1) * DASHBOARD_CONFIG.pageSize;
    const pageItems = arrayParaTabela.slice(start, start + DASHBOARD_CONFIG.pageSize);
    body.replaceChildren();

    if ($("table-count")) $("table-count").textContent = `${formatNumber(count)} registros`;
    if ($("pagina-info")) $("pagina-info").textContent = `Página ${state.currentPage} de ${totalPages}`;
    if ($("pagina-anterior")) $("pagina-anterior").disabled = state.currentPage <= 1;
    if ($("pagina-proxima")) $("pagina-proxima").disabled = state.currentPage >= totalPages;

    if (!pageItems.length) { empty.hidden = false; return; }
    empty.hidden = true;

    for (const a of pageItems) {
        const tr = document.createElement("tr");
        const loc = [a.client.city, a.client.state].filter(Boolean).join("/");
        
        const btnView = `<button class="table-action btn-view" type="button" title="Ver detalhes"><svg viewBox="0 0 24 24"><path d="M1.5 12s3.5-6 10.5-6 10.5 6 10.5 6-3.5 6-10.5 6S1.5 12 1.5 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>`;
        const btnDelete = state.canSeeAll ? `<button class="table-action delete btn-delete" type="button" title="Excluir"><svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"></path></svg></button>` : '';

        tr.innerHTML = `
            <td><span class="cell-primary">${escapeHtml(formatDate(a.scheduledAt))}</span><span class="cell-secondary">${escapeHtml(formatTime(a.scheduledAt))}</span></td>
            <td><span class="cell-primary">${escapeHtml(a.professional.name)}</span><span class="cell-secondary">${escapeHtml(a.professional.role)}</span></td>
            <td><span class="cell-primary">${escapeHtml(a.client.name)}</span><span class="cell-secondary">${escapeHtml(loc || a.client.address)}</span></td>
            <td>${escapeHtml(a.type)}</td>
            <td><span class="status-badge ${statusClass(a.status)}">${escapeHtml(a.status)}</span></td>
            <td>
                <div class="table-actions-group">
                    ${btnView}
                    ${btnDelete}
                </div>
            </td>
        `;
        
        tr.querySelector(".btn-view").addEventListener("click", () => openActivityDetails(a.id));
        if (state.canSeeAll) {
            tr.querySelector(".btn-delete").addEventListener("click", () => deletarAtividadeAdmin(a.id, a.raw));
        }
        body.appendChild(tr);
    }
}

// === DELEÇÃO DE ATIVIDADE COM LIXEIRA ===
window.deletarAtividadeAdmin = async function(id, rawData) {
    if(confirm("Deseja realmente excluir esta visita e movê-la para a lixeira?")) {
        try {
            await setDoc(doc(db, DASHBOARD_CONFIG.collections.trash, id), { ...rawData, excluidoEm: new Date(), excluidoPor: state.profile.id });
            await deleteDoc(doc(db, DASHBOARD_CONFIG.collections.activities, id));
            showToast("Visita excluída com sucesso.", "success");
            loadActivities().catch(()=>{});
        } catch(e) { 
            showToast("Erro ao excluir visita.", "error"); 
        }
    }
};

function openModal({ eyebrow, title, content }) {
    $("modal-eyebrow").textContent = eyebrow; 
    $("modal-title").textContent = title; 
    $("modal-content").innerHTML = content;
    const modal = $("dashboard-modal"); 
    if (typeof modal.showModal === "function") modal.showModal(); 
    else modal.setAttribute("open", "");
}

function closeModal() {
    const modal = $("dashboard-modal"); 
    if (typeof modal.close === "function" && modal.open) modal.close(); 
    else modal.removeAttribute("open");
}

function detailBox(label, value, wide = false) {
    return `<div class="detail-box ${wide ? "detail-wide" : ""}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "Não informado")}</strong></div>`;
}

async function openActivityDetails(activityId) {
    const a = state.activities.find(i => i.id === activityId); 
    if (!a) return;
    openModal({ eyebrow: "Carregando", title: a.client.name, content: `<p>Buscando detalhes...</p>` });

    let reportText = "Não há relatório."; 
    let reportCode = "";
    
    if (a.reportId) {
        try {
            const snap = await getDoc(doc(db, DASHBOARD_CONFIG.collections.reports, a.reportId));
            if (snap.exists()) { 
                reportText = safeString(snap.data().textoAtual ?? snap.data().texto); 
                reportCode = snap.data().codigo || a.reportId; 
            }
        } catch (e) { 
            reportText = "Erro ao carregar relatório."; 
        }
    }
    const content = `
        <div class="modal-grid">
            ${detailBox("Protocolo", `#${a.id}`)} 
            ${detailBox("Status", a.status)}
            ${detailBox("Profissional", a.professional.name)} 
            ${detailBox("Tipo", a.type)}
            ${detailBox("Agendamento", formatDateTime(a.scheduledAt))} 
            ${detailBox("Duração", formatDuration(a.durationMinutes))}
            ${detailBox("Cliente", a.client.name, true)} 
            ${detailBox("Endereço", a.client.address || a.client.city, true)}
            ${detailBox("Nota da agenda", a.note || "Sem observação.", true)}
            ${detailBox(reportCode ? `Relatório ${reportCode}` : "Relatório", reportText, true)}
        </div>
    `;
    $("modal-eyebrow").textContent = "Detalhes da atividade"; 
    $("modal-title").textContent = a.client.name; 
    $("modal-content").innerHTML = content;
}

function openProfessionalProfile(id) {
    const p = state.professionalMap.get(id); 
    if(!p) return;
    openModal({ 
        eyebrow: "Perfil", 
        title: p.name, 
        content: `<div class="modal-grid">${detailBox("E-mail", p.email)} ${detailBox("Telefone", p.phone)} ${detailBox("Região", p.region)} ${detailBox("Situação", p.status)}</div>` 
    });
}

function exportCsv() {
    if (!state.filteredActivities.length) return;
    const headers = ["ID", "Data agendada", "Hora agendada", "Profissional", "Cliente", "Cidade", "Tipo", "Status", "Check-in", "Check-out"];
    // Mantendo uso das state.filteredActivities no CSV ou trocando para state.activities, dependendo se o CSV deve ignorar filtros
    const rows = state.activities.map(a => [a.id, formatDate(a.scheduledAt), formatTime(a.scheduledAt), a.professional.name, a.client.name, a.client.city, a.type, a.status, formatDateTime(a.checkinAt), formatDateTime(a.checkoutAt)]);
    
    const content = [headers, ...rows].map(row => {
        return row.map(val => {
            const cell = String(val).replace(/"/g, '""');
            return `"${cell}"`;
        }).join(";");
    }).join("\r\n");

    const blob = new Blob(["\ufeff", content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob); 
    const anchor = document.createElement("a"); 
    anchor.href = url; 
    anchor.download = `visitas.csv`;
    anchor.click(); 
    URL.revokeObjectURL(url);
}

// === ABAS (TABS) E GESTÃO ===
function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.aba-conteudo').forEach(a => { 
                a.hidden = true; 
                a.classList.remove('active'); 
            });
            btn.classList.add('active');
            const target = $(btn.dataset.target);
            target.hidden = false; 
            target.classList.add('active');
            
            if (btn.dataset.target === 'aba-dashboard') {
                setTimeout(() => state.map?.invalidateSize(), 50);
            }
        });
    });
}

// === GESTÃO DE LOJAS / CLIENTES ===
function renderClientsAdminTable() {
    const tbody = $("tabela-clientes-body"); 
    if(!tbody) return;
    
    let html = '';
    state.clients.forEach(c => {
        const btnEdit = `<button class="table-action" onclick="window.editarClienteAdmin('${c.id}')"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>`;
        const btnDelete = state.canSeeAll ? `<button class="table-action delete" onclick="window.deletarClienteAdmin('${c.id}')"><svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"></path></svg></button>` : '';

        html += `
        <tr>
            <td>
                <span class="cell-primary">${escapeHtml(c.name)}</span>
                <span class="cell-secondary">CNPJ/Doc: ${c.raw.codigoCnpj || '-'}</span>
            </td>
            <td>${escapeHtml(c.city || '')} / ${escapeHtml(c.state || '')}</td>
            <td><span class="cell-secondary" style="white-space: normal;">${escapeHtml(c.address || '-')}</span></td>
            <td>
                <div class="table-actions-group">
                    ${btnEdit}
                    ${btnDelete}
                </div>
            </td>
        </tr>`;
    });
    tbody.innerHTML = html || '<tr><td colspan="4" class="empty-state">Nenhum cliente registado.</td></tr>';
}

window.editarClienteAdmin = function(id) {
    const c = state.clientMap.get(id); 
    if(!c) return;
    
    $("mc-id").value = id; 
    $("mc-nome").value = c.name; 
    $("mc-cidade").value = c.city; 
    $("mc-uf").value = c.state; 
    $("mc-endereco").value = c.address;
    
    $("cliente-modal-title").textContent = "Editar Loja"; 
    $("modal-cliente").showModal();
}

window.deletarClienteAdmin = async function(id) {
    if(confirm("Tem certeza que deseja excluir esta Loja/Cliente do sistema?")) {
        try { 
            await deleteDoc(doc(db, DASHBOARD_CONFIG.collections.clients, id)); 
            showToast("Loja excluída.", "success"); 
            loadReferenceData(state.sessionVersion); 
        } catch (e) { 
            showToast("Erro ao excluir.", "error"); 
        }
    }
}

// === GESTÃO DE EQUIPE ===
function renderTeamAdminTable() {
    const tbody = $("tabela-equipe-body"); 
    if(!tbody) return;
    
    let html = '';
    state.professionals.forEach(p => {
        const badge = p.ativo ? `<span class="status-badge status-concluida">Ativo</span>` : `<span class="status-badge status-andamento">Bloqueado</span>`;
        const btnEdit = `<button class="table-action" onclick="window.editarEquipeAdmin('${p.id}')"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>`;
        const btnDelete = state.canSeeAll ? `<button class="table-action delete" onclick="window.deletarEquipeAdmin('${p.sourceCollection}', '${p.id}')"><svg viewBox="0 0 24 24"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2M10 11v6M14 11v6"></path></svg></button>` : '';

        html += `
        <tr>
            <td>
                <span class="cell-primary">${escapeHtml(p.name)}</span>
                <span class="cell-secondary">${escapeHtml(p.phone || '-')}</span>
            </td>
            <td>${escapeHtml(p.email)}</td>
            <td><span class="cell-primary">${escapeHtml(p.role)}</span></td>
            <td>${escapeHtml(p.region || '-')}</td>
            <td>${badge}</td>
            <td>
                <div class="table-actions-group">
                    ${btnEdit}
                    ${btnDelete}
                </div>
            </td>
        </tr>`;
    });
    tbody.innerHTML = html || '<tr><td colspan="6" class="empty-state">Nenhum membro registado.</td></tr>';
}

window.editarEquipeAdmin = function(id) {
    const p = state.professionalMap.get(id); 
    if(!p) return;
    
    $("mu-id").value = id; 
    $("mu-colecao-original").value = p.sourceCollection;
    $("mu-nome").value = p.name; 
    $("mu-email").value = p.email; 
    $("mu-perfil").value = p.sourceCollection; 
    $("mu-regiao").value = p.region; 
    $("mu-telefone").value = p.phone;
    
    $("label-status-equipe").hidden = false; 
    $("mu-status").hidden = false; 
    $("mu-status").value = p.ativo ? "true" : "false";
    
    $("equipe-modal-title").textContent = "Editar Membro"; 
    $("modal-equipe").showModal();
}

window.deletarEquipeAdmin = async function(col, id) {
    if(confirm("Tem certeza que deseja excluir permanentemente este membro do acesso ao app?")) {
        try { 
            await deleteDoc(doc(db, col, id)); 
            showToast("Membro excluído.", "success"); 
            loadReferenceData(state.sessionVersion); 
        } catch (e) { 
            showToast("Erro ao excluir.", "error"); 
        }
    }
}

// === BRASIL API (CNPJ E CEP PARA O MODAL) COM LOGS ===
function initBrasilAPI() {
    const iptCnpj = $("mc-cnpj"); 
    const iptCep = $("mc-cep");
    
    if(iptCnpj) {
        iptCnpj.addEventListener('blur', async () => {
            const cnpjNum = iptCnpj.value.replace(/\D/g, ''); 
            const lblStatus = $("mc-status-cnpj");
            
            if(cnpjNum.length === 14) {
                lblStatus.textContent = "(Buscando...)"; 
                lblStatus.style.color = "var(--blue)";
                try {
                    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjNum}`);
                    if(res.ok) {
                        const dados = await res.json();
                        $("mc-nome").value = dados.nome_fantasia || dados.razao_social; 
                        $("mc-cep").value = (dados.cep || "").replace(/\D/g, '');
                        $("mc-endereco").value = dados.logradouro || ""; 
                        $("mc-cidade").value = dados.municipio || ""; 
                        $("mc-uf").value = dados.uf || "";
                        lblStatus.textContent = "(Encontrado)"; 
                        lblStatus.style.color = "var(--green)";
                    } else {
                        lblStatus.textContent = "(Falha)";
                        // ALTERAÇÃO 3: Gravação de log de falha de retorno da API
                        salvarLogErro("BrasilAPI_CNPJ", `Status da resposta não OK: ${res.status} ao buscar o CNPJ ${cnpjNum}`);
                    }
                } catch(e) { 
                    lblStatus.textContent = "(Falha)"; 
                    // ALTERAÇÃO 3: Gravação de log caso a requisição lance exceção (ex: timeout ou offline)
                    salvarLogErro("BrasilAPI_CNPJ", e.message || e);
                }
            }
        });
    }
    
    if(iptCep) {
        iptCep.addEventListener('blur', async () => {
            const cepNum = iptCep.value.replace(/\D/g, ''); 
            const lblStatus = $("mc-status-cep");
            
            if(cepNum.length === 8) {
                lblStatus.textContent = "(Buscando...)"; 
                lblStatus.style.color = "var(--blue)";
                try {
                    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepNum}`);
                    if(res.ok) {
                        const dados = await res.json();
                        $("mc-endereco").value = dados.street || ""; 
                        $("mc-cidade").value = dados.city || ""; 
                        $("mc-uf").value = dados.state || "";
                        lblStatus.textContent = "(Encontrado)"; 
                        lblStatus.style.color = "var(--green)";
                    } else {
                        lblStatus.textContent = "(Falha)";
                        // ALTERAÇÃO 3: Gravação de log
                        salvarLogErro("BrasilAPI_CEP", `Status da resposta não OK: ${res.status} ao buscar o CEP ${cepNum}`);
                    }
                } catch(e) { 
                    lblStatus.textContent = "(Falha)"; 
                    // ALTERAÇÃO 3: Gravação de log
                    salvarLogErro("BrasilAPI_CEP", e.message || e);
                }
            }
        });
    }
}

function bindEvents() {
    const today = new Date(); 
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    if($("filtro-data-inicial")) $("filtro-data-inicial").value = dateInputValue(firstDay); 
    if($("filtro-data-final")) $("filtro-data-final").value = dateInputValue(today);

    if($("dashboard-login-form")) {
        $("dashboard-login-form").addEventListener("submit", async e => {
            e.preventDefault();
            const em = $("dashboard-email").value.trim(); 
            const pw = $("dashboard-senha").value; 
            const err = $("dashboard-login-erro");
            
            err.hidden = true; 
            if (!em || !pw) { 
                err.textContent = "Preencha todos os campos."; 
                err.hidden = false; 
                return; 
            }
            
            $("dashboard-btn-entrar").disabled = true; 
            $("dashboard-btn-entrar").textContent = "Verificando...";
            
            try { 
                await signInWithEmailAndPassword(auth, em, pw); 
            } catch (error) { 
                err.textContent = errorMessage(error); 
                err.hidden = false; 
                $("dashboard-btn-entrar").disabled = false; 
                $("dashboard-btn-entrar").textContent = "Entrar"; 
            }
        });
    }

    $("dashboard-btn-sair")?.addEventListener("click", async () => { 
        if (!state.loading) {
            try { await signOut(auth); } catch (e) {} 
        }
    });

    $("dashboard-btn-atualizar")?.addEventListener("click", () => loadActivities().catch(()=>{}));
    $("dashboard-btn-aplicar")?.addEventListener("click", applyRequestedFilters);
    $("dashboard-btn-limpar")?.addEventListener("click", clearFilters);
    $("dashboard-btn-exportar")?.addEventListener("click", exportCsv);
    $("mapa-modo")?.addEventListener("change", renderMap);
    $("dashboard-btn-google-maps")?.addEventListener("click", openGoogleRoute);
    
    $("filtro-cliente")?.addEventListener("keydown", e => { 
        if (e.key === "Enter") applyRequestedFilters(); 
    });

    $("pagina-anterior")?.addEventListener("click", () => { 
        if (state.currentPage > 1) { 
            state.currentPage--; 
            renderTable(); 
        } 
    });
    
    $("pagina-proxima")?.addEventListener("click", () => { 
        // Correção de state.currentPage < total baseada no array state.activities
        const total = Math.max(1, Math.ceil(state.activities.length / DASHBOARD_CONFIG.pageSize)); 
        if (state.currentPage < total) { 
            state.currentPage++; 
            renderTable(); 
        } 
    });

    $("modal-fechar")?.addEventListener("click", closeModal);
    $("dashboard-modal")?.addEventListener("click", e => { 
        if (e.target === $("dashboard-modal")) closeModal(); 
    });
    
    // Inicializações de Gestão
    initTabs(); 
    initBrasilAPI();
    
    // GESTÃO DE CLIENTES (Eventos)
    $("btn-abrir-modal-cliente")?.addEventListener("click", () => {
        $("form-cliente-modal").reset(); 
        $("mc-id").value = ""; 
        $("mc-status-cnpj").textContent = ""; 
        $("mc-status-cep").textContent = "";
        $("cliente-modal-title").textContent = "Nova Loja"; 
        $("modal-cliente").showModal();
    });
    
    $("btn-fechar-cliente")?.addEventListener("click", () => $("modal-cliente").close());
    
    $("form-cliente-modal")?.addEventListener("submit", async e => {
        e.preventDefault(); 
        const btn = $("btn-salvar-modal-cli"); 
        btn.disabled = true; 
        btn.textContent = "A gravar...";
        
        try {
            const id = $("mc-id").value || "cli_" + Date.now();
            const cepLimpo = ($("mc-cep")?.value || "").replace(/\D/g, "");
            const endereco = $("mc-endereco")?.value || "";
            const cidade = $("mc-cidade")?.value || "";
            const uf = ($("mc-uf")?.value || "").toUpperCase();

            let latStr = "";
            let lngStr = "";

            // 1. Tenta obter coordenadas pelo CEP via BrasilAPI v2 (retorna location.coordinates)
            if (cepLimpo.length === 8) {
                try {
                    const resCep = await fetch(`https://brasilapi.com.br/api/cep/v2/${cepLimpo}`);
                    if (resCep.ok) {
                        const dadosCep = await resCep.json();
                        const coords = dadosCep?.location?.coordinates;
                        if (coords && coords.latitude && coords.longitude) {
                            latStr = String(coords.latitude);
                            lngStr = String(coords.longitude);
                        }
                    }
                } catch (e) {
                    salvarLogErro("Geocoding_BrasilAPI_CEP", e.message || e);
                }
            }

            // 2. Se a BrasilAPI não retornar coordenadas do CEP, busca pelo endereço via Nominatim (OpenStreetMap)
            if (!latStr || !lngStr) {
                const queryParts = [endereco, cidade, uf, "Brasil"].filter(Boolean).join(", ");
                if (queryParts) {
                    try {
                        const resGeo = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(queryParts)}`);
                        if (resGeo.ok) {
                            const results = await resGeo.json();
                            if (results && results.length > 0) {
                                latStr = String(results[0].lat);
                                lngStr = String(results[0].lon);
                            }
                        }
                    } catch (e) {
                        salvarLogErro("Geocoding_Nominatim", e.message || e);
                    }
                }
            }

            const data = {
                codigoCnpj: $("mc-cnpj")?.value ? ofuscarCNPJ($("mc-cnpj").value.replace(/\D/g, "")) : null,
                nome: $("mc-nome").value, 
                cidade: cidade, 
                uf: uf,
                enderecoCompleto: endereco, 
                lat: latStr,
                lng: lngStr,
                status: "Ativo", 
                atualizadoEm: new Date()
            };

            if (!$("mc-id").value) {
                data.criadoEm = new Date();
            }
            
            await setDoc(doc(db, DASHBOARD_CONFIG.collections.clients, id), data, { merge: true });
            showToast("Loja salva com sucesso!", "success"); 
            $("modal-cliente").close(); 
            loadReferenceData(state.sessionVersion);
        } catch(err) { 
            showToast("Erro ao salvar", "error"); 
        } finally { 
            btn.disabled = false; 
            btn.textContent = "Salvar Loja"; 
        }
    });

    // GESTÃO DE EQUIPE (Eventos)
    $("btn-abrir-modal-equipe")?.addEventListener("click", () => {
        $("form-equipe-modal").reset(); 
        $("mu-id").value = ""; 
        $("label-status-equipe").hidden = true; 
        $("mu-status").hidden = true;
        $("equipe-modal-title").textContent = "Novo Membro"; 
        $("modal-equipe").showModal();
    });
    
    $("btn-fechar-equipe")?.addEventListener("click", () => $("modal-equipe").close());

    $("form-equipe-modal")?.addEventListener("submit", async e => {
        e.preventDefault(); 
        const btn = $("btn-salvar-modal-user"); 
        btn.disabled = true; 
        btn.textContent = "A gravar...";
        
        try {
            const col = $("mu-perfil").value; 
            const oldCol = $("mu-colecao-original").value;
            const prefix = col === 'promotores' ? 'ptv_' : (col === 'assistencia' ? 'ast_' : 'adm_');
            const id = $("mu-id").value || prefix + Date.now();
            const role = col === 'promotores' ? 'Promotor Técnico' : (col === 'assistencia' ? 'Assistente Técnico' : 'Administrador');
            
            const data = { 
                nome: $("mu-nome").value, 
                email: $("mu-email").value, 
                perfil: role, 
                regiao: $("mu-regiao").value, 
                telefone: $("mu-telefone").value, 
                atualizadoEm: new Date() 
            };
            
            if(!$("mu-id").value) { 
                data.ativo = true; 
                data.criadoEm = new Date(); 
            } else { 
                data.ativo = $("mu-status").value === "true"; 
            }
            
            // Se mudou de coleção durante a edição, apaga o antigo
            if($("mu-id").value && oldCol && oldCol !== col) { 
                await deleteDoc(doc(db, oldCol, id)); 
            }
            
            await setDoc(doc(db, col, id), data, {merge: true});
            showToast("Equipe atualizada!", "success"); 
            $("modal-equipe").close(); 
            loadReferenceData(state.sessionVersion);
        } catch(err) { 
            showToast("Erro ao salvar", "error"); 
        } finally { 
            btn.disabled = false; 
            btn.textContent = "Cadastrar Membro"; 
        }
    });

    // AGENDAR VISITA (Eventos)
    $("form-nova-visita")?.addEventListener("submit", async e => {
        e.preventDefault(); 
        const btn = $("btn-salvar-visita"); 
        btn.disabled = true; 
        btn.textContent = "Agendando...";
        
        try {
            const id = "atv_" + Date.now();
            const dataVisita = new Date(`${$("v-data").value}T${$("v-hora").value}:00`);
            
            await setDoc(doc(db, DASHBOARD_CONFIG.collections.activities, id), {
                clienteId: $("v-cliente").value, 
                ptvId: $("v-responsavel").value,
                data: dataVisita,
                objetivo: $("v-motivo").value, 
                nota: $("v-nota").value,
                status: "Pendente", 
                tipo: "Visita", 
                criadoEm: new Date(), 
                atualizadoEm: new Date()
            });
            
            showToast("Visita agendada!", "success"); 
            $("form-nova-visita").reset(); 
            loadActivities().catch(()=>{});
        } catch(err) { 
            showToast("Erro ao agendar.", "error"); 
        } finally { 
            btn.disabled = false; 
            btn.textContent = "Atribuir Visita"; 
        }
    });
}

async function applyRequestedFilters() {
    try {
        const r = selectedDateRange();
        if (!state.loadedRange || state.loadedRange.startValue !== r.startValue || state.loadedRange.endValue !== r.endValue) {
            await loadActivities();
        } else {
            applyFilters({ resetPage: true });
        }
    } catch (e) { 
        showToast(errorMessage(e), "error"); 
    }
}

function clearFilters() {
    const today = new Date(); 
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    
    $("filtro-data-inicial").value = dateInputValue(firstDay); 
    $("filtro-data-final").value = dateInputValue(today);
    $("filtro-profissional").value = ""; 
    $("filtro-status").value = ""; 
    $("filtro-tipo").value = ""; 
    $("filtro-cliente").value = "";
    
    state.currentPage = 1; 
    loadActivities().catch(() => {});
}

// === INICIADOR (Start) ===
bindEvents();

onAuthStateChanged(auth, user => {
    if (!user) { 
        ++state.sessionVersion; 
        state.user = null; 
        resetStateForSession(); 
        showLogin(); 
        setSyncStatus("", "Aguardando login"); 
        return; 
    }
    handleAuthenticatedUser(user).catch(e => { showToast(errorMessage(e), "error"); });
});

async function handleAuthenticatedUser(user) {
    const v = ++state.sessionVersion; 
    resetStateForSession(); 
    state.user = user; 
    showDashboard();
    
    setLoading(true, "Validando acesso..."); 
    setSyncStatus("loading", "Validando acesso...");
    
    try {
        const access = await resolveUserAccess(user); 
        if (v !== state.sessionVersion) return;
        
        state.profile = access.profile; 
        state.canSeeAll = access.canSeeAll;
        
        $("dashboard-user-name").textContent = state.profile.name; 
        $("dashboard-user-role").textContent = state.canSeeAll ? "Visão de gestão" : "Visão individual";
        
        await loadReferenceData(v); 
        if (v !== state.sessionVersion) return;
        
        await loadActivities();
        
        clearInterval(state.autoRefreshTimer); 
        state.autoRefreshTimer = setInterval(() => { 
            if (!document.hidden && state.user && !state.loading) {
                loadActivities({ silent: true }).catch(()=>{}); 
            }
        }, DASHBOARD_CONFIG.autoRefreshMs);
        
    } catch (e) { 
        showToast(errorMessage(e), "error"); 
        try { await signOut(auth); } catch(ex){} 
    } finally { 
        if (v === state.sessionVersion) setLoading(false); 
        if ($("dashboard-btn-entrar")) {
            $("dashboard-btn-entrar").disabled = false; 
            $("dashboard-btn-entrar").textContent = "Entrar"; 
        }
    }
}
