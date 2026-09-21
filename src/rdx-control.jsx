import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Play, Square, Plus, X, ChevronRight, Wallet, AlertTriangle, Check,
  Clock, BarChart3, Layers, TrendingUp, RotateCcw, Download, Upload,
  Target, ListChecks, PieChart, FileText, Settings as SettingsIcon,
  ChevronDown, ChevronUp, Flag, Repeat, AlertCircle, Package, Briefcase, Calendar, Users
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

/* ============================================================
   RDX CONTROL â€” V2
   Objetivos â†’ Etapas â†’ Atividades  |  Capital-Tempo em horas
   Tempo: Gerenciar / Executar / Analisar
   Financeiro: Fixo / VariÃ¡vel / AnÃ¡lise
   HistÃ³rico: memorando + precisÃ£o executiva
   ============================================================ */

const UNIT_DEFS = [
  { id: "rdx", name: "RDX", full: "RDX â€” NÃºcleo Central", color: "#C9A24B" },
  { id: "kofen", name: "KOFEN", full: "Kofen â€” Operacional", color: "#7B9BC0" },
  { id: "holding", name: "HOLDING", full: "Matiazi Holding", color: "#5B8C6E" },
];

const PRIORITIES = {
  alta: { label: "Alta", color: "#C9544B" },
  media: { label: "MÃ©dia", color: "#C9A24B" },
  baixa: { label: "Baixa", color: "#5B8C6E" },
};

const FIN_VARIABLE_DEST = {
  rdx: { label: "RDX", color: "#C9A24B" },
  kofen: { label: "Kofen", color: "#7B9BC0" },
  holding: { label: "Holding", color: "#5B8C6E" },
};

const FIN_CATEGORIES = {
  entrada_aporte: { label: "Aporte", group: "Entrada", sign: 1 },
  entrada_retro: { label: "Retro", group: "Entrada", sign: 1 },
  saida_holding: { label: "Matiazi Holding", group: "SaÃ­da", sign: -1 },
  saida_kofen: { label: "Kofen", group: "SaÃ­da", sign: -1 },
  cof: { label: "Custo Operacional do Fundador (COF)", group: "Custo", sign: -1 },
};

const COF_SUBCATS = ["Moradia", "AlimentaÃ§Ã£o", "Hotelaria", "Vestimenta", "Transporte", "Despesas pessoais"];

const PERIODS = [
  { id: "total", label: "Total", ms: null },
  { id: "10y", label: "10a", ms: 10 * 365 * 86400000 },
  { id: "5y", label: "5a", ms: 5 * 365 * 86400000 },
  { id: "2y", label: "2a", ms: 2 * 365 * 86400000 },
  { id: "1y", label: "1a", ms: 365 * 86400000 },
  { id: "6m", label: "6m", ms: 182 * 86400000 },
  { id: "3m", label: "3m", ms: 91 * 86400000 },
  { id: "1m", label: "1m", ms: 30 * 86400000 },
  { id: "15d", label: "15d", ms: 15 * 86400000 },
  { id: "7d", label: "7d", ms: 7 * 86400000 },
  { id: "today", label: "Hoje", ms: null },
];

/* ---------- curva de metas: Valuation / Equity ---------- */
const GOAL_BASE_YEAR = 2026;
const GOAL_BASE_VALUE = 700;
const GOAL_GROWTH_FACTOR = 2.511886;
const GOAL_FINAL_YEAR = 2046; // ano em que a meta de R$70bi Ã© alcanÃ§ada
const USEFUL_HOURS_PER_YEAR = 365 * 12; // 4.380h

function goalForYear(year) {
  const n = year - GOAL_BASE_YEAR;
  return GOAL_BASE_VALUE * Math.pow(GOAL_GROWTH_FACTOR, n);
}
function currentGoalYear() { return new Date().getFullYear(); }
function currentAnnualGoal() { return goalForYear(currentGoalYear()); }
function currentHourValue() { return currentAnnualGoal() / USEFUL_HOURS_PER_YEAR; }
function nextGoalProjection() { return goalForYear(currentGoalYear() + 1); }

/* ---------- meta ideal mensal: curva composta dentro do ano, terminando na meta anual em dezembro ---------- */
const GOAL_MONTHLY_FACTOR = Math.pow(GOAL_GROWTH_FACTOR, 1 / 12);
function idealEquityForMonth(year, monthIndex /* 0=jan..11=dez */) {
  const prevYearGoal = goalForYear(year - 1);
  return prevYearGoal * Math.pow(GOAL_MONTHLY_FACTOR, monthIndex + 1);
}

/* ---------- Kofen valuation multiplier: 1x no mÃªs de inÃ­cio, +1x por mÃªs civil ---------- */
const KOFEN_MULTIPLIER_BASE = new Date(2026, 5, 1); // junho/2026 = mÃªs 1
function kofenMultiplier() {
  const now = new Date();
  const months = (now.getFullYear() - KOFEN_MULTIPLIER_BASE.getFullYear()) * 12 + (now.getMonth() - KOFEN_MULTIPLIER_BASE.getMonth());
  return Math.max(1, months + 1);
}

function computeRdxEquity(finEntries, varCosts, fixedCosts) {
  let entrada = 0, saidaHolding = 0, saidaKofen = 0;
  finEntries.forEach(e => {
    if (e.category === "entrada_aporte" || e.category === "entrada_retro") entrada += e.amount;
    if (e.category === "saida_holding") saidaHolding += e.amount;
    if (e.category === "saida_kofen") saidaKofen += e.amount;
  });
  const varTotal = varCosts.reduce((s, c) => s + c.amount, 0);
  const fixedActive = fixedCosts.filter(c => c.active).reduce((s, c) => s + c.amount, 0);
  return entrada - saidaHolding - saidaKofen - varTotal - fixedActive;
}

/* Same as computeRdxEquity, but only counting entries dated on/before cutoffTs.
   Used to reconstruct a historical monthly series from real transaction dates.
   Fixed costs have no per-occurrence date stored today, so they're treated as
   active-from-creation (createdAt) for this reconstruction. */
function computeRdxEquityUntil(finEntries, varCosts, fixedCosts, cutoffTs) {
  let entrada = 0, saidaHolding = 0, saidaKofen = 0;
  finEntries.forEach(e => {
    const ts = e.scheduledAt || e.createdAt;
    if (ts > cutoffTs) return;
    if (e.category === "entrada_aporte" || e.category === "entrada_retro") entrada += e.amount;
    if (e.category === "saida_holding") saidaHolding += e.amount;
    if (e.category === "saida_kofen") saidaKofen += e.amount;
  });
  const varTotal = varCosts.reduce((s, c) => {
    const ts = c.scheduledAt || c.createdAt;
    return ts <= cutoffTs ? s + c.amount : s;
  }, 0);
  const fixedActive = fixedCosts.reduce((s, c) => {
    if (!c.active) return s;
    return c.createdAt <= cutoffTs ? s + c.amount : s;
  }, 0);
  return entrada - saidaHolding - saidaKofen - varTotal - fixedActive;
}

/* Material assets always count at the conservative used-market price */
function computeAssetsValue(assets) {
  return (assets || []).reduce((s, a) => s + (a.usedPrice || 0), 0);
}
function computeAssetsValueUntil(assets, cutoffTs) {
  return (assets || []).reduce((s, a) => (a.createdAt <= cutoffTs ? s + (a.usedPrice || 0) : s), 0);
}
function assetGainLoss(asset) {
  if (asset.condition === "novo") return { label: "Economia na compra", value: asset.newPrice - asset.paidPrice };
  return { label: "Ganho/perda na compra", value: asset.usedPrice - asset.paidPrice };
}
function assetResaleLoss(asset) {
  return asset.paidPrice - asset.usedPrice; // positivo = perda estimada na revenda
}

function computeGoalProgress(goal, steps) {
  // 10% identificado + 10% plano criado + 80% execuÃ§Ã£o (proporcional Ã s etapas concluÃ­das)
  let pct = 0;
  if (goal.progressoIdentificado) pct += 10;
  if (goal.progressoPlano) pct += 10;
  const goalSteps = steps.filter(s => s.goalId === goal.id);
  if (goalSteps.length > 0) {
    const concluded = goalSteps.filter(s => s.status === "concluida").length;
    pct += Math.round((concluded / goalSteps.length) * 80);
  }
  return Math.min(100, pct);
}

function progressColor(pct) {
  if (pct >= 80) return "#5B8C6E";
  if (pct >= 40) return "#C9A24B";
  return "#C9544B";
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function dayKey(ts) { const d = new Date(ts); return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`; }
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
function addDays(ts, n) { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); }

/* ---------- scheduling: fixed cost due day / paid-month tracking ---------- */
function currentMonthKey(d = new Date()) { return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`; }
function fixedCostDueDate(dueDay, ref = new Date()) {
  const lastDay = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  const day = Math.min(dueDay, lastDay);
  return new Date(ref.getFullYear(), ref.getMonth(), day).getTime();
}
function daysUntil(ts) {
  return Math.ceil((startOfDay(ts) - startOfDay(Date.now())) / 86400000);
}
function dueLabel(ts) {
  const d = daysUntil(ts);
  if (d === 0) return { text: "Vence hoje", late: false };
  if (d > 0) return { text: `Vence em ${d} dia${d > 1 ? "s" : ""}`, late: false };
  return { text: `Atrasado hÃ¡ ${Math.abs(d)} dia${Math.abs(d) > 1 ? "s" : ""}`, late: true };
}

/* ---------- schedule proximity: cor + texto para a lista de agendamentos ---------- */
function scheduleProximity(scheduledAt) {
  if (!scheduledAt) return { level: "none", color: "#E8E6E1", label: "Sem data" };
  const diffMs = scheduledAt - Date.now();
  if (diffMs < 0) return { level: "late", color: "#C9544B", label: "Atrasado" };
  if (diffMs <= 86400000) return { level: "soon", color: "#C9A24B", label: "PrÃ³ximo (24h)" };
  return { level: "far", color: "#7B9BC0", label: "Distante" };
}

/* ---------- recurring time investment: weekly schedule occurrences ---------- */
function occurrenceKey(recurringId, dateKey) { return `${recurringId}__${dateKey}`; }
function dateKeyOf(d) { return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`; }

function computePendingOccurrences(recurringTimes, fromTs, toTs) {
  const occurrences = [];
  const active = recurringTimes.filter(r => r.active);
  if (active.length === 0) return occurrences;

  const from = new Date(fromTs);
  from.setHours(0, 0, 0, 0);
  const cursor = new Date(from);
  const end = new Date(toTs);

  while (cursor.getTime() <= end.getTime()) {
    const weekday = cursor.getDay(); // 0=Sun..6=Sat
    active.forEach(r => {
      if (!r.weekdays.includes(weekday)) return;
      const [eh, em] = r.endTime.split(":").map(Number);
      const occurrenceEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), eh, em).getTime();
      if (occurrenceEnd > fromTs && occurrenceEnd <= toTs) {
        const dKey = dateKeyOf(cursor);
        const key = occurrenceKey(r.id, dKey);
        if (!(r.decided || []).includes(key)) {
          const [sh, sm] = r.startTime.split(":").map(Number);
          const occurrenceStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), sh, sm).getTime();
          const hours = Math.max(0, (occurrenceEnd - occurrenceStart) / 3600000);
          occurrences.push({ key, recurringId: r.id, dateKey: dKey, label: r.label, unitId: r.unitId, activityId: r.activityId, start: occurrenceStart, end: occurrenceEnd, hours });
        }
      }
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return occurrences;
}

/* Counts how many times each active recurring time investment will still
   occur between now and the end of the current month (inclusive), for
   projecting its financial impact (Caixa Projetado LÃ­quido). */
function remainingFinancialImpactThisMonth(recurringTimes) {
  const active = (recurringTimes || []).filter(r => r.active && r.financialKind && r.financialValue > 0);
  if (active.length === 0) return 0;

  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  let total = 0;
  while (cursor.getTime() <= monthEnd.getTime()) {
    const weekday = cursor.getDay();
    active.forEach(r => {
      if (!r.weekdays.includes(weekday)) return;
      const [eh, em] = r.endTime.split(":").map(Number);
      const occurrenceEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), eh, em).getTime();
      if (occurrenceEnd <= now.getTime()) return; // already happened today, not "remaining"
      total += r.financialKind === "receita" ? r.financialValue : -r.financialValue;
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return total;
}

function periodStart(periodId) {
  if (periodId === "total") return 0;
  if (periodId === "today") return startOfDay(Date.now());
  const p = PERIODS.find(x => x.id === periodId);
  return Date.now() - p.ms;
}

function fmtH(hours) {
  const sign = hours < 0 ? "-" : "";
  const abs = Math.abs(hours);
  const h = Math.floor(abs);
  const m = Math.round((abs - h) * 60);
  if (m === 60) return `${sign}${h + 1}h00`;
  return `${sign}${h}h${m.toString().padStart(2, "0")}`;
}
function fmtClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
function fmtDate(d) { return new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }); }
function fmtDateTime(d) { return new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); }
function fmtBRL(v) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtBRLPrecise(v) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 4 }); }

/* ---------- storage ---------- */
async function sGet(key, fallback) {
  try { const r = await window.storage.get(key, true); return r ? JSON.parse(r.value) : fallback; }
  catch { return fallback; }
}
async function sSet(key, value) {
  try { await window.storage.set(key, JSON.stringify(value), true); }
  catch (e) { console.error("storage set failed", key, e); }
}

/* ============================================================
   ROOT
   ============================================================ */

export default function RDXControl() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [navMode, setNavMode] = useState("exec"); // "exec" | "comercial"
  const [showSettings, setShowSettings] = useState(false);
  const [showAgendaGlobal, setShowAgendaGlobal] = useState(false);
  const [showStopConfirmGlobal, setShowStopConfirmGlobal] = useState(false);

  const handleStopRequest = () => setShowStopConfirmGlobal(true);
  const [showServices, setShowServices] = useState(false); // mantido para compatibilidade futura

  const [config, setConfig] = useState(null);
  const [goals, setGoals] = useState([]);
  const [steps, setSteps] = useState([]);
  const [activities, setActivities] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [closures, setClosures] = useState([]);
  const [recoveries, setRecoveries] = useState([]);
  const [finEntries, setFinEntries] = useState([]);
  const [fixedCosts, setFixedCosts] = useState([]);
  const [varCosts, setVarCosts] = useState([]);
  const [recurringTimes, setRecurringTimes] = useState([]);
  const [assets, setAssets] = useState([]);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [services, setServices] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [recurringLastCheck, setRecurringLastCheck] = useState(Date.now());
  const [pendingOccurrences, setPendingOccurrences] = useState([]);
  const [showRecurringModal, setShowRecurringModal] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [holdingData, setHoldingData] = useState(null);
  const [kofenData, setKofenData] = useState(null);

  useEffect(() => {
    (async () => {
      const [cfg, g, st, ac, s, a, c, r, f, fc, vc, rt, lc, ast, inv, svc, sch] = await Promise.all([
        sGet("config", null), sGet("goals", []), sGet("steps", []), sGet("activities", []),
        sGet("sessions", []), sGet("active-session", null), sGet("closures", []),
        sGet("recoveries", []), sGet("financial-entries", []), sGet("fixed-costs", []), sGet("variable-costs", []),
        sGet("recurring-times", []), sGet("recurring-last-check", Date.now()), sGet("assets", []), sGet("inventory-items", []), sGet("services", []), sGet("schedules", [])
      ]);
      setConfig(cfg); setGoals(g || []); setSteps(st || []); setActivities(ac || []);
      setSessions(s || []); setActiveSession(a || null); setClosures(c || []);
      setRecoveries(r || []); setFinEntries(f || []); setFixedCosts(fc || []); setVarCosts(vc || []);
      setRecurringTimes(rt || []); setAssets(ast || []); setInventoryItems(inv || []); setServices(svc || []); setSchedules(sch || []);
      setLoading(false);

      /* compute pending occurrences since the last check, ask before debiting */
      const occurrences = computePendingOccurrences(rt || [], lc || Date.now(), Date.now());
      if (occurrences.length > 0) { setPendingOccurrences(occurrences); setShowRecurringModal(true); }
      setRecurringLastCheck(Date.now());
      sSet("recurring-last-check", Date.now());
    })();
  }, []);

  useEffect(() => {
    if (!activeSession) return;
    const i = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(i);
  }, [activeSession]);

  /* ---------- external data: Holding & Kofen apps (shared storage) ---------- */
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const [h, k] = await Promise.all([sGet("holding-data", null), sGet("kofen-data", null)]);
      if (!cancelled) { setHoldingData(h); setKofenData(k); }
    };
    poll();
    const i = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(i); };
  }, []);

  useEffect(() => {
    if (!config || loading) return;
    reconcileClosures();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, loading]);

  function reconcileClosures() {
    const today0 = startOfDay(Date.now());
    const start0 = startOfDay(config.startDate);
    const existingKeys = new Set(closures.map(c => c.date));
    const newClosures = [];
    let cursor = start0;
    while (cursor < today0) {
      const key = dayKey(cursor);
      if (!existingKeys.has(key)) {
        const dayEnd = addDays(cursor, 1);
        const invested = sessions
          .filter(s => s.type !== "recuperacao" && s.endedAt && s.endedAt >= cursor && s.endedAt < dayEnd)
          .reduce((sum, s) => sum + s.actualHours, 0);
        const lost = Math.max(0, config.dailyHours - invested);
        newClosures.push({ date: key, usefulHours: config.dailyHours, investedHours: invested, lostHours: lost });
      }
      cursor = addDays(cursor, 1);
    }
    if (newClosures.length > 0) {
      const next = [...closures, ...newClosures].sort((a, b) => a.date < b.date ? 1 : -1);
      setClosures(next); sSet("closures", next);
    }
  }

  const timeBank = useMemo(() => {
    if (!config) return null;
    const investedTotal = sessions.filter(s => s.endedAt && s.type !== "recuperacao").reduce((sum, s) => sum + s.actualHours, 0);
    const lostTotal = closures.reduce((sum, c) => sum + c.lostHours, 0);
    const recoveredTotal = recoveries.reduce((sum, r) => sum + r.hours, 0);
    const debt = Math.max(0, lostTotal - recoveredTotal);
    let liveElapsedH = 0;
    if (activeSession) liveElapsedH = (nowTick - activeSession.startedAt) / 3600000;
    const available = config.totalHours - investedTotal - liveElapsedH;
    const utilization = config.totalHours > 0 ? (investedTotal / config.totalHours) * 100 : 0;
    return { available, investedTotal, lostTotal, recoveredTotal, debt, liveElapsedH, utilization, totalHours: config.totalHours };
  }, [config, sessions, closures, recoveries, activeSession, nowTick]);

  /* ---------- persistence ----------
     Each persist* accepts either a new array OR an updater function (prev => next),
     exactly like setState's functional form. This avoids stale-closure races when
     multiple add/update calls happen synchronously in the same event (e.g. the
     Master Plan form creating 4 steps + 4 activities in one click). */
  const persistGoals = useCallback((next) => { setGoals(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("goals", v); return v; }); }, []);
  const persistSteps = useCallback((next) => { setStep
