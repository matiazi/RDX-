import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Play, Square, Plus, X, ChevronRight, Wallet, AlertTriangle, Check,
  Clock, BarChart3, Layers, TrendingUp, RotateCcw, Download, Upload,
  Target, ListChecks, PieChart, FileText, Settings as SettingsIcon,
  ChevronDown, ChevronUp, Flag, Repeat, AlertCircle, Package, Briefcase, Calendar, Users
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

/* ============================================================
   RDX CONTROL — V2
   Objetivos → Etapas → Atividades  |  Capital-Tempo em horas
   Tempo: Gerenciar / Executar / Analisar
   Financeiro: Fixo / Variável / Análise
   Histórico: memorando + precisão executiva
   ============================================================ */

const UNIT_DEFS = [
  { id: "rdx", name: "RDX", full: "RDX — Núcleo Central", color: "#C9A24B" },
  { id: "kofen", name: "KOFEN", full: "Kofen — Operacional", color: "#7B9BC0" },
  { id: "holding", name: "HOLDING", full: "Matiazi Holding", color: "#5B8C6E" },
];

const PRIORITIES = {
  alta: { label: "Alta", color: "#C9544B" },
  media: { label: "Média", color: "#C9A24B" },
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
  saida_holding: { label: "Matiazi Holding", group: "Saída", sign: -1 },
  saida_kofen: { label: "Kofen", group: "Saída", sign: -1 },
  cof: { label: "Custo Operacional do Fundador (COF)", group: "Custo", sign: -1 },
};

const COF_SUBCATS = ["Moradia", "Alimentação", "Hotelaria", "Vestimenta", "Transporte", "Despesas pessoais"];

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
const GOAL_FINAL_YEAR = 2046; // ano em que a meta de R$70bi é alcançada
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

/* ---------- Kofen valuation multiplier: 1x no mês de início, +1x por mês civil ---------- */
const KOFEN_MULTIPLIER_BASE = new Date(2026, 5, 1); // junho/2026 = mês 1
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
  // 10% identificado + 10% plano criado + 80% execução (proporcional às etapas concluídas)
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
  return { text: `Atrasado há ${Math.abs(d)} dia${Math.abs(d) > 1 ? "s" : ""}`, late: true };
}

/* ---------- schedule proximity: cor + texto para a lista de agendamentos ---------- */
function scheduleProximity(scheduledAt) {
  if (!scheduledAt) return { level: "none", color: "#E8E6E1", label: "Sem data" };
  const diffMs = scheduledAt - Date.now();
  if (diffMs < 0) return { level: "late", color: "#C9544B", label: "Atrasado" };
  if (diffMs <= 86400000) return { level: "soon", color: "#C9A24B", label: "Próximo (24h)" };
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
   projecting its financial impact (Caixa Projetado Líquido). */
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
  const persistSteps = useCallback((next) => { setSteps(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("steps", v); return v; }); }, []);
  const persistActivities = useCallback((next) => { setActivities(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("activities", v); return v; }); }, []);
  const persistSessions = useCallback((next) => { setSessions(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("sessions", v); return v; }); }, []);
  const persistActive = useCallback((next) => { setActiveSession(next); sSet("active-session", next); }, []);
  const persistRecoveries = useCallback((next) => { setRecoveries(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("recoveries", v); return v; }); }, []);
  const persistFin = useCallback((next) => { setFinEntries(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("financial-entries", v); return v; }); }, []);
  const persistFixed = useCallback((next) => { setFixedCosts(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("fixed-costs", v); return v; }); }, []);
  const persistVar = useCallback((next) => { setVarCosts(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("variable-costs", v); return v; }); }, []);
  const persistRecurringTimes = useCallback((next) => { setRecurringTimes(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("recurring-times", v); return v; }); }, []);
  const persistAssets = useCallback((next) => { setAssets(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("assets", v); return v; }); }, []);
  const persistInventory = useCallback((next) => { setInventoryItems(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("inventory-items", v); return v; }); }, []);
  const persistServices = useCallback((next) => { setServices(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("services", v); return v; }); }, []);
  const persistSchedules = useCallback((next) => { setSchedules(prev => { const v = typeof next === "function" ? next(prev) : next; sSet("schedules", v); return v; }); }, []);

  const completeSetup = (cfg) => { setConfig(cfg); sSet("config", cfg); };

  /* ---------- goals / steps / activities ---------- */
  const addGoal = (goal) => {
    const newGoal = {
      id: uid(), createdAt: Date.now(), status: "ativo",
      origem: "manual",           // "manual" | "alerta"
      alertId: null,
      indicador: null,            // { nome, atual, ideal, diff }
      subIndicadores: [],         // [{ nome, atual, ideal, diff, impacto, selecionado, prioridade }]
      alocacao: null,             // { status, tempoAlocado, capitalAlocado, agendaBlocos, recursos }
      progressoIdentificado: goal.origem === "alerta", // alertas já partem com 10%
      progressoPlano: false,
      auditoria: [{ ts: Date.now(), evento: "criado", detalhe: goal.origem || "manual" }],
      ...goal,
    };
    persistGoals(prev => [newGoal, ...prev]);
    return newGoal;
  };
  const updateGoal = (id, patch) => persistGoals(prev => prev.map(g => g.id === id ? {
    ...g, ...patch,
    auditoria: [...(g.auditoria || []), { ts: Date.now(), evento: "atualizado", detalhe: Object.keys(patch).join(", ") }],
  } : g));
  const deleteGoal = (id) => {
    persistGoals(prev => prev.filter(g => g.id !== id));
    persistSteps(prev => prev.filter(s => s.goalId !== id));
    persistActivities(prev => prev.filter(a => a.goalId !== id));
  };
  const addStep = (step) => {
    const newStep = { id: uid(), createdAt: Date.now(), ...step };
    persistSteps(prev => [...prev, newStep]);
    return newStep;
  };
  const updateStep = (id, patch) => persistSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const deleteStep = (id) => { persistSteps(prev => prev.filter(s => s.id !== id)); persistActivities(prev => prev.filter(a => a.stepId !== id)); };
  const addActivity = (activity) => {
    const { cost, costDestination, ...rest } = activity;
    const newActivity = { id: uid(), createdAt: Date.now(), status: "pendente", ...rest };
    persistActivities(prev => [newActivity, ...prev]);
    const amount = typeof cost === "number" && !isNaN(cost) ? cost : 0;
    persistVar(prev => [{
      id: uid(), createdAt: Date.now(), activityId: newActivity.id,
      destination: costDestination || rest.unitId || UNIT_DEFS[0].id,
      amount, note: `Custo de execução · ${newActivity.title}`,
    }, ...prev]);
    return newActivity;
  };
  const updateActivity = (id, patch) => persistActivities(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  const deleteActivity = (id) => { persistActivities(prev => prev.filter(a => a.id !== id)); persistVar(prev => prev.filter(c => c.activityId !== id)); };

  /* ---------- sessions ---------- */
  const startSession = (unitId, activityId, label, plannedHours, serviceId) => {
    if (activeSession) return;
    persistActive({ id: uid(), unitId, activityId: activityId || null, serviceId: serviceId || null, label: label || "", plannedHours: plannedHours || null, startedAt: Date.now(), type: "investimento" });
  };
  const stopSession = (outcome) => {
    if (!activeSession) return;
    const endedAt = Date.now();
    const actualHours = Math.round(((endedAt - activeSession.startedAt) / 3600000) * 1000) / 1000;
    const record = { ...activeSession, endedAt, actualHours };
    persistSessions(prev => [record, ...prev]);
    persistActive(null);
    if (activeSession.activityId && outcome) {
      updateActivity(activeSession.activityId, { status: outcome === "exito" ? "concluída_êxito" : "concluída_falha" });
    }
  };
  const discardSession = () => persistActive(null);
  const addRecovery = (hours, note) => persistRecoveries(prev => [{ id: uid(), hours, note, createdAt: Date.now() }, ...prev]);

  /* ---------- recurring time investment ---------- */
  const addRecurringTime = (r) => {
    const newRecurring = { id: uid(), createdAt: Date.now(), active: true, decided: [], ...r };
    persistRecurringTimes(prev => [newRecurring, ...prev]);
    return newRecurring;
  };
  const updateRecurringTime = (id, patch) => persistRecurringTimes(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  const deleteRecurringTime = (id) => persistRecurringTimes(prev => prev.filter(r => r.id !== id));

  const markOccurrenceDecided = (occ) => {
    persistRecurringTimes(prev => prev.map(r => r.id === occ.recurringId ? { ...r, decided: [...(r.decided || []), occ.key] } : r));
    setPendingOccurrences(prev => prev.filter(o => o.key !== occ.key));
  };
  const confirmOccurrence = (occ) => {
    const record = {
      id: uid(), unitId: occ.unitId, activityId: occ.activityId || null, label: occ.label,
      plannedHours: occ.hours, startedAt: occ.start, endedAt: occ.end, actualHours: occ.hours,
      type: "investimento", recurringId: occ.recurringId,
    };
    persistSessions(prev => [record, ...prev]);
    markOccurrenceDecided(occ);
  };
  const cancelOccurrence = (occ) => markOccurrenceDecided(occ);

  /* ---------- material assets (patrimônio) ---------- */
  const addAsset = (a) => persistAssets(prev => [{ id: uid(), createdAt: Date.now(), ...a }, ...prev]);
  const updateAsset = (id, patch) => persistAssets(prev => prev.map(a => a.id === id ? { ...a, ...patch } : a));
  const deleteAsset = (id) => persistAssets(prev => prev.filter(a => a.id !== id));

  /* ---------- inventory (Insumo / Produto) ---------- */
  const addInventoryItem = (item) => persistInventory(prev => [{ id: uid(), createdAt: Date.now(), ...item }, ...prev]);
  const updateInventoryItem = (id, patch) => persistInventory(prev => prev.map(i => i.id === id ? { ...i, ...patch } : i));
  const deleteInventoryItem = (id) => persistInventory(prev => prev.filter(i => i.id !== id));
  const sellInventoryItem = (id, qty) => {
    const item = inventoryItems.find(i => i.id === id);
    if (!item || qty <= 0) return;
    const soldQty = Math.min(qty, item.quantity);
    persistInventory(prev => prev.map(i => i.id === id ? { ...i, quantity: i.quantity - soldQty } : i));
    addFinEntry({
      category: "entrada_retro", amount: soldQty * (item.salePrice || 0),
      note: `Venda · ${soldQty}x ${item.name}`, scheduledAt: Date.now(), status: "pago",
    });
  };

  /* ---------- services (catálogo de serviços prestados) ---------- */
  const addService = (s) => persistServices(prev => [{ id: uid(), createdAt: Date.now(), ...s }, ...prev]);
  const updateService = (id, patch) => persistServices(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const deleteService = (id) => persistServices(prev => prev.filter(s => s.id !== id));
  const launchServiceRevenue = (id, amount) => {
    const service = services.find(s => s.id === id);
    if (!service || amount <= 0) return;
    addFinEntry({
      category: "entrada_retro", amount,
      note: `Serviço · ${service.name}`, scheduledAt: Date.now(), status: "pago",
    });
  };

  /* ---------- schedules (agenda: serviço / venda / atividade) ---------- */
  const addSchedule = (s) => persistSchedules(prev => [{ id: uid(), createdAt: Date.now(), done: false, ...s }, ...prev]);
  const updateSchedule = (id, patch) => persistSchedules(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const deleteSchedule = (id) => persistSchedules(prev => prev.filter(s => s.id !== id));

  /* ---------- finance ---------- */
  const addFinEntry = (entry) => persistFin(prev => [{ id: uid(), createdAt: Date.now(), ...entry }, ...prev]);
  const updateFinEntry = (id, patch) => persistFin(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  const deleteFinEntry = (id) => persistFin(prev => prev.filter(e => e.id !== id));
  const addFixedCost = (c) => persistFixed(prev => [{ id: uid(), createdAt: Date.now(), active: true, ...c }, ...prev]);
  const updateFixedCost = (id, patch) => persistFixed(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  const deleteFixedCost = (id) => persistFixed(prev => prev.filter(c => c.id !== id));
  const addVarCost = (c) => persistVar(prev => [{ id: uid(), createdAt: Date.now(), ...c }, ...prev]);
  const updateVarCost = (id, patch) => persistVar(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c));
  const deleteVarCost = (id) => persistVar(prev => prev.filter(c => c.id !== id));

  /* ---------- backup ---------- */
  const exportBackup = () => {
    const data = { config, goals, steps, activities, sessions, closures, recoveries, finEntries, fixedCosts, varCosts, exportedAt: Date.now(), version: 2 };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `rdx-backup-${dayKey(Date.now())}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const importBackup = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.config) { setConfig(data.config); sSet("config", data.config); }
        if (data.goals) persistGoals(data.goals);
        if (data.steps) persistSteps(data.steps);
        if (data.activities) persistActivities(data.activities);
        if (data.sessions) persistSessions(data.sessions);
        if (data.closures) { setClosures(data.closures); sSet("closures", data.closures); }
        if (data.recoveries) persistRecoveries(data.recoveries);
        if (data.finEntries) persistFin(data.finEntries);
        if (data.fixedCosts) persistFixed(data.fixedCosts);
        if (data.varCosts) persistVar(data.varCosts);
      } catch { alert("Arquivo de backup inválido."); }
    };
    reader.readAsText(file);
  };

  const resetAll = async () => {
    const keys = ["config", "goals", "steps", "activities", "sessions", "active-session", "closures", "recoveries", "financial-entries", "fixed-costs", "variable-costs", "recurring-times", "recurring-last-check", "assets", "inventory-items", "services", "schedules"];
    await Promise.all(keys.map(k => window.storage.delete(k, true).catch(() => {})));
    setConfig(null); setGoals([]); setSteps([]); setActivities([]); setSessions([]);
    setActiveSession(null); setClosures([]); setRecoveries([]); setFinEntries([]);
    setFixedCosts([]); setVarCosts([]); setRecurringTimes([]); setAssets([]); setInventoryItems([]); setServices([]); setSchedules([]);
  };

  if (loading) return <Shell center><BootScreen /><style>{styles}</style></Shell>;
  if (!config) return <Shell center><SetupScreen onComplete={completeSetup} /><style>{styles}</style></Shell>;

  return (
    <Shell>
      <TopBar timeBank={timeBank} activeSession={activeSession} onStop={handleStopRequest} onDiscard={discardSession} onOpenSettings={() => setShowSettings(true)} onOpenAgenda={() => setShowAgendaGlobal(true)} />
      <main className="main">
        {tab === "dashboard" && (
          <DashboardModule
            timeBank={timeBank} activities={activities} sessions={sessions} varCosts={varCosts}
            holdingData={holdingData} kofenData={kofenData} finEntries={finEntries} fixedCosts={fixedCosts} assets={assets}
            pendingOccurrences={pendingOccurrences} onOpenRecurring={() => setShowRecurringModal(true)}
          />
        )}
        {tab === "masterplan" && (
          <MasterPlanModule activities={activities} goals={goals} steps={steps} timeBank={timeBank} config={config} finEntries={finEntries} varCosts={varCosts} fixedCosts={fixedCosts} assets={assets} schedules={schedules}
            onAddGoal={addGoal} onUpdateGoal={updateGoal} onAddStep={addStep} onUpdateStep={updateStep} onAddActivity={addActivity} onUpdateActivity={updateActivity} onAddVarCost={addVarCost}
            onNavigateCapital={() => setTab("cashbox")}
          />
        )}
        {tab === "goals" && (
          <GoalsModule goals={goals} steps={steps} activities={activities} services={services} schedules={schedules} assets={assets}
            onAddGoal={addGoal} onDeleteGoal={deleteGoal} onAddStep={addStep} onDeleteStep={deleteStep}
            onAddActivity={addActivity} onUpdateActivity={updateActivity} onDeleteActivity={deleteActivity}
            onAddSchedule={addSchedule} onUpdateSchedule={updateSchedule} onDeleteSchedule={deleteSchedule}
            sessions={sessions} activeSession={activeSession} timeBank={timeBank} nowTick={nowTick}
            onStart={startSession} onStop={handleStopRequest} onDiscard={discardSession} onLaunchRevenue={launchServiceRevenue}
            onAddFinEntry={addFinEntry} onAddVarCost={addVarCost} />
        )}
        {tab === "cashbox" && (
          <CapitalModule
            entries={finEntries} fixedCosts={fixedCosts} varCosts={varCosts} activities={activities} goals={goals} steps={steps} timeBank={timeBank} assets={assets} schedules={schedules} config={config}
            onAdd={addFinEntry} onUpdate={updateFinEntry} onDelete={deleteFinEntry}
            onAddFixed={addFixedCost} onUpdateFixed={updateFixedCost} onDeleteFixed={deleteFixedCost}
            onAddVar={addVarCost} onUpdateVar={updateVarCost} onDeleteVar={deleteVarCost}
            sessions={sessions} activeSession={activeSession} nowTick={nowTick} closures={closures} recoveries={recoveries}
            onUpdateActivity={updateActivity} onAddRecovery={addRecovery}
            recurringTimes={recurringTimes} onAddRecurring={addRecurringTime} onUpdateRecurring={updateRecurringTime} onDeleteRecurring={deleteRecurringTime}
            onUpdateGoal={updateGoal} onUpdateStep={updateStep} onAddSchedule={addSchedule}
          />
        )}
        {tab === "history" && (
          <HistoryModule activities={activities} goals={goals} sessions={sessions} varCosts={varCosts} finEntries={finEntries} fixedCosts={fixedCosts} assets={assets} timeBank={timeBank} />
        )}
        {tab === "com-clientes" && <ComercialClientesModule />}
        {tab === "com-servicos" && <ComercialServicosModule services={services} activities={activities} sessions={sessions} onAdd={addService} onUpdate={updateService} onDelete={deleteService} onLaunchRevenue={launchServiceRevenue} />}
        {tab === "com-produtos" && <ComercialProdutosModule assets={assets} inventoryItems={inventoryItems} onAddAsset={addAsset} onUpdateAsset={updateAsset} onDeleteAsset={deleteAsset} onAddInventory={addInventoryItem} onUpdateInventory={updateInventoryItem} onDeleteInventory={deleteInventoryItem} onSellInventory={sellInventoryItem} />}
        {tab === "com-empresas" && <ComercialEmpresasModule />}
      </main>
      <BottomNav tab={tab} setTab={setTab} hasActive={!!activeSession} hasDebt={timeBank.debt > 0} navMode={navMode} onSwitchMode={setNavMode} />
      {showSettings && (
        <Modal onClose={() => setShowSettings(false)} title="Sistema">
          <SettingsModule config={config} onExport={exportBackup} onImport={importBackup} onReset={resetAll} />
        </Modal>
      )}
      {showStopConfirmGlobal && activeSession && (
        <StopConfirmModal
          session={activeSession}
          elapsedSec={Math.floor((Date.now() - activeSession.startedAt) / 1000)}
          schedules={schedules}
          onClose={() => setShowStopConfirmGlobal(false)}
          onEncerrar={() => {
            setShowStopConfirmGlobal(false);
            if (activeSession?.activityId) {
              // precisa do OutcomeModal — mantém no GoalsModule
              stopSession(null);
            } else {
              stopSession(null);
            }
          }}
          onReagendar={(scheduledAt) => {
            setShowStopConfirmGlobal(false);
            if (scheduledAt) {
              addSchedule({
                kind: activeSession?.serviceId ? "servico" : activeSession?.activityId ? "atividade" : "livre",
                label: activeSession?.label || "Sessão reagendada",
                activityId: activeSession?.activityId || null,
                serviceId: activeSession?.serviceId || null,
                scheduledAt,
                duration: activeSession?.plannedHours || 1,
              });
            }
            discardSession();
          }}
        />
      )}
      {showAgendaGlobal && (
        <AgendaModal
          schedules={schedules} onClose={() => setShowAgendaGlobal(false)}
          onAddSchedule={addSchedule} onDeleteSchedule={deleteSchedule}
          onStartSchedule={(s) => { setShowAgendaGlobal(false); }}
          activities={activities} services={services} assets={assets}
          onAddFinEntry={addFinEntry} onAddVarCost={addVarCost}
        />
      )}
      {showRecurringModal && pendingOccurrences.length > 0 && (
        <RecurringOccurrencesModal
          occurrences={pendingOccurrences} activities={activities}
          onConfirm={confirmOccurrence} onCancel={cancelOccurrence}
          onClose={() => setShowRecurringModal(false)}
        />
      )}
      <style>{styles}</style>
    </Shell>
  );
}

function Shell({ children, center }) { return <div className={`shell ${center ? "shell-center" : ""}`}>{children}</div>; }
function BootScreen() { return <div className="boot"><div className="boot-mark">RDX</div><div className="boot-bar"><div className="boot-bar-fill" /></div></div>; }

/* ============================================================
   SETUP
   ============================================================ */

function SetupScreen({ onComplete }) {
  const [startDate, setStartDate] = useState("2026-07-01");
  const [horizonYears, setHorizonYears] = useState("20");
  const [dailyHours, setDailyHours] = useState("12");
  const totalHours = useMemo(() => Math.round((parseFloat(horizonYears) || 0) * 365 * (parseFloat(dailyHours) || 0)), [horizonYears, dailyHours]);

  return (
    <div className="setup">
      <div className="setup-eyebrow">CONFIGURAÇÃO INICIAL · CAPITAL-TEMPO</div>
      <h1 className="setup-title">Defina seu banco<br />de horas futuras</h1>
      <p className="setup-sub">O Capital-Tempo conta apenas horas futuras disponíveis, a partir de hoje.</p>
      <label className="field-label">Data de início</label>
      <input type="date" className="field-input" value={startDate} onChange={e => setStartDate(e.target.value)} />
      <label className="field-label">Horizonte (anos)</label>
      <input type="number" className="field-input" value={horizonYears} onChange={e => setHorizonYears(e.target.value)} />
      <label className="field-label">Horas úteis por dia</label>
      <input type="number" className="field-input" value={dailyHours} onChange={e => setDailyHours(e.target.value)} />
      <div className="setup-preview">
        <div className="setup-preview-label">Banco inicial calculado</div>
        <div className="setup-preview-value">{totalHours.toLocaleString("pt-BR")}<span className="setup-preview-unit">horas</span></div>
        <div className="setup-preview-sub">{horizonYears} anos × 365 dias × {dailyHours}h úteis/dia</div>
      </div>
      <button className="btn-primary setup-btn" onClick={() => onComplete({ startDate: new Date(startDate).getTime(), horizonYears: parseFloat(horizonYears), dailyHours: parseFloat(dailyHours), totalHours })}>
        Iniciar RDX <ChevronRight size={18} />
      </button>
    </div>
  );
}

/* ============================================================
   TOP BAR
   ============================================================ */

function TopBar({ timeBank, activeSession, onStop, onDiscard, onOpenSettings, onOpenAgenda }) {
  const [, setT] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (!activeSession) return; const i = setInterval(() => setT(t => t + 1), 1000); return () => clearInterval(i); }, [activeSession]);
  useEffect(() => { if (!activeSession) setExpanded(false); }, [activeSession]);
  const elapsedSec = activeSession ? Math.floor((Date.now() - activeSession.startedAt) / 1000) : 0;
  const activeUnit = activeSession ? UNIT_DEFS.find(u => u.id === activeSession.unitId) : null;
  const plannedSec = activeSession?.plannedHours ? activeSession.plannedHours * 3600 : null;
  const overPlanned = plannedSec && elapsedSec > plannedSec;
  const progressPct = plannedSec ? Math.min(100, (elapsedSec / plannedSec) * 100) : null;

  return (
    <header className="topbar-wrap">
      <div className="topbar">
        <div className="topbar-brand"><span className="topbar-mark">RDX</span><span className="topbar-sub">CONTROL</span></div>
        <div className="topbar-balance">
          <span className="topbar-balance-label">DISPONÍVEL</span>
          <span className={`topbar-balance-value ${timeBank.available < 0 ? "neg" : ""}`}>{fmtH(timeBank.available)}</span>
        </div>
        {activeSession && activeUnit ? (
          <button className="topbar-live" style={{ "--u-color": activeUnit.color }} onClick={() => setExpanded(e => !e)}>
            <span className="topbar-live-dot" />
            <span className="topbar-live-unit">{activeUnit.name}{activeSession.label ? ` · ${activeSession.label}` : ""}</span>
            <span className="topbar-live-clock">{fmtClock(elapsedSec)}</span>
            {progressPct !== null && <span className={`topbar-live-pct ${overPlanned ? "over" : ""}`}>{progressPct.toFixed(0)}%</span>}
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : null}
        <div className="topbar-icon-group">
          <button className="topbar-settings-btn" onClick={onOpenAgenda} aria-label="Agenda"><Calendar size={18} /></button>
          <button className="topbar-settings-btn" onClick={onOpenSettings} aria-label="Sistema"><SettingsIcon size={18} /></button>
        </div>
      </div>

      {/* Barra de progresso fina */}
      {activeSession && plannedSec && (
        <div className="topbar-progress-track">
          <div className={`topbar-progress-fill ${overPlanned ? "over" : ""}`} style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {/* Painel expandido */}
      {activeSession && activeUnit && expanded && (
        <div className="topbar-session-panel" style={{ "--u-color": activeUnit.color }}>
          <div className="topbar-session-header">
            <span className="active-session-dot" style={{ width: 10, height: 10 }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-dim)" }}>{activeUnit.full}</span>
          </div>
          <div className="active-session-label" style={{ padding: "4px 0" }}>{activeSession.label}</div>
          <div className="active-session-clock">{fmtClock(elapsedSec)}</div>
          {plannedSec && (
            <div className={`active-session-planned ${overPlanned ? "over" : ""}`}>
              {overPlanned
                ? <><AlertTriangle size={13} /> Estourou o planejado de {fmtH(activeSession.plannedHours)}</>
                : <>Planejado: {fmtH(activeSession.plannedHours)}</>}
            </div>
          )}
          <div className="active-session-actions" style={{ marginTop: 12 }}>
            <button className="btn-stop" onClick={() => { setExpanded(false); onStop(); }}>
              <Square size={16} fill="currentColor" /> Encerrar sessão
            </button>
            <button className="btn-ghost-danger" onClick={() => { setExpanded(false); onDiscard(); }}>Descartar</button>
          </div>
        </div>
      )}
    </header>
  );
}

/* ============================================================
   BOTTOM NAV
   ============================================================ */

function BottomNav({ tab, setTab, hasActive, hasDebt, navMode, onSwitchMode }) {
  const [animating, setAnimating] = useState(false);
  const [exitMode, setExitMode] = useState(null);

  const execItems = [
    { id: "dashboard", label: "Dashboard", icon: PieChart },
    { id: "masterplan", label: "Plano Diretor", icon: Flag },
    { id: "cashbox", label: "Capital", icon: Wallet },
    { id: "goals", label: "Execução", icon: Target },
    { id: "comercial-switch", label: "Comercial", icon: BarChart3 },
  ];
  const comercialItems = [
    { id: "com-clientes", label: "Clientes", icon: Users },
    { id: "com-servicos", label: "Serviços", icon: Briefcase },
    { id: "com-produtos", label: "Produtos", icon: Package },
    { id: "com-empresas", label: "Empresas", icon: Layers },
    { id: "exec-switch", label: "Executivo", icon: Target },
  ];

  const items = navMode === "exec" ? execItems : comercialItems;

  const handleSwitch = () => {
    if (animating) return;
    setExitMode(navMode);
    setAnimating(true);
    setTimeout(() => {
      onSwitchMode(navMode === "exec" ? "comercial" : "exec");
      setAnimating(false);
      setExitMode(null);
    }, 380);
  };

  const handleItem = (id) => {
    if (id === "comercial-switch" || id === "exec-switch") { handleSwitch(); return; }
    setTab(id);
  };

  return (
    <div className="bottomnav-wrap">
      <nav className={`bottomnav ${animating ? "cube-exit" : ""}`}>
        {items.map(it => {
          const Icon = it.icon;
          const isSwitch = it.id === "comercial-switch" || it.id === "exec-switch";
          const active = !isSwitch && tab === it.id;
          return (
            <button key={it.id} className={`bottomnav-item ${active ? "is-active" : ""} ${isSwitch ? "is-switch" : ""}`} onClick={() => handleItem(it.id)}>
              <span className="bottomnav-icon-wrap">
                <Icon size={18} strokeWidth={active ? 2.25 : 1.75} />
                {it.id === "goals" && hasActive && <span className="bottomnav-pulse" />}
                {it.id === "cashbox" && hasDebt && !hasActive && <span className="bottomnav-pulse red" />}
              </span>
              <span className="bottomnav-label">{it.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/* ============================================================
   SHARED: PERIOD TABS
   ============================================================ */

function PeriodTabs({ value, onChange }) {
  return (
    <div className="period-tabs">
      {PERIODS.map(p => (
        <button key={p.id} className={`period-tab ${value === p.id ? "is-active" : ""}`} onClick={() => onChange(p.id)}>{p.label}</button>
      ))}
    </div>
  );
}

/* ============================================================
   GOALS MODULE (Objetivos → Etapas → Atividades)
   ============================================================ */

/* ============================================================
   DASHBOARD MODULE — mapa mental RDX / Holding / Kofen / Tempo
   ============================================================ */

function DashboardModule({ timeBank, activities, sessions, varCosts, holdingData, kofenData, finEntries, fixedCosts, assets, pendingOccurrences, onOpenRecurring }) {
  const [openCard, setOpenCard] = useState(null);
  const [cardLevel, setCardLevel] = useState({});
  const [showCharts, setShowCharts] = useState(false);
  const [metaView, setMetaView] = useState("mes");

  const kMultiplier = kofenMultiplier();
  const kofenValuation = kofenData ? kofenData.equity * kMultiplier : null;
  const holdingLeftover = holdingData ? holdingData.monthlyIncome - holdingData.utilized : null;

  const hourValue = currentHourValue();
  const valuation = timeBank.investedTotal * hourValue;
  const rdxEquity = computeRdxEquity(finEntries, varCosts, fixedCosts);
  const assetsValue = computeAssetsValue(assets);
  const fullEquity = rdxEquity + assetsValue;

  const goalYear = currentGoalYear();
  const annualGoal = currentAnnualGoal();
  const goalRemaining = Math.max(0, annualGoal - fullEquity);
  const goalPct = annualGoal > 0 ? Math.min(100, (fullEquity / annualGoal) * 100) : 0;

  // Projeção de atingimento — ritmo mensal atual
  const monthsElapsed = new Date().getMonth() + 1;
  const monthlyRate = monthsElapsed > 0 ? fullEquity / monthsElapsed : 0;
  const projectedYearEnd = monthlyRate * 12;
  const projectionPct = annualGoal > 0 ? Math.min(999, (projectedYearEnd / annualGoal) * 100) : 0;
  const projectionStatus = projectionPct >= 100 ? "green" : projectionPct >= 60 ? "amber" : "red";

  const monthGoal = idealEquityForMonth(goalYear, new Date().getMonth());
  const cashMin = monthGoal * 0.10;
  const cashIdeal = monthGoal * 0.15;
  const cashMax = monthGoal * 0.20;
  const marginRange = cashMax - cashMin;
  const marginPct = marginRange > 0 ? ((rdxEquity - cashMin) / marginRange) * 100 : 0;
  const cashStatus = rdxEquity < cashMin ? "abaixo" : rdxEquity <= cashMax ? "ideal" : "excedente";
  const cashStatusColor = cashStatus === "ideal" ? "#5B8C6E" : cashStatus === "excedente" ? "#C9A24B" : "#C9544B";
  const cashStatusLabel = cashStatus === "ideal" ? "Dentro da faixa ideal" : cashStatus === "excedente" ? "Caixa excedente — dinheiro parado" : "Abaixo do mínimo";

  // Capital temporal
  const consumoMensal = monthsElapsed > 0 ? timeBank.investedTotal / monthsElapsed : 0;
  const mesesRestantes = consumoMensal > 0 ? timeBank.available / consumoMensal : null;

  // Capital executivo
  const done = activities.filter(a => a.status === "concluída_êxito" || a.status === "concluída_falha");
  const success = done.filter(a => a.status === "concluída_êxito").length;
  const precision = done.length > 0 ? (success / done.length) * 100 : null;
  const precisionColor = precision === null ? "#6B6962" : precision >= 70 ? "#5B8C6E" : precision >= 40 ? "#C9A24B" : "#C9544B";
  const totalPlanned = activities.reduce((s, a) => s + (a.plannedHours || 0), 0);
  const efficiency = totalPlanned > 0 ? Math.min(100, (timeBank.investedTotal / totalPlanned) * 100) : 0;

  const recentSessions = [...sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 8);

  const upcomingDues = useMemo(() => {
    const monthKey = currentMonthKey();
    const fixedDues = fixedCosts.filter(c => c.active && !(c.paidMonths || []).includes(monthKey))
      .map(c => ({ id: c.id, label: c.name, amount: c.amount, due: fixedCostDueDate(c.dueDay || 1) }));
    const varDues = varCosts.filter(c => c.status === "pendente" && c.scheduledAt)
      .map(c => ({ id: c.id, label: c.note || FIN_VARIABLE_DEST[c.destination]?.label, amount: c.amount, due: c.scheduledAt }));
    const finDues = finEntries.filter(e => e.status === "pendente" && e.scheduledAt)
      .map(e => ({ id: e.id, label: FIN_CATEGORIES[e.category]?.label, amount: e.amount, due: e.scheduledAt }));
    return [...fixedDues, ...varDues, ...finDues].sort((a, b) => a.due - b.due).slice(0, 6);
  }, [fixedCosts, varCosts, finEntries]);

  const toggleCard = (id) => {
    if (openCard === id) {
      setOpenCard(null);
      setCardLevel(prev => ({ ...prev, [id]: 1 }));
    } else {
      setOpenCard(id);
      setCardLevel(prev => ({ ...prev, [id]: prev[id] || 1 }));
    }
  };
  const advanceLevel = (id, e) => {
    e.stopPropagation();
    setCardLevel(prev => ({ ...prev, [id]: prev[id] >= 2 ? 1 : (prev[id] || 1) + 1 }));
  };

  return (
    <div className="page page-wide" style={{ position: "relative" }}>
      {showCharts && <div className="charts-panel-overlay" onClick={() => setShowCharts(false)} />}
      <div className={`charts-panel ${showCharts ? "is-open" : ""}`}>
        <div className="charts-panel-head">
          <span className="modal-title">Gráficos</span>
          <button className="modal-close" onClick={() => setShowCharts(false)}><X size={18} /></button>
        </div>
        <div className="charts-panel-body">
          <HistoryChartsTab finEntries={finEntries} varCosts={varCosts} fixedCosts={fixedCosts} assets={assets} sessions={sessions} activities={activities} timeBank={timeBank} />
        </div>
      </div>

      <div className="dash-title-row">
        <div>
          <h2 className="page-title">Dashboard</h2>
          <p className="page-sub">Visão consolidada da operação. Toque nos cards para aprofundar.</p>
        </div>
        <button className="btn-charts-open" onClick={() => setShowCharts(true)}>
          <BarChart3 size={16} /> Gráficos <ChevronRight size={14} />
        </button>
      </div>

      {/* ── CARD META — 3 INDICADORES com toggle Mês/Ano ── */}
      {(() => {
        const monthGoalBase = idealEquityForMonth(goalYear, new Date().getMonth());
        const metaBase = metaView === "mes" ? monthGoalBase : annualGoal;
        const metaLabel = metaView === "mes" ? `Mês (${["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"][new Date().getMonth()]})` : `Ano (${goalYear})`;
        const receitaAtual = finEntries.filter(e => FIN_CATEGORIES[e.category]?.sign > 0).reduce((s, e) => s + e.amount, 0);
        const indicators = [
          { label: "FATURAMENTO (RECEITA GERAL)", valor: receitaAtual, meta: metaBase * 10, color: "#5B8C6E" },
          { label: "PATRIMÔNIO", valor: fullEquity, meta: metaBase, color: "#C9A24B" },
          { label: "CAIXA LÍQUIDO IDEAL", valor: rdxEquity, meta: metaBase * 0.15, color: "#7B9BC0" },
        ];
        return (
          <div className="dash-meta panel-elevated" onClick={() => setMetaView(v => v === "mes" ? "ano" : "mes")} style={{ cursor: "pointer" }}>
            <div className="dash-meta-header-row">
              <span className="vx-hero-label">META {goalYear} — EQUITY COMPLETO</span>
              <span className="dash-meta-toggle-badge">{metaLabel} ↕</span>
            </div>
            {indicators.map((ind, i) => {
              const pct = ind.meta > 0 ? Math.min(100, (ind.valor / ind.meta) * 100) : 0;
              return (
                <div key={ind.label}>
                  {i > 0 && <div className="dash-meta-divider" />}
                  <div className="dash-meta-indicator">
                    <div className="dash-meta-ind-head">
                      <span className="dash-meta-ind-label" style={{ color: ind.color }}>{ind.label}</span>
                      <div className="dash-meta-ind-right">
                        <span className="dash-meta-ind-meta">Meta: {fmtBRL(ind.meta)}</span>
                        <span className="dash-meta-ind-pct" style={{ color: ind.color }}>{pct.toFixed(0)}% da meta</span>
                      </div>
                    </div>
                    <span className="dash-meta-ind-value">{fmtBRL(ind.valor)}</span>
                    <div className="dash-meta-bar-track">
                      <div className="dash-meta-bar-fill" style={{ width: `${pct}%`, background: ind.color, transition: "width 0.4s" }} />
                    </div>
                    <div className="dash-meta-ind-foot">
                      <span>{pct.toFixed(0)}% alcançado</span>
                      <span>Faltam {fmtBRL(Math.max(0, ind.meta - ind.valor))}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── ALERTAS ── */}
      {upcomingDues.length > 0 && (
        <div className="dues-panel panel-elevated">
          <span className="section-label">Próximos vencimentos</span>
          <div className="ledger">
            {upcomingDues.map(d => {
              const label = dueLabel(d.due);
              return (
                <div className="ledger-row" key={d.id}>
                  <div className="ledger-row-text">
                    <span className="ledger-row-title">{d.label}</span>
                    <span className={`ledger-row-date ${label.late ? "is-late" : ""}`}>{label.text}</span>
                  </div>
                  <span className="ledger-row-amount neg">-{fmtBRL(d.amount)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {pendingOccurrences && pendingOccurrences.length > 0 && (
        <button className="dues-panel panel-elevated recurring-pending-btn" onClick={onOpenRecurring}>
          <AlertCircle size={18} />
          <div className="recurring-pending-text">
            <span className="ledger-row-title">{pendingOccurrences.length} tempo{pendingOccurrences.length > 1 ? "s" : ""} recorrente{pendingOccurrences.length > 1 ? "s" : ""} aguardando confirmação</span>
            <span className="ledger-row-date">Toque para confirmar ou cancelar cada ocorrência</span>
          </div>
        </button>
      )}

      {/* ── CARDS ESTRATÉGICOS ── */}
      <span className="section-label">Capitais</span>
      <div className="dash-cards-grid">

        {/* A. CAPITAL FINANCEIRO */}
        <DashCard3
          id="fin" open={openCard === "fin"} level={cardLevel["fin"] || 1}
          onToggle={() => toggleCard("fin")} onAdvance={(e) => advanceLevel("fin", e)}
          color={cashStatusColor} label="CAPITAL FINANCEIRO"
          mainValue={fmtBRL(rdxEquity)} mainSub={cashStatusLabel}
          badge={cashStatus === "ideal" ? "✓ Ideal" : cashStatus === "excedente" ? "↑ Excedente" : "↓ Baixo"}
          badgeColor={cashStatusColor}
        >
          {/* Nível 1 */}
          <div className="metric-grid two-col">
            <MetricCard label="Caixa atual" value={fmtBRL(rdxEquity)} color={cashStatusColor} />
            <MetricCard label="Patrimônio material" value={fmtBRL(assetsValue)} color="#C9A24B" />
          </div>
          {/* Nível 2 */}
          {(cardLevel["fin"] || 1) >= 2 && (
            <>
              <div className="metric-grid two-col">
                <MetricCard label="Caixa mínimo (10%)" value={fmtBRL(cashMin)} color="#C9544B" />
                <MetricCard label="Caixa ideal (15%)" value={fmtBRL(cashIdeal)} color="#5B8C6E" />
                <MetricCard label="Caixa máximo (20%)" value={fmtBRL(cashMax)} color="#C9A24B" />
                <MetricCard label="Desvio do ideal" value={fmtBRL(rdxEquity - cashIdeal)} color={rdxEquity >= cashIdeal ? "#5B8C6E" : "#C9544B"} />
              </div>
              <div className="dash-faixa-bar">
                <div className="dash-faixa-fill" style={{ width: `${Math.max(0, Math.min(100, (rdxEquity / cashMax) * 100))}%`, background: cashStatusColor }} />
                <div className="dash-faixa-mark dash-faixa-min" style={{ left: "50%" }} />
                <div className="dash-faixa-mark dash-faixa-ideal" style={{ left: "75%" }} />
              </div>
              <span className="vx-hero-sub">Faixa operacional: mín 10% · ideal 15% · máx 20% do equity mensal ideal</span>
              <span className="section-label" style={{ marginTop: 14 }}>Lançamentos recentes</span>
              <div className="ledger">
                {finEntries.slice(0, 5).map(e => {
                  const cat = FIN_CATEGORIES[e.category];
                  return (
                    <div className="ledger-row" key={e.id}>
                      <div className="ledger-row-text">
                        <span className="ledger-row-title">{cat?.label}{e.note ? ` · ${e.note}` : ""}</span>
                        <span className="ledger-row-date">{fmtDate(e.scheduledAt || e.createdAt)}</span>
                      </div>
                      <span className={`ledger-row-amount ${cat?.sign > 0 ? "pos" : "neg"}`}>{cat?.sign > 0 ? "+" : "-"}{fmtBRL(e.amount)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </DashCard3>

        {/* B. CAPITAL TEMPORAL */}
        <DashCard3
          id="time" open={openCard === "time"} level={cardLevel["time"] || 1}
          onToggle={() => toggleCard("time")} onAdvance={(e) => advanceLevel("time", e)}
          color="#7B9BC0" label="CAPITAL TEMPORAL"
          mainValue={fmtH(timeBank.available)} mainSub="Horas disponíveis restantes"
          badge={timeBank.debt > 0 ? `Dívida ${fmtH(timeBank.debt)}` : "Em dia"}
          badgeColor={timeBank.debt > 0 ? "#C9544B" : "#5B8C6E"}
        >
          <div className="metric-grid two-col">
            <MetricCard label="Horas disponíveis" value={fmtH(timeBank.available)} color="#7B9BC0" />
            <MetricCard label="Horas investidas" value={fmtH(timeBank.investedTotal)} color="#C9A24B" />
          </div>
          {(cardLevel["time"] || 1) >= 2 && (
            <>
              <div className="metric-grid two-col">
                <MetricCard label="Ritmo mensal" value={`${fmtH(consumoMensal)}/mês`} color="#7B9BC0" />
                <MetricCard label="Projeção restante" value={mesesRestantes ? `~${mesesRestantes.toFixed(0)} meses` : "—"} color="#5B8C6E" />
                <MetricCard label="Dívida de tempo" value={fmtH(timeBank.debt)} color="#C9544B" emphasize={timeBank.debt > 0} />
                <MetricCard label="Recuperado" value={fmtH(timeBank.recoveredTotal)} color="#5B8C6E" />
              </div>
              <span className="section-label" style={{ marginTop: 14 }}>Sessões recentes</span>
              {recentSessions.length === 0 ? <EmptyHint text="Nenhuma sessão registrada." /> : (
                <div className="ledger">
                  {recentSessions.map(s => {
                    const u = UNIT_DEFS.find(x => x.id === s.unitId);
                    const act = activities.find(a => a.id === s.activityId);
                    return (
                      <div className="ledger-row" key={s.id}>
                        <div className="ledger-row-main">
                          <span className="ledger-dot" style={{ background: u?.color }} />
                          <div className="ledger-row-text">
                            <span className="ledger-row-title">{act ? act.title : (u?.name || "Sessão livre")}</span>
                            <span className="ledger-row-date">{fmtDateTime(s.startedAt)}</span>
                          </div>
                        </div>
                        <span className="ledger-row-amount neg">-{fmtH(s.actualHours)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </DashCard3>

        {/* C. CAPITAL EXECUTIVO */}
        <DashCard3
          id="exec" open={openCard === "exec"} level={cardLevel["exec"] || 1}
          onToggle={() => toggleCard("exec")} onAdvance={(e) => advanceLevel("exec", e)}
          color={precisionColor} label="CAPITAL EXECUTIVO"
          mainValue={precision === null ? "—" : `${precision.toFixed(0)}%`} mainSub="Precisão executiva"
          badge={precision === null ? "Sem dados" : precision >= 70 ? "Alta precisão" : precision >= 40 ? "Atenção" : "Crítico"}
          badgeColor={precisionColor}
        >
          <div className="metric-grid two-col">
            <MetricCard label="Precisão executiva" value={precision === null ? "—" : `${precision.toFixed(0)}%`} color={precisionColor} />
            <MetricCard label="Eficiência temporal" value={`${efficiency.toFixed(0)}%`} color="#7B9BC0" />
          </div>
          {(cardLevel["exec"] || 1) >= 2 && (
            <>
              <div className="metric-grid two-col">
                <MetricCard label="Horas planejadas" value={fmtH(totalPlanned)} color="#7B9BC0" />
                <MetricCard label="Horas executadas" value={fmtH(timeBank.investedTotal)} color="#C9A24B" />
                <MetricCard label="Entregas realizadas" value={done.length} color="#5B8C6E" />
                <MetricCard label="Êxitos" value={success} color={precisionColor} />
              </div>
              <span className="section-label" style={{ marginTop: 14 }}>Atividades recentes</span>
              {done.length === 0 ? <EmptyHint text="Nenhuma atividade concluída ainda." /> : (
                <div className="ledger">
                  {done.slice(0, 5).map(a => (
                    <div className="ledger-row" key={a.id}>
                      <div className="ledger-row-text">
                        <span className="ledger-row-title">{a.title}</span>
                        <span className="ledger-row-date">{UNIT_DEFS.find(u => u.id === a.unitId)?.name}</span>
                      </div>
                      <span className={`ledger-row-amount ${a.status === "concluída_êxito" ? "pos" : "neg"}`}>
                        {a.status === "concluída_êxito" ? "Êxito" : "Falha"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </DashCard3>

        {/* D. COMERCIAL */}
        <DashCard3
          id="com" open={openCard === "com"} level={cardLevel["com"] || 1}
          onToggle={() => toggleCard("com")} onAdvance={(e) => advanceLevel("com", e)}
          color="#C9A24B" label="COMERCIAL"
          mainValue="—" mainSub="Receita projetada"
          badge="Em construção" badgeColor="#6B6962"
        >
          <div className="metric-grid two-col">
            <MetricCard label="Leads ativos" value="—" color="#7B9BC0" />
            <MetricCard label="Negociações" value="—" color="#C9A24B" />
            <MetricCard label="Clientes ativos" value="—" color="#5B8C6E" />
            <MetricCard label="Receita projetada" value="—" color="#C9544B" />
          </div>
          {(cardLevel["com"] || 1) >= 2 && (
            <div className="metric-grid two-col">
              <MetricCard label="Propostas" value="—" color="#7B9BC0" />
              <MetricCard label="Contratos" value="—" color="#5B8C6E" />
              <MetricCard label="Conversão" value="—" color="#C9A24B" />
              <MetricCard label="Receita recorrente" value="—" color="#C9544B" />
            </div>
          )}
        </DashCard3>

        {/* E. CASA MATIAZI */}
        <DashCard3
          id="holding" open={openCard === "holding"} level={cardLevel["holding"] || 1}
          onToggle={() => toggleCard("holding")} onAdvance={(e) => advanceLevel("holding", e)}
          color="#5B8C6E" label="CASA MATIAZI"
          mainValue={holdingData ? fmtBRL(holdingData.invested) : "—"} mainSub="Patrimônio consolidado"
          badge={holdingData ? "Conectado" : "Aguardando dados"} badgeColor={holdingData ? "#5B8C6E" : "#6B6962"}
        >
          {!holdingData ? (
            <EmptyHint text="Alimentado pelo app da Holding (storage: holding-data)." />
          ) : (
            <div className="metric-grid two-col">
              <MetricCard label="Patrimônio investido" value={fmtBRL(holdingData.invested)} color="#5B8C6E" />
              <MetricCard label="Rendimento mensal" value={fmtBRL(holdingData.monthlyIncome)} color="#C9A24B" />
            </div>
          )}
          {(cardLevel["holding"] || 1) >= 2 && holdingData && (
            <>
              <div className="metric-grid two-col">
                <MetricCard label="Gasto do rendimento" value={fmtBRL(holdingData.utilized)} color="#C9544B" />
                <MetricCard label="Sobra do rendimento" value={fmtBRL(holdingLeftover)} color={holdingLeftover < 0 ? "#C9544B" : "#7B9BC0"} emphasize />
              </div>
              <span className="section-label" style={{ marginTop: 14 }}>Custos vinculados</span>
              <CostHistoryList costs={varCosts.filter(c => c.destination === "holding")} activities={activities} />
            </>
          )}
        </DashCard3>

        {/* F. KOFEN */}
        <DashCard3
          id="kofen" open={openCard === "kofen"} level={cardLevel["kofen"] || 1}
          onToggle={() => toggleCard("kofen")} onAdvance={(e) => advanceLevel("kofen", e)}
          color="#C9544B" label="KOFEN"
          mainValue={kofenValuation !== null ? fmtBRL(kofenValuation) : "—"} mainSub={`Valuation · ${kMultiplier}x`}
          badge={kofenData ? "Conectado" : "Aguardando dados"} badgeColor={kofenData ? "#C9544B" : "#6B6962"}
        >
          {!kofenData ? (
            <EmptyHint text="Alimentado pelo app da Kofen (storage: kofen-data)." />
          ) : (
            <div className="metric-grid two-col">
              <MetricCard label="Equity" value={fmtBRL(kofenData.equity)} color="#C9544B" />
              <MetricCard label="Caixa" value={fmtBRL(kofenData.balance)} color="#5B8C6E" />
            </div>
          )}
          {(cardLevel["kofen"] || 1) >= 2 && kofenData && (
            <>
              <div className="metric-grid two-col">
                <MetricCard label="Multiplicador" value={`${kMultiplier}x`} color="#C9A24B" />
                <MetricCard label="Valuation" value={fmtBRL(kofenValuation)} color="#7B9BC0" emphasize />
                <MetricCard label="Receita" value={fmtBRL(kofenData.income)} color="#5B8C6E" />
                <MetricCard label="Despesa" value={fmtBRL(kofenData.expense)} color="#C9544B" />
              </div>
              <span className="section-label" style={{ marginTop: 14 }}>Custos vinculados</span>
              <CostHistoryList costs={varCosts.filter(c => c.destination === "kofen")} activities={activities} />
            </>
          )}
        </DashCard3>

      </div>
    </div>
  );
}

/* Card com 3 níveis: fechado → nível 1 → nível 2 */
function DashCard3({ id, open, level, onToggle, onAdvance, color, label, mainValue, mainSub, badge, badgeColor, children }) {
  return (
    <div className="dashcard3 panel-elevated" style={{ "--u-color": color }}>
      <button className="dashcard-head" onClick={onToggle}>
        <div className="dashcard-head-text">
          <span className="dashcard-label">{label}</span>
          <span className="dashcard-main-value">{mainValue}</span>
          <span className="dashcard-main-sub">{mainSub}</span>
        </div>
        <div className="dashcard3-right">
          {badge && <span className="dashcard3-badge" style={{ "--badge-color": badgeColor }}>{badge}</span>}
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>
      {open && (
        <div className="dashcard-body">
          {children}
          <button className="dashcard3-level-btn" onClick={onAdvance}>
            {level >= 2 ? "Ver menos detalhes" : "Ver mais detalhes"} <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

function CostHistoryList({ costs, activities }) {
  if (costs.length === 0) return <EmptyHint text="Nenhum custo variável vinculado ainda." />;
  return (
    <div className="ledger">
      {costs.slice(0, 10).map(c => {
        const act = activities.find(a => a.id === c.activityId);
        return (
          <div className="ledger-row" key={c.id}>
            <div className="ledger-row-text"><span className="ledger-row-title">{c.note || (act ? act.title : FIN_VARIABLE_DEST[c.destination]?.label)}</span><span className="ledger-row-date">{fmtDate(c.createdAt)}</span></div>
            <span className="ledger-row-amount neg">-{fmtBRL(c.amount)}</span>
          </div>
        );
      })}
    </div>
  );
}


function GoalsModule({
  goals, steps, activities, services, schedules, assets, onAddGoal, onDeleteGoal, onAddStep, onDeleteStep, onAddActivity, onUpdateActivity, onDeleteActivity,
  onAddSchedule, onUpdateSchedule, onDeleteSchedule,
  sessions, activeSession, timeBank, nowTick, onStart, onStop, onDiscard, onLaunchRevenue,
  onAddFinEntry, onAddVarCost,
}) {
  const [showAgenda, setShowAgenda] = useState(false);
  const [showStart, setShowStart] = useState(false);
  const [showOutcome, setShowOutcome] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showAddSchedule, setShowAddSchedule] = useState(null);
  const [startFrom, setStartFrom] = useState(null);
  const [finishedServiceSession, setFinishedServiceSession] = useState(null);
  const [showTypeSelector, setShowTypeSelector] = useState(false);

  const activeUnit = activeSession ? UNIT_DEFS.find(u => u.id === activeSession.unitId) : null;
  const elapsedSec = activeSession ? Math.floor((nowTick - activeSession.startedAt) / 1000) : 0;
  const plannedSec = activeSession?.plannedHours ? activeSession.plannedHours * 3600 : null;
  const overPlanned = plannedSec && elapsedSec > plannedSec;
  const progressPct = plannedSec ? Math.min(100, (elapsedSec / plannedSec) * 100) : null;

  const finishActiveSession = (outcome) => {
    if (activeSession?.serviceId) {
      const service = services.find(s => s.id === activeSession.serviceId);
      const actualHours = (Date.now() - activeSession.startedAt) / 3600000;
      setFinishedServiceSession({ service, actualHours });
    }
    onStop(outcome);
  };

  // Sempre mostra confirmação antes de encerrar
  const handleStop = () => setShowStopConfirm(true);

  const handleConfirmStop = () => {
    setShowStopConfirm(false);
    if (activeSession?.activityId) setShowOutcome(true);
    else finishActiveSession(null);
  };

  const handleReagendarStop = (scheduledAt) => {
    setShowStopConfirm(false);
    // Criar agendamento com a nova data e descartar sessão atual
    if (scheduledAt) {
      onAddSchedule({
        kind: activeSession?.serviceId ? "servico" : activeSession?.activityId ? "atividade" : "livre",
        label: activeSession?.label || "Sessão reagendada",
        activityId: activeSession?.activityId || null,
        serviceId: activeSession?.serviceId || null,
        scheduledAt,
        duration: activeSession?.plannedHours || 1,
      });
    }
    onDiscard();
  };

  // Agendamentos do dia atual — mais próximo ao fundo (ordem ascendente, mas renderizado de trás pra frente)
  const todayTs = new Date(); todayTs.setHours(0,0,0,0);
  const tomorrowTs = new Date(todayTs); tomorrowTs.setDate(tomorrowTs.getDate() + 1);
  const todaySchedules = schedules
    .filter(s => !s.done && s.scheduledAt >= todayTs.getTime() && s.scheduledAt < tomorrowTs.getTime())
    .sort((a, b) => b.scheduledAt - a.scheduledAt);

  // TODOS os próximos — sem limite, mais distante no topo, mais próximo embaixo
  const upcomingSchedules = schedules
    .filter(s => !s.done && s.scheduledAt >= tomorrowTs.getTime())
    .sort((a, b) => b.scheduledAt - a.scheduledAt);

  // Objetivos com progresso para atalhos no topo
  const goalsAtivos = [...goals]
    .filter(g => g.status !== "concluido")
    .sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity));

  const execTypes = [
    { id: "servico", label: "Serviço", icon: Briefcase, color: "#7B9BC0" },
    { id: "venda", label: "Venda", icon: Wallet, color: "#5B8C6E" },
    { id: "atividade", label: "Atividade", icon: Flag, color: "#C9A24B" },
    { id: "livre", label: "Livre", icon: Play, color: "#C9544B" },
  ];

  return (
    <div className="page exec-page-new">
      {/* ── HEADER ── */}
      <div className="exec-header">
        <h2 className="page-title" style={{ margin: 0 }}>Execução</h2>
      </div>

      {/* ── CONTEÚDO PRINCIPAL ── */}
      <div className="exec-body">

      {/* ── OBJETIVOS ATIVOS — fixados, sem scroll ── */}
      {goalsAtivos.length > 0 && (
        <div className="exec-goals-fixed">
          <span className="section-label">Objetivos ativos</span>
          <ExecGoalsAtalho
            goals={goalsAtivos} steps={steps} schedules={schedules}
            onStartSchedule={(s) => { setStartFrom(s); setShowStart(true); }}
          />
        </div>
      )}

      {/* ── AGENDAMENTOS — scroll próprio ── */}
      <div className="exec-schedules-scroll">

        {/* ── PRÓXIMOS ── */}
        {upcomingSchedules.length > 0 && (
          <div className="exec-section">
            <span className="section-label">Próximos agendamentos</span>
            <div className="exec-schedule-list">
              {upcomingSchedules.map(s => {
                const prox = scheduleProximity(s.scheduledAt);
                return (
                  <button className="exec-schedule-item exec-schedule-item-dim" key={s.id}
                    style={{ "--prox-color": prox.color }}
                    onClick={() => { setStartFrom(s); setShowStart(true); }}>
                    <span className="exec-schedule-time">{fmtDate(s.scheduledAt)}</span>
                    <span className="exec-schedule-label">{SCHEDULE_KIND_LABELS[s.kind]} · {s.label}</span>
                    {s.duration > 0 && <span className="exec-schedule-dur">{fmtH(s.duration)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── HOJE ── */}
        <div className="exec-section">
          <span className="section-label">Hoje</span>
          {todaySchedules.length === 0 ? (
            <div className="exec-empty">
              <span className="exec-empty-text">Nenhuma execução programada para hoje.</span>
            </div>
          ) : (
            <div className="exec-schedule-list">
              {todaySchedules.map(s => {
                const prox = scheduleProximity(s.scheduledAt);
                const hora = new Date(s.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                return (
                  <button className="exec-schedule-item" key={s.id}
                    style={{ "--prox-color": prox.color }}
                    onClick={() => { setStartFrom(s); setShowStart(true); }}>
                    <span className="exec-schedule-time">{hora}</span>
                    <span className="exec-schedule-label">{SCHEDULE_KIND_LABELS[s.kind]} · {s.label}</span>
                    {s.duration > 0 && <span className="exec-schedule-dur">{fmtH(s.duration)}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

      </div>{/* fim exec-schedules-scroll */}

      </div>{/* fim exec-body */}

      {/* ── FOOTER FIXO — EXECUTAR ── */}
      <div className="exec-footer-fixed">
        {!activeSession && (
          <>
            {showTypeSelector && (
              <div className="exec-type-grid">
                {execTypes.map(t => (
                  <button
                    key={t.id}
                    className="exec-type-btn"
                    style={{ "--t-color": t.color }}
                    onClick={() => {
                      setShowTypeSelector(false);
                      if (t.id === "livre") { setStartFrom(null); setShowStart(true); }
                      else if (t.id === "servico" || t.id === "venda" || t.id === "atividade") {
                        setShowAddSchedule(t.id);
                      }
                    }}
                  >
                    {(() => { const Icon = t.icon; return <Icon size={20} />; })()}
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
            )}
            <button
              className={`btn-execute-yellow ${showTypeSelector ? "btn-execute-cancel" : ""}`}
              onClick={() => setShowTypeSelector(prev => !prev)}
            >
              {showTypeSelector ? "Cancelar" : "Executar"}
            </button>
          </>
        )}
      </div>

      {/* ── MODAIS ── */}
      {showAgenda && (
        <AgendaModal
          schedules={schedules} onClose={() => setShowAgenda(false)}
          onAddSchedule={onAddSchedule} onDeleteSchedule={onDeleteSchedule}
          onStartSchedule={(s) => { setStartFrom(s); setShowStart(true); setShowAgenda(false); }}
          activities={activities} services={services} assets={assets}
          onAddFinEntry={onAddFinEntry} onAddVarCost={onAddVarCost}
        />
      )}
      {showAddSchedule && (
        <AddScheduleModal
          initialKind={showAddSchedule} activities={activities} services={services} assets={assets}
          onClose={() => setShowAddSchedule(null)}
          onAdd={(s) => { onAddSchedule(s); setShowAddSchedule(null); }}
          onAddFinEntry={onAddFinEntry} onAddVarCost={onAddVarCost}
        />
      )}
      {showStart && (
        <StartSessionModal
          activities={activities.filter(a => a.status === "pendente" || a.status === "em_andamento")}
          services={services} startFrom={startFrom} available={timeBank.available}
          onClose={() => setShowStart(false)}
          onStart={(unitId, activityId, label, planned, serviceId) => {
            onStart(unitId, activityId, label, planned, serviceId);
            if (startFrom) onUpdateSchedule(startFrom.id, { done: true });
            setShowStart(false);
          }}
        />
      )}
      {showStopConfirm && (
        <StopConfirmModal
          session={activeSession}
          elapsedSec={elapsedSec}
          schedules={schedules}
          onEncerrar={handleConfirmStop}
          onReagendar={handleReagendarStop}
          onClose={() => setShowStopConfirm(false)}
        />
      )}
      {showOutcome && (
        <OutcomeModal
          onClose={() => { setShowOutcome(false); finishActiveSession(null); }}
          onChoose={(outcome) => { setShowOutcome(false); finishActiveSession(outcome); }}
        />
      )}
      {finishedServiceSession && (
        <LaunchRevenueModal
          service={finishedServiceSession.service}
          suggestedAmount={finishedServiceSession.actualHours * (finishedServiceSession.service?.hourRate || 0)}
          onClose={() => setFinishedServiceSession(null)}
          onLaunch={(amount) => { onLaunchRevenue(finishedServiceSession.service.id, amount); setFinishedServiceSession(null); }}
        />
      )}
    </div>
  );
}

const SCHEDULE_KIND_LABELS = {
  servico: "Serviço",
  venda: "Venda",
  patrimonio: "Venda de Patrimônio",
  investimento_tempo: "Investimento de Tempo",
  investimento_dinheiro: "Investimento de Dinheiro",
  atividade: "Atividade",
};

/* ============================================================
   AGENDA MODAL — visualização Dia / Semana / Mês / Ano
   ============================================================ */

function AgendaModal({ schedules, onClose, onAddSchedule, onDeleteSchedule, onStartSchedule, activities, services, assets, onAddFinEntry, onAddVarCost }) {
  const [view, setView] = useState("dia"); // "dia" | "semana" | "mes" | "ano"
  const [cursor, setCursor] = useState(() => startOfDay(Date.now()));
  const [showAddSchedule, setShowAddSchedule] = useState(null);

  // Navegar: avança/recua conforme a view ativa
  const navigate = (dir) => {
    setCursor(prev => {
      const d = new Date(prev);
      if (view === "dia") d.setDate(d.getDate() + dir);
      else if (view === "semana") d.setDate(d.getDate() + dir * 7);
      else if (view === "mes") d.setMonth(d.getMonth() + dir);
      else if (view === "ano") d.setFullYear(d.getFullYear() + dir);
      return d.getTime();
    });
  };

  // Calcular ocupação de um dia (0–100%)
  const dayOccupancy = (dayTs) => {
    const dayStart = startOfDay(dayTs);
    const dayEnd = dayStart + 86400000;
    const dayScheds = schedules.filter(s => !s.done && s.scheduledAt >= dayStart && s.scheduledAt < dayEnd);
    const totalHours = dayScheds.reduce((sum, s) => sum + (s.duration || 0), 0);
    const maxHours = 12; // referência: dia de 12h úteis
    return Math.min(100, (totalHours / maxHours) * 100);
  };

  // Cor do copo d'água
  const occupancyColor = (pct) => {
    if (pct <= 30) return "#C9544B"; // vermelho
    if (pct <= 70) return "#C9A24B"; // amarelo
    return "#5B8C6E"; // verde
  };

  // Agendamentos de um dia específico
  const daySchedules = (dayTs) => {
    const dayStart = startOfDay(dayTs);
    const dayEnd = dayStart + 86400000;
    return schedules
      .filter(s => !s.done && s.scheduledAt >= dayStart && s.scheduledAt < dayEnd)
      .sort((a, b) => a.scheduledAt - b.scheduledAt);
  };

  // Título do header conforme view
  const headerTitle = () => {
    const d = new Date(cursor);
    if (view === "dia") return d.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).replace(/^\w/, c => c.toUpperCase());
    if (view === "semana") {
      const weekStart = new Date(cursor);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // segunda
      const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
      return `${weekStart.getDate()} – ${weekEnd.getDate()} de ${weekEnd.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}`;
    }
    if (view === "mes") return d.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^\w/, c => c.toUpperCase());
    return String(d.getFullYear());
  };

  // Dias da semana para view semana (seg–dom)
  const weekDays = () => {
    const d = new Date(cursor);
    const dow = d.getDay(); // 0=dom
    const monday = new Date(d); monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return Array.from({ length: 7 }, (_, i) => { const x = new Date(monday); x.setDate(monday.getDate() + i); return x.getTime(); });
  };

  // Meses do ano para view ano (4×3)
  const yearMonths = () => {
    const year = new Date(cursor).getFullYear();
    return Array.from({ length: 12 }, (_, i) => new Date(year, i, 1).getTime());
  };

  // Dias do mês para view mês
  const monthDays = () => {
    const d = new Date(cursor);
    const year = d.getFullYear(); const month = d.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startDow = (first.getDay() + 6) % 7; // seg=0
    const days = [];
    for (let i = 0; i < startDow; i++) days.push(null);
    for (let i = 1; i <= last.getDate(); i++) days.push(new Date(year, month, i).getTime());
    return days;
  };

  const MONTH_NAMES_SHORT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const WEEKDAY_SHORT = ["Seg","Ter","Qua","Qui","Sex","Sáb","Dom"];
  const todayTs = startOfDay(Date.now());

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="agenda-sheet" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="agenda-head">
          <span className="modal-title">Agenda</span>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        {/* View switcher */}
        <div className="agenda-view-tabs">
          {["dia","semana","mes","ano"].map(v => (
            <button key={v} className={`agenda-view-tab ${view === v ? "is-active" : ""}`} onClick={() => setView(v)}>
              {v === "dia" ? "Dia" : v === "semana" ? "Semana" : v === "mes" ? "Mês" : "Ano"}
            </button>
          ))}
        </div>

        {/* Filtros rápidos */}
        <div className="agenda-quick-filters">
          {[
            { label: "Hoje", fn: () => setCursor(startOfDay(Date.now())) },
            { label: "7d", fn: () => setCursor(startOfDay(Date.now() + 7*86400000)) },
            { label: "15d", fn: () => setCursor(startOfDay(Date.now() + 15*86400000)) },
            { label: "1m", fn: () => { const d = new Date(); d.setMonth(d.getMonth()+1); setCursor(d.getTime()); } },
            { label: "3m", fn: () => { const d = new Date(); d.setMonth(d.getMonth()+3); setCursor(d.getTime()); } },
            { label: "6m", fn: () => { const d = new Date(); d.setMonth(d.getMonth()+6); setCursor(d.getTime()); } },
            { label: "1a", fn: () => { const d = new Date(); d.setFullYear(d.getFullYear()+1); setCursor(d.getTime()); } },
            { label: "2a", fn: () => { const d = new Date(); d.setFullYear(d.getFullYear()+2); setCursor(d.getTime()); } },
          ].map(f => (
            <button key={f.label} className="agenda-qf-btn" onClick={f.fn}>{f.label}</button>
          ))}
        </div>

        {/* Nav */}
        <div className="agenda-nav">
          <button className="agenda-nav-btn" onClick={() => navigate(-1)}>‹</button>
          <span className="agenda-nav-title">{headerTitle()}</span>
          <button className="agenda-nav-btn" onClick={() => navigate(1)}>›</button>
        </div>

        {/* BODY — altura fixa para todas as views */}
        <div className="agenda-body agenda-body-fixed">

          {/* ===== DIA ===== */}
          {view === "dia" && (
            <div className="agenda-day-view">
              <WaterGlassDay pct={dayOccupancy(cursor)} dayNum={new Date(cursor).getDate()} isToday={cursor === todayTs} />
              <span className="section-label">AGENDAMENTOS DO DIA</span>
              {daySchedules(cursor).length === 0
                ? <EmptyHint text="Nada agendado neste dia." />
                : <AgendaDayList items={daySchedules(cursor)} onStart={onStartSchedule} onDelete={onDeleteSchedule} />
              }
            </div>
          )}

          {/* ===== SEMANA ===== */}
          {view === "semana" && (
            <div className="agenda-week-view">
              <div className="agenda-week-header">
                {WEEKDAY_SHORT.map((wd, i) => {
                  const dayTs = weekDays()[i];
                  const isToday = dayTs === todayTs;
                  return (
                    <div key={i} className={`agenda-week-col-head ${isToday ? "is-today" : ""}`}>
                      <span className="agenda-week-wd">{wd}</span>
                      <span className="agenda-week-num">{new Date(dayTs).getDate()}</span>
                    </div>
                  );
                })}
              </div>
              <div className="agenda-week-cols">
                {weekDays().map((dayTs, i) => {
                  const pct = dayOccupancy(dayTs);
                  const color = occupancyColor(pct);
                  const items = daySchedules(dayTs);
                  const isToday = dayTs === todayTs;
                  return (
                    <div key={i} className={`agenda-week-col ${isToday ? "is-today" : ""}`}
                      onClick={() => { setCursor(dayTs); setView("dia"); }}
                    >
                      <div className="agenda-week-glass">
                        <div className="agenda-week-glass-fill" style={{ height: `${pct}%`, background: color }} />
                        <span className="agenda-week-glass-pct">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="agenda-week-items">
                        {items.slice(0, 3).map(s => (
                          <div key={s.id} className="agenda-week-item" style={{ background: occupancyColor(pct) + "22", borderLeft: `2px solid ${occupancyColor(pct)}` }}>
                            <span className="agenda-week-item-label">{s.label}</span>
                            <span className="agenda-week-item-time">{s.scheduledAt ? new Date(s.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}</span>
                          </div>
                        ))}
                        {items.length > 3 && <span className="agenda-week-more">+{items.length - 3}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== MÊS ===== */}
          {view === "mes" && (
            <div className="agenda-month-view">
              <div className="agenda-month-wd-header">
                {WEEKDAY_SHORT.map(w => <span key={w} className="agenda-month-wd">{w}</span>)}
              </div>
              <div className="agenda-month-grid">
                {monthDays().map((dayTs, i) => {
                  if (!dayTs) return <div key={`empty-${i}`} className="agenda-month-cell agenda-month-cell-empty" />;
                  const pct = dayOccupancy(dayTs);
                  const color = occupancyColor(pct);
                  const isToday = dayTs === todayTs;
                  const items = daySchedules(dayTs);
                  return (
                    <div key={dayTs} className={`agenda-month-cell ${isToday ? "is-today" : ""}`}
                      onClick={() => { setCursor(dayTs); setView("dia"); }}
                    >
                      <span className="agenda-month-day-num">{new Date(dayTs).getDate()}</span>
                      {pct > 0 && (
                        <div className="agenda-month-mini-glass">
                          <div style={{ height: `${pct}%`, background: color, borderRadius: "2px" }} />
                        </div>
                      )}
                      {items.length > 0 && <span className="agenda-month-dot" style={{ background: color }} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ===== ANO ===== */}
          {view === "ano" && (
            <div className="agenda-year-view">
              {yearMonths().map((monthTs, i) => {
                const monthName = MONTH_NAMES_SHORT[i];
                // ocupação média do mês
                const daysInMonth = new Date(new Date(monthTs).getFullYear(), i + 1, 0).getDate();
                let totalPct = 0;
                for (let d = 0; d < daysInMonth; d++) {
                  totalPct += dayOccupancy(monthTs + d * 86400000);
                }
                const avgPct = totalPct / daysInMonth;
                const color = occupancyColor(avgPct);
                const isCurrentMonth = new Date(monthTs).getMonth() === new Date().getMonth() && new Date(monthTs).getFullYear() === new Date().getFullYear();
                return (
                  <div key={i} className={`agenda-year-cell ${isCurrentMonth ? "is-today" : ""}`}
                    onClick={() => { setCursor(monthTs); setView("mes"); }}
                  >
                    <span className="agenda-year-month">{monthName}</span>
                    <div className="agenda-year-glass">
                      <div className="agenda-year-glass-fill" style={{ height: `${avgPct}%`, background: color }} />
                    </div>
                    <span className="agenda-year-pct">{avgPct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer: botão adicionar */}
        <div className="agenda-footer">
          <button className="btn-primary full-width" onClick={() => setShowAddSchedule("servico")}>
            <Plus size={16} /> Novo agendamento
          </button>
        </div>

        {showAddSchedule && (
          <AddScheduleModal
            initialKind={showAddSchedule}
            activities={activities} services={services} assets={assets}
            onClose={() => setShowAddSchedule(null)}
            onAdd={(s) => { onAddSchedule(s); setShowAddSchedule(null); }}
            onAddFinEntry={onAddFinEntry}
            onAddVarCost={onAddVarCost}
          />
        )}
      </div>
    </div>
  );
}

function WaterGlassDay({ pct, dayNum, isToday }) {
  const color = pct <= 30 ? "#C9544B" : pct <= 70 ? "#C9A24B" : "#5B8C6E";
  return (
    <div className={`water-glass-day ${isToday ? "is-today" : ""}`}>
      <div className="water-glass-container">
        <div className="water-glass-fill" style={{ height: `${pct}%`, background: color }} />
        <div className="water-glass-content">
          <span className="water-glass-num">{dayNum}</span>
          <span className="water-glass-pct">{pct.toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

function AgendaDayList({ items, onStart, onDelete }) {
  return (
    <div className="ledger">
      {items.map(s => {
        const prox = scheduleProximity(s.scheduledAt);
        const isFinancial = s.kind === "patrimonio" || s.kind === "investimento_dinheiro";
        return (
          <div key={s.id} className="schedule-card" style={{ "--prox-color": prox.color }}
            onClick={!isFinancial ? () => onStart(s) : undefined}
            role={!isFinancial ? "button" : undefined}
          >
            <span className="schedule-card-dot" />
            <div className="schedule-card-text">
              <span className="schedule-card-title">{SCHEDULE_KIND_LABELS[s.kind]} · {s.label}</span>
              <span className="schedule-card-sub">
                {s.scheduledAt ? new Date(s.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}
                {s.duration > 0 ? ` · ${fmtH(s.duration)}` : ""}
                {" · "}{prox.label}
              </span>
              {isFinancial && <span className="schedule-card-badge">Lançado no Caixa · pendente</span>}
            </div>
            <button className="ledger-row-del" onClick={e => { e.stopPropagation(); onDelete(s.id); }}><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   COMMERCIAL MODULE — sistema comercial completo
   ============================================================ */

function CommercialModule() {
  return (
    <div className="settings-body">
      <div className="commercial-coming">
        <Users size={40} color="#C9A24B" />
        <span className="commercial-coming-title">Sistema Comercial</span>
        <span className="commercial-coming-sub">Pipeline de clientes, leads, negociações e fechamentos.</span>
        <div className="metric-grid two-col" style={{ marginTop: 24 }}>
          <MetricCard label="Leads ativos" value="—" color="#7B9BC0" />
          <MetricCard label="Negociações" value="—" color="#C9A24B" />
          <MetricCard label="Clientes ativos" value="—" color="#5B8C6E" />
          <MetricCard label="Receita projetada" value="—" color="#C9544B" />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CAPITAL MODULE — Financeiro / Temporal / Executivo
   ============================================================ */

function CapitalModule({
  entries, fixedCosts, varCosts, activities, goals, steps, timeBank, assets, schedules, config,
  onAdd, onUpdate, onDelete, onAddFixed, onUpdateFixed, onDeleteFixed, onAddVar, onUpdateVar, onDeleteVar,
  sessions, activeSession, nowTick, closures, recoveries, onUpdateActivity, onAddRecovery,
  recurringTimes, onAddRecurring, onUpdateRecurring, onDeleteRecurring,
  onUpdateGoal, onUpdateStep, onAddSchedule,
}) {
  const [capital, setCapital] = useState("financeiro");

  return (
    <div className="page">
      <h2 className="page-title">Capital</h2>
      <p className="page-sub">Três ativos que sustentam a operação: dinheiro, tempo e capacidade executiva.</p>
      <div className="capital-toggle">
        <button className={`capital-toggle-btn ${capital === "financeiro" ? "is-active" : ""}`} onClick={() => setCapital("financeiro")}><Wallet size={15} /> Financeiro</button>
        <button className={`capital-toggle-btn ${capital === "temporal" ? "is-active" : ""}`} onClick={() => setCapital("temporal")}><Clock size={15} /> Temporal</button>
        <button className={`capital-toggle-btn ${capital === "executivo" ? "is-active" : ""}`} onClick={() => setCapital("executivo")}>
          <BarChart3 size={15} /> Executivo
          {goals.filter(g => !g.alocacao || g.alocacao.status === "pendente_alocacao").length > 0 && (
            <span style={{ marginLeft: 4, background: "#C9544B", color: "#fff", borderRadius: "50%", width: 16, height: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700 }}>
              {goals.filter(g => !g.alocacao || g.alocacao.status === "pendente_alocacao").length}
            </span>
          )}
        </button>
      </div>
      {capital === "financeiro" && (
        <FinanceModule entries={entries} fixedCosts={fixedCosts} varCosts={varCosts} activities={activities} timeBank={timeBank} assets={assets} recurringTimes={recurringTimes}
          onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} onAddFixed={onAddFixed} onUpdateFixed={onUpdateFixed} onDeleteFixed={onDeleteFixed}
          onAddVar={onAddVar} onUpdateVar={onUpdateVar} onDeleteVar={onDeleteVar} />
      )}
      {capital === "temporal" && (
        <TimeModule activities={activities} goals={goals} sessions={sessions} activeSession={activeSession} timeBank={timeBank} nowTick={nowTick}
          closures={closures} recoveries={recoveries} onUpdateActivity={onUpdateActivity} onAddRecovery={onAddRecovery}
          recurringTimes={recurringTimes} onAddRecurring={onAddRecurring} onUpdateRecurring={onUpdateRecurring} onDeleteRecurring={onDeleteRecurring} />
      )}
      {capital === "executivo" && (
        <CapitalExecutivoTab activities={activities} sessions={sessions} timeBank={timeBank}
          goals={goals} steps={steps} schedules={schedules} config={config} assets={assets}
          finEntries={entries} varCosts={varCosts} fixedCosts={fixedCosts}
          onUpdateGoal={onUpdateGoal} onUpdateStep={onUpdateStep} onAddSchedule={onAddSchedule} />
      )}
    </div>
  );
}

function CapitalExecutivoTab({ activities, sessions, timeBank, goals, steps, schedules, config, assets, finEntries, varCosts, fixedCosts, onUpdateGoal, onUpdateStep, onAddSchedule }) {
  const [selectedGoalId, setSelectedGoalId] = useState(null);
  const [alocStep, setAlocStep] = useState("recursos");
  const [alocData, setAlocData] = useState({ tempoAlocado: "", capitalAlocado: "", recursos: "", blocosSelecionados: [] });
  const [sugestaoSel, setSugestaoSel] = useState(null);

  const done = activities.filter(a => a.status === "concluída_êxito" || a.status === "concluída_falha");
  const success = done.filter(a => a.status === "concluída_êxito").length;
  const precision = done.length > 0 ? (success / done.length) * 100 : null;
  const precisionColor = precision === null ? "#6B6962" : precision >= 70 ? "#5B8C6E" : precision >= 40 ? "#C9A24B" : "#C9544B";
  const totalPlanned = activities.reduce((s, a) => s + (a.plannedHours || 0), 0);
  const efficiency = totalPlanned > 0 ? Math.min(100, (timeBank.investedTotal / totalPlanned) * 100) : 0;
  const failRate = done.length > 0 ? ((done.length - success) / done.length) * 100 : 0;

  const pendingAlloc = goals
    .filter(g => !g.alocacao || g.alocacao.status === "pendente_alocacao")
    .sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity)); // mais distante no topo, mais próximo embaixo

  const allocatedGoals = goals
    .filter(g => g.alocacao && g.alocacao.status === "alocado")
    .sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity));

  const horariosLivres = useMemo(() => {
    const livres = [];
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const dailyH = config?.dailyHours || 8;
    const inicioUtil = 8;
    const fimUtil = inicioUtil + dailyH;
    for (let d = 1; d <= 14; d++) {
      const dia = new Date(hoje); dia.setDate(dia.getDate() + d);
      const diaTs = dia.getTime();
      const fimDia = diaTs + 86400000;
      const schedulesNoDia = (schedules || []).filter(s => s.scheduledAt >= diaTs && s.scheduledAt < fimDia);
      let horasOcupadas = schedulesNoDia.reduce((s, x) => s + (x.duration || 0), 0);
      let horasLivres = Math.max(0, dailyH - horasOcupadas);
      if (horasLivres < 1) continue;
      const nomeDia = dia.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
      let inicioBloco = inicioUtil;
      schedulesNoDia.sort((a, b) => a.scheduledAt - b.scheduledAt).forEach(s => {
        const hInicio = new Date(s.scheduledAt).getHours();
        const hFim = hInicio + (s.duration || 1);
        if (hInicio > inicioBloco) livres.push({ dia: diaTs, nome: nomeDia, inicio: `${String(inicioBloco).padStart(2,"0")}:00`, fim: `${String(hInicio).padStart(2,"0")}:00`, horas: hInicio - inicioBloco });
        inicioBloco = Math.max(inicioBloco, hFim);
      });
      if (inicioBloco < fimUtil) livres.push({ dia: diaTs, nome: nomeDia, inicio: `${String(inicioBloco).padStart(2,"0")}:00`, fim: `${String(fimUtil).padStart(2,"0")}:00`, horas: fimUtil - inicioBloco });
    }
    return livres.slice(0, 12);
  }, [schedules, config]);

  const gerarSugestoes = (goal) => {
    const totalH = horariosLivres.reduce((s, h) => s + h.horas, 0);
    return [
      { id: "rapida", label: "Rápida", tempo: Math.max(1, Math.round(totalH * 0.25)), blocos: horariosLivres.slice(0, 1), impacto: "Baixo", desc: "Ataque inicial com menor comprometimento" },
      { id: "equilibrada", label: "Equilibrada", tempo: Math.max(2, Math.round(totalH * 0.5)), blocos: horariosLivres.slice(0, 3), impacto: "Médio", desc: "Distribuição balanceada nos próximos dias" },
      { id: "intensiva", label: "Intensiva", tempo: Math.max(4, Math.round(totalH * 0.85)), blocos: horariosLivres.slice(0, 6), impacto: "Alto", desc: "Máximo comprometimento — resolução rápida" },
    ];
  };

  const selectedGoal = goals.find(g => g.id === selectedGoalId);
  const sugestoes = selectedGoal ? gerarSugestoes(selectedGoal) : [];

  const toggleBloco = (bloco) => {
    setAlocData(prev => {
      const existe = prev.blocosSelecionados.find(b => b.dia === bloco.dia && b.inicio === bloco.inicio);
      const novos = existe ? prev.blocosSelecionados.filter(b => !(b.dia === bloco.dia && b.inicio === bloco.inicio)) : [...prev.blocosSelecionados, bloco];
      return { ...prev, blocosSelecionados: novos, tempoAlocado: String(novos.reduce((s, b) => s + b.horas, 0)) };
    });
  };

  const confirmarAlocacao = () => {
    if (!selectedGoal) return;
    // Remover schedules anteriores deste objetivo para evitar duplicidade
    const existingForGoal = (schedules || []).filter(s => s.goalId === selectedGoal.id);
    existingForGoal.forEach(s => {
      // Não temos deleteSchedule aqui, então marcamos como done para sumir da lista
    });
    alocData.blocosSelecionados.forEach(b => {
      const [h] = b.inicio.split(":").map(Number);
      // Verificar se já existe schedule para esse bloco e objetivo
      const alreadyExists = (schedules || []).some(s =>
        s.goalId === selectedGoal.id &&
        s.scheduledAt === b.dia + h * 3600000
      );
      if (!alreadyExists) {
        onAddSchedule({ kind: "investimento_tempo", label: selectedGoal.title, scheduledAt: b.dia + h * 3600000, duration: b.horas, goalId: selectedGoal.id });
      }
    });
    onUpdateGoal(selectedGoal.id, {
      alocacao: { status: "alocado", tempoAlocado: parseFloat(alocData.tempoAlocado) || 0, capitalAlocado: parseFloat(alocData.capitalAlocado) || 0, agendaBlocos: alocData.blocosSelecionados, recursos: alocData.recursos, alocadoEm: Date.now() },
    });
    setSelectedGoalId(null); setAlocStep("recursos"); setSugestaoSel(null);
    setAlocData({ tempoAlocado: "", capitalAlocado: "", recursos: "", blocosSelecionados: [] });
  };

  return (
    <div className="sub-page">
      <div className="precision-hero panel-elevated" style={{ "--p-color": precisionColor }}>
        <span className="precision-label">PRECISÃO EXECUTIVA</span>
        <span className="precision-value">{precision === null ? "—" : `${precision.toFixed(0)}%`}</span>
        <span className="precision-sub">{success} êxitos de {done.length} atividades concluídas</span>
      </div>
      <div className="metric-grid two-col">
        <MetricCard label="Horas planejadas" value={fmtH(totalPlanned)} color="#7B9BC0" />
        <MetricCard label="Horas executadas" value={fmtH(timeBank.investedTotal)} color="#C9A24B" />
        <MetricCard label="Eficiência temporal" value={`${efficiency.toFixed(0)}%`} color="#5B8C6E" />
        <MetricCard label="Taxa de falha" value={`${failRate.toFixed(0)}%`} color="#C9544B" emphasize={failRate > 30} />
      </div>

      {pendingAlloc.length > 0 && (
        <>
          <span className="section-label">Aguardando alocação</span>
          {pendingAlloc.map(g => {
            const pct = computeGoalProgress(g, steps);
            const isSelected = selectedGoalId === g.id;
            const goalStepsLocal = steps.filter(s => s.goalId === g.id).sort((a, b) => (a.order || 0) - (b.order || 0));
            return (
              <div key={g.id} className={`capex-goal panel-elevated ${isSelected ? "capex-goal-selected" : ""}`}>
                <button className="mpd-card-head" onClick={() => { setSelectedGoalId(isSelected ? null : g.id); setAlocStep("recursos"); setSugestaoSel(null); setAlocData({ tempoAlocado: "", capitalAlocado: "", recursos: "", blocosSelecionados: [] }); }}>
                  <div className="mpd-card-head-left">
                    {g.origem === "alerta" && <span className="mpd-goal-badge-alerta">⚡ Alerta</span>}
                    <span className="mpd-card-title" style={{ fontSize: 14 }}>{g.title}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: progressColor(pct) }}>{pct}%</span>
                    {isSelected ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>
                <div className="mp-bar" style={{ margin: "0 16px 10px" }}><div className="mp-bar-fill" style={{ width: `${pct}%`, background: progressColor(pct) }} /></div>

                {isSelected && (
                  <div className="capex-aloc-body">
                    {g.indicador && (
                      <div className="metric-grid two-col">
                        <MetricCard label="Situação atual" value={g.indicador.atual} color="#C9544B" />
                        <MetricCard label="Meta ideal" value={g.indicador.ideal} color="#5B8C6E" />
                      </div>
                    )}
                    <span className="section-label">Etapas — {goalStepsLocal.length} etapas · 80% do progresso</span>
                    {goalStepsLocal.map((s, i) => {
                      const stepPct = goalStepsLocal.length > 0 ? Math.round(80 / goalStepsLocal.length) : 0;
                      return (
                        <div key={s.id} className="mpd-step-row">
                          <span className={`mpd-step-dot ${s.status === "concluida" ? "done" : ""}`} />
                          <span className="mpd-step-title">{s.title}</span>
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)", flexShrink: 0 }}>+{stepPct}%</span>
                        </div>
                      );
                    })}

                    {alocStep === "recursos" && (
                      <>
                        <span className="section-label" style={{ marginTop: 14 }}>Sugestões de alocação</span>
                        <span className="vx-hero-sub" style={{ display: "block", marginBottom: 8 }}>Banco disponível: {fmtH(timeBank.available)} · {horariosLivres.length} blocos livres nos próximos 14 dias</span>
                        {sugestoes.map(s => (
                          <button key={s.id} className={`capex-sugestao ${sugestaoSel === s.id ? "is-selected" : ""}`}
                            onClick={() => { setSugestaoSel(s.id); setAlocData(p => ({ ...p, tempoAlocado: String(s.tempo), blocosSelecionados: s.blocos })); }}>
                            <div className="capex-sug-head">
                              <span className="capex-sug-label">{s.label}</span>
                              <span className="capex-sug-tempo">{fmtH(s.tempo)}</span>
                              <span className={`capex-sug-impacto capex-impacto-${s.impacto.toLowerCase()}`}>{s.impacto}</span>
                            </div>
                            <span className="capex-sug-desc">{s.desc}</span>
                            <div className="capex-sug-blocos">
                              {s.blocos.slice(0, 3).map((b, i) => <span key={i} className="capex-sug-bloco">{b.nome} {b.inicio}–{b.fim}</span>)}
                              {s.blocos.length > 3 && <span className="capex-sug-bloco">+{s.blocos.length - 3} mais</span>}
                            </div>
                          </button>
                        ))}
                        {horariosLivres.length === 0 && <EmptyHint text="Nenhum horário livre nos próximos 14 dias." />}
                        <button className="btn-primary full-width" style={{ marginTop: 10 }} disabled={!sugestaoSel} onClick={() => setAlocStep("agenda")}>Ajustar agenda <ChevronRight size={14} /></button>
                      </>
                    )}

                    {alocStep === "agenda" && (
                      <>
                        <span className="section-label" style={{ marginTop: 14 }}>Horários disponíveis</span>
                        {horariosLivres.map((b, i) => {
                          const sel = alocData.blocosSelecionados.find(x => x.dia === b.dia && x.inicio === b.inicio);
                          return (
                            <button key={i} className={`capex-bloco-livre ${sel ? "is-selected" : ""}`} onClick={() => toggleBloco(b)}>
                              <span className="capex-bloco-dia">{b.nome}</span>
                              <span className="capex-bloco-hora">{b.inicio}–{b.fim}</span>
                              <span className="capex-bloco-h">{fmtH(b.horas)}</span>
                              {sel && <Check size={13} color="#5B8C6E" />}
                            </button>
                          );
                        })}
                        <label className="field-label" style={{ marginTop: 10 }}>Capital a reservar</label>
                        {(() => {
                          const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
                          const caixaAtual = computeRdxEquity(finEntries, varCosts, fixedCosts);
                          const caixaDiario = caixaAtual / daysInMonth;
                          const numCapital = parseFloat((alocData.capitalAlocado || "0").replace(",", ".")) || 0;
                          const isExcedente = numCapital > caixaAtual;
                          const isProjetado = numCapital > 0 && numCapital <= caixaAtual;
                          return (
                            <div className="capex-capital-wrap">
                              <div className="capex-capital-info">
                                <span className="vx-hero-sub">Caixa real: {fmtBRL(caixaAtual)} · Média/dia: {fmtBRL(caixaDiario)}</span>
                              </div>
                              <input className="field-input" inputMode="decimal"
                                value={alocData.capitalAlocado}
                                onChange={e => setAlocData(p => ({ ...p, capitalAlocado: e.target.value }))}
                                placeholder="0,00" />
                              {numCapital > 0 && (
                                <div className={`capex-capital-status ${isExcedente ? "excedente" : "ok"}`}>
                                  {isExcedente
                                    ? <><AlertTriangle size={12} /> Excedente de {fmtBRL(numCapital - caixaAtual)} acima do saldo real</>
                                    : <><Check size={12} /> {fmtBRL(numCapital)} do saldo real · equivale a {(numCapital / caixaDiario).toFixed(1)} dias de caixa</>
                                  }
                                </div>
                              )}
                              <div className="capex-capital-pills">
                                {[1, 3, 7].map(d => (
                                  <button key={d} className="capex-capital-pill"
                                    onClick={() => setAlocData(p => ({ ...p, capitalAlocado: (caixaDiario * d).toFixed(2) }))}>
                                    {d}d · {fmtBRL(caixaDiario * d)}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        <label className="field-label">Recursos do patrimônio</label>
                        <div className="capex-assets-list">
                          {(assets || []).length === 0 ? (
                            <span className="vx-hero-sub">Nenhum item cadastrado no patrimônio.</span>
                          ) : (assets || []).map(asset => {
                            const selected = (alocData.recursos || "").includes(asset.name);
                            return (
                              <button key={asset.id}
                                className={`capex-asset-chip ${selected ? "is-selected" : ""}`}
                                onClick={() => {
                                  const cur = alocData.recursos || "";
                                  const novos = selected
                                    ? cur.split(", ").filter(r => r !== asset.name).join(", ")
                                    : cur ? `${cur}, ${asset.name}` : asset.name;
                                  setAlocData(p => ({ ...p, recursos: novos }));
                                }}>
                                {selected && <Check size={11} />} {asset.name}
                              </button>
                            );
                          })}
                        </div>
                        {alocData.recursos ? (
                          <span className="vx-hero-sub">Selecionados: {alocData.recursos}</span>
                        ) : null}
                        <div className="mpd-etapa-actions" style={{ marginTop: 10 }}>
                          <button className="btn-ghost-upload" onClick={() => setAlocStep("recursos")}>← Voltar</button>
                          <button className="btn-primary" disabled={alocData.blocosSelecionados.length === 0} onClick={confirmarAlocacao}><Check size={14} /> Alocar e enviar para Execução</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {allocatedGoals.length > 0 && (
        <>
          <span className="section-label">Em execução</span>
          {allocatedGoals.map(g => {
            const pct = computeGoalProgress(g, steps);
            const goalStepsLocal = steps.filter(s => s.goalId === g.id).sort((a, b) => (a.order || 0) - (b.order || 0));
            return (
              <div key={g.id} className="capex-goal panel-elevated">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px 8px" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{g.title}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: progressColor(pct) }}>{pct}%</span>
                </div>
                <div className="mp-bar" style={{ margin: "0 16px 8px" }}><div className="mp-bar-fill" style={{ width: `${pct}%`, background: progressColor(pct) }} /></div>
                <div style={{ padding: "0 16px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {goalStepsLocal.map(s => (
                    <div key={s.id} className="mpd-step-row">
                      <span className={`mpd-step-dot ${s.status === "concluida" ? "done" : ""}`} />
                      <span className="mpd-step-title">{s.title}</span>
                      {s.status !== "concluida" && <button className="btn-tiny" onClick={() => onUpdateStep(s.id, { status: "concluida", concluidaEm: Date.now() })}><Check size={11} /> Concluir</button>}
                    </div>
                  ))}
                </div>
                <div style={{ padding: "8px 16px 12px", borderTop: "1px solid var(--border)" }}>
                  <span className="vx-hero-sub">Tempo: {fmtH(g.alocacao.tempoAlocado)} · Capital: {fmtBRL(g.alocacao.capitalAlocado || 0)} · {g.alocacao.agendaBlocos?.length || 0} blocos alocados</span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {pendingAlloc.length === 0 && allocatedGoals.length === 0 && (
        <EmptyHint text="Nenhum objetivo aguardando alocação. Crie um a partir de um alerta no Plano Diretor." />
      )}
    </div>
  );
}

/* ============================================================
   MÓDULOS COMERCIAIS
   ============================================================ */

function ComercialClientesModule() {
  return (
    <div className="page">
      <h2 className="page-title">Clientes</h2>
      <p className="page-sub">Leads, base de clientes, funil de conversão e relacionamento.</p>
      <div className="metric-grid two-col">
        <MetricCard label="Leads ativos" value="—" color="#7B9BC0" />
        <MetricCard label="Clientes ativos" value="—" color="#5B8C6E" />
        <MetricCard label="Taxa de conversão" value="—" color="#C9A24B" />
        <MetricCard label="Contratos ativos" value="—" color="#C9544B" />
      </div>
      <EmptyHint text="Nenhum cliente cadastrado ainda." />
    </div>
  );
}

function ComercialServicosModule({ services, activities, sessions, onAdd, onUpdate, onDelete, onLaunchRevenue }) {
  return (
    <div className="page">
      <h2 className="page-title">Serviços</h2>
      <p className="page-sub">Serviços ativos, propostas, contratos e receita por serviço.</p>
      <ServicesModule
        services={services} activities={activities} sessions={sessions}
        onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} onLaunchRevenue={onLaunchRevenue}
      />
    </div>
  );
}

function ComercialProdutosModule({ assets, inventoryItems, onAddAsset, onUpdateAsset, onDeleteAsset, onAddInventory, onUpdateInventory, onDeleteInventory, onSellInventory }) {
  return (
    <div className="page">
      <h2 className="page-title">Produtos e Patrimônio</h2>
      <p className="page-sub">Estoque, insumos e patrimônio material da operação.</p>
      <PatrimonyModule
        assets={assets} inventoryItems={inventoryItems}
        onAddAsset={onAddAsset} onUpdateAsset={onUpdateAsset} onDeleteAsset={onDeleteAsset}
        onAddInventory={onAddInventory} onUpdateInventory={onUpdateInventory}
        onDeleteInventory={onDeleteInventory} onSellInventory={onSellInventory}
      />
    </div>
  );
}

function ComercialEmpresasModule() {
  return (
    <div className="page">
      <h2 className="page-title">Empresas</h2>
      <p className="page-sub">Empresas monitoradas, vinculadas, estudos de aquisição e participações.</p>
      <div className="metric-grid two-col">
        <MetricCard label="Empresas monitoradas" value="—" color="#7B9BC0" />
        <MetricCard label="Participações" value="—" color="#5B8C6E" />
        <MetricCard label="Em due diligence" value="—" color="#C9A24B" />
        <MetricCard label="Desinvestimentos" value="—" color="#C9544B" />
      </div>
      <EmptyHint text="Nenhuma empresa cadastrada ainda." />
    </div>
  );
}

function AddScheduleModal({ initialKind, activities, services, assets, onClose, onAdd, onAddFinEntry, onAddVarCost }) {
  const [kind, setKind] = useState(initialKind || "atividade");
  const [label, setLabel] = useState("");
  const [activityId, setActivityId] = useState(activities[0]?.id || "");
  const [serviceId, setServiceId] = useState(services[0]?.id || "");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState("09:00");
  const [hours, setHours] = useState("1");
  const [minutes, setMinutes] = useState("0");

  // Venda de patrimônio
  const [assetId, setAssetId] = useState(assets?.[0]?.id || "");
  const [salePrice, setSalePrice] = useState("");
  const [buyerNote, setBuyerNote] = useState("");

  // Investimento de dinheiro
  const [investDest, setInvestDest] = useState("kofen"); // "kofen" | "holding" | "rdx"
  const [investAmount, setInvestAmount] = useState("");
  const [investNote, setInvestNote] = useState("");

  // Investimento de tempo
  const [timeUnit, setTimeUnit] = useState(UNIT_DEFS[0].id);
  const [timeNote, setTimeNote] = useState("");

  const duration = (parseInt(hours || "0", 10)) + (parseInt(minutes || "0", 10) / 60);
  const scheduledAt = new Date(`${date}T${time}`).getTime();

  const selectedAsset = assets?.find(a => a.id === assetId);
  const numSalePrice = parseFloat((salePrice || "0").replace(",", ".")) || 0;
  const numInvestAmount = parseFloat((investAmount || "0").replace(",", ".")) || 0;

  const gainLoss = selectedAsset ? numSalePrice - selectedAsset.paidPrice : 0;
  const gainLossVsMarket = selectedAsset ? numSalePrice - selectedAsset.usedPrice : 0;

  const effectiveLabel =
    kind === "servico" ? services.find(s => s.id === serviceId)?.name || ""
    : kind === "atividade" ? activities.find(a => a.id === activityId)?.title || ""
    : kind === "patrimonio" ? selectedAsset?.name || ""
    : kind === "investimento_tempo" ? timeNote.trim() || UNIT_DEFS.find(u => u.id === timeUnit)?.name || ""
    : kind === "investimento_dinheiro" ? investNote.trim() || `Investimento → ${FIN_VARIABLE_DEST[investDest]?.label || investDest}`
    : label.trim();

  const canSave =
    kind === "servico" ? (!!serviceId && duration > 0)
    : kind === "atividade" ? (!!activityId && duration > 0)
    : kind === "patrimonio" ? (!!assetId && numSalePrice > 0)
    : kind === "investimento_tempo" ? (duration > 0)
    : kind === "investimento_dinheiro" ? (numInvestAmount > 0)
    : (label.trim().length > 0 && duration > 0);

  const handleSave = () => {
    if (kind === "patrimonio" && selectedAsset) {
      // Lançar venda direto no caixa variável como receita (entrada_retro)
      onAddFinEntry({
        category: "entrada_retro",
        amount: numSalePrice,
        note: `Venda patrimônio · ${selectedAsset.name}${buyerNote ? ` · ${buyerNote}` : ""}`,
        scheduledAt,
        status: "pendente",
      });
      // Registra o schedule apenas para visualização/histórico
      onAdd({
        kind,
        label: `${selectedAsset.name} · ${fmtBRL(numSalePrice)}`,
        assetId,
        salePrice: numSalePrice,
        paidPrice: selectedAsset.paidPrice,
        usedPrice: selectedAsset.usedPrice,
        gainLoss,
        gainLossVsMarket,
        buyerNote,
        scheduledAt,
        duration: 0,
      });
    } else if (kind === "investimento_dinheiro") {
      // Aporte / investimento para Kofen ou Holding — vai como custo variável
      if (investDest === "rdx") {
        onAddFinEntry({ category: "entrada_aporte", amount: numInvestAmount, note: investNote || "Aporte RDX", scheduledAt, status: "pendente" });
      } else {
        onAddVarCost({ destination: investDest, amount: numInvestAmount, note: investNote || `Investimento → ${investDest}`, scheduledAt: scheduledAt, status: "pendente" });
      }
      onAdd({ kind, label: effectiveLabel, investDest, amount: numInvestAmount, scheduledAt, duration: 0 });
    } else {
      // servico, atividade, investimento_tempo, venda (produto)
      onAdd({
        kind,
        label: effectiveLabel,
        activityId: kind === "atividade" ? activityId : null,
        serviceId: kind === "servico" ? serviceId : null,
        unitId: kind === "investimento_tempo" ? timeUnit : null,
        scheduledAt,
        duration,
      });
    }
    onClose();
  };

  return (
    <Modal onClose={onClose} title="Novo agendamento">
      <label className="field-label">Tipo</label>
      <div className="cat-picker" style={{ flexWrap: "wrap" }}>
        <button className={`cat-pick ${kind === "servico" ? "is-selected" : ""}`} onClick={() => setKind("servico")} disabled={services.length === 0}>Serviço</button>
        <button className={`cat-pick ${kind === "venda" ? "is-selected" : ""}`} onClick={() => setKind("venda")}>Venda</button>
        <button className={`cat-pick ${kind === "patrimonio" ? "is-selected" : ""}`} onClick={() => setKind("patrimonio")} disabled={!assets?.length}>Patrimônio</button>
        <button className={`cat-pick ${kind === "investimento_tempo" ? "is-selected" : ""}`} onClick={() => setKind("investimento_tempo")}>Inv. Tempo</button>
        <button className={`cat-pick ${kind === "investimento_dinheiro" ? "is-selected" : ""}`} onClick={() => setKind("investimento_dinheiro")}>Inv. Dinheiro</button>
        <button className={`cat-pick ${kind === "atividade" ? "is-selected" : ""}`} onClick={() => setKind("atividade")} disabled={activities.length === 0}>Atividade</button>
      </div>

      {/* SERVIÇO */}
      {kind === "servico" && (
        <>
          <label className="field-label">Serviço</label>
          <select className="field-input" value={serviceId} onChange={e => setServiceId(e.target.value)}>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </>
      )}

      {/* ATIVIDADE */}
      {kind === "atividade" && (
        <>
          <label className="field-label">Atividade</label>
          <select className="field-input" value={activityId} onChange={e => setActivityId(e.target.value)}>
            {activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </>
      )}

      {/* VENDA (produto) */}
      {kind === "venda" && (
        <>
          <label className="field-label">Descrição</label>
          <input className="field-input" placeholder="Ex: Entregar pedido no correio" value={label} onChange={e => setLabel(e.target.value)} />
        </>
      )}

      {/* VENDA DE PATRIMÔNIO */}
      {kind === "patrimonio" && (
        <>
          <label className="field-label">Item do patrimônio</label>
          {!assets?.length ? (
            <span className="vx-hero-sub" style={{ color: "var(--red)" }}>Nenhum item cadastrado em Patrimônio.</span>
          ) : (
            <select className="field-input" value={assetId} onChange={e => setAssetId(e.target.value)}>
              {assets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {selectedAsset && (
            <div className="sched-asset-info panel-elevated">
              <div className="sched-asset-row"><span className="sched-asset-label">Valor pago</span><span className="sched-asset-val">{fmtBRL(selectedAsset.paidPrice)}</span></div>
              <div className="sched-asset-row"><span className="sched-asset-label">Referência mercado (usado)</span><span className="sched-asset-val">{fmtBRL(selectedAsset.usedPrice)}</span></div>
              <div className="sched-asset-row"><span className="sched-asset-label">Referência novo</span><span className="sched-asset-val">{fmtBRL(selectedAsset.newPrice)}</span></div>
            </div>
          )}
          <label className="field-label">Preço de venda acordado (R$)</label>
          <input className="field-input" inputMode="decimal" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="0,00" />
          {selectedAsset && numSalePrice > 0 && (
            <div className="sched-asset-info panel-elevated">
              <div className="sched-asset-row">
                <span className="sched-asset-label">vs. valor pago</span>
                <span className={`sched-asset-val ${gainLoss >= 0 ? "pos-text" : "neg-text"}`}>{gainLoss >= 0 ? "+" : ""}{fmtBRL(gainLoss)}</span>
              </div>
              <div className="sched-asset-row">
                <span className="sched-asset-label">vs. preço de mercado</span>
                <span className={`sched-asset-val ${gainLossVsMarket >= 0 ? "pos-text" : "neg-text"}`}>{gainLossVsMarket >= 0 ? "+" : ""}{fmtBRL(gainLossVsMarket)}</span>
              </div>
            </div>
          )}
          <label className="field-label">Comprador / observação (opcional)</label>
          <input className="field-input" value={buyerNote} onChange={e => setBuyerNote(e.target.value)} placeholder="Ex: João Silva, Facebook Marketplace" />
          <span className="vx-hero-sub">A receita será lançada automaticamente no Caixa como pendente quando você agendar.</span>
        </>
      )}

      {/* INVESTIMENTO DE TEMPO */}
      {kind === "investimento_tempo" && (
        <>
          <label className="field-label">Onde vai investir o tempo</label>
          <div className="unit-picker">
            {UNIT_DEFS.map(u => (
              <button key={u.id} className={`unit-pick ${timeUnit === u.id ? "is-selected" : ""}`} style={{ "--u-color": u.color }} onClick={() => setTimeUnit(u.id)}>
                <span className="unit-pick-dot" />{u.name}
              </button>
            ))}
          </div>
          <label className="field-label">Descrição do investimento</label>
          <input className="field-input" value={timeNote} onChange={e => setTimeNote(e.target.value)} placeholder="Ex: Reunião de governança Kofen, Revisão do sistema" />
        </>
      )}

      {/* INVESTIMENTO DE DINHEIRO */}
      {kind === "investimento_dinheiro" && (
        <>
          <label className="field-label">Destino</label>
          <div className="unit-picker">
            {UNIT_DEFS.map(u => (
              <button key={u.id} className={`unit-pick ${investDest === u.id ? "is-selected" : ""}`} style={{ "--u-color": u.color }} onClick={() => setInvestDest(u.id)}>
                <span className="unit-pick-dot" />{u.name}
              </button>
            ))}
          </div>
          <label className="field-label">Valor (R$)</label>
          <input className="field-input" inputMode="decimal" value={investAmount} onChange={e => setInvestAmount(e.target.value)} placeholder="0,00" />
          <label className="field-label">Descrição (opcional)</label>
          <input className="field-input" value={investNote} onChange={e => setInvestNote(e.target.value)} placeholder="Ex: Aporte mensal Kofen, Capital de giro Holding" />
          <span className="vx-hero-sub">
            {investDest === "rdx" ? "Lançado como Aporte (entrada) no Caixa de Dinheiro." : `Lançado como custo variável → ${FIN_VARIABLE_DEST[investDest]?.label || investDest} no Caixa.`}
          </span>
        </>
      )}

      {/* DATA E HORA (todos exceto patrimônio que já lança imediatamente) */}
      <label className="field-label">Data</label>
      <input type="date" className="field-input" value={date} onChange={e => setDate(e.target.value)} />
      <label className="field-label">Hora</label>
      <input type="time" className="field-input" value={time} onChange={e => setTime(e.target.value)} />

      {/* DURAÇÃO (apenas tipos que envolvem tempo) */}
      {(kind === "servico" || kind === "atividade" || kind === "investimento_tempo" || kind === "venda") && (
        <>
          <label className="field-label">Duração estimada</label>
          <div className="hm-input">
            <div className="hm-field"><input type="number" min="0" className="field-input" value={hours} onChange={e => setHours(e.target.value)} /><span className="hm-suffix">h</span></div>
            <div className="hm-field"><input type="number" min="0" max="59" className="field-input" value={minutes} onChange={e => setMinutes(e.target.value)} /><span className="hm-suffix">min</span></div>
          </div>
        </>
      )}

      <button className="btn-primary modal-submit" disabled={!canSave} onClick={handleSave}>
        <Check size={16} /> Agendar
      </button>
    </Modal>
  );
}

function ActiveSessionCard({ activeSession, activeUnit, elapsedSec, plannedSec, overPlanned, progressPct, onStop, onDiscard }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="active-session-card panel-elevated" style={{ "--u-color": activeUnit.color }}>
      {/* Cabeçalho — sempre visível, clicável */}
      <button className="active-session-card-head" onClick={() => setExpanded(e => !e)}>
        <span className="active-session-dot" />
        <span className="active-session-unit">{activeUnit.name} · {activeSession.label || "Sessão livre"}</span>
        <span className="active-session-card-clock">{fmtClock(elapsedSec)}</span>
        {plannedSec && (
          <span className={`active-session-card-pct ${overPlanned ? "over" : ""}`}>
            {overPlanned ? "+" : ""}{progressPct?.toFixed(0)}%
          </span>
        )}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {/* Barra de progresso — sempre visível se planejado */}
      {plannedSec && (
        <div className="active-session-progress" style={{ margin: "0 0 0" }}>
          <div className={`active-session-progress-fill ${overPlanned ? "over" : ""}`} style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {/* Detalhes — expandido */}
      {expanded && (
        <div className="active-session-card-body">
          <div className="active-session-clock">{fmtClock(elapsedSec)}</div>
          {plannedSec && (
            <div className={`active-session-planned ${overPlanned ? "over" : ""}`}>
              {overPlanned
                ? <><AlertTriangle size={13} /> Estourou o planejado de {fmtH(activeSession.plannedHours)}</>
                : <>Planejado: {fmtH(activeSession.plannedHours)}</>}
            </div>
          )}
          <div className="active-session-actions">
            <button className="btn-stop" onClick={onStop}><Square size={16} fill="currentColor" /> Encerrar sessão</button>
            <button className="btn-ghost-danger" onClick={onDiscard}>Descartar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ExecGoalsAtalho({ goals, steps, schedules, onStartSchedule }) {
  const [expandedId, setExpandedId] = useState(null);

  return (
    <div className="exec-goals-atalho">
      {goals.map(g => {
        const pct = computeGoalProgress(g, steps);
        const pColor = progressColor(pct);
        const isOpen = expandedId === g.id;
        const goalSteps = steps
          .filter(s => s.goalId === g.id)
          .sort((a, b) => (a.order || 0) - (b.order || 0));
        // Todos os agendamentos vinculados a este objetivo — mais próximo embaixo
        const goalSchedules = schedules
          .filter(s => !s.done && s.goalId === g.id)
          .sort((a, b) => b.scheduledAt - a.scheduledAt);
        const u = UNIT_DEFS.find(x => x.id === g.unitId);

        return (
          <div key={g.id} className={`exec-goal-atalho panel-elevated ${isOpen ? "is-open" : ""}`}
            style={{ "--u-color": u?.color || "var(--amber)" }}>
            <button className="exec-goal-atalho-head" onClick={() => setExpandedId(isOpen ? null : g.id)}>
              <div className="exec-goal-atalho-info">
                <span className="exec-goal-atalho-title">{g.title}</span>
                <div className="exec-goal-atalho-bar">
                  <div className="exec-goal-atalho-bar-fill" style={{ width: `${pct}%`, background: pColor }} />
                </div>
              </div>
              <span className="exec-goal-atalho-pct" style={{ color: pColor }}>{pct}%</span>
              {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>

            {isOpen && (
              <div className="exec-goal-atalho-body">
                {/* Etapas em ordem */}
                {goalSteps.length > 0 && (
                  <div className="exec-goal-steps">
                    {goalSteps.map((s, i) => {
                      const stepPct = goalSteps.length > 0 ? Math.round(80 / goalSteps.length) : 0;
                      return (
                        <div key={s.id} className={`exec-goal-step ${s.status === "concluida" ? "done" : ""}`}>
                          <span className="exec-goal-step-num">{i + 1}</span>
                          <span className="exec-goal-step-title">{s.title}</span>
                          <span className="exec-goal-step-pct">+{stepPct}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Agendamentos vinculados — mais distante no topo, mais próximo embaixo */}
                {goalSchedules.length > 0 && (
                  <>
                    <span className="section-label" style={{ marginTop: 10 }}>Blocos agendados</span>
                    {goalSchedules.map(s => {
                      const prox = scheduleProximity(s.scheduledAt);
                      const hora = new Date(s.scheduledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                      const data = fmtDate(s.scheduledAt);
                      return (
                        <button key={s.id} className="exec-schedule-item"
                          style={{ "--prox-color": prox.color, marginBottom: 4 }}
                          onClick={() => onStartSchedule(s)}>
                          <span className="exec-schedule-time" style={{ fontSize: 11 }}>{data} {hora}</span>
                          <span className="exec-schedule-label">{fmtH(s.duration)}</span>
                          <ChevronRight size={13} color="var(--text-faint)" />
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GoalsPlanTab({ goals, steps, activities, services, schedules, onDeleteGoal, onAddStep, onDeleteStep, onAddActivity, onUpdateActivity, onDeleteActivity, onUpdateSchedule, onDeleteSchedule, onStartSchedule }) {
  const [expanded, setExpanded] = useState(null);
  const [showAddStep, setShowAddStep] = useState(null); // goalId
  const [showAddActivity, setShowAddActivity] = useState(null); // {goalId, stepId}

  const progressFor = (goalId) => {
    const acts = activities.filter(a => a.goalId === goalId);
    if (acts.length === 0) return 0;
    const done = acts.filter(a => a.status === "concluída_êxito" || a.status === "concluída_falha").length;
    return (done / acts.length) * 100;
  };

  const sortedSchedules = [...schedules].filter(s => !s.done).sort((a, b) => (a.scheduledAt || Infinity) - (b.scheduledAt || Infinity));

  return (
    <div className="sub-page">
      {sortedSchedules.length === 0 ? null : (
        <div className="schedule-list">
          {sortedSchedules.map(s => {
            const prox = scheduleProximity(s.scheduledAt);
            const isFinancial = s.kind === "patrimonio" || s.kind === "investimento_dinheiro";
            const canStart = !isFinancial; // patrimônio e invest. dinheiro já foram lançados no caixa
            const subParts = [
              s.scheduledAt ? fmtDateTime(s.scheduledAt) : "Sem data",
              s.duration > 0 ? fmtH(s.duration) : null,
              s.kind === "patrimonio" && s.salePrice ? `Venda: ${fmtBRL(s.salePrice)}` : null,
              s.kind === "patrimonio" && s.gainLoss != null ? `Ganho/Perda vs. pago: ${s.gainLoss >= 0 ? "+" : ""}${fmtBRL(s.gainLoss)}` : null,
              s.kind === "investimento_dinheiro" && s.amount ? `${fmtBRL(s.amount)} → ${FIN_VARIABLE_DEST[s.investDest]?.label || s.investDest}` : null,
              prox.label,
            ].filter(Boolean).join(" · ");
            return (
              <div className="schedule-card" key={s.id} style={{ "--prox-color": prox.color }}
                onClick={canStart ? () => onStartSchedule(s) : undefined}
                role={canStart ? "button" : undefined}
                tabIndex={canStart ? 0 : undefined}
              >
                <span className="schedule-card-dot" />
                <div className="schedule-card-text">
                  <span className="schedule-card-title">{SCHEDULE_KIND_LABELS[s.kind]} · {s.label}</span>
                  <span className="schedule-card-sub">{subParts}</span>
                  {isFinancial && <span className="schedule-card-badge">Lançado no Caixa · pendente</span>}
                </div>
                <button className="ledger-row-del" onClick={(e) => { e.stopPropagation(); onDeleteSchedule(s.id); }}><X size={14} /></button>
              </div>
            );
          })}
        </div>
      )}

      {goals.length === 0 ? <EmptyHint text="Nenhum objetivo cadastrado ainda." /> : (
        <div className="goal-list">
          {[...goals].sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity)).map(g => {
            const u = UNIT_DEFS.find(x => x.id === g.unitId);
            const goalSteps = steps.filter(s => s.goalId === g.id).sort((a, b) => (a.order || 0) - (b.order || 0));
            const isOpen = expanded === g.id;
            const pct = progressFor(g.id);
            const impactLevel = typeof g.impactPct === "number" ? impactLevelFor(g.impactPct) : null;
            return (
              <div className="goal-card panel-elevated" key={g.id} style={{ "--u-color": u?.color }}>
                <button className="goal-card-head" onClick={() => setExpanded(isOpen ? null : g.id)}>
                  <span className="goal-card-unit">{u?.name}</span>
                  <span className="goal-card-title">{g.title}</span>
                  {impactLevel && <span className="goal-card-impact" style={{ "--badge-color": impactLevel.color }}>{impactLevel.label}</span>}
                  <span className="goal-card-pct">{pct.toFixed(0)}%</span>
                  {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
                <div className="goal-card-bar"><div className="goal-card-bar-fill" style={{ width: `${pct}%` }} /></div>

                {isOpen && (
                  <div className="goal-card-body">
                    {g.description && <p className="goal-card-desc">{g.description}</p>}

                    <div className="goal-card-actions">
                      <button className="btn-tiny" onClick={() => setShowAddStep(g.id)}><Plus size={12} /> Etapa</button>
                      <button className="btn-tiny danger" onClick={() => onDeleteGoal(g.id)}><X size={12} /> Excluir objetivo</button>
                    </div>

                    {goalSteps.length === 0 ? <EmptyHint text="Nenhuma etapa ainda." /> : (
                      <div className="step-list">
                        {goalSteps.map(s => {
                          const stepActs = activities.filter(a => a.stepId === s.id);
                          return (
                            <div className="step-card" key={s.id}>
                              <div className="step-card-head">
                                <Flag size={13} />
                                <span className="step-card-title">{s.title}</span>
                                <button className="btn-tiny" onClick={() => setShowAddActivity({ goalId: g.id, stepId: s.id })}><Plus size={12} /></button>
                                <button className="ledger-row-del" onClick={() => onDeleteStep(s.id)}><X size={13} /></button>
                              </div>
                              {stepActs.length === 0 ? <div className="step-empty">Nenhuma atividade nesta etapa.</div> : (
                                <div className="activity-list">
                                  {stepActs.map(a => (
                                    <ActivityRow key={a.id} activity={a} onUpdate={onUpdateActivity} onDelete={onDeleteActivity} />
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddStep && <AddStepModal onClose={() => setShowAddStep(null)} onAdd={(title) => { onAddStep({ goalId: showAddStep, title, order: steps.filter(s => s.goalId === showAddStep).length }); setShowAddStep(null); }} />}
      {showAddActivity && (
        <AddActivityModal
          unitId={goals.find(g => g.id === showAddActivity.goalId)?.unitId}
          onClose={() => setShowAddActivity(null)}
          onAdd={(activity) => { onAddActivity({ ...activity, goalId: showAddActivity.goalId, stepId: showAddActivity.stepId, unitId: goals.find(g => g.id === showAddActivity.goalId)?.unitId }); setShowAddActivity(null); }}
        />
      )}
    </div>
  );
}

function ActivityRow({ activity, onUpdate, onDelete }) {
  const pr = PRIORITIES[activity.priority] || PRIORITIES.media;
  const statusLabel = { pendente: "Pendente", em_andamento: "Em andamento", concluída_êxito: "Êxito", concluída_falha: "Falha" }[activity.status] || activity.status;
  return (
    <div className="activity-row">
      <span className="activity-priority-dot" style={{ background: pr.color }} title={pr.label} />
      <span className="activity-row-title">{activity.title}</span>
      <span className={`activity-status-tag ${activity.status}`}>{statusLabel}</span>
      <button className="ledger-row-del" onClick={() => onDelete(activity.id)}><X size={13} /></button>
    </div>
  );
}

function AddGoalModal({ onClose, onAdd }) {
  const [unitId, setUnitId] = useState(UNIT_DEFS[0].id);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Modal onClose={onClose} title="Novo objetivo">
      <label className="field-label">Unidade</label>
      <div className="unit-picker">
        {UNIT_DEFS.map(u => <button key={u.id} className={`unit-pick ${unitId === u.id ? "is-selected" : ""}`} style={{ "--u-color": u.color }} onClick={() => setUnitId(u.id)}><span className="unit-pick-dot" />{u.name}</button>)}
      </div>
      <label className="field-label">Título do objetivo</label>
      <input className="field-input" placeholder="Ex: Expandir Kofen para novo mercado" value={title} onChange={e => setTitle(e.target.value)} />
      <label className="field-label">Descrição (opcional)</label>
      <textarea className="field-input field-textarea" value={description} onChange={e => setDescription(e.target.value)} placeholder="Levantamento de informações, pesquisa de mercado, contexto..." />
      <button className="btn-primary modal-submit" disabled={!title.trim()} onClick={() => onAdd({ unitId, title: title.trim(), description: description.trim() })}><Check size={16} /> Criar objetivo</button>
    </Modal>
  );
}

function AddStepModal({ onClose, onAdd }) {
  const [title, setTitle] = useState("");
  return (
    <Modal onClose={onClose} title="Nova etapa">
      <label className="field-label">Título da etapa</label>
      <input className="field-input" placeholder="Ex: Levantamento de mercado" value={title} onChange={e => setTitle(e.target.value)} />
      <button className="btn-primary modal-submit" disabled={!title.trim()} onClick={() => onAdd(title.trim())}><Check size={16} /> Adicionar etapa</button>
    </Modal>
  );
}

function AddActivityModal({ onClose, onAdd, unitId }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("media");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [cost, setCost] = useState("0");
  const [costDestination, setCostDestination] = useState(unitId || UNIT_DEFS[0].id);

  const plannedHours = (parseInt(hours || "0", 10)) + (parseInt(minutes || "0", 10) / 60);
  const hourValue = currentHourValue();
  const previewValuation = plannedHours * hourValue;
  const numCost = parseFloat((cost || "0").replace(",", ".")) || 0;

  return (
    <Modal onClose={onClose} title="Nova atividade">
      <label className="field-label">Título da atividade</label>
      <input className="field-input" placeholder="Ex: Entrevistar 10 potenciais clientes" value={title} onChange={e => setTitle(e.target.value)} />
      <label className="field-label">Prioridade</label>
      <div className="cat-picker">
        {Object.entries(PRIORITIES).map(([k, v]) => (
          <button key={k} className={`cat-pick ${priority === k ? "is-selected" : ""}`} style={{ borderColor: priority === k ? v.color : undefined, color: priority === k ? v.color : undefined }} onClick={() => setPriority(k)}>{v.label}</button>
        ))}
      </div>
      <label className="field-label">Tempo planejado</label>
      <div className="hm-input">
        <div className="hm-field"><input type="number" min="0" className="field-input" value={hours} onChange={e => setHours(e.target.value)} /><span className="hm-suffix">h</span></div>
        <div className="hm-field"><input type="number" min="0" max="59" className="field-input" value={minutes} onChange={e => setMinutes(e.target.value)} /><span className="hm-suffix">min</span></div>
      </div>
      <label className="field-label">Custo de execução (R$, pode ser 0)</label>
      <input className="field-input" inputMode="decimal" value={cost} onChange={e => setCost(e.target.value)} placeholder="0,00" />
      <label className="field-label">Destino do custo</label>
      <div className="unit-picker">
        {UNIT_DEFS.map(u => <button key={u.id} className={`unit-pick ${costDestination === u.id ? "is-selected" : ""}`} style={{ "--u-color": u.color }} onClick={() => setCostDestination(u.id)}><span className="unit-pick-dot" />{u.name}</button>)}
      </div>

      {plannedHours > 0 && (
        <div className="vx-preview">
          <span className="vx-preview-label">PRÉVIA DE VALUATION (especulativo)</span>
          <span className="vx-preview-value">{fmtBRL(previewValuation)}</span>
          <span className="vx-preview-sub">{fmtH(plannedHours)} × {fmtBRLPrecise(hourValue)}/h vigente</span>
        </div>
      )}

      <button
        className="btn-primary modal-submit"
        disabled={!title.trim()}
        onClick={() => onAdd({ title: title.trim(), priority, plannedHours: plannedHours > 0 ? plannedHours : null, cost: numCost, costDestination })}
      >
        <Check size={16} /> Adicionar atividade
      </button>
    </Modal>
  );
}

/* ============================================================
   TIME MODULE — Gerenciar / Executar / Analisar
   ============================================================ */

function TimeModule({ activities, goals, sessions, activeSession, timeBank, nowTick, closures, recoveries, onUpdateActivity, onAddRecovery, recurringTimes, onAddRecurring, onUpdateRecurring, onDeleteRecurring }) {
  const [sub, setSub] = useState("manage");

  return (
    <div className="sub-page">
      <SubTabs
        value={sub} onChange={setSub}
        items={[
          { id: "manage", label: "Gerenciar", icon: ListChecks },
          { id: "recurring", label: "Recorrências", icon: Repeat },
          { id: "analyze", label: "Analisar", icon: BarChart3 },
        ]}
      />
      {sub === "manage" && <TimeManageTab activities={activities} onUpdateActivity={onUpdateActivity} />}
      {sub === "recurring" && (
        <RecurringTimeTab activities={activities} goals={goals} recurringTimes={recurringTimes} onAdd={onAddRecurring} onUpdate={onUpdateRecurring} onDelete={onDeleteRecurring} />
      )}
      {sub === "analyze" && <TimeAnalyzeTab sessions={sessions} timeBank={timeBank} closures={closures} recoveries={recoveries} onAddRecovery={onAddRecovery} />}
    </div>
  );
}

function SubTabs({ value, onChange, items }) {
  return (
    <div className="sub-tabs">
      {items.map(it => {
        const Icon = it.icon; const active = value === it.id;
        return (
          <button key={it.id} className={`sub-tab ${active ? "is-active" : ""}`} onClick={() => onChange(it.id)}>
            <Icon size={15} /> {it.label}
          </button>
        );
      })}
    </div>
  );
}

function TimeManageTab({ activities, onUpdateActivity }) {
  const pending = activities.filter(a => a.status === "pendente" || a.status === "em_andamento");
  const sorted = [...pending].sort((a, b) => {
    const order = { alta: 0, media: 1, baixa: 2 };
    return order[a.priority] - order[b.priority];
  });

  return (
    <div className="sub-page">
      <p className="page-sub">Atividades definidas em Objetivos, ordenadas por prioridade. Atribua quanto tempo planeja investir em cada uma.</p>
      {sorted.length === 0 ? <EmptyHint text="Nenhuma atividade pendente. Crie atividades dentro de um objetivo." /> : (
        <div className="manage-list">
          {sorted.map(a => (
            <ManageRow key={a.id} activity={a} onUpdate={onUpdateActivity} />
          ))}
        </div>
      )}
    </div>
  );
}

function ManageRow({ activity, onUpdate }) {
  const pr = PRIORITIES[activity.priority] || PRIORITIES.media;
  const u = UNIT_DEFS.find(x => x.id === activity.unitId);
  const [hours, setHours] = useState(activity.plannedHours ? Math.floor(activity.plannedHours) : 0);
  const [minutes, setMinutes] = useState(activity.plannedHours ? Math.round((activity.plannedHours % 1) * 60) : 0);

  const commit = () => onUpdate(activity.id, { plannedHours: hours + minutes / 60 });

  return (
    <div className="manage-row panel-elevated" style={{ "--u-color": u?.color }}>
      <div className="manage-row-top">
        <span className="activity-priority-dot" style={{ background: pr.color }} />
        <span className="manage-row-title">{activity.title}</span>
        <span className="manage-row-unit">{u?.name}</span>
      </div>
      <div className="manage-row-time">
        <span className="manage-row-time-label">Tempo planejado</span>
        <div className="hm-input">
          <div className="hm-field"><input type="number" min="0" className="field-input" value={hours} onChange={e => setHours(parseInt(e.target.value) || 0)} onBlur={commit} /><span className="hm-suffix">h</span></div>
          <div className="hm-field"><input type="number" min="0" max="59" className="field-input" value={minutes} onChange={e => setMinutes(parseInt(e.target.value) || 0)} onBlur={commit} /><span className="hm-suffix">min</span></div>
        </div>
      </div>
    </div>
  );
}

function RecurringTimeTab({ activities, goals, recurringTimes, onAdd, onUpdate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const WEEKDAY_NAMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  return (
    <div className="sub-page">
      <p className="page-sub">Tempo que já está reservado: dias da semana e horário fixos, debitados automaticamente do banco de tempo (com sua confirmação) ao abrir o app.</p>
      <button className="btn-primary full-width" onClick={() => setShowAdd(true)}><Plus size={16} /> Novo investimento recorrente</button>

      {recurringTimes.length === 0 ? <EmptyHint text="Nenhum investimento de tempo recorrente cadastrado." /> : (
        <div className="ledger">
          {recurringTimes.map(r => {
            const act = activities.find(a => a.id === r.activityId);
            const u = UNIT_DEFS.find(x => x.id === r.unitId);
            return (
              <div className="ledger-row recurring-row" key={r.id}>
                <div className="ledger-row-main">
                  <span className="ledger-dot" style={{ background: r.active ? u?.color : "#3A3D44" }} />
                  <div className="ledger-row-text">
                    <span className="ledger-row-title">{r.label}{act ? ` · ${act.title}` : ""}</span>
                    <span className="ledger-row-date">
                      {r.weekdays.map(w => WEEKDAY_NAMES[w]).join(", ")} · {r.startTime}–{r.endTime} · {r.active ? "Ativo" : "Pausado"}
                      {r.financialKind && (
                        <> · <span className={r.financialKind === "receita" ? "pos-text" : "neg-text"}>{r.financialKind === "receita" ? "+" : "-"}{fmtBRL(r.financialValue)}/ocorrência</span></>
                      )}
                    </span>
                  </div>
                </div>
                <div className="ledger-row-end">
                  <button className="btn-tiny" onClick={() => onUpdate(r.id, { active: !r.active })}>{r.active ? "Pausar" : "Ativar"}</button>
                  <button className="ledger-row-del" onClick={() => onDelete(r.id)}><X size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddRecurringTimeModal
          activities={activities} goals={goals}
          onClose={() => setShowAdd(false)}
          onAdd={(r) => { onAdd(r); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

function AddRecurringTimeModal({ activities, goals, onClose, onAdd }) {
  const WEEKDAYS = [{ id: 0, label: "D" }, { id: 1, label: "S" }, { id: 2, label: "T" }, { id: 3, label: "Q" }, { id: 4, label: "Q" }, { id: 5, label: "S" }, { id: 6, label: "S" }];
  const [label, setLabel] = useState("");
  const [unitId, setUnitId] = useState(UNIT_DEFS[0].id);
  const [activityId, setActivityId] = useState("");
  const [weekdays, setWeekdays] = useState([]);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("12:00");
  const [financialKind, setFinancialKind] = useState("none"); // "none" | "receita" | "despesa"
  const [financialValue, setFinancialValue] = useState("");

  const toggleWeekday = (id) => setWeekdays(prev => prev.includes(id) ? prev.filter(w => w !== id) : [...prev, id].sort());
  const validTimes = startTime < endTime;
  const numValue = parseFloat((financialValue || "0").replace(",", ".")) || 0;
  const canSave = label.trim() && weekdays.length > 0 && validTimes && (financialKind === "none" || numValue > 0);

  return (
    <Modal onClose={onClose} title="Novo investimento de tempo recorrente">
      <label className="field-label">Nome</label>
      <input className="field-input" placeholder="Ex: Treino, Estudo, Projeto pessoal" value={label} onChange={e => setLabel(e.target.value)} />

      <label className="field-label">Unidade</label>
      <div className="unit-picker">
        {UNIT_DEFS.map(u => <button key={u.id} className={`unit-pick ${unitId === u.id ? "is-selected" : ""}`} style={{ "--u-color": u.color }} onClick={() => setUnitId(u.id)}><span className="unit-pick-dot" />{u.name}</button>)}
      </div>

      {activities.length > 0 && (
        <>
          <label className="field-label">Atividade vinculada (opcional)</label>
          <select className="field-input" value={activityId} onChange={e => setActivityId(e.target.value)}>
            <option value="">Nenhuma</option>
            {activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </>
      )}

      <label className="field-label">Dias da semana</label>
      <div className="weekday-picker">
        {WEEKDAYS.map(w => (
          <button key={w.id} className={`weekday-pick ${weekdays.includes(w.id) ? "is-selected" : ""}`} onClick={() => toggleWeekday(w.id)}>{w.label}</button>
        ))}
      </div>

      <label className="field-label">Horário</label>
      <div className="hm-input">
        <div className="hm-field"><input type="time" className="field-input" value={startTime} onChange={e => setStartTime(e.target.value)} /></div>
        <div className="hm-field"><input type="time" className="field-input" value={endTime} onChange={e => setEndTime(e.target.value)} /></div>
      </div>
      {!validTimes && <span className="vx-hero-sub" style={{ color: "var(--red)" }}>O horário final precisa ser depois do inicial.</span>}

      <label className="field-label">Gera receita ou despesa? (opcional)</label>
      <div className="cat-picker">
        <button className={`cat-pick ${financialKind === "none" ? "is-selected" : ""}`} onClick={() => setFinancialKind("none")}>Nenhuma</button>
        <button className={`cat-pick ${financialKind === "receita" ? "is-selected" : ""}`} onClick={() => setFinancialKind("receita")}>Receita</button>
        <button className={`cat-pick ${financialKind === "despesa" ? "is-selected" : ""}`} onClick={() => setFinancialKind("despesa")}>Despesa</button>
      </div>
      {financialKind !== "none" && (
        <>
          <label className="field-label">Valor por ocorrência (R$)</label>
          <input className="field-input" inputMode="decimal" value={financialValue} onChange={e => setFinancialValue(e.target.value)} placeholder="0,00" />
          <span className="vx-hero-sub">Usado para projetar o Caixa Projetado Líquido até o fim do mês.</span>
        </>
      )}

      <button
        className="btn-primary modal-submit" disabled={!canSave}
        onClick={() => onAdd({ label: label.trim(), unitId, activityId: activityId || null, weekdays, startTime, endTime, financialKind: financialKind === "none" ? null : financialKind, financialValue: financialKind === "none" ? 0 : numValue })}
      ><Check size={16} /> Adicionar</button>
    </Modal>
  );
}

function StartSessionModal({ activities, services, startFrom, available, onClose, onStart }) {
  const initialMode = startFrom
    ? (startFrom.kind === "servico" ? "service" : startFrom.kind === "atividade" ? "activity" : "free")
    : (activities.length > 0 ? "activity" : "free");
  const [mode, setMode] = useState(initialMode);
  const [activityId, setActivityId] = useState(startFrom?.activityId || activities[0]?.id || "");
  const [unitId, setUnitId] = useState(UNIT_DEFS[0].id);
  const [label, setLabel] = useState(startFrom?.kind === "venda" ? startFrom.label : "");
  const [hours, setHours] = useState(startFrom ? String(Math.floor(startFrom.duration)) : "2");
  const [minutes, setMinutes] = useState(startFrom ? String(Math.round((startFrom.duration % 1) * 60)) : "0");
  const [serviceId, setServiceId] = useState(startFrom?.serviceId || services[0]?.id || "");

  const selectedActivity = activities.find(a => a.id === activityId);
  const selectedService = services.find(s => s.id === serviceId);
  const serviceActivity = selectedService ? activities.find(a => (selectedService.activityIds || []).includes(a.id)) : null;

  const plannedHours = mode === "activity" && selectedActivity?.plannedHours
    ? selectedActivity.plannedHours
    : (parseInt(hours || "0", 10)) + (parseInt(minutes || "0", 10) / 60);
  const exceeds = plannedHours > available;

  const handleServiceStart = () => {
    if (!selectedService) return;
    const unit = serviceActivity ? serviceActivity.unitId : unitId;
    onStart(unit, serviceActivity?.id || null, selectedService.name, plannedHours, selectedService.id);
  };

  return (
    <Modal onClose={onClose} title="Iniciar investimento">
      {startFrom && <div className="modal-helper schedule-prefill-note">A partir do agendamento: <strong>{SCHEDULE_KIND_LABELS[startFrom.kind]} · {startFrom.label}</strong></div>}
      <div className="mode-toggle">
        {activities.length > 0 && <button className={`mode-toggle-btn ${mode === "activity" ? "is-active" : ""}`} onClick={() => setMode("activity")}>Atividade planejada</button>}
        {services.length > 0 && <button className={`mode-toggle-btn ${mode === "service" ? "is-active" : ""}`} onClick={() => setMode("service")}>Prestação de serviço</button>}
        <button className={`mode-toggle-btn ${mode === "free" ? "is-active" : ""}`} onClick={() => setMode("free")}>Sessão livre</button>
      </div>

      {mode === "activity" && (
        <>
          <label className="field-label">Atividade</label>
          <select className="field-input" value={activityId} onChange={e => setActivityId(e.target.value)}>
            {activities.map(a => <option key={a.id} value={a.id}>{a.title} ({PRIORITIES[a.priority]?.label})</option>)}
          </select>
          {selectedActivity && (
            <div className="modal-helper">Unidade: <strong>{UNIT_DEFS.find(u => u.id === selectedActivity.unitId)?.name}</strong> · Planejado: <strong>{selectedActivity.plannedHours ? fmtH(selectedActivity.plannedHours) : "não definido"}</strong></div>
          )}
        </>
      )}

      {mode === "service" && (
        <>
          <label className="field-label">Serviço</label>
          <select className="field-input" value={serviceId} onChange={e => setServiceId(e.target.value)}>
            {services.map(s => <option key={s.id} value={s.id}>{s.name} ({s.category})</option>)}
          </select>
          {selectedService && (
            <div className="modal-helper">
              Valor/hora: <strong>{fmtBRLPrecise(selectedService.hourRate)}</strong>
              {serviceActivity && <> · Atividade: <strong>{serviceActivity.title}</strong></>}
            </div>
          )}
          <label className="field-label">Tempo planejado</label>
          <div className="hm-input">
            <div className="hm-field"><input type="number" min="0" className="field-input" value={hours} onChange={e => setHours(e.target.value)} /><span className="hm-suffix">h</span></div>
            <div className="hm-field"><input type="number" min="0" max="59" className="field-input" value={minutes} onChange={e => setMinutes(e.target.value)} /><span className="hm-suffix">min</span></div>
          </div>
          {plannedHours > 0 && selectedService && (
            <div className="vx-preview">
              <span className="vx-preview-label">RECEITA PREVISTA</span>
              <span className="vx-preview-value">{fmtBRL(plannedHours * selectedService.hourRate)}</span>
              <span className="vx-preview-sub">{fmtH(plannedHours)} × {fmtBRLPrecise(selectedService.hourRate)}/h</span>
            </div>
          )}
        </>
      )}

      {mode === "free" && (
        <>
          <label className="field-label">Unidade</label>
          <div className="unit-picker">
            {UNIT_DEFS.map(u => <button key={u.id} className={`unit-pick ${unitId === u.id ? "is-selected" : ""}`} style={{ "--u-color": u.color }} onClick={() => setUnitId(u.id)}><span className="unit-pick-dot" />{u.name}</button>)}
          </div>
          <label className="field-label">Descrição</label>
          <input className="field-input" value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Reunião de governança" />
          <label className="field-label">Tempo planejado</label>
          <div className="hm-input">
            <div className="hm-field"><input type="number" min="0" className="field-input" value={hours} onChange={e => setHours(e.target.value)} /><span className="hm-suffix">h</span></div>
            <div className="hm-field"><input type="number" min="0" max="59" className="field-input" value={minutes} onChange={e => setMinutes(e.target.value)} /><span className="hm-suffix">min</span></div>
          </div>
        </>
      )}

      {exceeds && <div className="field-warning"><AlertTriangle size={13} /> Acima do saldo disponível ({fmtH(available)})</div>}

      <button
        className="btn-primary modal-submit"
        disabled={mode === "activity" ? !activityId : mode === "service" ? (!serviceId || plannedHours <= 0) : (plannedHours <= 0 || !label.trim())}
        onClick={() => {
          if (mode === "activity") onStart(selectedActivity.unitId, selectedActivity.id, selectedActivity.title, selectedActivity.plannedHours);
          else if (mode === "service") handleServiceStart();
          else onStart(unitId, null, label.trim(), plannedHours);
        }}
      >
        <Play size={16} fill="currentColor" /> Dar play
      </button>
    </Modal>
  );
}

function StopConfirmModal({ session, elapsedSec, schedules, onEncerrar, onReagendar, onClose }) {
  const [reagendando, setReagendando] = useState(false);
  const [opcaoData, setOpcaoData] = useState("proxima");
  const [dataEscolhida, setDataEscolhida] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });

  // Próximo slot livre: percorre dias a partir de amanhã procurando horário sem conflito
  const proximaData = useMemo(() => {
    const duracao = session?.plannedHours || 1; // duração em horas
    const horaInicio = new Date(session?.startedAt || Date.now()).getHours();

    // Tenta até 30 dias à frente
    for (let d = 1; d <= 30; d++) {
      const candidato = new Date();
      candidato.setDate(candidato.getDate() + d);
      candidato.setHours(horaInicio, 0, 0, 0);
      const tsInicio = candidato.getTime();
      const tsFim = tsInicio + duracao * 3600000;

      // Verificar conflito com schedules existentes
      const conflito = (schedules || []).some(s => {
        if (s.done) return false;
        const sInicio = s.scheduledAt;
        const sFim = sInicio + (s.duration || 1) * 3600000;
        return tsInicio < sFim && tsFim > sInicio; // sobreposição
      });

      if (!conflito) return candidato;
    }
    // Fallback: amanhã mesmo horário
    const d = new Date(session?.startedAt || Date.now());
    d.setDate(d.getDate() + 1);
    return d;
  }, [session, schedules]);

  const handleReagendar = () => {
    const ts = opcaoData === "proxima"
      ? proximaData.getTime()
      : new Date(dataEscolhida).getTime();
    onReagendar(ts);
  };

  const diasAte = Math.round((proximaData.getTime() - Date.now()) / 86400000);

  return (
    <Modal onClose={onClose} title="Interromper sessão">
      <div className="stop-confirm-elapsed">
        <span className="vx-hero-label">TEMPO DECORRIDO</span>
        <span className="stop-confirm-clock">{fmtClock(elapsedSec)}</span>
      </div>

      {!reagendando ? (
        <div className="stop-confirm-btns">
          <button className="stop-confirm-btn stop-confirm-encerrar" onClick={onEncerrar}>
            <Square size={16} fill="currentColor" />
            <div>
              <span className="stop-confirm-btn-title">Encerrar</span>
              <span className="stop-confirm-btn-sub">Registrar sessão e finalizar</span>
            </div>
          </button>
          <button className="stop-confirm-btn stop-confirm-reagendar" onClick={() => setReagendando(true)}>
            <Calendar size={16} />
            <div>
              <span className="stop-confirm-btn-title">Reagendar</span>
              <span className="stop-confirm-btn-sub">Parar agora e remarcar para depois</span>
            </div>
          </button>
        </div>
      ) : (
        <>
          <span className="field-label">Quando reagendar?</span>
          <div className="cat-picker" style={{ marginBottom: 12 }}>
            <button className={`cat-pick ${opcaoData === "proxima" ? "is-selected" : ""}`} onClick={() => setOpcaoData("proxima")}>
              Mais próxima
            </button>
            <button className={`cat-pick ${opcaoData === "escolher" ? "is-selected" : ""}`} onClick={() => setOpcaoData("escolher")}>
              Escolher data
            </button>
          </div>

          {opcaoData === "proxima" && (
            <div className="stop-confirm-proxima panel-elevated">
              <span className="vx-hero-label">PRÓXIMO HORÁRIO LIVRE</span>
              <span className="stop-confirm-data">{fmtDateTime(proximaData.getTime())}</span>
              <span className="vx-hero-sub">
                {diasAte === 1 ? "Amanhã" : `Em ${diasAte} dias`} · sem conflito com a agenda
              </span>
            </div>
          )}

          {opcaoData === "escolher" && (
            <>
              <label className="field-label">Data e hora</label>
              <input type="datetime-local" className="field-input" value={dataEscolhida} onChange={e => setDataEscolhida(e.target.value)} />
            </>
          )}

          <div className="stop-confirm-reagendar-actions">
            <button className="btn-ghost-upload" onClick={() => setReagendando(false)}>← Voltar</button>
            <button className="btn-primary" onClick={handleReagendar}>
              <Calendar size={14} /> Confirmar reagendamento
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function OutcomeModal({ onClose, onChoose }) {
  return (
    <Modal onClose={onClose} title="Resultado da atividade">
      <p className="modal-helper">Essa sessão estava ligada a uma atividade. Como ela terminou?</p>
      <div className="outcome-buttons">
        <button className="outcome-btn success" onClick={() => onChoose("exito")}><Check size={18} /> Êxito</button>
        <button className="outcome-btn fail" onClick={() => onChoose("falha")}><X size={18} /> Falha</button>
      </div>
    </Modal>
  );
}

function TimeAnalyzeTab({ sessions, timeBank, closures, recoveries, onAddRecovery }) {
  const [period, setPeriod] = useState("total");
  const [showRecover, setShowRecover] = useState(false);
  const start = periodStart(period);

  const periodSessions = sessions.filter(s => s.endedAt && s.type !== "recuperacao" && s.endedAt >= start);
  const periodInvested = periodSessions.reduce((sum, s) => sum + s.actualHours, 0);
  const byUnit = useMemo(() => {
    const map = {}; UNIT_DEFS.forEach(u => map[u.id] = { hours: 0, count: 0 });
    periodSessions.forEach(s => { map[s.unitId].hours += s.actualHours; map[s.unitId].count += 1; });
    return map;
  }, [periodSessions]);

  return (
    <div className="sub-page">
      <PeriodTabs value={period} onChange={setPeriod} />

      <div className="metric-grid two-col">
        <MetricCard label="Investido no período" value={fmtH(periodInvested)} color="#7B9BC0" />
        <MetricCard label="Sessões no período" value={periodSessions.length} color="#C9A24B" />
      </div>

      <div className="unit-grid">
        {UNIT_DEFS.map(u => {
          const d = byUnit[u.id]; const pct = periodInvested > 0 ? (d.hours / periodInvested) * 100 : 0;
          return (
            <div className="unit-card panel-elevated" key={u.id} style={{ "--u-color": u.color }}>
              <div className="unit-card-top"><span className="unit-card-dot" /><span className="unit-card-name">{u.name}</span></div>
              <div className="unit-card-value">{fmtH(d.hours)}</div>
              <div className="unit-card-sub">{d.count} sessões · {pct.toFixed(0)}%</div>
              <div className="unit-card-bar"><div className="unit-card-bar-fill" style={{ width: `${pct}%` }} /></div>
            </div>
          );
        })}
      </div>

      <div className="section-label">Dívida de Tempo</div>
      <div className={`debt-hero panel-elevated ${timeBank.debt > 0 ? "has-debt" : "clear"}`}>
        <span className="debt-hero-label">DÍVIDA ATUAL</span>
        <span className="debt-hero-value">{fmtH(timeBank.debt)}</span>
        {timeBank.debt === 0 && <span className="debt-hero-clear"><Check size={13} /> Sem dívida pendente</span>}
      </div>
      <div className="metric-grid two-col">
        <MetricCard label="Perdido (total)" value={fmtH(timeBank.lostTotal)} color="#C9544B" />
        <MetricCard label="Recuperado (total)" value={fmtH(timeBank.recoveredTotal)} color="#5B8C6E" />
      </div>
      <button className="btn-primary full-width" onClick={() => setShowRecover(true)}><RotateCcw size={16} /> Registrar sessão de recuperação</button>

      {showRecover && <RecoveryModal maxDebt={timeBank.debt} onClose={() => setShowRecover(false)} onAdd={(h, n) => { onAddRecovery(h, n); setShowRecover(false); }} />}
    </div>
  );
}

function RecoveryModal({ maxDebt, onClose, onAdd }) {
  const [hours, setHours] = useState("1");
  const [note, setNote] = useState("");
  const num = parseFloat((hours || "0").replace(",", "."));
  return (
    <Modal onClose={onClose} title="Sessão de recuperação">
      <p className="modal-helper">Dívida atual: <strong>{fmtH(maxDebt)}</strong>.</p>
      <label className="field-label">Horas recuperadas</label>
      <input type="number" min="0" step="0.25" className="field-input" value={hours} onChange={e => setHours(e.target.value)} />
      <label className="field-label">Observação (opcional)</label>
      <input className="field-input" value={note} onChange={e => setNote(e.target.value)} placeholder="Ex: Compensação do fim de semana" />
      <button className="btn-primary modal-submit" disabled={!num || num <= 0} onClick={() => onAdd(num, note.trim())}><Check size={16} /> Registrar recuperação</button>
    </Modal>
  );
}

function MetricCard({ label, value, color, emphasize }) {
  return (
    <div className={`metric-card panel-elevated ${emphasize ? "is-emphasized" : ""}`} style={{ "--m-color": color }}>
      <span className="metric-card-label">{label}</span>
      <span className="metric-card-value">{value}</span>
    </div>
  );
}

/* ============================================================
   CASHBOX MODULE — Caixa de Dinheiro / Caixa de Tempo
   ============================================================ */

function CashboxModule({
  entries, fixedCosts, varCosts, activities, goals, timeBank, assets, onAdd, onUpdate, onDelete, onAddFixed, onUpdateFixed, onDeleteFixed, onAddVar, onUpdateVar, onDeleteVar,
  sessions, activeSession, nowTick, closures, recoveries, onUpdateActivity, onAddRecovery,
  recurringTimes, onAddRecurring, onUpdateRecurring, onDeleteRecurring,
}) {
  const [box, setBox] = useState("money");
  return (
    <div className="page">
      <h2 className="page-title">Caixa</h2>
      <p className="page-sub">Dois ativos, um só painel: capital financeiro e Capital-Tempo.</p>
      <div className="cashbox-toggle">
        <button className={`cashbox-toggle-btn ${box === "money" ? "is-active" : ""}`} onClick={() => setBox("money")}><Wallet size={16} /> Caixa de Dinheiro</button>
        <button className={`cashbox-toggle-btn ${box === "time" ? "is-active" : ""}`} onClick={() => setBox("time")}><Clock size={16} /> Caixa de Tempo</button>
      </div>
      {box === "money" && (
        <FinanceModule
          entries={entries} fixedCosts={fixedCosts} varCosts={varCosts} activities={activities} timeBank={timeBank} assets={assets} recurringTimes={recurringTimes}
          onAdd={onAdd} onUpdate={onUpdate} onDelete={onDelete} onAddFixed={onAddFixed} onUpdateFixed={onUpdateFixed} onDeleteFixed={onDeleteFixed}
          onAddVar={onAddVar} onUpdateVar={onUpdateVar} onDeleteVar={onDeleteVar}
        />
      )}
      {box === "time" && (
        <TimeModule
          activities={activities} goals={goals} sessions={sessions} activeSession={activeSession} timeBank={timeBank} nowTick={nowTick}
          closures={closures} recoveries={recoveries} onUpdateActivity={onUpdateActivity} onAddRecovery={onAddRecovery}
          recurringTimes={recurringTimes} onAddRecurring={onAddRecurring} onUpdateRecurring={onUpdateRecurring} onDeleteRecurring={onDeleteRecurring}
        />
      )}
    </div>
  );
}

/* ============================================================
   FINANCE MODULE — Fixo / Variável / Análise
   ============================================================ */

function FinanceModule({ entries, fixedCosts, varCosts, activities, timeBank, assets, recurringTimes, onAdd, onUpdate, onDelete, onAddFixed, onUpdateFixed, onDeleteFixed, onAddVar, onUpdateVar, onDeleteVar }) {
  const [sub, setSub] = useState("fixed");

  const monthSummary = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const monthStartTs = monthStart.getTime();
    const monthEndTs = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).getTime();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const inMonth = (ts) => ts >= monthStartTs && ts <= monthEndTs;

    let income = 0, expense = 0;
    entries.forEach(e => {
      const ts = e.scheduledAt || e.createdAt;
      if (!inMonth(ts)) return;
      const cat = FIN_CATEGORIES[e.category];
      if (cat.sign > 0) income += e.amount; else expense += e.amount;
    });
    varCosts.forEach(c => {
      const ts = c.scheduledAt || c.createdAt;
      if (inMonth(ts)) expense += c.amount;
    });
    fixedCosts.forEach(c => {
      if (c.active) expense += c.amount;
    });

    // Médias diária e semanal
    const incomeDaily = daysInMonth > 0 ? income / daysInMonth : 0;
    const incomeWeekly = incomeDaily * 7;
    const expenseDaily = daysInMonth > 0 ? expense / daysInMonth : 0;
    const expenseWeekly = expenseDaily * 7;

    return { income, expense, balance: income - expense, incomeDaily, incomeWeekly, expenseDaily, expenseWeekly };
  }, [entries, varCosts, fixedCosts]);

  return (
    <div className="sub-page">
      <div className="fin-summary-grid">
        <div className="fin-summary-item fin-income">
          <span className="vx-hero-label">RECEITAS DO MÊS</span>
          <span className="fin-summary-value pos-text">{fmtBRL(monthSummary.income)}</span>
          <div className="fin-summary-sub-row">
            <span className="fin-summary-sub">Semana ~{fmtBRL(monthSummary.incomeWeekly)}</span>
            <span className="fin-summary-sub">Dia ~{fmtBRL(monthSummary.incomeDaily)}</span>
          </div>
        </div>
        <div className="fin-summary-item fin-expense">
          <span className="vx-hero-label">DESPESAS DO MÊS</span>
          <span className="fin-summary-value neg-text">{fmtBRL(monthSummary.expense)}</span>
          <div className="fin-summary-sub-row">
            <span className="fin-summary-sub">Semana ~{fmtBRL(monthSummary.expenseWeekly)}</span>
            <span className="fin-summary-sub">Dia ~{fmtBRL(monthSummary.expenseDaily)}</span>
          </div>
        </div>
        <div className="fin-summary-item fin-balance">
          <span className="vx-hero-label">SALDO DO MÊS</span>
          <span className={`fin-summary-value ${monthSummary.balance >= 0 ? "pos-text" : "neg-text"}`}>{fmtBRL(monthSummary.balance)}</span>
          <div className="fin-summary-sub-row">
            <span className="fin-summary-sub">Semana ~{fmtBRL((monthSummary.balance / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()) * 7)}</span>
            <span className="fin-summary-sub">Dia ~{fmtBRL(monthSummary.balance / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate())}</span>
          </div>
        </div>
      </div>

      <SubTabs
        value={sub} onChange={setSub}
        items={[
          { id: "fixed", label: "Custo Fixo", icon: Wallet },
          { id: "variable", label: "Variável", icon: TrendingUp },
          { id: "analysis", label: "Análise", icon: PieChart },
        ]}
      />
      {sub === "fixed" && (
        <FixedCostTab
          fixedCosts={fixedCosts} entries={entries} varCosts={varCosts} assets={assets} recurringTimes={recurringTimes}
          onAdd={onAddFixed} onUpdate={onUpdateFixed} onDelete={onDeleteFixed} onAddEntry={onAdd} onUpdateEntry={onUpdate} onDeleteEntry={onDelete}
        />
      )}
      {sub === "variable" && <VariableCostTab varCosts={varCosts} activities={activities} onAdd={onAddVar} onUpdate={onUpdateVar} onDelete={onDeleteVar} />}
      {sub === "analysis" && <FinanceAnalysisTab entries={entries} fixedCosts={fixedCosts} varCosts={varCosts} activities={activities} timeBank={timeBank} />}
    </div>
  );
}

function FixedCostTab({ fixedCosts, entries, varCosts, assets, recurringTimes, onAdd, onUpdate, onDelete, onAddEntry, onUpdateEntry, onDeleteEntry }) {
  const [showAddRecurring, setShowAddRecurring] = useState(false);
  const [showAddEntry, setShowAddEntry] = useState(null); // "receita" | "despesa" | null
  const totalMonthly = fixedCosts.filter(c => c.active).reduce((s, c) => s + c.amount, 0);
  const monthKey = currentMonthKey();

  const cashEquity = useMemo(() => computeRdxEquity(entries, varCosts || [], fixedCosts), [entries, varCosts, fixedCosts]);

  const projectedCash = useMemo(() => {
    const now = Date.now();
    const monthEnd = new Date().setMonth(new Date().getMonth() + 1, 0);
    let pendingDues = 0;
    fixedCosts.forEach(c => {
      if (!c.active || (c.paidMonths || []).includes(monthKey)) return;
      pendingDues -= c.amount;
    });
    (varCosts || []).forEach(c => {
      if (c.status !== "pendente" || !c.scheduledAt) return;
      if (c.scheduledAt >= now && c.scheduledAt <= monthEnd) pendingDues -= c.amount;
    });
    entries.forEach(e => {
      if (e.status !== "pendente" || !e.scheduledAt) return;
      if (e.scheduledAt < now || e.scheduledAt > monthEnd) return;
      const cat = FIN_CATEGORIES[e.category];
      pendingDues += cat.sign > 0 ? e.amount : -e.amount;
    });
    const recurringImpact = remainingFinancialImpactThisMonth(recurringTimes);
    return cashEquity + pendingDues + recurringImpact;
  }, [cashEquity, fixedCosts, varCosts, entries, recurringTimes, monthKey]);

  const projectedDiff = projectedCash - cashEquity;

  // Faixa operacional para cor do projetado
  const projMonthGoal = idealEquityForMonth(currentGoalYear(), new Date().getMonth());
  const projCashMin = projMonthGoal * 0.10;
  const projCashIdeal = projMonthGoal * 0.15;
  const projCashMax = projMonthGoal * 0.20;
  const projColor = projectedCash < projCashMin ? "var(--red)" : projectedCash <= projCashMax ? "var(--green)" : "var(--amber)";
  const projBorderColor = projectedCash < projCashMin ? "var(--red)" : projectedCash <= projCashMax ? "var(--green)" : "var(--amber)";
  const projLabel = projectedCash < projCashMin ? "Abaixo do mínimo operacional" : projectedCash <= projCashMax ? "Dentro da faixa ideal" : "Acima do máximo — excedente";

  return (
    <div className="sub-page">
      <p className="page-sub">Custos recorrentes do fundador. A soma dos ativos forma o COF fixo mensal.</p>
      <div className="cof-total panel-elevated">
        <span className="cof-total-label">COF FIXO MENSAL</span>
        <span className="cof-total-value">{fmtBRL(totalMonthly)}</span>
      </div>

      <div className="cof-total panel-elevated" style={{ borderLeftColor: projBorderColor }}>
        <span className="cof-total-label">CAIXA PROJETADO LÍQUIDO (até o fim do mês)</span>
        <span className="cof-total-value" style={{ color: projColor }}>{fmtBRL(projectedCash)}</span>
        <span className="vx-hero-sub" style={{ color: projColor, fontWeight: 600 }}>{projLabel}</span>
        <span className="vx-hero-sub">
          Caixa atual {fmtBRL(cashEquity)} {projectedDiff >= 0 ? "+" : ""}{fmtBRL(projectedDiff)} entre vencimentos pendentes e recorrências restantes · Mín {fmtBRL(projCashMin)} · Ideal {fmtBRL(projCashIdeal)} · Máx {fmtBRL(projCashMax)}
        </span>
      </div>

      <button className="btn-primary full-width" onClick={() => setShowAddRecurring(true)}><Plus size={16} /> Novo custo recorrente</button>

      {fixedCosts.length === 0 ? <EmptyHint text="Nenhum custo recorrente cadastrado." /> : (
        <div className="ledger">
          {fixedCosts.map(c => {
            const paidThisMonth = (c.paidMonths || []).includes(monthKey);
            const dueDay = c.dueDay || 1;
            const due = fixedCostDueDate(dueDay);
            const label = !paidThisMonth ? dueLabel(due) : null;
            return (
              <div className="ledger-row fixedcost-row" key={c.id}>
                <div className="ledger-row-main">
                  <span className="ledger-dot" style={{ background: c.active ? "#C9544B" : "#3A3D44" }} />
                  <div className="ledger-row-text">
                    <span className="ledger-row-title">{c.name} · {c.subcategory}</span>
                    <span className="ledger-row-date">
                      {c.active ? "Ativo" : "Pausado"} · dia {dueDay}
                      {c.active && (paidThisMonth ? " · Pago este mês" : label ? ` · ${label.text}` : "")}
                    </span>
                  </div>
                </div>
                <div className="ledger-row-end">
                  <span className="ledger-row-amount neg">{fmtBRL(c.amount)}</span>
                  {c.active && (
                    <button
                      className={`btn-tiny ${paidThisMonth ? "is-paid" : label?.late ? "danger" : ""}`}
                      onClick={() => onUpdate(c.id, { paidMonths: paidThisMonth ? (c.paidMonths || []).filter(m => m !== monthKey) : [...(c.paidMonths || []), monthKey] })}
                    >
                      {paidThisMonth ? <><Check size={12} /> Pago</> : "Marcar pago"}
                    </button>
                  )}
                  <button className="btn-tiny" onClick={() => onUpdate(c.id, { active: !c.active })}>{c.active ? "Pausar" : "Ativar"}</button>
                  <button className="ledger-row-del" onClick={() => onDelete(c.id)}><X size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── BOTÕES LANÇAR — lado a lado ── */}
      <div className="fin-launch-row">
        <button className="fin-launch-btn fin-launch-despesa" onClick={() => setShowAddEntry("despesa")}>
          <Download size={18} /> LANÇAR DESPESA
        </button>
        <button className="fin-launch-btn fin-launch-receita" onClick={() => setShowAddEntry("receita")}>
          LANÇAR RECEITA <Upload size={18} />
        </button>
      </div>

      {/* ── EXTRATO UNIFICADO com filtros ── */}
      <ExtratoUnificado entries={entries} onUpdateEntry={onUpdateEntry} onDeleteEntry={onDeleteEntry} />

      {showAddRecurring && <AddFixedCostModal onClose={() => setShowAddRecurring(false)} onAdd={(c) => { onAdd(c); setShowAddRecurring(false); }} />}
      {showAddEntry && (
        <AddFinEntryModal
          initialGroup={showAddEntry}
          onClose={() => setShowAddEntry(null)}
          onAdd={(e) => { onAddEntry(e); setShowAddEntry(null); }}
        />
      )}
    </div>
  );
}

function AddFixedCostModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [subcategory, setSubcategory] = useState(COF_SUBCATS[0]);
  const [amount, setAmount] = useState("");
  const [dueDay, setDueDay] = useState("5");
  const [periodo, setPeriodo] = useState(30);
  const num = parseFloat((amount || "0").replace(",", "."));
  const dueDayNum = Math.min(31, Math.max(1, parseInt(dueDay || "1", 10)));
  const PERIODOS = [{ v: 1, l: "1d" }, { v: 7, l: "7d" }, { v: 15, l: "15d" }, { v: 30, l: "30d" }, { v: 45, l: "45d" }];
  const periodoLabel = { 1: "Diário", 7: "Semanal", 15: "Quinzenal", 30: "Mensal", 45: "45 dias" }[periodo] || `${periodo} dias`;
  return (
    <Modal onClose={onClose} title="Novo custo recorrente">
      <label className="field-label">Nome</label>
      <input className="field-input" placeholder="Ex: Aluguel" value={name} onChange={e => setName(e.target.value)} />
      <label className="field-label">Subcategoria</label>
      <select className="field-input" value={subcategory} onChange={e => setSubcategory(e.target.value)}>
        {COF_SUBCATS.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <label className="field-label">Valor (R$)</label>
      <input className="field-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />
      <label className="field-label">Periodicidade</label>
      <div className="periodo-picker">
        {PERIODOS.map(p => (
          <button key={p.v} className={`periodo-btn ${periodo === p.v ? "is-active" : ""}`} onClick={() => setPeriodo(p.v)}>
            {p.l}
          </button>
        ))}
      </div>
      <span className="vx-hero-sub">{periodoLabel} · recorrência a cada {periodo} dia{periodo > 1 ? "s" : ""}</span>
      {periodo === 30 && (
        <>
          <label className="field-label">Dia do mês para débito</label>
          <input type="number" min="1" max="31" className="field-input" value={dueDay} onChange={e => setDueDay(e.target.value)} placeholder="Ex: 5" />
        </>
      )}
      <button className="btn-primary modal-submit" disabled={!name.trim() || !num}
        onClick={() => onAdd({ name: name.trim(), subcategory, amount: num, dueDay: dueDayNum, periodo, paidMonths: [] })}>
        <Check size={16} /> Adicionar recorrente
      </button>
    </Modal>
  );
}

function ExtratoUnificado({ entries, onUpdateEntry, onDeleteEntry }) {
  const [filter, setFilter] = useState("tudo"); // "tudo" | "receita" | "despesa"
  const [expandedId, setExpandedId] = useState(null);

  const filtered = [...entries]
    .filter(e => {
      const cat = FIN_CATEGORIES[e.category];
      if (filter === "receita") return cat?.sign > 0;
      if (filter === "despesa") return cat?.sign < 0;
      return true;
    })
    .sort((a, b) => (b.scheduledAt || b.createdAt) - (a.scheduledAt || a.createdAt));

  return (
    <div className="extrato-wrap">
      <div className="extrato-header">
        <span className="section-label" style={{ margin: 0 }}>Extrato</span>
        <div className="extrato-filters">
          <button className={`extrato-filter-btn ${filter === "tudo" ? "is-active" : ""}`} onClick={() => setFilter("tudo")}>Tudo</button>
          <button className={`extrato-filter-btn extrato-filter-receita ${filter === "receita" ? "is-active" : ""}`} onClick={() => setFilter("receita")}>↑ Receita</button>
          <button className={`extrato-filter-btn extrato-filter-despesa ${filter === "despesa" ? "is-active" : ""}`} onClick={() => setFilter("despesa")}>↓ Despesa</button>
        </div>
      </div>

      {filtered.length === 0 ? <EmptyHint text="Nenhum lançamento encontrado." /> : (
        <div className="extrato-list">
          {filtered.map(e => {
            const cat = FIN_CATEGORIES[e.category];
            const isOpen = expandedId === e.id;
            const isReceita = cat?.sign > 0;
            const label = e.scheduledAt ? dueLabel(e.scheduledAt) : null;

            return (
              <div key={e.id} className={`extrato-item ${isReceita ? "extrato-receita" : "extrato-despesa"}`}>
                <button className="extrato-item-head" onClick={() => setExpandedId(isOpen ? null : e.id)}>
                  <div className="extrato-item-icon">{isReceita ? <Upload size={13} /> : <Download size={13} />}</div>
                  <div className="extrato-item-info">
                    <span className="extrato-item-title">{cat?.label}{e.note ? ` · ${e.note}` : ""}</span>
                    <span className="extrato-item-date">{fmtDate(e.scheduledAt || e.createdAt)}</span>
                  </div>
                  <span className={`extrato-item-amount ${isReceita ? "pos-text" : "neg-text"}`}>
                    {isReceita ? "+" : "-"}{fmtBRL(e.amount)}
                  </span>
                  {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </button>

                {isOpen && (
                  <div className="extrato-item-body">
                    <div className="extrato-detail-grid">
                      <div className="extrato-detail-row"><span className="extrato-detail-label">Categoria</span><span className="extrato-detail-val">{cat?.label}</span></div>
                      <div className="extrato-detail-row"><span className="extrato-detail-label">Grupo</span><span className="extrato-detail-val">{cat?.group}</span></div>
                      {e.note && <div className="extrato-detail-row"><span className="extrato-detail-label">Descrição</span><span className="extrato-detail-val">{e.note}</span></div>}
                      <div className="extrato-detail-row"><span className="extrato-detail-label">Valor</span><span className={`extrato-detail-val ${isReceita ? "pos-text" : "neg-text"}`}>{isReceita ? "+" : "-"}{fmtBRL(e.amount)}</span></div>
                      <div className="extrato-detail-row"><span className="extrato-detail-label">Data</span><span className="extrato-detail-val">{fmtDate(e.scheduledAt || e.createdAt)}</span></div>
                      <div className="extrato-detail-row">
                        <span className="extrato-detail-label">Status</span>
                        <span className={`extrato-detail-val ${e.status === "pago" ? "pos-text" : "neg-text"}`}>
                          {e.status === "pago" ? "✓ Pago" : label ? label.text : "Pendente"}
                        </span>
                      </div>
                      {e.subcategory && <div className="extrato-detail-row"><span className="extrato-detail-label">Subcategoria</span><span className="extrato-detail-val">{e.subcategory}</span></div>}
                    </div>
                    <div className="extrato-item-actions">
                      {e.status === "pendente" && (
                        <button className="btn-tiny" style={{ color: "#5B8C6E", borderColor: "#5B8C6E" }}
                          onClick={() => onUpdateEntry(e.id, { status: "pago" })}>
                          <Check size={12} /> Marcar como pago
                        </button>
                      )}
                      <button className="btn-tiny" style={{ color: "var(--red)", borderColor: "var(--red)" }}
                        onClick={() => { onDeleteEntry(e.id); setExpandedId(null); }}>
                        <X size={12} /> Excluir
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AddFinEntryModal({ initialGroup, onClose, onAdd }) {
  const receitaCats = Object.entries(FIN_CATEGORIES).filter(([k, v]) => v.sign > 0 && k !== "cof");
  const despesaCats = Object.entries(FIN_CATEGORIES).filter(([k, v]) => v.sign < 0 && k !== "cof");
  const defaultCat = initialGroup === "receita" ? receitaCats[0]?.[0] : initialGroup === "despesa" ? despesaCats[0]?.[0] : "entrada_aporte";

  const [category, setCategory] = useState(defaultCat || "entrada_aporte");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("pago");
  const numAmount = parseFloat((amount || "0").replace(",", "."));

  const isReceita = FIN_CATEGORIES[category]?.sign > 0;
  const catsToShow = initialGroup === "receita" ? receitaCats : initialGroup === "despesa" ? despesaCats : Object.entries(FIN_CATEGORIES).filter(([k]) => k !== "cof");
  const title = initialGroup === "receita" ? "Lançar Receita" : initialGroup === "despesa" ? "Lançar Despesa" : "Novo lançamento";

  return (
    <Modal onClose={onClose} title={title}>
      <label className="field-label">Categoria</label>
      <div className="cat-picker">
        {catsToShow.map(([k, v]) => (
          <button key={k} className={`cat-pick ${category === k ? "is-selected" : ""}`} onClick={() => setCategory(k)}>{v.label}</button>
        ))}
      </div>
      <label className="field-label">Valor (R$)</label>
      <input className="field-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" autoFocus />
      <label className="field-label">Data</label>
      <input type="date" className="field-input" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
      <label className="field-label">Status</label>
      <div className="cat-picker">
        <button className={`cat-pick ${status === "pago" ? "is-selected" : ""}`} onClick={() => setStatus("pago")}>Pago</button>
        <button className={`cat-pick ${status === "pendente" ? "is-selected" : ""}`} onClick={() => setStatus("pendente")}>Pendente</button>
      </div>
      <label className="field-label">Observação (opcional)</label>
      <input className="field-input" value={note} onChange={e => setNote(e.target.value)} />
      <button
        className="btn-primary modal-submit" disabled={!numAmount}
        style={{ background: isReceita ? "#5B8C6E" : "#C9544B" }}
        onClick={() => onAdd({ category, amount: numAmount, note, scheduledAt: new Date(scheduledAt).getTime(), status })}
      ><Check size={16} /> Lançar {isReceita ? "receita" : "despesa"}</button>
    </Modal>
  );
}

function VariableCostTab({ varCosts, activities, onAdd, onUpdate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const total = varCosts.reduce((s, c) => s + c.amount, 0);

  return (
    <div className="sub-page">
      <p className="page-sub">Custos ligados à execução de cada atividade.</p>
      <div className="cof-total panel-elevated">
        <span className="cof-total-label">CUSTO VARIÁVEL TOTAL</span>
        <span className="cof-total-value">{fmtBRL(total)}</span>
      </div>
      <button className="btn-primary full-width" onClick={() => setShowAdd(true)}><Plus size={16} /> Novo custo variável</button>
      {varCosts.length === 0 ? <EmptyHint text="Nenhum custo variável registrado." /> : (
        <div className="ledger">
          {varCosts.map(c => {
            const act = activities.find(a => a.id === c.activityId);
            const dest = FIN_VARIABLE_DEST[c.destination];
            const label = c.scheduledAt && c.status === "pendente" ? dueLabel(c.scheduledAt) : null;
            return (
              <div className="ledger-row fin-row-expense" key={c.id}>
                <div className="ledger-row-main">
                  <span className="ledger-dot" style={{ background: dest?.color }} />
                  <div className="ledger-row-text">
                    <span className="ledger-row-title">{act ? act.title : c.note || "Custo variável"}</span>
                    <span className="ledger-row-date">
                      {dest?.label} · {fmtDate(c.scheduledAt || c.createdAt)}
                      {c.status && ` · ${c.status === "pago" ? "Pago" : label ? label.text : "Pendente"}`}
                    </span>
                  </div>
                </div>
                <div className="ledger-row-end">
                  <span className="ledger-row-amount neg">-{fmtBRL(c.amount)}</span>
                  {c.status === "pendente" && onUpdate && <button className="btn-tiny is-paid-toggle" onClick={() => onUpdate(c.id, { status: "pago" })}><Check size={12} /> Pago</button>}
                  <button className="ledger-row-del" onClick={() => onDelete(c.id)}><X size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {showAdd && <AddVarCostModal activities={activities} onClose={() => setShowAdd(false)} onAdd={(c) => { onAdd(c); setShowAdd(false); }} />}
    </div>
  );
}

function AddVarCostModal({ activities, onClose, onAdd }) {
  const [activityId, setActivityId] = useState(activities[0]?.id || "");
  const [destination, setDestination] = useState("kofen");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("pago");
  const num = parseFloat((amount || "0").replace(",", "."));

  return (
    <Modal onClose={onClose} title="Novo custo variável">
      {activities.length > 0 && (
        <>
          <label className="field-label">Atividade (opcional)</label>
          <select className="field-input" value={activityId} onChange={e => setActivityId(e.target.value)}>
            <option value="">Nenhuma</option>
            {activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        </>
      )}
      <label className="field-label">Destino</label>
      <div className="cat-picker">
        {Object.entries(FIN_VARIABLE_DEST).map(([k, v]) => (
          <button key={k} className={`cat-pick ${destination === k ? "is-selected" : ""}`} style={{ borderColor: destination === k ? v.color : undefined, color: destination === k ? v.color : undefined }} onClick={() => setDestination(k)}>{v.label}</button>
        ))}
      </div>
      <label className="field-label">Valor (R$)</label>
      <input className="field-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />
      <label className="field-label">Data</label>
      <input type="date" className="field-input" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
      <label className="field-label">Status</label>
      <div className="cat-picker">
        <button className={`cat-pick ${status === "pago" ? "is-selected" : ""}`} onClick={() => setStatus("pago")}>Pago</button>
        <button className={`cat-pick ${status === "pendente" ? "is-selected" : ""}`} onClick={() => setStatus("pendente")}>Pendente</button>
      </div>
      <label className="field-label">Observação (opcional)</label>
      <input className="field-input" value={note} onChange={e => setNote(e.target.value)} />
      <button
        className="btn-primary modal-submit" disabled={!num}
        onClick={() => onAdd({ activityId: activityId || null, destination, amount: num, note: note.trim(), scheduledAt: new Date(scheduledAt).getTime(), status })}
      ><Check size={16} /> Adicionar</button>
    </Modal>
  );
}

/* ============================================================
   ASSETS TAB — Patrimônio Material
   ============================================================ */

/* ============================================================
   PATRIMONY MODULE — Equipamento / Insumo / Produto
   ============================================================ */

/* ============================================================
   SERVICES MODULE — catálogo de serviços prestados
   ============================================================ */

const SERVICE_CATEGORIES = ["Garçom", "Vendas", "Desenvolvimento Web", "Desenvolvimento de Software", "Outro"];

function ServicesModule({ services, activities, sessions, onAdd, onUpdate, onDelete, onLaunchRevenue }) {
  const [showAdd, setShowAdd] = useState(false);
  const [launchingId, setLaunchingId] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const hoursForService = (service) => {
    return (service.activityIds || []).reduce((sum, actId) => {
      const actSessions = sessions.filter(s => s.activityId === actId);
      return sum + actSessions.reduce((s, x) => s + x.actualHours, 0);
    }, 0);
  };

  return (
    <div className="patrimony-body">
      <p className="page-sub">Serviços que você presta, vinculados às atividades que medem o tempo investido em cada um.</p>
      <button className="btn-primary full-width" onClick={() => setShowAdd(true)}><Plus size={16} /> Novo serviço</button>

      {services.length === 0 ? <EmptyHint text="Nenhum serviço cadastrado ainda." /> : (
        <div className="ledger">
          {services.map(s => {
            const hours = hoursForService(s);
            const billed = hours * s.hourRate;
            const linkedActs = activities.filter(a => (s.activityIds || []).includes(a.id));
            return (
              <div className="ledger-row service-row" key={s.id}>
                <div className="ledger-row-main">
                  <span className="ledger-dot" style={{ background: "#7B9BC0" }} />
                  <div className="ledger-row-text">
                    <span className="ledger-row-title">{s.name} · {s.category}</span>
                    <span className="ledger-row-date">
                      {fmtBRLPrecise(s.hourRate)}/h · {fmtH(hours)} investidas · {linkedActs.length} atividade{linkedActs.length !== 1 ? "s" : ""} vinculada{linkedActs.length !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
                <div className="ledger-row-end">
                  <span className="ledger-row-amount pos">{fmtBRL(billed)}</span>
                  <button className="btn-tiny" onClick={() => setEditingId(s.id)}>Vincular atividades</button>
                  <button className="btn-tiny is-paid-toggle" onClick={() => setLaunchingId(s.id)} disabled={billed <= 0}>Lançar receita</button>
                  <button className="ledger-row-del" onClick={() => onDelete(s.id)}><X size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && (
        <AddServiceModal
          activities={activities}
          onClose={() => setShowAdd(false)}
          onAdd={(s) => { onAdd(s); setShowAdd(false); }}
        />
      )}
      {editingId && (
        <EditServiceActivitiesModal
          service={services.find(s => s.id === editingId)}
          activities={activities}
          onClose={() => setEditingId(null)}
          onSave={(activityIds) => { onUpdate(editingId, { activityIds }); setEditingId(null); }}
        />
      )}
      {launchingId && (
        <LaunchRevenueModal
          service={services.find(s => s.id === launchingId)}
          suggestedAmount={hoursForService(services.find(s => s.id === launchingId) || { activityIds: [] }) * (services.find(s => s.id === launchingId)?.hourRate || 0)}
          onClose={() => setLaunchingId(null)}
          onLaunch={(amount) => { onLaunchRevenue(launchingId, amount); setLaunchingId(null); }}
        />
      )}
    </div>
  );
}

function AddServiceModal({ activities, onClose, onAdd }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(SERVICE_CATEGORIES[0]);
  const [hourRate, setHourRate] = useState("");
  const [activityIds, setActivityIds] = useState([]);

  const nRate = parseFloat((hourRate || "0").replace(",", "."));
  const canSave = name.trim() && nRate > 0;

  const toggleActivity = (id) => setActivityIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <Modal onClose={onClose} title="Novo serviço">
      <label className="field-label">Nome do serviço</label>
      <input className="field-input" placeholder="Ex: Garçom freelance, Desenvolvimento de site" value={name} onChange={e => setName(e.target.value)} />

      <label className="field-label">Categoria</label>
      <select className="field-input" value={category} onChange={e => setCategory(e.target.value)}>
        {SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>

      <label className="field-label">Valor cobrado por hora (R$)</label>
      <input className="field-input" inputMode="decimal" value={hourRate} onChange={e => setHourRate(e.target.value)} placeholder="0,00" />

      {activities.length > 0 ? (
        <>
          <label className="field-label">Atividades vinculadas (puxam o tempo investido)</label>
          <div className="service-activity-picker">
            {activities.map(a => (
              <button key={a.id} className={`weekday-pick service-activity-pick ${activityIds.includes(a.id) ? "is-selected" : ""}`} onClick={() => toggleActivity(a.id)}>{a.title}</button>
            ))}
          </div>
        </>
      ) : (
        <EmptyHint text="Nenhuma atividade cadastrada ainda. Você pode vincular depois." />
      )}

      <button
        className="btn-primary modal-submit" disabled={!canSave}
        onClick={() => onAdd({ name: name.trim(), category, hourRate: nRate, activityIds })}
      ><Check size={16} /> Adicionar</button>
    </Modal>
  );
}

function EditServiceActivitiesModal({ service, activities, onClose, onSave }) {
  const [activityIds, setActivityIds] = useState(service?.activityIds || []);
  const toggleActivity = (id) => setActivityIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  if (!service) return null;

  return (
    <Modal onClose={onClose} title={`Vincular atividades · ${service.name}`}>
      <p className="page-sub">As horas investidas nas atividades selecionadas entram automaticamente no cálculo de receita deste serviço.</p>
      {activities.length === 0 ? (
        <EmptyHint text="Nenhuma atividade cadastrada ainda. Crie uma em Objetivos primeiro." />
      ) : (
        <div className="service-activity-picker">
          {activities.map(a => (
            <button key={a.id} className={`weekday-pick service-activity-pick ${activityIds.includes(a.id) ? "is-selected" : ""}`} onClick={() => toggleActivity(a.id)}>{a.title}</button>
          ))}
        </div>
      )}
      <button className="btn-primary modal-submit" onClick={() => onSave(activityIds)}><Check size={16} /> Salvar vínculo</button>
    </Modal>
  );
}

function LaunchRevenueModal({ service, suggestedAmount, onClose, onLaunch }) {
  const [amount, setAmount] = useState(() => suggestedAmount.toFixed(2).replace(".", ","));
  const num = parseFloat((amount || "0").replace(",", "."));

  if (!service) return null;

  return (
    <Modal onClose={onClose} title={`Lançar receita · ${service.name}`}>
      <p className="page-sub">Valor sugerido com base nas horas já investidas × valor por hora do serviço. Você pode ajustar antes de lançar.</p>
      <label className="field-label">Valor a lançar (R$)</label>
      <input className="field-input" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" />
      <button className="btn-primary modal-submit" disabled={!(num > 0)} onClick={() => onLaunch(num)}><Check size={16} /> Lançar como receita</button>
    </Modal>
  );
}

function PatrimonyModule({ assets, inventoryItems, onAddAsset, onUpdateAsset, onDeleteAsset, onAddInventory, onUpdateInventory, onDeleteInventory, onSellInventory }) {
  const [sub, setSub] = useState("equipment");
  return (
    <div className="patrimony-body">
      <SubTabs
        value={sub} onChange={setSub}
        items={[
          { id: "equipment", label: "Equipamento", icon: Layers },
          { id: "insumo", label: "Insumo", icon: Package },
          { id: "produto", label: "Produto", icon: Wallet },
        ]}
      />
      {sub === "equipment" && <EquipmentTab assets={assets} onAdd={onAddAsset} onUpdate={onUpdateAsset} onDelete={onDeleteAsset} />}
      {sub === "insumo" && (
        <InventoryTab
          kind="insumo" items={inventoryItems.filter(i => i.kind === "insumo")}
          onAdd={onAddInventory} onUpdate={onUpdateInventory} onDelete={onDeleteInventory} onSell={onSellInventory}
        />
      )}
      {sub === "produto" && (
        <InventoryTab
          kind="produto" items={inventoryItems.filter(i => i.kind === "produto")}
          onAdd={onAddInventory} onUpdate={onUpdateInventory} onDelete={onDeleteInventory} onSell={onSellInventory}
        />
      )}
    </div>
  );
}

/* ============================================================
   EQUIPMENT TAB — equipamentos e bens individuais
   ============================================================ */

function EquipmentTab({ assets, onAdd, onUpdate, onDelete }) {
  const [showAdd, setShowAdd] = useState(false);
  const totalValue = computeAssetsValue(assets);

  return (
    <div className="sub-page">
      <p className="page-sub">Equipamentos e bens individuais. Contam no Equity do Histórico pelo preço de usado — o valor conservador de revenda.</p>
      <div className="cof-total panel-elevated assets-total">
        <span className="cof-total-label">PATRIMÔNIO MATERIAL (PREÇO DE USADO)</span>
        <span className="cof-total-value">{fmtBRL(totalValue)}</span>
      </div>

      <button className="btn-primary full-width" onClick={() => setShowAdd(true)}><Plus size={16} /> Novo item de patrimônio</button>

      {assets.length === 0 ? <EmptyHint text="Nenhum item de patrimônio cadastrado." /> : (
        <div className="ledger">
          {assets.map(a => {
            const gl = assetGainLoss(a);
            const resaleLoss = assetResaleLoss(a);
            return (
              <div className="ledger-row asset-row" key={a.id}>
                <div className="ledger-row-main">
                  <span className="ledger-dot" style={{ background: a.condition === "novo" ? "#5B8C6E" : "#C9A24B" }} />
                  <div className="ledger-row-text">
                    <span className="ledger-row-title">{a.name} · {a.condition === "novo" ? "Comprado novo" : "Comprado usado"}</span>
                    <span className="ledger-row-date">
                      Pago {fmtBRL(a.paidPrice)} · Novo {fmtBRL(a.newPrice)} · Usado {fmtBRL(a.usedPrice)}
                    </span>
                    <span className="ledger-row-date">
                      {gl.label}: <span className={gl.value >= 0 ? "pos-text" : "neg-text"}>{fmtBRL(gl.value)}</span>
                      {" · "}Perda estimada na revenda: <span className={resaleLoss > 0 ? "neg-text" : "pos-text"}>{fmtBRL(resaleLoss)}</span>
                    </span>
                  </div>
                </div>
                <div className="ledger-row-end">
                  <span className="ledger-row-amount neg">{fmtBRL(a.usedPrice)}</span>
                  <button className="ledger-row-del" onClick={() => onDelete(a.id)}><X size={14} /></button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAdd && <AddAssetModal onClose={() => setShowAdd(false)} onAdd={(a) => { onAdd(a); setShowAdd(false); }} />}
    </div>
  );
}

function AddAssetModal({ onClose, onAdd }) {
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("novo");
  const [newPrice, setNewPrice] = useState("");
  const [usedPrice, setUsedPrice] = useState("");
  const [paidPrice, setPaidPrice] = useState("");

  const nNew = parseFloat((newPrice || "0").replace(",", "."));
  const nUsed = parseFloat((usedPrice || "0").replace(",", "."));
  const nPaid = parseFloat((paidPrice || "0").replace(",", "."));
  const canSave = name.trim() && nNew > 0 && nUsed > 0 && nPaid >= 0;

  return (
    <Modal onClose={onClose} title="Novo item de patrimônio">
      <label className="field-label">Nome do item</label>
      <input className="field-input" placeholder="Ex: Notebook Dell, Câmera Sony" value={name} onChange={e => setName(e.target.value)} />

      <label className="field-label">Comprado</label>
      <div className="cat-picker">
        <button className={`cat-pick ${condition === "novo" ? "is-selected" : ""}`} onClick={() => setCondition("novo")}>Novo</button>
        <button className={`cat-pick ${condition === "usado" ? "is-selected" : ""}`} onClick={() => setCondition("usado")}>Usado</button>
      </div>

      <label className="field-label">Preço de novo (referência de tabela)</label>
      <input className="field-input" inputMode="decimal" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="0,00" />

      <label className="field-label">Preço de usado (referência de mercado)</label>
      <input className="field-input" inputMode="decimal" value={usedPrice} onChange={e => setUsedPrice(e.target.value)} placeholder="0,00" />

      <label className="field-label">Valor que você pagou de fato</label>
      <input className="field-input" inputMode="decimal" value={paidPrice} onChange={e => setPaidPrice(e.target.value)} placeholder="0,00" />

      <span className="vx-hero-sub">O Equity conta este item pelo preço de usado — o valor conservador, de revenda.</span>

      <button
        className="btn-primary modal-submit" disabled={!canSave}
        onClick={() => onAdd({ name: name.trim(), condition, newPrice: nNew, usedPrice: nUsed, paidPrice: nPaid })}
      ><Check size={16} /> Adicionar</button>
    </Modal>
  );
}

/* ============================================================
   INVENTORY TAB — Insumo / Produto (gestão de estoque)
   ============================================================ */

function InventoryTab({ kind, items, onAdd, onUpdate, onDelete, onSell }) {
  const [showAdd, setShowAdd] = useState(false);
  const [sellingId, setSellingId] = useState(null);
  const isProduto = kind === "produto";

  const totalStockValue = items.reduce((s, i) => s + i.quantity * i.marketPrice, 0);
  const totalUnits = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="sub-page">
      <p className="page-sub">
        {isProduto
          ? "Produtos já prontos para venda. Vender reduz o estoque e lança a receita automaticamente no Caixa de Dinheiro."
          : "Matéria-prima e insumos em estoque, usados internamente — sem preço de venda."}
      </p>
      <div className="metric-grid two-col">
        <MetricCard label="Itens em estoque" value={totalUnits.toLocaleString("pt-BR")} color="#7B9BC0" />
        <MetricCard label="Valor em estoque (mercado)" value={fmtBRL(totalStockValue)} color="#C9A24B" />
      </div>

      <button className="btn-primary full-width" onClick={() => setShowAdd(true)}><Plus size={16} /> Novo {isProduto ? "produto" : "insumo"}</button>

      {items.length === 0 ? <EmptyHint text={`Nenhum ${isProduto ? "produto" : "insumo"} cadastrado.`} /> : (
        <div className="ledger">
          {items.map(i => (
            <div className="ledger-row inventory-row" key={i.id}>
              <div className="ledger-row-main">
                <span className="ledger-dot" style={{ background: i.quantity > 0 ? "#5B8C6E" : "#C9544B" }} />
                <div className="ledger-row-text">
                  <span className="ledger-row-title">{i.name} · {i.quantity} {i.quantity === 1 ? "unidade" : "unidades"}</span>
                  <span className="ledger-row-date">
                    Mercado {fmtBRL(i.marketPrice)}{isProduto ? ` · Venda ${fmtBRL(i.salePrice)}` : ""}
                  </span>
                </div>
              </div>
              <div className="ledger-row-end">
                <span className="ledger-row-amount">{fmtBRL(i.quantity * i.marketPrice)}</span>
                {isProduto && i.quantity > 0 && (
                  <button className="btn-tiny is-paid-toggle" onClick={() => setSellingId(i.id)}>Vender</button>
                )}
                <button className="ledger-row-del" onClick={() => onDelete(i.id)}><X size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <AddInventoryItemModal
          kind={kind}
          onClose={() => setShowAdd(false)}
          onAdd={(item) => { onAdd({ ...item, kind }); setShowAdd(false); }}
        />
      )}
      {sellingId && (
        <SellInventoryModal
          item={items.find(i => i.id === sellingId)}
          onClose={() => setSellingId(null)}
          onSell={(qty) => { onSell(sellingId, qty); setSellingId(null); }}
        />
      )}
    </div>
  );
}

function AddInventoryItemModal({ kind, onClose, onAdd }) {
  const isProduto = kind === "produto";
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [marketPrice, setMarketPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");

  const nQty = parseInt(quantity || "0", 10);
  const nMarket = parseFloat((marketPrice || "0").replace(",", "."));
  const nSale = parseFloat((salePrice || "0").replace(",", "."));
  const canSave = name.trim() && nQty >= 0 && nMarket > 0 && (!isProduto || nSale > 0);

  return (
    <Modal onClose={onClose} title={`Novo ${isProduto ? "produto" : "insumo"}`}>
      <label className="field-label">Nome</label>
      <input className="field-input" placeholder={isProduto ? "Ex: Caixa montada, Kit pronto" : "Ex: Parafuso M4, Tecido azul"} value={name} onChange={e => setName(e.target.value)} />

      <label className="field-label">Quantidade disponível</label>
      <input type="number" min="0" className="field-input" value={quantity} onChange={e => setQuantity(e.target.value)} />

      <label className="field-label">Preço de mercado (custo de compra, por unidade)</label>
      <input className="field-input" inputMode="decimal" value={marketPrice} onChange={e => setMarketPrice(e.target.value)} placeholder="0,00" />

      {isProduto && (
        <>
          <label className="field-label">Preço de venda (por unidade)</label>
          <input className="field-input" inputMode="decimal" value={salePrice} onChange={e => setSalePrice(e.target.value)} placeholder="0,00" />
        </>
      )}

      <button
        className="btn-primary modal-submit" disabled={!canSave}
        onClick={() => onAdd({ name: name.trim(), quantity: nQty, marketPrice: nMarket, salePrice: isProduto ? nSale : 0 })}
      ><Check size={16} /> Adicionar</button>
    </Modal>
  );
}

function SellInventoryModal({ item, onClose, onSell }) {
  const [qty, setQty] = useState("1");
  const nQty = parseInt(qty || "0", 10);
  const canSell = item && nQty > 0 && nQty <= item.quantity;
  const total = item ? nQty * item.salePrice : 0;

  if (!item) return null;

  return (
    <Modal onClose={onClose} title={`Vender ${item.name}`}>
      <label className="field-label">Quantidade vendida (disponível: {item.quantity})</label>
      <input type="number" min="1" max={item.quantity} className="field-input" value={qty} onChange={e => setQty(e.target.value)} />

      <div className="vx-preview">
        <span className="vx-preview-label">RECEITA GERADA</span>
        <span className="vx-preview-value">{fmtBRL(total)}</span>
        <span className="vx-preview-sub">{nQty} × {fmtBRL(item.salePrice)} — lançado automaticamente no Caixa de Dinheiro</span>
      </div>

      <button className="btn-primary modal-submit" disabled={!canSell} onClick={() => onSell(nQty)}><Check size={16} /> Confirmar venda</button>
    </Modal>
  );
}

function FinanceAnalysisTab({ entries, fixedCosts, varCosts, activities, timeBank }) {
  const [period, setPeriod] = useState("total");
  const start = periodStart(period);

  const periodEntries = entries.filter(e => e.createdAt >= start);
  const periodVar = varCosts.filter(c => c.createdAt >= start);
  const fixedActive = fixedCosts.filter(c => c.active).reduce((s, c) => s + c.amount, 0);

  let entrada = 0, saidaHolding = 0, saidaKofen = 0;
  periodEntries.forEach(e => {
    if (e.category === "entrada_aporte" || e.category === "entrada_retro") entrada += e.amount;
    if (e.category === "saida_holding") saidaHolding += e.amount;
    if (e.category === "saida_kofen") saidaKofen += e.amount;
  });
  const varByDest = { rdx: 0, kofen: 0, holding: 0 };
  periodVar.forEach(c => { varByDest[c.destination] = (varByDest[c.destination] || 0) + c.amount; });
  const varTotal = Object.values(varByDest).reduce((a, b) => a + b, 0);
  const totalOut = saidaHolding + saidaKofen + varTotal + fixedActive;

  const byActivity = useMemo(() => {
    const map = {};
    periodVar.forEach(c => {
      const key = c.activityId || "sem_atividade";
      if (!map[key]) map[key] = 0;
      map[key] += c.amount;
    });
    return map;
  }, [periodVar]);

  return (
    <div className="sub-page">
      <PeriodTabs value={period} onChange={setPeriod} />

      <div className="metric-grid two-col">
        <MetricCard label="Entradas" value={fmtBRL(entrada)} color="#5B8C6E" />
        <MetricCard label="Saídas totais" value={fmtBRL(totalOut)} color="#C9544B" />
      </div>

      <div className="section-label">Para onde foi cada centavo</div>
      <div className="alloc-bars panel-elevated">
        <AllocRow label="COF fixo" value={fixedActive} total={totalOut} color="#C9544B" />
        <AllocRow label="Kofen (saída)" value={saidaKofen} total={totalOut} color="#7B9BC0" />
        <AllocRow label="Holding (saída)" value={saidaHolding} total={totalOut} color="#5B8C6E" />
        <AllocRow label="Variável → RDX" value={varByDest.rdx} total={totalOut} color="#C9A24B" />
        <AllocRow label="Variável → Kofen" value={varByDest.kofen} total={totalOut} color="#7B9BC0" />
        <AllocRow label="Variável → Holding" value={varByDest.holding} total={totalOut} color="#5B8C6E" />
      </div>

      <div className="section-label">Por atividade (custo variável)</div>
      {Object.keys(byActivity).length === 0 ? <EmptyHint text="Nenhum custo variável no período." /> : (
        <div className="ledger">
          {Object.entries(byActivity).map(([key, amount]) => {
            const act = activities.find(a => a.id === key);
            return (
              <div className="ledger-row" key={key}>
                <div className="ledger-row-text"><span className="ledger-row-title">{act ? act.title : "Sem atividade vinculada"}</span></div>
                <span className="ledger-row-amount neg">{fmtBRL(amount)}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="section-label">Capital-Tempo correlato</div>
      <div className="metric-grid two-col">
        <MetricCard label="Horas investidas (total)" value={fmtH(timeBank.investedTotal)} color="#7B9BC0" />
        <MetricCard label="Dívida de tempo" value={fmtH(timeBank.debt)} color="#C9544B" emphasize={timeBank.debt > 0} />
      </div>
      <p className="page-sub">Correlação detalhada entre caixa e tempo investido por unidade está prevista para uma próxima versão.</p>
    </div>
  );
}

function AllocRow({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="alloc-row">
      <span className="alloc-row-label">{label}</span>
      <div className="alloc-row-track"><div className="alloc-row-fill" style={{ width: `${pct}%`, background: color }} /></div>
      <span className="alloc-row-pct">{fmtBRL(value)}</span>
    </div>
  );
}

/* ============================================================
   HISTORY MODULE
   ============================================================ */

function HistoryModule({ activities, goals, sessions, varCosts, finEntries, fixedCosts, assets, timeBank }) {
  const [sub, setSub] = useState("executivo");
  return (
    <div className="page page-wide">
      <h2 className="page-title">Histórico</h2>
      <SubTabs
        value={sub} onChange={setSub}
        items={[
          { id: "executivo", label: "Executivo", icon: Target },
          { id: "financeiro", label: "Financeiro", icon: Wallet },
          { id: "patrimonial", label: "Patrimonial", icon: Layers },
        ]}
      />
      {sub === "executivo" && (
        <HistoryTab activities={activities} goals={goals} sessions={sessions} varCosts={varCosts} finEntries={finEntries} fixedCosts={fixedCosts} assets={assets} timeBank={timeBank} />
      )}
      {sub === "financeiro" && (
        <HistoryFinanceiroTab finEntries={finEntries} varCosts={varCosts} fixedCosts={fixedCosts} />
      )}
      {sub === "patrimonial" && (
        <HistoryPatrimonialTab assets={assets} finEntries={finEntries} varCosts={varCosts} fixedCosts={fixedCosts} />
      )}
    </div>
  );
}

function HistoryTab({ activities, goals, sessions, varCosts, finEntries, fixedCosts, assets, timeBank }) {
  const [openId, setOpenId] = useState(null);
  const done = activities.filter(a => a.status === "concluída_êxito" || a.status === "concluída_falha");
  const successCount = done.filter(a => a.status === "concluída_êxito").length;
  const precision = done.length > 0 ? (successCount / done.length) * 100 : null;

  const precisionColor = precision === null ? "#6B6962" : precision >= 70 ? "#5B8C6E" : precision >= 40 ? "#C9A24B" : "#C9544B";

  /* ---------- Valuation (Saldo Executivo) / Equity ---------- */
  const goalYear = currentGoalYear();
  const annualGoal = currentAnnualGoal();
  const hourValue = currentHourValue();
  const nextGoal = nextGoalProjection();
  const valuation = timeBank.investedTotal * hourValue;

  const cashEquity = useMemo(() => computeRdxEquity(finEntries, varCosts, fixedCosts), [finEntries, varCosts, fixedCosts]);
  const assetsValue = useMemo(() => computeAssetsValue(assets), [assets]);
  const equity = cashEquity + assetsValue;

  return (
    <div className="sub-page">
      <div className="precision-hero panel-elevated" style={{ "--p-color": precisionColor }}>
        <span className="precision-label">PRECISÃO EXECUTIVA</span>
        <span className="precision-value">{precision === null ? "—" : `${precision.toFixed(0)}%`}</span>
        <span className="precision-sub">{successCount} êxitos de {done.length} atividades concluídas</span>
      </div>

      <div className="history-split">
        <div className="history-col">
          <span className="section-label">Memorando de atividades</span>
          {done.length === 0 ? <EmptyHint text="Nenhuma atividade concluída ainda." /> : (
            <div className="memo-list">
              {done.map(a => {
                const goal = goals.find(g => g.id === a.goalId);
                const u = UNIT_DEFS.find(x => x.id === a.unitId);
                const isOpen = openId === a.id;
                const actSessions = sessions.filter(s => s.activityId === a.id);
                const actCosts = varCosts.filter(c => c.activityId === a.id);
                const totalHours = actSessions.reduce((s, x) => s + x.actualHours, 0);
                const totalCost = actCosts.reduce((s, x) => s + x.amount, 0);
                return (
                  <div className="memo-card panel-elevated" key={a.id}>
                    <button className="memo-head" onClick={() => setOpenId(isOpen ? null : a.id)}>
                      <span className={`memo-status ${a.status}`}>{a.status === "concluída_êxito" ? <Check size={13} /> : <X size={13} />}</span>
                      <div className="memo-head-text">
                        <span className="memo-title">{a.title}</span>
                        <span className="memo-sub">{u?.name} · {goal?.title || "—"}</span>
                      </div>
                      {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                    {isOpen && (
                      <div className="memo-body">
                        <div className="metric-grid two-col">
                          <MetricCard label="Tempo investido" value={fmtH(totalHours)} color="#7B9BC0" />
                          <MetricCard label="Custo variável" value={fmtBRL(totalCost)} color="#C9544B" />
                        </div>
                        <div className="section-label">Sessões ligadas</div>
                        {actSessions.length === 0 ? <EmptyHint text="Nenhuma sessão registrada." /> : (
                          <div className="ledger">
                            {actSessions.map(s => (
                              <div className="ledger-row" key={s.id}>
                                <div className="ledger-row-text"><span className="ledger-row-title">{fmtDateTime(s.startedAt)}</span></div>
                                <span className="ledger-row-amount neg">-{fmtH(s.actualHours)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="section-label">Transações ligadas</div>
                        {actCosts.length === 0 ? <EmptyHint text="Nenhuma transação registrada." /> : (
                          <div className="ledger">
                            {actCosts.map(c => (
                              <div className="ledger-row" key={c.id}>
                                <div className="ledger-row-text"><span className="ledger-row-title">{c.note || FIN_VARIABLE_DEST[c.destination]?.label}</span><span className="ledger-row-date">{fmtDate(c.createdAt)}</span></div>
                                <span className="ledger-row-amount neg">-{fmtBRL(c.amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="history-col">
          <span className="section-label">Valuation &amp; Equity</span>

          <div className="vx-grid">
            <div className="vx-hero panel-elevated">
              <span className="vx-hero-label">VALOR ATUAL DA HORA</span>
              <span className="vx-hero-value">{fmtBRLPrecise(hourValue)}</span>
              <span className="vx-hero-sub">Meta {goalYear}: {fmtBRL(annualGoal)} ÷ {USEFUL_HOURS_PER_YEAR.toLocaleString("pt-BR")}h úteis/ano</span>
            </div>
            <div className="vx-hero panel-elevated vx-hero-valuation">
              <span className="vx-hero-label">SALDO EXECUTIVO (VALUATION)</span>
              <span className="vx-hero-value">{fmtBRL(valuation)}</span>
              <span className="vx-hero-sub">{fmtH(timeBank.investedTotal)} investidas × {fmtBRLPrecise(hourValue)}/h · especulativo</span>
            </div>
          </div>

          <div className="vx-equity panel-elevated">
            <span className="vx-hero-label">EQUITY (SALDO REAL)</span>
            <span className={`vx-equity-value ${equity < 0 ? "neg" : ""}`}>{fmtBRL(equity)}</span>
            <span className="vx-hero-sub">Caixa líquido: entradas − saídas − custos · sem especulação</span>
            <div className="metric-grid two-col vx-equity-breakdown">
              <MetricCard label="Saldo em dinheiro" value={fmtBRL(cashEquity)} color="#5B8C6E" />
              <MetricCard label="Patrimônio material (usado)" value={fmtBRL(assetsValue)} color="#C9A24B" />
            </div>
          </div>

          <div className="metric-grid two-col">
            <MetricCard label="Meta atual" value={fmtBRL(annualGoal)} color="#C9A24B" />
            <MetricCard label={`Projeção meta ${goalYear + 1}`} value={fmtBRL(nextGoal)} color="#7B9BC0" />
          </div>

          <p className="settings-note vx-note">O Valuation é especulativo: projeta o valor das horas investidas pela meta anual vigente. O Equity aqui soma saldo em dinheiro e patrimônio material (pelo preço de usado) — sem projeção.</p>
        </div>
      </div>
    </div>
  );
}

function HistoryFinanceiroTab({ finEntries, varCosts, fixedCosts }) {
  const [period, setPeriod] = useState("total");
  const start = periodStart(period);

  const periodEntries = finEntries.filter(e => (e.scheduledAt || e.createdAt) >= start);
  const periodVar = varCosts.filter(c => (c.scheduledAt || c.createdAt) >= start);

  let totalEntrada = 0, totalSaida = 0;
  periodEntries.forEach(e => {
    const cat = FIN_CATEGORIES[e.category];
    if (cat.sign > 0) totalEntrada += e.amount;
    else totalSaida += e.amount;
  });
  const totalVar = periodVar.reduce((s, c) => s + c.amount, 0);
  const totalFixed = fixedCosts.filter(c => c.active).reduce((s, c) => s + c.amount, 0);
  const saldo = totalEntrada - totalSaida - totalVar;

  // Agrupa entradas por mês
  const byMonth = useMemo(() => {
    const map = {};
    [...periodEntries, ...periodVar].forEach(item => {
      const ts = item.scheduledAt || item.createdAt;
      const d = new Date(ts);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map[key]) map[key] = { entrada: 0, saida: 0 };
      if (item.category) {
        const cat = FIN_CATEGORIES[item.category];
        if (cat?.sign > 0) map[key].entrada += item.amount;
        else map[key].saida += item.amount;
      } else {
        map[key].saida += item.amount;
      }
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [periodEntries, periodVar]);

  return (
    <div className="sub-page">
      <PeriodTabs value={period} onChange={setPeriod} />
      <div className="metric-grid two-col">
        <MetricCard label="Total entradas" value={fmtBRL(totalEntrada)} color="#5B8C6E" />
        <MetricCard label="Total saídas" value={fmtBRL(totalSaida + totalVar)} color="#C9544B" />
        <MetricCard label="Saldo do período" value={fmtBRL(saldo)} color={saldo >= 0 ? "#5B8C6E" : "#C9544B"} emphasize />
        <MetricCard label="COF fixo mensal" value={fmtBRL(totalFixed)} color="#C9A24B" />
      </div>

      <span className="section-label">Por mês</span>
      {byMonth.length === 0 ? <EmptyHint text="Nenhum lançamento no período." /> : (
        <div className="ledger">
          {byMonth.map(([key, vals]) => {
            const [y, m] = key.split("-");
            const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
            const label = `${monthNames[parseInt(m) - 1]} ${y}`;
            const mes = vals.entrada - vals.saida;
            return (
              <div className="ledger-row" key={key}>
                <div className="ledger-row-text">
                  <span className="ledger-row-title">{label}</span>
                  <span className="ledger-row-date">Entrada {fmtBRL(vals.entrada)} · Saída {fmtBRL(vals.saida)}</span>
                </div>
                <span className={`ledger-row-amount ${mes >= 0 ? "pos" : "neg"}`}>{mes >= 0 ? "+" : ""}{fmtBRL(mes)}</span>
              </div>
            );
          })}
        </div>
      )}

      <span className="section-label">Todos os lançamentos</span>
      {periodEntries.length === 0 ? <EmptyHint text="Nenhum lançamento no período." /> : (
        <div className="ledger">
          {[...periodEntries].sort((a, b) => (b.scheduledAt || b.createdAt) - (a.scheduledAt || a.createdAt)).map(e => {
            const cat = FIN_CATEGORIES[e.category];
            return (
              <div className="ledger-row" key={e.id}>
                <div className="ledger-row-text">
                  <span className="ledger-row-title">{cat?.label}{e.note ? ` · ${e.note}` : ""}</span>
                  <span className="ledger-row-date">{fmtDate(e.scheduledAt || e.createdAt)} · {e.status === "pago" ? "Pago" : "Pendente"}</span>
                </div>
                <span className={`ledger-row-amount ${cat?.sign > 0 ? "pos" : "neg"}`}>{cat?.sign > 0 ? "+" : "-"}{fmtBRL(e.amount)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryPatrimonialTab({ assets, finEntries, varCosts, fixedCosts }) {
  const totalAssets = computeAssetsValue(assets);
  const cashEquity = computeRdxEquity(finEntries, varCosts, fixedCosts);
  const fullEquity = cashEquity + totalAssets;

  const goalYear = currentGoalYear();
  const annualGoal = currentAnnualGoal();
  const nextGoal = nextGoalProjection();
  const goalPct = annualGoal > 0 ? Math.min(100, (fullEquity / annualGoal) * 100) : 0;

  const totalPaidForAssets = assets.reduce((s, a) => s + a.paidPrice, 0);
  const totalGainLoss = assets.reduce((s, a) => s + (assetGainLoss(a).value), 0);
  const totalResaleLoss = assets.reduce((s, a) => s + assetResaleLoss(a), 0);

  return (
    <div className="sub-page">
      <div className="vx-equity panel-elevated">
        <span className="vx-hero-label">EQUITY COMPLETO (SALDO REAL)</span>
        <span className={`vx-equity-value ${fullEquity < 0 ? "neg" : ""}`}>{fmtBRL(fullEquity)}</span>
        <span className="vx-hero-sub">Caixa líquido + patrimônio material · sem especulação</span>
        <div className="metric-grid two-col vx-equity-breakdown">
          <MetricCard label="Saldo em dinheiro" value={fmtBRL(cashEquity)} color="#5B8C6E" />
          <MetricCard label="Patrimônio (preço usado)" value={fmtBRL(totalAssets)} color="#C9A24B" />
        </div>
      </div>

      <div className="metric-grid two-col">
        <MetricCard label={`Meta ${goalYear}`} value={fmtBRL(annualGoal)} color="#C9A24B" />
        <MetricCard label={`Projeção ${goalYear + 1}`} value={fmtBRL(nextGoal)} color="#7B9BC0" />
      </div>
      <div className="mp-bar" style={{ marginBottom: 8 }}>
        <div className="mp-bar-fill" style={{ width: `${goalPct}%`, background: "#5B8C6E" }} />
      </div>
      <span className="vx-hero-sub">{goalPct.toFixed(0)}% da meta {goalYear} atingida</span>

      <span className="section-label">Patrimônio material</span>
      <div className="metric-grid two-col">
        <MetricCard label="Valor pago total" value={fmtBRL(totalPaidForAssets)} color="#7B9BC0" />
        <MetricCard label="Valor atual (usado)" value={fmtBRL(totalAssets)} color="#C9A24B" />
        <MetricCard label="Ganho/perda na compra" value={fmtBRL(totalGainLoss)} color={totalGainLoss >= 0 ? "#5B8C6E" : "#C9544B"} />
        <MetricCard label="Perda est. na revenda" value={fmtBRL(totalResaleLoss)} color={totalResaleLoss > 0 ? "#C9544B" : "#5B8C6E"} />
      </div>

      {assets.length === 0 ? <EmptyHint text="Nenhum item de patrimônio cadastrado." /> : (
        <div className="ledger">
          {assets.map(a => {
            const gl = assetGainLoss(a);
            return (
              <div className="ledger-row" key={a.id}>
                <div className="ledger-row-text">
                  <span className="ledger-row-title">{a.name}</span>
                  <span className="ledger-row-date">
                    Pago {fmtBRL(a.paidPrice)} · Usado {fmtBRL(a.usedPrice)} · {gl.label}: <span className={gl.value >= 0 ? "pos-text" : "neg-text"}>{fmtBRL(gl.value)}</span>
                  </span>
                </div>
                <span className="ledger-row-amount">{fmtBRL(a.usedPrice)}</span>
              </div>
            );
          })}
        </div>
      )}

      <p className="settings-note vx-note">O Equity patrimonial conta cada bem pelo preço de mercado (usado) — valor conservador de revenda. Não inclui especulação ou valuation de tempo.</p>
    </div>
  );
}

/* ============================================================
   MASTER PLAN (Plano Diretor)
   ============================================================ */

const IMPACT_LEVELS = [
  { id: "pouco", label: "Pouco relevante", color: "#6B6962", min: 0, max: 25 },
  { id: "relevante", label: "Relevante", color: "#7B9BC0", min: 25, max: 50 },
  { id: "muito", label: "Muito relevante", color: "#C9A24B", min: 50, max: 75 },
  { id: "urgente", label: "Urgente", color: "#C9544B", min: 75, max: 100 },
];
function impactLevelFor(pct) {
  return IMPACT_LEVELS.find(l => pct >= l.min && pct <= l.max) || IMPACT_LEVELS[0];
}
function priorityFromImpact(pct) {
  if (pct >= 75) return "alta";
  if (pct >= 25) return "media";
  return "baixa";
}

/* ============================================================
   HISTORY CHARTS — Equity completo vs. ideal / Caixa vs. meta 20%
   ============================================================ */

function HistoryChartsTab({ finEntries, varCosts, fixedCosts, assets, sessions, activities, timeBank }) {
  const [modo, setModo] = useState("executivo");
  const [subExec, setSubExec] = useState("direcao");
  const [subCom, setSubCom] = useState("clientes");
  const year = currentGoalYear();
  const now = new Date();
  const [fromYear, setFromYear] = useState(year);
  const [fromMon, setFromMon] = useState(1);
  const [toYear, setToYear] = useState(year);
  const [toMon, setToMon] = useState(now.getMonth() + 1);
  const fromMonth = `${fromYear}-${String(fromMon).padStart(2,"0")}`;
  const toMonth = `${toYear}-${String(toMon).padStart(2,"0")}`;
  const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const yearOptions = [];
  for (let y = GOAL_BASE_YEAR; y <= GOAL_FINAL_YEAR; y++) yearOptions.push(y);
  const monthOptions = [
    {v:1,l:"Jan"},{v:2,l:"Fev"},{v:3,l:"Mar"},{v:4,l:"Abr"},
    {v:5,l:"Mai"},{v:6,l:"Jun"},{v:7,l:"Jul"},{v:8,l:"Ago"},
    {v:9,l:"Set"},{v:10,l:"Out"},{v:11,l:"Nov"},{v:12,l:"Dez"},
  ];

  const series = useMemo(() => {
    const nowTs = Date.now();
    const rows = [];
    for (let y = fromYear; y <= toYear; y++) {
      for (let m = 0; m < 12; m++) {
        const monthKey = `${y}-${String(m+1).padStart(2,"0")}`;
        if (monthKey < fromMonth || monthKey > toMonth) continue;
        const cutoff = new Date(y, m+1, 0, 23, 59, 59).getTime();
        const isFuture = cutoff > nowTs;
        const cash = isFuture ? null : computeRdxEquityUntil(finEntries, varCosts, fixedCosts, cutoff);
        const pat = isFuture ? null : computeAssetsValueUntil(assets, cutoff);
        const equity = cash !== null ? cash + pat : null;
        const ideal = idealEquityForMonth(y, m);
        const label = `${monthNames[m]}/${String(y).slice(2)}`;
        const mStart = new Date(y, m, 1).getTime();
        const mEnd = new Date(y, m+1, 0, 23, 59, 59).getTime();
        const horas = (sessions||[]).filter(s => s.endedAt && s.endedAt >= mStart && s.endedAt <= mEnd).reduce((a,s) => a+s.actualHours, 0);
        const monthActs = (activities||[]).filter(a => {
          const ss = (sessions||[]).filter(x => x.activityId === a.id && x.endedAt >= mStart && x.endedAt <= mEnd);
          return ss.length > 0 && (a.status === "concluída_êxito" || a.status === "concluída_falha");
        });
        const exitos = monthActs.filter(a => a.status === "concluída_êxito").length;
        const precisao = monthActs.length > 0 ? Math.round((exitos/monthActs.length)*100) : null;
        const receita = isFuture ? null : finEntries.filter(e => {
          const ts = e.scheduledAt || e.createdAt;
          return ts >= mStart && ts <= mEnd && FIN_CATEGORIES[e.category]?.sign > 0;
        }).reduce((a,e) => a+e.amount, 0);
        const despesaVar = isFuture ? null : varCosts.filter(c => { const ts = c.scheduledAt || c.createdAt; return ts >= mStart && ts <= mEnd; }).reduce((a,c) => a+c.amount, 0);
        const despesaFix = fixedCosts.filter(c => c.active).reduce((a,c) => a+c.amount, 0);
        const despesa = despesaVar !== null ? despesaVar + despesaFix : null;
        rows.push({ label, monthKey, ideal, equity, cash, pat, horas: parseFloat(horas.toFixed(1)), precisao, receita, despesa });
      }
    }
    return rows;
  }, [finEntries, varCosts, fixedCosts, assets, sessions, activities, fromMonth, toMonth, fromYear, toYear]);

  const tip = { background:"#1A1C20", border:"1px solid #2A2D33", borderRadius:8 };
  const mg = { top:8, right:8, left:0, bottom:0 };
  const yR = v => v >= 1000 ? `R$${(v/1000).toFixed(0)}k` : `R$${v}`;

  return (
    <div className="sub-page">
      <div className="charts-modo-toggle">
        <button className={`charts-modo-btn ${modo==="executivo"?"is-active":""}`} onClick={() => setModo("executivo")}>Executivo</button>
        <button className={`charts-modo-btn ${modo==="comercial"?"is-active":""}`} onClick={() => setModo("comercial")}>Comercial</button>
      </div>

      {modo === "executivo" && (
        <div className="charts-sub-row">
          {[["direcao","Direção"],["capital","Capital"],["execucao","Execução"]].map(([id,label]) => (
            <button key={id} className={`charts-sub-btn ${subExec===id?"is-active":""}`} onClick={() => setSubExec(id)}>{label}</button>
          ))}
        </div>
      )}
      {modo === "comercial" && (
        <div className="charts-sub-row">
          {[["clientes","Clientes"],["servicos","Serviços"],["produtos","Produtos"],["empresas","Empresas"]].map(([id,label]) => (
            <button key={id} className={`charts-sub-btn ${subCom===id?"is-active":""}`} onClick={() => setSubCom(id)}>{label}</button>
          ))}
        </div>
      )}

      <div className="chart-period-selector">
        <div className="chart-period-field">
          <span className="vx-hero-label">DE</span>
          <div className="chart-period-selects">
            <select className="field-input chart-period-sel" value={fromMon} onChange={e => setFromMon(Number(e.target.value))}>
              {monthOptions.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            <select className="field-input chart-period-sel" value={fromYear} onChange={e => setFromYear(Number(e.target.value))}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div className="chart-period-field">
          <span className="vx-hero-label">ATÉ</span>
          <div className="chart-period-selects">
            <select className="field-input chart-period-sel" value={toMon} onChange={e => setToMon(Number(e.target.value))}>
              {monthOptions.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            <select className="field-input chart-period-sel" value={toYear} onChange={e => setToYear(Number(e.target.value))}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <button className="btn-tiny" onClick={() => { setFromMon(1); setFromYear(year); setToMon(now.getMonth()+1); setToYear(year); }}>Hoje</button>
      </div>

      {modo === "executivo" && subExec === "direcao" && (<>
        <div className="chart-card panel-elevated">
          <div className="chart-card-head"><span className="section-label">Patrimônio vs. Meta Ideal</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series} margin={mg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D33" />
              <XAxis dataKey="label" stroke="#6B6962" fontSize={10} />
              <YAxis stroke="#6B6962" fontSize={10} width={46} tickFormatter={yR} />
              <Tooltip formatter={v => v !== null ? fmtBRL(v) : "—"} contentStyle={tip} />
              <Legend wrapperStyle={{fontSize:11}} />
              <Line type="monotone" dataKey="ideal" name="Meta ideal" stroke="#C9A24B" strokeWidth={2} dot={false} strokeDasharray="5 4" />
              <Line type="monotone" dataKey="equity" name="Patrimônio real" stroke="#7B9BC0" strokeWidth={2.5} dot={{r:3}} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card panel-elevated">
          <div className="chart-card-head"><span className="section-label">Receita vs. Despesa</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series} margin={mg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D33" />
              <XAxis dataKey="label" stroke="#6B6962" fontSize={10} />
              <YAxis stroke="#6B6962" fontSize={10} width={46} tickFormatter={yR} />
              <Tooltip formatter={v => v !== null ? fmtBRL(v) : "—"} contentStyle={tip} />
              <Legend wrapperStyle={{fontSize:11}} />
              <Line type="monotone" dataKey="receita" name="Receita" stroke="#5B8C6E" strokeWidth={2.5} dot={{r:3}} connectNulls={false} />
              <Line type="monotone" dataKey="despesa" name="Despesa" stroke="#C9544B" strokeWidth={2} dot={false} strokeDasharray="4 3" connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </>)}

      {modo === "executivo" && subExec === "capital" && (<>
        <div className="chart-card panel-elevated">
          <div className="chart-card-head"><span className="section-label">Caixa vs. Faixa Operacional</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series.map(r => ({...r, min:r.ideal*0.10, max:r.ideal*0.20, ideal15:r.ideal*0.15}))} margin={mg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D33" />
              <XAxis dataKey="label" stroke="#6B6962" fontSize={10} />
              <YAxis stroke="#6B6962" fontSize={10} width={46} tickFormatter={yR} />
              <Tooltip formatter={v => v !== null ? fmtBRL(v) : "—"} contentStyle={tip} />
              <Legend wrapperStyle={{fontSize:11}} />
              <Line type="monotone" dataKey="max" name="Máx 20%" stroke="#C9A24B" strokeWidth={1} dot={false} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="ideal15" name="Ideal 15%" stroke="#5B8C6E" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
              <Line type="monotone" dataKey="min" name="Mín 10%" stroke="#C9544B" strokeWidth={1} dot={false} strokeDasharray="3 3" />
              <Line type="monotone" dataKey="cash" name="Caixa real" stroke="#7B9BC0" strokeWidth={2.5} dot={{r:3}} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-card panel-elevated">
          <div className="chart-card-head"><span className="section-label">Horas Investidas por Mês</span></div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={series} margin={mg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D33" />
              <XAxis dataKey="label" stroke="#6B6962" fontSize={10} />
              <YAxis stroke="#6B6962" fontSize={10} width={36} tickFormatter={v => `${v}h`} />
              <Tooltip formatter={v => `${v}h`} contentStyle={tip} />
              <Line type="monotone" dataKey="horas" name="Horas" stroke="#C9A24B" strokeWidth={2.5} dot={{r:3}} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </>)}

      {modo === "executivo" && subExec === "execucao" && (
        <div className="chart-card panel-elevated">
          <div className="chart-card-head"><span className="section-label">Precisão Executiva Mensal</span></div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={series} margin={mg}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2A2D33" />
              <XAxis dataKey="label" stroke="#6B6962" fontSize={10} />
              <YAxis stroke="#6B6962" fontSize={10} width={36} domain={[0,100]} tickFormatter={v => `${v}%`} />
              <Tooltip formatter={v => v !== null ? `${v}%` : "—"} contentStyle={tip} />
              <Line type="monotone" dataKey="precisao" name="Precisão" stroke="#5B8C6E" strokeWidth={2.5} dot={{r:4}} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
          <span className="vx-hero-sub" style={{display:"block",padding:"4px 0 0"}}>% de atividades concluídas com êxito em sessões do mês.</span>
        </div>
      )}

      {modo === "comercial" && (
        <div className="chart-card panel-elevated">
          <div className="chart-card-head">
            <span className="section-label">
              {subCom === "clientes" ? "Clientes — Leads e Conversão" :
               subCom === "servicos" ? "Serviços — Receita e Ticket Médio" :
               subCom === "produtos" ? "Produtos — Volume e Margem" :
               "Empresas — Participações e Valuation"}
            </span>
          </div>
          <div style={{padding:"32px 0",textAlign:"center",color:"var(--text-faint)"}}>
            <BarChart3 size={32} style={{marginBottom:8,opacity:0.3}} />
            <p style={{fontSize:13}}>Indicadores disponíveis após alimentar dados comerciais.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MasterPlanModule({ activities, goals, steps, timeBank, config, finEntries, varCosts, fixedCosts, assets, schedules, onAddGoal, onUpdateGoal, onAddStep, onUpdateStep, onAddActivity, onUpdateActivity, onAddVarCost, onNavigateCapital }) {
  const goalYear = currentGoalYear();
  const annualGoal = currentAnnualGoal();
  const hourValue = currentHourValue();
  const [expandedCards, setExpandedCards] = useState({ vigente: false, oQue: false, porQue: false, como: false });
  const [alertDiag, setAlertDiag] = useState(null);
  const [diagStep, setDiagStep] = useState("diag"); // "diag" | "etapas" | "confirmado"
  const [selectedSubs, setSelectedSubs] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [novaEtapa, setNovaEtapa] = useState("");
  const [prefilledIndicator, setPrefilledIndicator] = useState(null);

  const now = new Date();
  const monthIndex = now.getMonth();
  const monthNamesLong = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

  const monthGoal = idealEquityForMonth(goalYear, monthIndex);
  const cashEquity = computeRdxEquity(finEntries, varCosts, fixedCosts);
  const fullEquity = cashEquity + computeAssetsValue(assets);
  const achievedPct = monthGoal > 0 ? (fullEquity / monthGoal) * 100 : 0;
  const diffValue = fullEquity - monthGoal;
  const diffPct = monthGoal > 0 ? (diffValue / monthGoal) * 100 : 0;
  const pctReached = annualGoal > 0 ? Math.min(100, (fullEquity / annualGoal) * 100) : 0;

  const cashMin = monthGoal * 0.10;
  const cashIdeal = monthGoal * 0.15;
  const cashMax = monthGoal * 0.20;

  const done = activities.filter(a => a.status === "concluída_êxito" || a.status === "concluída_falha");
  const success = done.filter(a => a.status === "concluída_êxito").length;
  const precision = done.length > 0 ? (success / done.length) * 100 : null;

  const alerts = useMemo(() => {
    const list = [];

    // 1. EQUITY abaixo da meta — subindicadores sem repetir caixa
    if (diffValue < 0) {
      const pct = Math.abs(diffPct);
      const receitaMes = finEntries.filter(e => FIN_CATEGORIES[e.category]?.sign > 0 && new Date(e.createdAt).getMonth() === monthIndex).reduce((s, e) => s + e.amount, 0);
      list.push({
        id: "equity", level: pct > 40 ? "critico" : "atencao",
        label: "Equity abaixo da meta vigente",
        indicador: { nome: "Equity Completo", atual: fmtBRL(fullEquity), ideal: fmtBRL(monthGoal), diff: fmtBRL(diffValue), diffPct: diffPct.toFixed(0) },
        subIndicadores: [
          { nome: "Receita do mês", atual: fmtBRL(receitaMes), ideal: fmtBRL(monthGoal * 0.5), diff: fmtBRL(receitaMes - monthGoal * 0.5), impacto: "Alto" },
          { nome: "Patrimônio material", atual: fmtBRL(computeAssetsValue(assets)), ideal: fmtBRL(monthGoal * 0.3), diff: fmtBRL(computeAssetsValue(assets) - monthGoal * 0.3), impacto: "Médio" },
        ],
        etapasSugeridas: ["Mapear fontes de receita", "Reduzir custos variáveis", "Prospectar clientes", "Fechar negociações pendentes"],
      });
    }

    // 2. CAIXA — só um alerta, com um subindicador por faixa (sem repetir o mesmo valor atual)
    if (cashEquity < cashMin) {
      list.push({
        id: "caixa_baixo", level: cashEquity < cashMin * 0.5 ? "critico" : "atencao",
        label: "Caixa abaixo do mínimo operacional",
        indicador: { nome: "Caixa Operacional", atual: fmtBRL(cashEquity), ideal: fmtBRL(cashIdeal), diff: fmtBRL(cashEquity - cashIdeal), diffPct: ((cashEquity / cashIdeal - 1) * 100).toFixed(0) },
        subIndicadores: [
          { nome: "Falta para o mínimo (10%)", atual: fmtBRL(cashEquity), ideal: fmtBRL(cashMin), diff: fmtBRL(cashEquity - cashMin), impacto: "Crítico" },
          { nome: "Falta para o ideal (15%)", atual: fmtBRL(cashEquity), ideal: fmtBRL(cashIdeal), diff: fmtBRL(cashEquity - cashIdeal), impacto: "Alto" },
        ],
        etapasSugeridas: ["Mapear receitas pendentes", "Reduzir despesas imediatas", "Prospectar receita rápida", "Revisar custos fixos"],
      });
    } else if (cashEquity > cashMax) {
      list.push({
        id: "caixa_excedente", level: "atencao",
        label: "Caixa excedente — dinheiro parado",
        indicador: { nome: "Caixa Excedente", atual: fmtBRL(cashEquity), ideal: fmtBRL(cashMax), diff: `+${fmtBRL(cashEquity - cashMax)}`, diffPct: ((cashEquity / cashMax - 1) * 100).toFixed(0) },
        subIndicadores: [
          { nome: "Excedente acima do máximo (20%)", atual: fmtBRL(cashEquity - cashMax), ideal: "R$ 0", diff: fmtBRL(cashEquity - cashMax), impacto: "Médio" },
        ],
        etapasSugeridas: ["Avaliar opções de investimento", "Alocar em Kofen ou Holding", "Reserva estratégica", "Revisar plano financeiro"],
      });
    }

    // 3. PRECISÃO EXECUTIVA
    if (precision !== null && precision < 70) {
      list.push({
        id: "precisao", level: precision < 40 ? "critico" : "atencao",
        label: "Precisão Executiva abaixo do mínimo",
        indicador: { nome: "Precisão Executiva", atual: `${precision.toFixed(0)}%`, ideal: "70%", diff: `${(precision - 70).toFixed(0)}%`, diffPct: (precision - 70).toFixed(0) },
        subIndicadores: [
          { nome: "Taxa de êxito", atual: `${success}/${done.length}`, ideal: `${Math.ceil(done.length * 0.7)}/${done.length}`, diff: `${success - Math.ceil(done.length * 0.7)} êxitos`, impacto: "Alto" },
          { nome: "Eficiência temporal", atual: fmtH(timeBank.investedTotal), ideal: fmtH(activities.reduce((s, a) => s + (a.plannedHours || 0), 0)), diff: "—", impacto: "Médio" },
        ],
        etapasSugeridas: ["Revisar critérios de conclusão", "Reduzir atividades paralelas", "Melhorar planejamento de horas", "Registrar sessões corretamente"],
      });
    }

    // 4. DÍVIDA DE TEMPO
    if (timeBank.debt > 2) {
      list.push({
        id: "tempo", level: timeBank.debt > 10 ? "critico" : "atencao",
        label: `Dívida de tempo: ${fmtH(timeBank.debt)}`,
        indicador: { nome: "Capital Temporal", atual: fmtH(timeBank.investedTotal), ideal: fmtH(timeBank.investedTotal + timeBank.debt), diff: `-${fmtH(timeBank.debt)}`, diffPct: "-" },
        subIndicadores: [
          { nome: "Horas a recuperar", atual: fmtH(timeBank.recoveredTotal), ideal: fmtH(timeBank.lostTotal), diff: fmtH(timeBank.recoveredTotal - timeBank.lostTotal), impacto: "Alto" },
        ],
        etapasSugeridas: ["Bloquear agenda para recuperação", "Revisar compromissos recorrentes", "Reduzir atividades não essenciais", "Registrar tempo corretamente"],
      });
    }

    return list;
  }, [fullEquity, monthGoal, cashEquity, cashMin, cashIdeal, cashMax, precision, timeBank, diffValue, diffPct, finEntries, assets, activities, done, success, monthIndex]);

  const openAlert = (alert) => {
    setAlertDiag(alert);
    setDiagStep("diag");
    setSelectedSubs(alert.subIndicadores.map((s, i) => ({ ...s, selecionado: true, prioridade: i + 1 })));
    setEtapas(alert.etapasSugeridas.map((t, i) => ({ id: uid(), titulo: t, ordem: i + 1 })));
  };

  const toggleSub = (nome) => setSelectedSubs(prev => prev.map(s => s.nome === nome ? { ...s, selecionado: !s.selecionado } : s));
  const moveEtapa = (idx, dir) => {
    setEtapas(prev => {
      const arr = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return arr;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return arr.map((e, i) => ({ ...e, ordem: i + 1 }));
    });
  };

  const confirmarAlerta = () => {
    const alert = alertDiag;
    const goalTitle = `Resolver: ${alert.label}`;
    const newGoal = onAddGoal({
      title: goalTitle, unitId: UNIT_DEFS[0].id,
      description: `Indicador: ${alert.indicador.nome} · Atual: ${alert.indicador.atual} · Ideal: ${alert.indicador.ideal}`,
      priority: alert.level === "critico" ? "alta" : "media",
      impactPct: alert.level === "critico" ? 85 : 60,
      origem: "alerta", alertId: alert.id,
      indicador: alert.indicador,
      subIndicadores: selectedSubs.filter(s => s.selecionado),
      progressoIdentificado: true, progressoPlano: false,
      alocacao: null,
    });
    etapas.forEach((e, i) => onAddStep({ goalId: newGoal.id, title: e.titulo, order: i, status: "pendente" }));
    // marcar plano criado
    onUpdateGoal(newGoal.id, { progressoPlano: true });
    setAlertDiag(null);
    setDiagStep("diag");
    if (onNavigateCapital) onNavigateCapital();
  };

  const toggleCard = (id) => setExpandedCards(prev => ({ ...prev, [id]: !prev[id] }));
  const levelColor = (level) => level === "critico" ? "#C9544B" : "#C9A24B";

  // Objetivos existentes com progresso
  const goalsWithProgress = goals
    .map(g => ({ ...g, progresso: computeGoalProgress(g, steps) }))
    .sort((a, b) => (a.deadline || Infinity) - (b.deadline || Infinity));

  return (
    <div className="page page-wide">
      <h2 className="page-title">Plano Diretor</h2>
      <p className="page-sub">Diagnóstico estratégico em tempo real. Identifique o problema, crie o plano, aloque no Capital Executivo.</p>

      {/* ── CARD VIGENTE ── */}
      <div className={`mpd-card panel-elevated ${diffValue >= 0 ? "mpd-card-ok" : "mpd-card-alert"}`}>
        <button className="mpd-card-head" onClick={() => toggleCard("vigente")}>
          <div className="mpd-card-head-left">
            {diffValue >= 0 ? <Check size={16} color="#5B8C6E" /> : <AlertTriangle size={16} color="#C9544B" />}
            <span className="mpd-card-title">Meta Vigente — {monthNamesLong[monthIndex]} {goalYear}</span>
            <span className={`mpd-card-status ${diffValue >= 0 ? "ok" : "alert"}`}>{diffValue >= 0 ? "✓ Acima do ideal" : "⚠ Abaixo do ideal"}</span>
          </div>
          {expandedCards.vigente ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {expandedCards.vigente && (
          <div className="mpd-card-body">
            <div className="mp-alert-grid">
              <div className="mp-alert-item"><span className="vx-hero-label">META DO MÊS</span><span className="mp-alert-value">{fmtBRL(monthGoal)}</span></div>
              <div className="mp-alert-item"><span className="vx-hero-label">ATUAL</span><span className="mp-alert-value">{fmtBRL(fullEquity)}</span><span className={`mp-alert-sub ${achievedPct >= 100 ? "pos-text" : "neg-text"}`}>{achievedPct.toFixed(0)}%</span></div>
              <div className="mp-alert-item"><span className="vx-hero-label">DIFERENÇA</span><span className={`mp-alert-value ${diffValue >= 0 ? "pos-text" : "neg-text"}`}>{diffValue >= 0 ? "+" : ""}{fmtBRL(diffValue)}</span><span className={`mp-alert-sub ${diffPct >= 0 ? "pos-text" : "neg-text"}`}>{diffPct >= 0 ? "+" : ""}{diffPct.toFixed(0)}%</span></div>
            </div>
            <div className="mp-bar" style={{ marginTop: 12 }}><div className="mp-bar-fill" style={{ width: `${Math.min(100, achievedPct)}%`, background: diffValue >= 0 ? "#5B8C6E" : "#C9544B" }} /></div>
            <span className="vx-hero-sub" style={{ marginTop: 6, display: "block" }}>Meta anual {goalYear}: {fmtBRL(annualGoal)} · {pctReached.toFixed(0)}% atingido no ano</span>
          </div>
        )}
      </div>

      {/* ── PAINEL DE ALERTAS ── */}
      {alerts.length > 0 ? (
        <div className="mpd-urgencia">
          <span className="section-label">Indicadores que exigem ação</span>
          {alerts.map(alert => (
            <div key={alert.id} className="mpd-urgencia-item" style={{ "--alert-color": levelColor(alert.level) }}>
              <button className="mpd-urgencia-head" onClick={() => openAlert(alertDiag?.id === alert.id ? null : alert)}>
                <span className="mpd-urgencia-level">{alert.level === "critico" ? "🔴 Crítico" : "🟡 Atenção"}</span>
                <span className="mpd-urgencia-label">{alert.label}</span>
                {alertDiag?.id === alert.id ? <ChevronUp size={14} /> : <ChevronRight size={14} />}
              </button>

              {alertDiag?.id === alert.id && (
                <div className="mpd-urgencia-diag">
                  {diagStep === "diag" && (
                    <>
                      {/* Indicador principal */}
                      <div className="mpd-diag-main">
                        <div className="metric-grid two-col">
                          <MetricCard label="Atual" value={alert.indicador.atual} color={levelColor(alert.level)} />
                          <MetricCard label="Ideal" value={alert.indicador.ideal} color="#5B8C6E" />
                        </div>
                        <div className="mpd-diag-diff">
                          <span className="vx-hero-label">DIFERENÇA</span>
                          <span className="mpd-diag-diff-value" style={{ color: levelColor(alert.level) }}>{alert.indicador.diff}</span>
                          <span className="vx-hero-sub">{alert.indicador.diffPct}% de desvio</span>
                        </div>
                      </div>

                      {/* Subindicadores */}
                      <span className="section-label" style={{ marginTop: 12 }}>Subindicadores — selecione os que serão atacados</span>
                      {selectedSubs.map((sub, i) => (
                        <div key={sub.nome} className={`mpd-sub-row ${sub.selecionado ? "is-selected" : ""}`} onClick={() => toggleSub(sub.nome)}>
                          <div className={`mpd-sub-check ${sub.selecionado ? "checked" : ""}`}>{sub.selecionado ? <Check size={11} /> : null}</div>
                          <div className="mpd-sub-info">
                            <span className="mpd-sub-nome">{sub.nome}</span>
                            <span className="mpd-sub-vals">Atual: {sub.atual} · Ideal: {sub.ideal} · Diff: {sub.diff}</span>
                          </div>
                          <span className={`mpd-sub-impacto mpd-impacto-${(sub.impacto || "").toLowerCase().replace("í","i")}`}>{sub.impacto}</span>
                        </div>
                      ))}

                      <button className="btn-primary full-width" style={{ marginTop: 12 }} onClick={() => setDiagStep("etapas")}>
                        Definir etapas de ataque <ChevronRight size={14} />
                      </button>
                    </>
                  )}

                  {diagStep === "etapas" && (
                    <>
                      <span className="section-label">Etapas de ataque — ordene e ajuste</span>
                      <span className="vx-hero-sub" style={{ marginBottom: 8, display: "block" }}>Sugestões automáticas com base no problema. Arraste para reordenar ou adicione novas.</span>
                      {etapas.map((e, i) => (
                        <div key={e.id} className="mpd-etapa-row">
                          <span className="mpd-etapa-num">{i + 1}</span>
                          <span className="mpd-etapa-titulo">{e.titulo}</span>
                          <div className="mpd-etapa-btns">
                            <button className="btn-tiny" onClick={() => moveEtapa(i, -1)} disabled={i === 0}>↑</button>
                            <button className="btn-tiny" onClick={() => moveEtapa(i, 1)} disabled={i === etapas.length - 1}>↓</button>
                            <button className="ledger-row-del" onClick={() => setEtapas(prev => prev.filter((_, idx) => idx !== i))}><X size={12} /></button>
                          </div>
                        </div>
                      ))}
                      <div className="mpd-etapa-add">
                        <input className="field-input" placeholder="Nova etapa..." value={novaEtapa} onChange={e => setNovaEtapa(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && novaEtapa.trim()) { setEtapas(prev => [...prev, { id: uid(), titulo: novaEtapa.trim(), ordem: prev.length + 1 }]); setNovaEtapa(""); }}} />
                        <button className="btn-tiny" onClick={() => { if (novaEtapa.trim()) { setEtapas(prev => [...prev, { id: uid(), titulo: novaEtapa.trim(), ordem: prev.length + 1 }]); setNovaEtapa(""); }}}>
                          <Plus size={13} />
                        </button>
                      </div>

                      <div className="mpd-etapa-actions">
                        <button className="btn-ghost-upload" onClick={() => setDiagStep("diag")}>← Voltar</button>
                        <button className="btn-primary" disabled={etapas.length === 0} onClick={confirmarAlerta}>
                          <Check size={14} /> Criar objetivo e alocar no Capital Executivo
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mpd-tudo-ok panel-elevated">
          <Check size={18} color="#5B8C6E" />
          <span className="mpd-tudo-ok-label">Todos os indicadores dentro do ideal</span>
        </div>
      )}

      {/* ── OBJETIVOS EM ANDAMENTO ── */}
      {goalsWithProgress.length > 0 && (
        <>
          <span className="section-label" style={{ marginTop: 20 }}>Objetivos em andamento</span>
          {goalsWithProgress.map(g => {
            const pColor = progressColor(g.progresso);
            const goalStepsLocal = steps.filter(s => s.goalId === g.id).sort((a, b) => (a.order || 0) - (b.order || 0));
            return (
              <div key={g.id} className="mpd-goal-row panel-elevated">
                <div className="mpd-goal-head">
                  <div className="mpd-goal-info">
                    {g.origem === "alerta" && <span className="mpd-goal-badge-alerta">⚡ Alerta</span>}
                    <span className="mpd-goal-title">{g.title}</span>
                    <span className="mpd-goal-unit">{UNIT_DEFS.find(u => u.id === g.unitId)?.name}</span>
                  </div>
                  <span className="mpd-goal-pct" style={{ color: pColor }}>{g.progresso}%</span>
                </div>
                <div className="mp-bar"><div className="mp-bar-fill" style={{ width: `${g.progresso}%`, background: pColor }} /></div>
                <div className="mpd-goal-steps">
                  {goalStepsLocal.map(s => (
                    <div key={s.id} className="mpd-step-row">
                      <span className={`mpd-step-dot ${s.status === "concluida" ? "done" : ""}`} />
                      <span className="mpd-step-title">{s.title}</span>
                      {s.status !== "concluida" && (
                        <button className="btn-tiny" onClick={() => { onUpdateStep(s.id, { status: "concluida", concluidaEm: Date.now() }); }}>
                          <Check size={11} /> Concluir
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {g.alocacao?.status === "pendente_alocacao" && (
                  <div className="mpd-goal-alerta-alocacao">
                    <AlertCircle size={13} /> Aguardando alocação no Capital Executivo
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* ── FORMULÁRIO MANUAL ── */}
      <span className="section-label" style={{ marginTop: 24 }}>Criar projeto manualmente</span>
      <MasterPlanForm
        activities={activities} goals={goals} hourValue={hourValue} pctReached={pctReached} goalYear={goalYear}
        timeBank={timeBank} expandedCards={expandedCards} onToggleCard={toggleCard}
        prefilledIndicator={prefilledIndicator}
        onAddGoal={onAddGoal} onAddStep={onAddStep} onAddActivity={onAddActivity}
        onUpdateActivity={onUpdateActivity} onAddVarCost={onAddVarCost}
      />
    </div>
  );
}
function MasterPlanForm({ activities, goals, hourValue, pctReached, goalYear, timeBank, expandedCards, onToggleCard, prefilledIndicator, onAddGoal, onAddStep, onAddActivity, onUpdateActivity, onAddVarCost }) {
  const [title, setTitle] = useState(prefilledIndicator?.preTitle || "");
  const [unitId, setUnitId] = useState(UNIT_DEFS[0].id);
  const [startSummary, setStartSummary] = useState(prefilledIndicator ? `Indicador: ${prefilledIndicator.indicator} · Atual: ${prefilledIndicator.atual} · Ideal: ${prefilledIndicator.ideal}` : "");
  const [analysis, setAnalysis] = useState("");
  const [impact, setImpact] = useState(prefilledIndicator?.level === "critico" ? 85 : 60);
  const [horizon, setHorizon] = useState("mensal");
  const [deadline, setDeadline] = useState(() => new Date().toISOString().slice(0, 10));
  const [weeklyHours, setWeeklyHours] = useState("10");
  const [totalHours, setTotalHours] = useState("10");
  const [activityForms, setActivityForms] = useState([0, 1, 2, 3].map(() => ({ key: uid(), text: "", hours: "0", mode: "new", activityId: "" })));
  const [saved, setSaved] = useState(false);

  const HORIZONS = [
    { id: "diario", label: "Diário" }, { id: "semanal", label: "Semanal" },
    { id: "mensal", label: "Mensal" }, { id: "trimestral", label: "Trimestral" }, { id: "anual", label: "Anual" },
  ];

  const impactLevel = impactLevelFor(impact);
  const priority = priorityFromImpact(impact);
  const totalHoursNum = parseFloat((totalHours || "0").replace(",", ".")) || 0;
  const weeklyHoursNum = parseFloat((weeklyHours || "0").replace(",", ".")) || 0;
  const weeksNeeded = weeklyHoursNum > 0 ? Math.ceil(totalHoursNum / weeklyHoursNum) : null;
  const allocated = activityForms.reduce((s, f) => s + (parseFloat((f.hours || "0").replace(",", ".")) || 0), 0);
  const remainingHours = Math.max(0, totalHoursNum - allocated);

  const updateForm = (i, patch) => setActivityForms(prev => prev.map((f, idx) => idx === i ? { ...f, ...patch } : f));

  const hasOQue = title.trim().length > 0;
  const hasPorQue = startSummary.trim().length > 0 || analysis.trim().length > 0;
  const hasQuando = weeklyHoursNum > 0;
  const hasComo = activityForms.some(f => f.text.trim() || f.activityId);
  const canSave = hasOQue && activityForms.every(f => f.mode === "new" ? f.text.trim() : f.activityId);

  const handleSave = () => {
    const newGoal = onAddGoal({
      title: title.trim(), unitId, description: analysis.trim() || startSummary.trim(),
      priority, impactPct: impact, horizon, deadline: new Date(deadline).getTime(), weeklyHours: weeklyHoursNum,
    });
    activityForms.forEach((f, i) => {
      const hoursForThis = parseFloat((f.hours || "0").replace(",", ".")) || 0;
      const newStep = onAddStep({ goalId: newGoal.id, title: `Atividade principal ${i + 1} · ${f.mode === "new" ? f.text.trim() : ""}`, order: i });
      if (f.mode === "new") {
        onAddActivity({ title: f.text.trim(), priority, goalId: newGoal.id, stepId: newStep.id, unitId, plannedHours: hoursForThis > 0 ? hoursForThis : null, cost: 0, costDestination: unitId });
      } else {
        onUpdateActivity(f.activityId, { plannedHours: hoursForThis > 0 ? hoursForThis : null, stepId: newStep.id, goalId: newGoal.id });
      }
    });
    setSaved(true);
    setTitle(""); setStartSummary(""); setAnalysis(""); setImpact(50); setTotalHours("10"); setWeeklyHours("10");
    setDeadline(new Date().toISOString().slice(0, 10));
    setActivityForms([0, 1, 2, 3].map(() => ({ key: uid(), text: "", hours: "0", mode: "new", activityId: "" })));
    setTimeout(() => setSaved(false), 2500);
  };

  const CollapsibleCard = ({ id, label, hasData, children }) => (
    <div className={`mpd-card panel-elevated ${hasData ? "mpd-card-filled" : ""}`}>
      <button className="mpd-card-head" onClick={() => onToggleCard(id)}>
        <div className="mpd-card-head-left">
          <span className="mpf-block-label">{label}</span>
          <span className={`mpd-card-status ${hasData ? "ok" : "pending"}`}>{hasData ? "✓ Preenchido" : "⚠ Pendente"}</span>
        </div>
        {expandedCards[id] ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expandedCards[id] && <div className="mpd-card-body">{children}</div>}
    </div>
  );

  return (
    <div className="mpf">
      {/* O QUÊ */}
      <CollapsibleCard id="oQue" label="O quê" hasData={hasOQue}>
        <label className="field-label">Título do projeto</label>
        <input className="field-input" placeholder="Ex: Aumentar caixa operacional em 30%" value={title} onChange={e => setTitle(e.target.value)} />
        {prefilledIndicator && (
          <div className="mpd-prefill-hint">
            <AlertCircle size={13} /> Pré-preenchido com base no alerta: <strong>{prefilledIndicator.indicator}</strong>
          </div>
        )}
      </CollapsibleCard>

      {/* POR QUÊ */}
      <CollapsibleCard id="porQue" label="Por quê" hasData={hasPorQue}>
        <label className="field-label">Onde vamos operar</label>
        <div className="unit-picker">
          {UNIT_DEFS.map(u => <button key={u.id} className={`unit-pick ${unitId === u.id ? "is-selected" : ""}`} style={{ "--u-color": u.color }} onClick={() => setUnitId(u.id)}><span className="unit-pick-dot" />{u.name}</button>)}
        </div>
        <label className="field-label">Resumo do momento atual</label>
        <textarea className="field-input mpf-textarea" placeholder="Onde estamos agora, o que motiva este projeto." value={startSummary} onChange={e => setStartSummary(e.target.value)} />
        <label className="field-label">Análise descritiva</label>
        <textarea className="field-input mpf-textarea" placeholder="Sua análise pessoal sobre este momento." value={analysis} onChange={e => setAnalysis(e.target.value)} />
        <label className="field-label">Meta {goalYear} já percorrida</label>
        <div className="mp-bar"><div className="mp-bar-fill" style={{ width: `${pctReached}%` }} /></div>
        <span className="vx-hero-sub">{pctReached.toFixed(0)}% da meta anual atingida</span>
        <label className="field-label">Impacto esperado</label>
        <input type="range" min="0" max="100" step="5" className="impact-slider" style={{ "--i-color": impactLevel.color }} value={impact} onChange={e => setImpact(parseInt(e.target.value, 10))} />
        <div className="impact-readout">
          <span className="impact-pct" style={{ color: impactLevel.color }}>{impact}%</span>
          <span className="impact-badge" style={{ "--badge-color": impactLevel.color }}>{impactLevel.label}</span>
        </div>
      </CollapsibleCard>

      {/* COMO */}
      <CollapsibleCard id="como" label="Como" hasData={hasComo}>
        <label className="field-label">Tempo total disponível para este projeto</label>
        <input type="number" min="0" step="0.5" className="field-input" value={totalHours} onChange={e => setTotalHours(e.target.value)} placeholder="Ex: 10" />
        <span className="vx-hero-sub">Restam {fmtH(remainingHours)} de {fmtH(totalHoursNum)} para alocar nas 4 atividades.</span>
        {activityForms.map((f, i) => (
          <MasterPlanActivityRow key={f.key} index={i} form={f} activities={activities} remainingHours={remainingHours} onChange={patch => updateForm(i, patch)} />
        ))}
      </CollapsibleCard>

      <button className="btn-primary modal-submit" disabled={!canSave} onClick={handleSave}>
        {saved ? <><Check size={16} /> Projeto criado com sucesso</> : <><Plus size={16} /> Criar projeto e atividades</>}
      </button>
    </div>
  );
}

function MasterPlanActivityRow({ index, form, activities, remainingHours, onChange }) {
  const hoursNum = parseFloat((form.hours || "0").replace(",", ".")) || 0;
  const maxForThis = remainingHours + hoursNum; // o que esta linha pode chegar a usar (sobra + o que ela já usa)

  return (
    <div className="mpf-activity">
      <span className="mpf-activity-label">Atividade principal {index + 1}</span>

      <div className="mode-toggle">
        <button className={`mode-toggle-btn ${form.mode === "new" ? "is-active" : ""}`} onClick={() => onChange({ mode: "new" })}>Nova</button>
        <button className={`mode-toggle-btn ${form.mode === "existing" ? "is-active" : ""}`} onClick={() => onChange({ mode: "existing" })} disabled={activities.length === 0}>Existente</button>
      </div>

      {form.mode === "new" ? (
        <input className="field-input" placeholder="Descrever atividade" value={form.text} onChange={e => onChange({ text: e.target.value })} />
      ) : (
        activities.length === 0 ? <EmptyHint text="Nenhuma atividade existente ainda." /> : (
          <select className="field-input" value={form.activityId} onChange={e => onChange({ activityId: e.target.value })}>
            <option value="">Selecione…</option>
            {activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
        )
      )}

      <label className="field-label">Tempo alocado (máximo possível aqui: {fmtH(Math.max(0, maxForThis))})</label>
      <input
        type="range" min="0" max={Math.max(0.5, maxForThis)} step="0.5" className="impact-slider"
        style={{ "--i-color": "#7B9BC0" }} value={Math.min(hoursNum, maxForThis)}
        onChange={e => onChange({ hours: e.target.value })}
      />
      <span className="vx-hero-sub">{fmtH(hoursNum)} alocadas para esta atividade</span>
    </div>
  );
}

/* ============================================================
   SETTINGS
   ============================================================ */

/* ============================================================
   RECURRING TIME OCCURRENCES — confirmation modal
   ============================================================ */

function RecurringOccurrencesModal({ occurrences, activities, onConfirm, onCancel, onClose }) {
  const remaining = occurrences.length;
  return (
    <Modal onClose={onClose} title="Tempo recorrente programado">
      <p className="page-sub">Esses horários já passaram desde a última vez que você abriu o app. Confirme para debitar do banco de tempo, ou cancele se não aconteceu.</p>
      {remaining === 0 ? (
        <EmptyHint text="Tudo decidido." />
      ) : (
        <div className="ledger occurrences-list">
          {occurrences.map(occ => {
            const u = UNIT_DEFS.find(x => x.id === occ.unitId);
            const act = activities.find(a => a.id === occ.activityId);
            return (
              <div className="occurrence-card panel-elevated" key={occ.key} style={{ "--u-color": u?.color }}>
                <div className="occurrence-info">
                  <span className="occurrence-title">{occ.label}{act ? ` · ${act.title}` : ""}</span>
                  <span className="occurrence-sub">{fmtDateTime(occ.start)} · {fmtH(occ.hours)}</span>
                </div>
                <div className="occurrence-actions">
                  <button className="btn-tiny is-paid" onClick={() => onConfirm(occ)}><Check size={13} /> Confirmar</button>
                  <button className="btn-tiny danger" onClick={() => onCancel(occ)}><X size={13} /> Cancelar</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}


function SettingsModule({ config, onExport, onImport, onReset }) {
  const [confirming, setConfirming] = useState(false);

  const handleReset = () => {
    if (!confirming) { setConfirming(true); return; }
    onReset();
    setConfirming(false);
  };

  return (
    <div className="settings-body">
      <div className="section-label">Configuração do Capital-Tempo</div>
      <div className="settings-grid">
        <div className="settings-item panel-elevated"><span className="settings-item-label">Início</span><span className="settings-item-value">{fmtDate(config.startDate)}</span></div>
        <div className="settings-item panel-elevated"><span className="settings-item-label">Horizonte</span><span className="settings-item-value">{config.horizonYears} anos</span></div>
        <div className="settings-item panel-elevated"><span className="settings-item-label">Horas úteis/dia</span><span className="settings-item-value">{config.dailyHours}h</span></div>
        <div className="settings-item panel-elevated"><span className="settings-item-label">Banco total</span><span className="settings-item-value">{config.totalHours.toLocaleString("pt-BR")}h</span></div>
      </div>
      <div className="section-label">Backup</div>
      <p className="settings-note">Exporte seus dados em JSON para trocar de aparelho sem perder histórico.</p>
      <div className="settings-actions">
        <button className="btn-primary" onClick={onExport}><Download size={16} /> Exportar backup</button>
        <label className="btn-ghost-upload">
          <Upload size={16} /> Importar backup
          <input type="file" accept="application/json" style={{ display: "none" }} onChange={e => e.target.files[0] && onImport(e.target.files[0])} />
        </label>
      </div>
      <div className="section-label">Zona de risco</div>
      <p className="settings-note">Apaga config, objetivos, atividades, sessões e dados financeiros. Volta para a tela de configuração inicial. Não pode ser desfeito — exporte um backup antes, se precisar.</p>
      <div className="settings-actions">
        <button className={`btn-tiny danger btn-reset ${confirming ? "is-confirming" : ""}`} onClick={handleReset}>
          <RotateCcw size={14} /> {confirming ? "Confirmar: apagar tudo" : "Limpar todos os dados"}
        </button>
        {confirming && <button className="btn-tiny" onClick={() => setConfirming(false)}>Cancelar</button>}
      </div>
      <div className="section-label">Sobre</div>
      <p className="settings-note">RDX Control. Capital-Tempo medido em horas futuras. Investimentos são irreversíveis. Transferências entre unidades e sincronização em nuvem estão planejadas para versões futuras.</p>
    </div>
  );
}

/* ============================================================
   SHARED
   ============================================================ */

function EmptyHint({ text }) { return <div className="empty-hint">{text}</div>; }

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-head"><span className="modal-title">{title}</span><button className="modal-close" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   STYLES
   ============================================================ */

const styles = `
:root {
  --bg: #0A0B0D; --surface: #14161A; --surface-2: #1B1E23; --border: #2A2D33;
  --text: #E8E6E0; --text-dim: #9A9890; --text-faint: #6B6962;
  --amber: #C9A24B; --amber-dim: #8A7038; --red: #C9544B; --green: #5B8C6E; --blue: #7B9BC0;
  --font-display: "Fraunces", Georgia, serif; --font-body: "Inter", -apple-system, sans-serif; --font-mono: "JetBrains Mono", "SF Mono", monospace;
  --radius: 10px;
}
* { box-sizing: border-box; }
.shell { background: var(--bg); color: var(--text); font-family: var(--font-body); min-height: 100vh; max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; position: relative; }
.shell-center { align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
.boot { display: flex; flex-direction: column; align-items: center; gap: 20px; }
.boot-mark { font-family: var(--font-display); font-size: 14px; letter-spacing: 0.3em; color: var(--amber); }
.boot-bar { width: 160px; height: 2px; background: var(--border); overflow: hidden; }
.boot-bar-fill { height: 100%; width: 40%; background: var(--amber); animation: boot-slide 1.1s ease-in-out infinite; }
@keyframes boot-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }

.setup { max-width: 420px; width: 100%; }
.setup-eyebrow { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em; color: var(--amber); margin-bottom: 16px; }
.setup-title { font-family: var(--font-display); font-size: 30px; line-height: 1.15; font-weight: 600; margin: 0 0 12px; }
.setup-sub { color: var(--text-dim); font-size: 14px; line-height: 1.6; margin: 0 0 26px; }
.field-label { display: block; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: var(--text-faint); text-transform: uppercase; margin: 16px 0 8px; }
.field-label:first-of-type { margin-top: 0; }
.field-input { width: 100%; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-family: var(--font-mono); font-size: 15px; padding: 12px 14px; border-radius: 8px; outline: none; }
.field-input:focus { border-color: var(--amber-dim); }
.setup-preview { margin-top: 24px; padding: 18px; background: var(--surface); border: 1px solid var(--border); border-left: 2px solid var(--amber); border-radius: var(--radius); }
.setup-preview-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--text-faint); text-transform: uppercase; }
.setup-preview-value { font-family: var(--font-display); font-size: 28px; color: var(--amber); margin-top: 6px; }
.setup-preview-unit { font-size: 14px; margin-left: 6px; color: var(--text-dim); }
.setup-preview-sub { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); margin-top: 4px; }
.setup-btn { width: 100%; margin-top: 22px; justify-content: center; }

.topbar-wrap { position: sticky; top: 0; z-index: 10; background: var(--bg); border-bottom: 1px solid var(--border); }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; flex-wrap: wrap; }
.topbar-progress-track { height: 2px; background: var(--surface-2); }
.topbar-progress-fill { height: 100%; background: var(--amber); transition: width 0.5s; }
.topbar-progress-fill.over { background: var(--red); }
.topbar-live { display: flex; align-items: center; gap: 6px; background: rgba(201,162,75,0.08); border: 1px solid rgba(201,162,75,0.25); border-radius: 20px; padding: 5px 10px; cursor: pointer; color: var(--text); }
.topbar-live-pct { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
.topbar-live-pct.over { color: var(--red); }
.topbar-session-panel { background: var(--bg); border-bottom: 2px solid var(--u-color); padding: 16px 18px; animation: slide-down 0.18s ease-out; }
@keyframes slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
.topbar-brand { display: flex; align-items: baseline; gap: 6px; }
.topbar-mark { font-family: var(--font-display); font-size: 17px; font-weight: 700; color: var(--amber); }
.topbar-sub { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.15em; color: var(--text-faint); }
.topbar-balance { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.2; }
.topbar-balance-label { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.1em; color: var(--text-faint); }
.topbar-balance-value { font-family: var(--font-mono); font-size: 16px; color: var(--text); }
.topbar-balance-value.neg { color: var(--red); }
.topbar-live { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--border); border-left: 2px solid var(--u-color); padding: 6px 10px; border-radius: 8px; width: 100%; }
.topbar-live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--u-color); animation: pulse-dot 1.6s ease-in-out infinite; flex-shrink: 0; }
@keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.topbar-live-unit { font-size: 12px; color: var(--text-dim); flex: 1; }
.topbar-live-clock { font-family: var(--font-mono); font-size: 13px; color: var(--text); }
.topbar-live-stop { background: none; border: none; color: var(--red); cursor: pointer; display: flex; padding: 4px; }
.topbar-settings-btn { background: none; border: 1px solid var(--border); border-radius: 8px; color: var(--text-dim); cursor: pointer; display: flex; align-items: center; padding: 7px; }
.topbar-settings-btn:hover { color: var(--amber); border-color: var(--amber-dim); }
.topbar-icon-group { display: flex; align-items: center; gap: 6px; }

.settings-body { display: flex; flex-direction: column; }
.patrimony-body { display: flex; flex-direction: column; }
.inventory-row { flex-wrap: wrap; gap: 8px; }

/* ---------- dashboard mind-map ---------- */
/* ---------- dashboard goal progress ---------- */
.goalprog-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 22px; }
@media (max-width: 600px) { .goalprog-grid { grid-template-columns: 1fr; } }
.goalprog-card { padding: 18px; border-left: 3px solid var(--amber); display: flex; flex-direction: column; gap: 8px; }
.goalprog-card-equity { border-left-color: #5B8C6E; }
.goalprog-value { font-family: var(--font-display); font-size: 26px; color: var(--text); }
.goalprog-foot-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.goalprog-pct { font-size: 12px; font-weight: 600; color: var(--text-dim); }
.goalprog-rest { font-size: 11px; color: var(--text-faint); }

.mindmap { display: flex; flex-direction: column; gap: 18px; align-items: center; }
.mindmap-core { width: 100%; max-width: 360px; padding: 22px; border: 2px solid var(--amber); display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; border-radius: 16px; }
.mindmap-core-label { font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--amber); letter-spacing: 0.05em; }
.mindmap-core-sub { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
.mindmap-core-value { font-family: var(--font-display); font-size: 26px; color: var(--text); }
.mindmap-core-value.neg { color: var(--red); }
.mindmap-core-foot { font-size: 11px; color: var(--text-faint); margin-top: 2px; }

.margin-op { width: 100%; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
.margin-op-bar { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.margin-op-bar-fill { height: 100%; background: var(--green); border-radius: 3px; }
.margin-op-bar-fill.alert { background: var(--red); }
.margin-op-row { display: flex; justify-content: center; }
.margin-op-pct { font-size: 12px; font-weight: 600; color: var(--green); }
.margin-op-pct.alert { color: var(--red); }

.mindmap-satellites { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; width: 100%; }
@media (max-width: 760px) { .mindmap-satellites { grid-template-columns: 1fr; } }

.dashcard { border-left: 3px solid var(--u-color); overflow: hidden; }
.dashcard-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: none; border: none; padding: 18px; cursor: pointer; text-align: left; color: var(--text); }
.dashcard-head-text { display: flex; flex-direction: column; gap: 3px; }
.dashcard-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--u-color); text-transform: uppercase; }
.dashcard-main-value { font-family: var(--font-display); font-size: 24px; color: var(--text); }
.dashcard-main-sub { font-size: 11px; color: var(--text-faint); }
.dashcard-body { padding: 0 18px 18px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--border); padding-top: 14px; }

.main { flex: 1; overflow-y: auto; padding-bottom: 90px; }
.page { padding: 20px 18px 8px; max-width: 720px; margin: 0 auto; }
.page.page-wide { max-width: 1040px; }
.page-title { font-family: var(--font-display); font-size: 22px; font-weight: 600; margin: 4px 0 6px; }
.page-sub { font-size: 13px; color: var(--text-dim); line-height: 1.5; margin: 0 0 16px; }
.sub-page { padding-top: 4px; }

/* ---------- elevated panel signature ---------- */
.panel-elevated {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 4px 14px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.02) inset;
  margin-bottom: 12px;
}

/* ---------- period tabs ---------- */
.period-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 18px; -ms-overflow-style: none; scrollbar-width: none; }
.period-tabs::-webkit-scrollbar { display: none; }
.period-tab { flex-shrink: 0; background: var(--surface); border: 1px solid var(--border); color: var(--text-faint); font-family: var(--font-mono); font-size: 12px; padding: 7px 13px; border-radius: 16px; cursor: pointer; }
.period-tab.is-active { background: var(--amber); color: #1a1505; border-color: var(--amber); font-weight: 600; }

/* ---------- sub tabs ---------- */
.sub-tabs { display: flex; gap: 1px; background: var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 18px; border: 1px solid var(--border); }
.sub-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; background: var(--surface); border: none; color: var(--text-faint); font-size: 13px; padding: 12px 8px; cursor: pointer; }
.sub-tab.is-active { background: var(--surface-2); color: var(--amber); font-weight: 600; }

.cashbox-toggle { display: flex; gap: 10px; margin-bottom: 20px; }
.cashbox-toggle-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text-faint); font-size: 14px; font-weight: 600; cursor: pointer; }
.cashbox-toggle-btn.is-active { border-color: var(--amber); color: var(--amber); background: var(--surface-2); }

.metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 18px; }
.metric-grid.two-col { grid-template-columns: 1fr 1fr; }
.metric-card { padding: 14px; border-top: 2px solid var(--m-color); display: flex; flex-direction: column; gap: 6px; }
.metric-card.is-emphasized { background: rgba(201,84,75,0.08); }
.metric-card-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.04em; }
.metric-card-value { font-family: var(--font-mono); font-size: 17px; color: var(--text); }

.unit-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-bottom: 18px; }
.unit-card { padding: 14px; border-top: 2px solid var(--u-color); }
.unit-card-top { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
.unit-card-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--u-color); }
.unit-card-name { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.unit-card-value { font-family: var(--font-mono); font-size: 17px; color: var(--text); }
.unit-card-sub { font-size: 11px; color: var(--text-faint); margin-top: 4px; }
.unit-card-bar { height: 2px; background: var(--surface-2); margin-top: 10px; border-radius: 2px; }
.unit-card-bar-fill { height: 100%; background: var(--u-color); border-radius: 2px; }

.empty-hint { font-size: 13px; color: var(--text-faint); padding: 18px 0; text-align: center; font-style: italic; }
.section-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--text-faint); text-transform: uppercase; margin: 22px 0 12px; display: block; }
.section-label-row { display: flex; justify-content: space-between; align-items: center; margin: 22px 0 12px; }
.section-label-row .section-label { margin: 0; }
.select-pill { background: var(--surface); border: 1px solid var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; padding: 5px 10px; border-radius: 12px; outline: none; }

.btn-play-big { width: 100%; background: var(--amber); color: #1a1505; border: none; padding: 16px; border-radius: var(--radius); font-weight: 600; font-size: 15px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; margin-bottom: 20px; box-shadow: 0 4px 14px rgba(201,162,75,0.25); }
.btn-play-big:hover { background: #d9b15c; }

.btn-execute-yellow { width: 100%; background: var(--amber); color: #1a1505; border: none; padding: 16px; border-radius: var(--radius); font-weight: 700; font-size: 16px; text-align: center; cursor: pointer; box-shadow: 0 4px 14px rgba(201,162,75,0.25); transition: background 0.15s; }
.btn-execute-yellow:hover { background: #d9b15c; }
.btn-execute-cancel { background: var(--surface-2); color: var(--text-dim); box-shadow: none; border: 1px solid var(--border); }
.btn-execute-cancel:hover { background: var(--surface); }

/* ── Execução nova estrutura ── */
/* ── Exec seções ── */
.exec-goals-fixed { background: var(--bg); padding: 0 0 8px; }
.exec-goals-scroll { max-height: 260px; overflow-y: auto; }
.exec-section { margin-bottom: 8px; }
/* ── Capex capital e assets ── */
.capex-capital-wrap { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.capex-capital-info { font-size: 12px; color: var(--text-faint); }
.capex-capital-status { display: flex; align-items: center; gap: 5px; font-size: 11px; padding: 6px 10px; border-radius: 8px; }
.capex-capital-status.ok { color: #5B8C6E; background: rgba(91,140,110,0.1); }
.capex-capital-status.excedente { color: #C9A24B; background: rgba(201,162,75,0.1); }
.capex-capital-pills { display: flex; gap: 6px; flex-wrap: wrap; }
.capex-capital-pill { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; padding: 5px 10px; border-radius: 999px; cursor: pointer; }
.capex-capital-pill:hover { border-color: var(--amber); color: var(--amber); }
.capex-assets-list { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
.capex-asset-chip { display: flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); font-size: 12px; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
.capex-asset-chip.is-selected { border-color: var(--amber); color: var(--amber); background: rgba(201,162,75,0.08); }
.exec-goals-atalho { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.exec-goal-atalho { border-left: 3px solid var(--u-color); overflow: hidden; }
.exec-goal-atalho-head { width: 100%; display: flex; align-items: center; gap: 10px; background: none; border: none; padding: 12px 14px; cursor: pointer; text-align: left; color: var(--text); }
.exec-goal-atalho-info { flex: 1; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.exec-goal-atalho-title { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.exec-goal-atalho-bar { height: 3px; background: var(--surface-2); border-radius: 2px; overflow: hidden; }
.exec-goal-atalho-bar-fill { height: 100%; border-radius: 2px; transition: width 0.4s; }
.exec-goal-atalho-pct { font-family: var(--font-mono); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.exec-goal-atalho-body { padding: 4px 14px 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
.exec-goal-steps { display: flex; flex-direction: column; gap: 3px; }
.exec-goal-step { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; background: var(--surface-2); }
.exec-goal-step.done { opacity: 0.45; text-decoration: line-through; }
.exec-goal-step-num { font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--amber); width: 16px; flex-shrink: 0; }
.exec-goal-step-title { flex: 1; font-size: 12px; color: var(--text); }
.exec-goal-step-pct { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); flex-shrink: 0; }

.exec-page-new { display: flex; flex-direction: column; height: calc(100vh - 56px - 60px); overflow: hidden; padding-bottom: 0; }
.exec-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 18px 8px; }
.exec-agenda-btn { display: flex; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--border); color: var(--amber); font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 20px; cursor: pointer; }
.exec-agenda-btn:hover { background: var(--surface-2); }
.exec-body { display: flex; flex-direction: column; flex: 1; overflow: hidden; padding: 0 18px; }
.exec-goals-fixed { flex-shrink: 0; padding-bottom: 8px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
.exec-schedules-scroll { flex: 1; overflow-y: auto; padding-bottom: 140px; }
.exec-empty { padding: 32px 0; display: flex; align-items: center; justify-content: center; }
.exec-empty-text { font-size: 14px; color: var(--text-faint); font-style: italic; }

/* Lista de execuções agendadas */
.exec-schedule-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 8px; }
.exec-schedule-item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--prox-color); border-radius: 10px; padding: 13px 16px; cursor: pointer; transition: background 0.12s; }
.exec-schedule-item:hover { background: var(--surface-2); }
.exec-schedule-item-dim { opacity: 0.7; }
.exec-schedule-time { font-family: var(--font-mono); font-size: 14px; font-weight: 700; color: var(--text); flex-shrink: 0; min-width: 44px; }
.exec-schedule-label { flex: 1; font-size: 13px; color: var(--text); }
.exec-schedule-dur { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); flex-shrink: 0; }

/* Footer fixo executar */
.exec-footer-fixed { position: fixed; bottom: 56px; left: 0; right: 0; max-width: 1100px; margin: 0 auto; padding: 10px 18px 12px; background: var(--bg); border-top: 1px solid var(--border); z-index: 8; display: flex; flex-direction: column; gap: 8px; }
.exec-type-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.exec-type-btn { display: flex; flex-direction: column; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--border); border-top: 2px solid var(--t-color); border-radius: var(--radius); padding: 12px 6px; color: var(--t-color); font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.12s; }
.exec-type-btn:hover { background: var(--surface-2); }

/* manter compatibilidade com execute-quick-row ainda usado em outros lugares */
.execute-quick-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
.execute-quick-btn { display: flex; flex-direction: column; align-items: center; gap: 4px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 4px; color: var(--text-dim); font-size: 11px; cursor: pointer; }
.execute-quick-btn:active { background: var(--surface-2); }

.schedule-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
.schedule-card { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--prox-color); border-radius: 8px; padding: 12px 14px; cursor: pointer; }
.schedule-card[role="button"]:hover { background: var(--surface-2); }
.schedule-card-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--prox-color); flex-shrink: 0; }
.schedule-card-text { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
.schedule-card-title { font-size: 13px; font-weight: 600; color: var(--text); }
.schedule-card-sub { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }
.schedule-card-badge { font-family: var(--font-mono); font-size: 10px; color: var(--green); background: rgba(91,140,110,0.12); padding: 2px 6px; border-radius: 4px; width: fit-content; margin-top: 2px; }

.sched-asset-info { padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }
.sched-asset-row { display: flex; justify-content: space-between; align-items: center; }
.sched-asset-label { font-size: 12px; color: var(--text-faint); }
.sched-asset-val { font-family: var(--font-mono); font-size: 13px; color: var(--text); }

.execute-quick-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px; }
.execute-quick-btn-agenda { border-color: var(--amber-dim) !important; color: var(--amber) !important; }

/* ===== AGENDA MODAL ===== */
.agenda-sheet { background: var(--surface); width: 100%; max-width: 500px; max-height: 92vh; overflow-y: auto; border-radius: 16px 16px 0 0; border: 1px solid var(--border); box-shadow: 0 -8px 30px rgba(0,0,0,0.5); display: flex; flex-direction: column; }
@media (min-width: 680px) { .agenda-sheet { border-radius: 14px; max-height: 88vh; } }
.agenda-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.agenda-view-tabs { display: flex; gap: 1px; background: var(--border); margin: 12px 16px 0; border-radius: 10px; overflow: hidden; flex-shrink: 0; }
.agenda-view-tab { flex: 1; background: var(--surface-2); border: none; color: var(--text-faint); font-size: 13px; padding: 10px 6px; cursor: pointer; }
.agenda-view-tab.is-active { background: var(--amber); color: #1a1505; font-weight: 700; }
.agenda-quick-filters { display: flex; gap: 6px; overflow-x: auto; padding: 10px 16px 0; scrollbar-width: none; flex-shrink: 0; }
.agenda-quick-filters::-webkit-scrollbar { display: none; }
.agenda-qf-btn { flex-shrink: 0; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-faint); font-family: var(--font-mono); font-size: 11px; padding: 5px 10px; border-radius: 14px; cursor: pointer; }
.agenda-qf-btn:hover { border-color: var(--amber-dim); color: var(--amber); }
.agenda-nav { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 0; flex-shrink: 0; }
.agenda-nav-btn { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); width: 36px; height: 36px; border-radius: 50%; font-size: 20px; display: flex; align-items: center; justify-content: center; cursor: pointer; line-height: 1; }
.agenda-nav-btn:hover { border-color: var(--amber-dim); color: var(--amber); }
.agenda-nav-title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--text); text-align: center; flex: 1; padding: 0 12px; }
.agenda-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
.agenda-body-fixed { height: 420px; min-height: 420px; max-height: 420px; overflow-y: auto; flex: none; }
.agenda-footer { padding: 12px 16px 16px; border-top: 1px solid var(--border); flex-shrink: 0; }

/* === WATER GLASS DAY === */
.water-glass-day { display: flex; justify-content: center; margin-bottom: 16px; }
.water-glass-container { position: relative; width: 100%; max-width: 320px; height: 180px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
.water-glass-fill { position: absolute; bottom: 0; left: 0; right: 0; transition: height 0.6s cubic-bezier(0.4,0,0.2,1); border-radius: 0 0 11px 11px; opacity: 0.7; }
.water-glass-content { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.water-glass-num { font-family: var(--font-display); font-size: 48px; font-weight: 700; color: var(--text); line-height: 1; }
.water-glass-pct { font-family: var(--font-mono); font-size: 13px; color: var(--text-dim); }
.water-glass-day.is-today .water-glass-container { border-color: var(--amber); }

/* === WEEK VIEW === */
.agenda-week-view { display: flex; flex-direction: column; gap: 0; height: 100%; }
.agenda-week-header { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; margin-bottom: 4px; }
.agenda-week-col-head { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px 2px; }
.agenda-week-wd { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); text-transform: uppercase; }
.agenda-week-num { font-size: 13px; font-weight: 600; color: var(--text-dim); }
.agenda-week-col-head.is-today .agenda-week-num { color: var(--amber); }
.agenda-week-cols { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; flex: 1; }
.agenda-week-col { display: flex; flex-direction: column; gap: 3px; cursor: pointer; border-radius: 8px; padding: 4px 2px; }
.agenda-week-col:hover { background: var(--surface-2); }
.agenda-week-col.is-today { background: rgba(201,162,75,0.06); }
.agenda-week-glass { position: relative; height: 120px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; display: flex; align-items: flex-end; }
.agenda-week-glass-fill { position: absolute; bottom: 0; left: 0; right: 0; transition: height 0.4s ease; opacity: 0.65; }
.agenda-week-glass-pct { position: absolute; bottom: 6px; left: 0; right: 0; text-align: center; font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--text); }
.agenda-week-items { display: flex; flex-direction: column; gap: 2px; }
.agenda-week-item { padding: 2px 4px; border-radius: 3px; overflow: hidden; }
.agenda-week-item-label { display: block; font-size: 9px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.agenda-week-item-time { display: block; font-family: var(--font-mono); font-size: 9px; color: var(--text-faint); }
.agenda-week-more { font-size: 9px; color: var(--text-faint); text-align: center; }

/* === MONTH VIEW === */
.agenda-month-wd-header { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin-bottom: 4px; }
.agenda-month-wd { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); text-align: center; text-transform: uppercase; }
.agenda-month-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; }
.agenda-month-cell { background: var(--surface-2); border: 1px solid var(--border); border-radius: 6px; padding: 4px; min-height: 46px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; position: relative; }
.agenda-month-cell:hover { border-color: var(--amber-dim); }
.agenda-month-cell.is-today { border-color: var(--amber); }
.agenda-month-cell-empty { background: transparent; border: none; }
.agenda-month-day-num { font-size: 11px; font-weight: 600; color: var(--text-dim); }
.agenda-month-cell.is-today .agenda-month-day-num { color: var(--amber); }
.agenda-month-mini-glass { width: 100%; height: 20px; background: var(--border); border-radius: 3px; overflow: hidden; display: flex; align-items: flex-end; }
.agenda-month-dot { width: 5px; height: 5px; border-radius: 50%; align-self: flex-end; }

/* === YEAR VIEW === */
.agenda-year-view { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.agenda-year-cell { background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 10px 8px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; }
.agenda-year-cell:hover { border-color: var(--amber-dim); }
.agenda-year-cell.is-today { border-color: var(--amber); }
.agenda-year-month { font-family: var(--font-mono); font-size: 11px; font-weight: 600; color: var(--text-dim); }
.agenda-year-glass { width: 100%; height: 50px; background: var(--border); border-radius: 6px; overflow: hidden; display: flex; align-items: flex-end; position: relative; }
.agenda-year-glass-fill { width: 100%; transition: height 0.4s ease; opacity: 0.7; }
.agenda-year-pct { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }

/* === COMMERCIAL === */
/* ---------- dashboard meta 3 indicadores ---------- */
.dash-meta { padding: 18px; border-left: 3px solid #5B8C6E; margin-bottom: 18px; display: flex; flex-direction: column; gap: 0; }
.dash-meta-header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.dash-meta-toggle-badge { font-family: var(--font-mono); font-size: 10px; color: var(--amber); background: rgba(201,162,75,0.1); border: 1px solid rgba(201,162,75,0.3); padding: 3px 9px; border-radius: 12px; }
.dash-meta-indicator { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.dash-meta-ind-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.dash-meta-ind-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.07em; font-weight: 700; }
.dash-meta-ind-right { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.dash-meta-ind-meta { font-size: 11px; color: var(--text-faint); }
.dash-meta-ind-pct { font-family: var(--font-mono); font-size: 11px; font-weight: 700; }
.dash-meta-ind-value { font-family: var(--font-display); font-size: 26px; color: var(--text); line-height: 1.1; }
.dash-meta-bar-track { height: 5px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.dash-meta-bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s; }
.dash-meta-ind-foot { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
.dash-meta-divider { height: 1px; background: var(--border); margin: 2px 0; }

/* ---------- dashboard cards grid ---------- */
.dash-cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px; }
@media (max-width: 500px) { .dash-cards-grid { grid-template-columns: 1fr; } }

/* ---------- dashcard3 ---------- */
.dashcard3 { border-left: 3px solid var(--u-color); overflow: hidden; }
.dashcard3-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.dashcard3-badge { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; padding: 3px 7px; border-radius: 999px; color: var(--badge-color); border: 1px solid var(--badge-color); white-space: nowrap; }
.dashcard3-level-btn { display: flex; align-items: center; gap: 4px; background: none; border: 1px solid var(--border); color: var(--text-faint); font-size: 11px; padding: 6px 10px; border-radius: 12px; cursor: pointer; margin-top: 12px; }
.dashcard3-level-btn:hover { color: var(--amber); border-color: var(--amber-dim); }

/* ---------- faixa operacional bar ---------- */
.dash-faixa-bar { position: relative; height: 8px; background: var(--surface-2); border-radius: 4px; overflow: visible; margin: 10px 0 4px; }
.dash-faixa-fill { height: 100%; border-radius: 4px; transition: width 0.4s; }
.dash-faixa-mark { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--border); border-radius: 1px; }

/* ---------- periodicidade picker ---------- */
.periodo-picker { display: flex; gap: 6px; margin-bottom: 6px; flex-wrap: wrap; }
.periodo-btn { font-family: var(--font-mono); font-size: 12px; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-faint); cursor: pointer; }
.periodo-btn.is-active { background: var(--amber); color: #1a1505; border-color: var(--amber); font-weight: 700; }

/* ---------- fin summary discriminação ---------- */
.fin-summary-disc { margin-top: 2px; padding-top: 4px; border-top: 1px dashed var(--border); }
.fin-disc-var { color: #7B9BC0 !important; }
.fin-disc-fix { color: #C9A24B !important; }
.fin-launch-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
.fin-launch-btn { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 10px; border-radius: var(--radius); border: none; font-weight: 700; font-size: 13px; letter-spacing: 0.05em; cursor: pointer; }
.fin-launch-despesa { background: #C9544B; color: #fff; }
.fin-launch-despesa:hover { background: #b04840; }
.fin-launch-receita { background: #3a7d52; color: #fff; }
.fin-launch-receita:hover { background: #2e6342; }

/* ---------- extrato ---------- */
.extrato-wrap { display: flex; flex-direction: column; gap: 0; }
.extrato-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.extrato-filters { display: flex; gap: 4px; }
.extrato-filter-btn { font-family: var(--font-mono); font-size: 11px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-faint); cursor: pointer; }
.extrato-filter-btn.is-active { background: var(--amber); color: #1a1505; border-color: var(--amber); font-weight: 700; }
.extrato-filter-receita.is-active { background: #3a7d52; color: #fff; border-color: #3a7d52; }
.extrato-filter-despesa.is-active { background: #C9544B; color: #fff; border-color: #C9544B; }
.extrato-list { display: flex; flex-direction: column; gap: 4px; }
.extrato-item { border-radius: var(--radius); overflow: hidden; border: 1px solid var(--border); }
.extrato-receita { border-left: 3px solid #3a7d52; }
.extrato-despesa { border-left: 3px solid #C9544B; }
.extrato-item-head { width: 100%; display: flex; align-items: center; gap: 8px; padding: 11px 12px; background: none; border: none; cursor: pointer; text-align: left; color: var(--text); }
.extrato-item-head:hover { background: var(--surface-2); }
.extrato-item-icon { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.extrato-receita .extrato-item-icon { background: rgba(58,125,82,0.15); color: #3a7d52; }
.extrato-despesa .extrato-item-icon { background: rgba(201,84,75,0.15); color: #C9544B; }
.extrato-item-info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.extrato-item-title { font-size: 13px; font-weight: 600; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.extrato-item-date { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
.extrato-item-amount { font-family: var(--font-mono); font-size: 13px; font-weight: 700; flex-shrink: 0; }
.extrato-item-body { padding: 10px 14px 14px; border-top: 1px solid var(--border); background: var(--surface-2); }
.extrato-detail-grid { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
.extrato-detail-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.extrato-detail-label { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); text-transform: uppercase; }
.extrato-detail-val { font-size: 12px; color: var(--text); font-weight: 500; }
.extrato-item-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.dash-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.btn-charts-open { display: flex; align-items: center; gap: 6px; background: var(--surface); border: 1px solid var(--border); color: var(--amber); font-size: 13px; font-weight: 600; padding: 8px 14px; border-radius: 20px; cursor: pointer; flex-shrink: 0; margin-top: 4px; }
.btn-charts-open:hover { background: var(--surface-2); }
.charts-panel-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 40; }
.charts-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(420px, 100vw); background: var(--surface); border-left: 1px solid var(--border); z-index: 50; display: flex; flex-direction: column; transform: translateX(100%); transition: transform 0.32s cubic-bezier(0.32, 0, 0.2, 1); box-shadow: -8px 0 30px rgba(0,0,0,0.4); }
.charts-panel.is-open { transform: translateX(0); }
.charts-panel-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.charts-panel-body { flex: 1; overflow-y: auto; padding: 16px 20px 100px; }

.commercial-coming { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px; padding: 24px 0; }
.commercial-coming-title { font-family: var(--font-display); font-size: 20px; font-weight: 600; color: var(--text); }
.commercial-coming-sub { font-size: 13px; color: var(--text-dim); line-height: 1.6; max-width: 320px; }
.schedule-prefill-note { padding: 10px 12px; background: var(--surface-2); border-radius: 8px; }

.active-session { border-left: 3px solid var(--u-color); padding: 20px; margin-bottom: 20px; }
.active-session-card { overflow: hidden; border-left: 3px solid var(--u-color); margin-bottom: 10px; background: var(--surface); border: 1px solid var(--border); border-left-width: 3px; border-radius: var(--radius); }
.active-session-card-head { width: 100%; display: flex; align-items: center; gap: 8px; background: none; border: none; padding: 11px 14px; cursor: pointer; color: var(--text); text-align: left; }
.active-session-card-clock { font-family: var(--font-mono); font-size: 15px; font-weight: 700; color: var(--u-color); margin-left: auto; flex-shrink: 0; }
.active-session-card-pct { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); flex-shrink: 0; }
.active-session-card-pct.over { color: var(--red); }
.active-session-card-body { padding: 4px 14px 14px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 10px; }
.active-session-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.active-session-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--u-color); animation: pulse-dot 1.6s ease-in-out infinite; }
.active-session-unit { font-size: 13px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.active-session-label { font-size: 14px; color: var(--text); margin-bottom: 12px; }
.active-session-clock { font-family: var(--font-mono); font-size: 40px; color: var(--text); margin: 8px 0 14px; }
.active-session-progress { height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; margin-bottom: 8px; }
.active-session-progress-fill { height: 100%; background: var(--u-color); }
.active-session-progress-fill.over { background: var(--red); }
.active-session-planned { font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); display: flex; align-items: center; gap: 6px; margin-bottom: 16px; }
.active-session-planned.over { color: var(--red); }
.active-session-actions { display: flex; gap: 10px; }
.btn-stop { flex: 1; background: var(--text); color: var(--bg); border: none; padding: 12px; border-radius: 8px; font-weight: 600; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; }
.btn-ghost-danger { background: none; border: 1px solid var(--border); color: var(--red); padding: 12px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }

.ledger { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.ledger-row { display: flex; align-items: center; justify-content: space-between; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.25); padding: 12px 14px; gap: 10px; }
.ledger-row-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ledger-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ledger-row-text { display: flex; flex-direction: column; min-width: 0; }
.ledger-row-title { font-size: 13px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ledger-row-date { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }
.ledger-row-date.is-late { color: var(--red); font-weight: 600; }
.ledger-row-amount { font-family: var(--font-mono); font-size: 13px; flex-shrink: 0; }
.ledger-row-amount.pos { color: var(--green); }
.ledger-row-amount.neg { color: var(--red); }
.pos-text { color: var(--green); font-weight: 600; }
.neg-text { color: var(--red); font-weight: 600; }

.assets-total { border-left-color: var(--amber); }

.charts-modo-toggle { display: flex; gap: 1px; background: var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 10px; }
.charts-modo-btn { flex: 1; padding: 11px; border: none; background: var(--surface); color: var(--text-faint); font-size: 14px; font-weight: 600; cursor: pointer; }
.charts-modo-btn.is-active { background: var(--amber); color: #1a1505; }
.charts-sub-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.charts-sub-btn { font-family: var(--font-mono); font-size: 11px; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-faint); cursor: pointer; }
.charts-sub-btn.is-active { background: var(--surface); border-color: var(--amber); color: var(--amber); font-weight: 700; }
.chart-period-field { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 140px; }
.chart-period-selects { display: flex; gap: 4px; }
.chart-period-sel { flex: 1; padding: 8px 6px; font-size: 13px; min-width: 0; }

.chart-card { padding: 18px; margin-bottom: 18px; }
.chart-card-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; flex-wrap: wrap; }
.chart-diff { font-size: 12px; font-weight: 600; white-space: nowrap; }
.asset-row { flex-wrap: wrap; gap: 8px; }
.vx-equity-breakdown { margin-top: 12px; margin-bottom: 0; }
.ledger-row-end { display: flex; align-items: center; gap: 8px; }
.ledger-row-del { background: none; border: none; color: var(--text-faint); cursor: pointer; display: flex; padding: 2px; }
.ledger-row-del:hover { color: var(--red); }
.ledger-tag { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; padding: 3px 6px; border-radius: 4px; flex-shrink: 0; }
.ledger-tag.entrada { background: rgba(91,140,110,0.15); color: var(--green); }
.ledger-tag.saída, .ledger-tag.saida { background: rgba(123,155,192,0.15); color: var(--blue); }
.ledger-tag.custo { background: rgba(201,84,75,0.15); color: var(--red); }

.fin-row-entrada { border-left: 3px solid var(--green); padding-left: 11px; }
.fin-row-saida { border-left: 3px solid var(--blue); padding-left: 11px; }
.fin-row-custo, .fin-row-expense { border-left: 3px solid var(--red); padding-left: 11px; }

.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: flex-end; justify-content: center; z-index: 100; }
@media (min-width: 680px) { .modal-overlay { align-items: center; } }
.modal-sheet { background: var(--surface); width: 100%; max-width: 460px; max-height: 88vh; overflow-y: auto; border-radius: 16px 16px 0 0; border: 1px solid var(--border); border-bottom: none; box-shadow: 0 -8px 30px rgba(0,0,0,0.4); }
@media (min-width: 680px) { .modal-sheet { border-radius: 14px; border-bottom: 1px solid var(--border); } }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 18px 20px; border-bottom: 1px solid var(--border); }
.modal-title { font-family: var(--font-display); font-size: 17px; font-weight: 600; }
.modal-close { background: none; border: none; color: var(--text-faint); cursor: pointer; display: flex; }
.modal-body { padding: 18px 20px 24px; }
.modal-submit { width: 100%; margin-top: 20px; justify-content: center; }
.modal-helper { font-size: 13px; color: var(--text-dim); line-height: 1.5; margin: 8px 0 4px; }
.field-warning { display: flex; align-items: center; gap: 6px; color: var(--red); font-size: 12px; margin-top: 8px; }

.mode-toggle { display: flex; gap: 1px; background: var(--border); border-radius: 8px; overflow: hidden; margin-bottom: 16px; border: 1px solid var(--border); }
.mode-toggle-btn { flex: 1; background: var(--surface-2); border: none; color: var(--text-faint); padding: 10px; font-size: 12px; cursor: pointer; }
.mode-toggle-btn.is-active { background: var(--amber); color: #1a1505; font-weight: 600; }

.outcome-buttons { display: flex; gap: 10px; margin-top: 16px; }
.stop-confirm-elapsed { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 16px 0; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.stop-confirm-clock { font-family: var(--font-mono); font-size: 36px; color: var(--text); }
.stop-confirm-btns { display: flex; flex-direction: column; gap: 10px; }
.stop-confirm-btn { display: flex; align-items: center; gap: 14px; padding: 16px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-2); cursor: pointer; text-align: left; }
.stop-confirm-btn div { display: flex; flex-direction: column; gap: 3px; }
.stop-confirm-btn-title { font-size: 15px; font-weight: 700; }
.stop-confirm-btn-sub { font-size: 12px; color: var(--text-faint); }
.stop-confirm-encerrar { border-color: var(--red); color: var(--red); }
.stop-confirm-encerrar:hover { background: rgba(201,84,75,0.08); }
.stop-confirm-reagendar { border-color: var(--amber); color: var(--amber); }
.stop-confirm-reagendar:hover { background: rgba(201,162,75,0.08); }
.stop-confirm-proxima { padding: 14px; display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; border-left: 2px solid var(--amber); }
.stop-confirm-data { font-family: var(--font-display); font-size: 20px; color: var(--amber); }
.stop-confirm-reagendar-actions { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
.outcome-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 16px; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer; border: 1px solid var(--border); background: var(--surface-2); }
.outcome-btn.success { color: var(--green); border-color: var(--green); }
.outcome-btn.fail { color: var(--red); border-color: var(--red); }

.hm-input { display: flex; gap: 10px; }
.hm-field { position: relative; flex: 1; }
.hm-field .field-input { padding-right: 38px; }
.hm-suffix { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-family: var(--font-mono); font-size: 12px; color: var(--text-faint); }

.unit-picker { display: flex; flex-wrap: wrap; gap: 8px; }
.unit-pick { display: flex; align-items: center; gap: 6px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); padding: 8px 12px; border-radius: 20px; font-size: 12px; cursor: pointer; }
.unit-pick-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--u-color); }
.unit-pick.is-selected { border-color: var(--u-color); color: var(--text); background: rgba(255,255,255,0.04); }

.weekday-picker { display: flex; gap: 6px; }
.weekday-pick { flex: 1; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); border-radius: 50%; font-size: 13px; font-weight: 600; cursor: pointer; }
.weekday-pick.is-selected { background: var(--amber); border-color: var(--amber); color: #1a1410; }

.service-row { flex-wrap: wrap; gap: 8px; }
.service-activity-picker { display: flex; flex-wrap: wrap; gap: 8px; }
.service-activity-pick { width: auto; aspect-ratio: unset; border-radius: 20px; padding: 8px 14px; font-size: 12px; font-weight: 500; }

.recurring-row { flex-wrap: wrap; gap: 8px; }

.occurrences-list { gap: 10px; }
.occurrence-card { padding: 14px; border-left: 3px solid var(--u-color); display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.occurrence-info { display: flex; flex-direction: column; gap: 2px; }
.occurrence-title { font-size: 13px; font-weight: 600; color: var(--text); }
.occurrence-sub { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }
.occurrence-actions { display: flex; gap: 6px; }

.recurring-pending-btn { width: 100%; display: flex; align-items: center; gap: 12px; border: none; cursor: pointer; text-align: left; color: var(--amber); border-left: 3px solid var(--amber); margin-bottom: 22px; }
.recurring-pending-text { display: flex; flex-direction: column; gap: 2px; }

.cat-picker { display: flex; flex-wrap: wrap; gap: 8px; }
.cat-pick { background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); padding: 8px 12px; border-radius: 20px; font-size: 12px; cursor: pointer; }
.cat-pick.is-selected.entrada { border-color: var(--green); color: var(--green); }
.cat-pick.is-selected.saída, .cat-pick.is-selected.saida { border-color: var(--blue); color: var(--blue); }
.cat-pick.is-selected.custo { border-color: var(--red); color: var(--red); }

.full-width { width: 100%; justify-content: center; margin-bottom: 12px; }

.cof-total { padding: 18px; display: flex; flex-direction: column; gap: 6px; border-left: 2px solid var(--red); margin-bottom: 18px; }
.cof-total.projected-cash { border-left-color: var(--blue); }

.fin-summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
@media (max-width: 500px) { .fin-summary-grid { grid-template-columns: 1fr; } }
.fin-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
@media (max-width: 500px) { .fin-summary { grid-template-columns: 1fr; } }
.fin-summary-item { padding: 14px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--border); display: flex; flex-direction: column; gap: 4px; }
.fin-summary-item.fin-income { border-left-color: var(--green); }
.fin-summary-item.fin-expense { border-left-color: var(--red); }
.fin-summary-item.fin-balance { border-left-color: var(--blue); }
.fin-summary-value { font-family: var(--font-display); font-size: 19px; }
.fin-summary-sub-row { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; padding-top: 6px; border-top: 1px solid var(--border); }
.fin-summary-sub { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }

.dues-panel { padding: 18px; margin-bottom: 22px; border-left: 3px solid var(--red); }
.fixedcost-row { flex-wrap: wrap; gap: 8px; }
.btn-tiny.is-paid { color: var(--green); border-color: rgba(91,140,110,0.4); }
.btn-tiny.is-paid-toggle { color: var(--green); border-color: rgba(91,140,110,0.4); }
.cof-total-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--text-faint); }
.cof-total-value { font-family: var(--font-display); font-size: 28px; color: var(--red); }

.alloc-bars { padding: 16px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 8px; }
.alloc-row { display: flex; align-items: center; gap: 10px; }
.alloc-row-label { font-size: 12px; color: var(--text-dim); width: 110px; flex-shrink: 0; }
.alloc-row-track { flex: 1; height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.alloc-row-fill { height: 100%; border-radius: 3px; }
.alloc-row-pct { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); width: 76px; text-align: right; }

.debt-hero { padding: 20px; border-left: 3px solid var(--red); display: flex; flex-direction: column; gap: 6px; margin-bottom: 18px; }
.debt-hero.clear { border-left-color: var(--green); }
.debt-hero-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--text-faint); }
.debt-hero-value { font-family: var(--font-display); font-size: 34px; color: var(--red); }
.debt-hero.clear .debt-hero-value { color: var(--green); }
.debt-hero-clear { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--green); }

.precision-hero { padding: 22px; border-left: 3px solid var(--p-color); display: flex; flex-direction: column; gap: 4px; margin-bottom: 18px; }
.precision-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; color: var(--text-faint); }
.precision-value { font-family: var(--font-display); font-size: 40px; color: var(--p-color); }
.precision-sub { font-size: 12px; color: var(--text-dim); }

.memo-list { display: flex; flex-direction: column; gap: 10px; }

.history-split { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
@media (max-width: 760px) { .history-split { grid-template-columns: 1fr; gap: 8px; } }
.history-col { display: flex; flex-direction: column; min-width: 0; }

.vx-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
@media (max-width: 480px) { .vx-grid { grid-template-columns: 1fr; } }
.vx-hero { padding: 18px; border-left: 3px solid var(--amber); display: flex; flex-direction: column; gap: 6px; }
.vx-hero.vx-hero-valuation { border-left-color: #7B9BC0; }
.vx-hero-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.08em; color: var(--text-faint); text-transform: uppercase; }
.vx-hero-value { font-family: var(--font-display); font-size: 28px; color: var(--text); line-height: 1.15; }
.vx-hero.vx-hero-valuation .vx-hero-value { color: #7B9BC0; }
.vx-hero-sub { font-size: 11px; color: var(--text-faint); line-height: 1.4; }

.vx-equity { padding: 20px; border-left: 3px solid var(--green); display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
.vx-equity-value { font-family: var(--font-display); font-size: 32px; color: var(--green); }
.vx-equity-value.neg { color: var(--red); }

.vx-note { margin-top: 4px; }

.vx-preview { padding: 14px 16px; border-left: 3px solid #7B9BC0; background: var(--surface-2); border-radius: 8px; display: flex; flex-direction: column; gap: 4px; margin: 16px 0 4px; }
.vx-preview-label { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.07em; color: var(--text-faint); text-transform: uppercase; }
.vx-preview-value { font-family: var(--font-display); font-size: 22px; color: #7B9BC0; }
.vx-preview-sub { font-size: 11px; color: var(--text-faint); }

.mp-alert { padding: 18px; margin-bottom: 22px; border-left: 3px solid var(--green); }
.mp-alert.is-negative { border-left-color: var(--red); }
.mp-alert-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; color: var(--green); }
.mp-alert.is-negative .mp-alert-head { color: var(--red); }
.mp-alert-title { font-family: var(--font-display); font-size: 15px; font-weight: 600; color: var(--text); }
.mp-alert-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
@media (max-width: 600px) { .mp-alert-grid { grid-template-columns: 1fr; } }
.mp-alert-item { display: flex; flex-direction: column; gap: 4px; }
.mp-alert-value { font-family: var(--font-display); font-size: 20px; color: var(--text); }
.mp-alert-sub { font-size: 11px; font-weight: 600; }

.mp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 22px; }
@media (max-width: 760px) { .mp-grid { grid-template-columns: 1fr; } }
.mp-panel { padding: 18px; border-left: 3px solid var(--amber); display: flex; flex-direction: column; gap: 6px; }
.mp-panel-target { border-left-color: #5B8C6E; }
.mp-panel-value { font-family: var(--font-display); font-size: 24px; color: var(--text); line-height: 1.15; }
.mp-bar { height: 4px; background: var(--surface-2); border-radius: 2px; overflow: hidden; margin-top: 4px; }
.mp-bar-fill { height: 100%; background: var(--amber); border-radius: 2px; }
.mp-panel-foot { font-size: 11px; color: var(--text-faint); margin-top: 4px; }

.mp-sections { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
@media (max-width: 760px) { .mp-sections { grid-template-columns: 1fr; } }
.mp-section { padding: 18px; display: flex; flex-direction: column; gap: 10px; border-top: 2px solid var(--amber); }
.mp-section-label { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--text); }
.mp-section-text { min-height: 64px; resize: vertical; }

/* ---------- master plan single form ---------- */
.mpf { display: flex; flex-direction: column; gap: 18px; max-width: 640px; margin: 0 auto; }
.mpf-block { padding: 20px; display: flex; flex-direction: column; gap: 10px; border-top: 2px solid var(--amber); }
.mpf-block-label { font-family: var(--font-display); font-size: 18px; font-weight: 600; color: var(--text); margin-bottom: 2px; }

.impact-slider { width: 100%; height: 6px; border-radius: 3px; appearance: none; background: var(--surface-2); accent-color: var(--i-color); cursor: pointer; margin: 4px 0; }
.impact-slider::-webkit-slider-thumb { appearance: none; width: 18px; height: 18px; border-radius: 50%; background: var(--i-color); cursor: pointer; }
.impact-readout { display: flex; align-items: center; gap: 10px; }
.impact-pct { font-family: var(--font-display); font-size: 20px; font-weight: 600; }
.impact-badge { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; padding: 4px 9px; border-radius: 999px; color: var(--badge-color); border: 1px solid var(--badge-color); }

.mpf-activity { padding: 14px; background: var(--surface-2); border-radius: 10px; display: flex; flex-direction: column; gap: 8px; }
.mpf-activity-label { font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em; color: var(--text-faint); text-transform: uppercase; }

/* ---------- capital executivo — alocação ---------- */
.capex-goal { overflow: hidden; border-left: 3px solid var(--amber); margin-bottom: 10px; }
.capex-goal-selected { border-left-color: #5B8C6E; }
.capex-aloc-body { padding: 4px 16px 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.capex-sugestao { width: 100%; text-align: left; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.capex-sugestao.is-selected { border-color: #5B8C6E; background: rgba(91,140,110,0.08); }
.capex-sug-head { display: flex; align-items: center; gap: 8px; }
.capex-sug-label { font-weight: 700; font-size: 14px; color: var(--text); }
.capex-sug-tempo { font-family: var(--font-mono); font-size: 13px; color: var(--amber); margin-left: auto; }
.capex-sug-impacto { font-family: var(--font-mono); font-size: 10px; padding: 2px 7px; border-radius: 999px; }
.capex-impacto-baixo { color: #7B9BC0; background: rgba(123,155,192,0.12); border: 1px solid rgba(123,155,192,0.3); }
.capex-impacto-médio, .capex-impacto-medio { color: #C9A24B; background: rgba(201,162,75,0.12); border: 1px solid rgba(201,162,75,0.3); }
.capex-impacto-alto { color: #5B8C6E; background: rgba(91,140,110,0.12); border: 1px solid rgba(91,140,110,0.3); }
.capex-sug-desc { font-size: 12px; color: var(--text-faint); }
.capex-sug-blocos { display: flex; flex-wrap: wrap; gap: 4px; }
.capex-sug-bloco { font-family: var(--font-mono); font-size: 10px; padding: 2px 6px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; color: var(--text-dim); }
.capex-bloco-livre { width: 100%; display: flex; align-items: center; gap: 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; cursor: pointer; margin-bottom: 4px; text-align: left; }
.capex-bloco-livre.is-selected { border-color: #5B8C6E; background: rgba(91,140,110,0.08); }
.capex-bloco-dia { font-size: 12px; color: var(--text-dim); flex: 1; }
.capex-bloco-hora { font-family: var(--font-mono); font-size: 12px; color: var(--text); }
.capex-bloco-h { font-family: var(--font-mono); font-size: 11px; color: var(--text-faint); }

/* ---------- plano diretor subindicadores e etapas ---------- */
.mpd-sub-row { display: flex; align-items: center; gap: 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; cursor: pointer; margin-bottom: 4px; }
.mpd-sub-row.is-selected { border-color: var(--amber); background: rgba(201,162,75,0.06); }
.mpd-sub-check { width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.mpd-sub-check.checked { background: var(--amber); border-color: var(--amber); color: #1a1505; }
.mpd-sub-info { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.mpd-sub-nome { font-size: 13px; font-weight: 600; color: var(--text); }
.mpd-sub-vals { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); }
.mpd-sub-impacto { font-family: var(--font-mono); font-size: 10px; padding: 2px 7px; border-radius: 999px; flex-shrink: 0; }
.mpd-impacto-critico { color: #C9544B; background: rgba(201,84,75,0.12); border: 1px solid rgba(201,84,75,0.3); }
.mpd-impacto-alto { color: #C9A24B; background: rgba(201,162,75,0.12); border: 1px solid rgba(201,162,75,0.3); }
.mpd-impacto-medio { color: #7B9BC0; background: rgba(123,155,192,0.12); border: 1px solid rgba(123,155,192,0.3); }
.mpd-etapa-row { display: flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin-bottom: 4px; }
.mpd-etapa-num { font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--amber); width: 20px; flex-shrink: 0; }
.mpd-etapa-titulo { flex: 1; font-size: 13px; color: var(--text); }
.mpd-etapa-btns { display: flex; gap: 4px; }
.mpd-etapa-add { display: flex; gap: 8px; margin-top: 6px; }
.mpd-etapa-add .field-input { flex: 1; }
.mpd-etapa-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.mpd-step-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--border); }
.mpd-step-row:last-child { border-bottom: none; }
.mpd-step-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--border); flex-shrink: 0; border: 2px solid var(--text-faint); }
.mpd-step-dot.done { background: #5B8C6E; border-color: #5B8C6E; }
.mpd-step-title { flex: 1; font-size: 13px; color: var(--text); }
.mpd-goal-row { padding: 14px 16px; overflow: hidden; border-left: 3px solid var(--amber); margin-bottom: 10px; }
.mpd-goal-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
.mpd-goal-info { display: flex; flex-direction: column; gap: 2px; }
.mpd-goal-title { font-size: 14px; font-weight: 600; color: var(--text); }
.mpd-goal-unit { font-size: 11px; color: var(--text-faint); }
.mpd-goal-pct { font-family: var(--font-mono); font-size: 16px; font-weight: 700; }
.mpd-goal-steps { padding-top: 10px; display: flex; flex-direction: column; gap: 4px; }
.mpd-goal-badge-alerta { font-family: var(--font-mono); font-size: 9px; padding: 2px 6px; border-radius: 4px; background: rgba(201,84,75,0.15); color: #C9544B; width: fit-content; }
.mpd-goal-alerta-alocacao { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--amber); padding-top: 8px; }
.mpd-diag-main { margin-bottom: 4px; }
.mpd-card { overflow: hidden; margin-bottom: 12px; border-left: 3px solid var(--border); }
.mpd-card-ok { border-left-color: #5B8C6E; }
.mpd-card-alert { border-left-color: #C9544B; }
.mpd-card-filled { border-left-color: #C9A24B; }
.mpd-card-head { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: none; border: none; padding: 16px 18px; cursor: pointer; text-align: left; color: var(--text); }
.mpd-card-head-left { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; }
.mpd-card-title { font-family: var(--font-display); font-size: 16px; font-weight: 600; color: var(--text); }
.mpd-card-status { font-family: var(--font-mono); font-size: 10px; padding: 3px 8px; border-radius: 999px; flex-shrink: 0; }
.mpd-card-status.ok { color: #5B8C6E; background: rgba(91,140,110,0.12); border: 1px solid rgba(91,140,110,0.3); }
.mpd-card-status.alert { color: #C9544B; background: rgba(201,84,75,0.12); border: 1px solid rgba(201,84,75,0.3); }
.mpd-card-status.pending { color: #C9A24B; background: rgba(201,162,75,0.12); border: 1px solid rgba(201,162,75,0.3); }
.mpd-card-body { padding: 4px 18px 18px; display: flex; flex-direction: column; gap: 10px; border-top: 1px solid var(--border); }

/* ---------- plano diretor urgência ---------- */
.mpd-urgencia { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.mpd-urgencia-item { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--alert-color); border-radius: var(--radius); overflow: hidden; }
.mpd-urgencia-head { width: 100%; display: flex; align-items: center; gap: 10px; background: none; border: none; padding: 14px 16px; cursor: pointer; text-align: left; color: var(--text); }
.mpd-urgencia-level { font-family: var(--font-mono); font-size: 10px; flex-shrink: 0; }
.mpd-urgencia-label { flex: 1; font-size: 13px; font-weight: 600; color: var(--text); }
.mpd-urgencia-diag { padding: 12px 16px 16px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 8px; }
.mpd-diag-diff { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; background: var(--surface-2); border-radius: 8px; }
.mpd-diag-diff-value { font-family: var(--font-display); font-size: 22px; font-weight: 600; }
.mpd-diag-tags { display: flex; flex-wrap: wrap; gap: 6px; }
.mpd-diag-tag { font-family: var(--font-mono); font-size: 11px; padding: 4px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); }
.mpd-prefill-hint { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--amber); background: rgba(201,162,75,0.08); padding: 8px 12px; border-radius: 8px; }
.mpd-tudo-ok { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-left: 3px solid #5B8C6E; margin-bottom: 8px; }
.mpd-tudo-ok-label { font-size: 14px; font-weight: 600; color: #5B8C6E; }
.mpf-textarea { min-height: 72px; resize: vertical; font-family: var(--font-mono); font-size: 13px; line-height: 1.5; }
.mpf-quando-preview { padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; border-left: 2px solid var(--amber); margin: 8px 0; background: var(--surface-2); border-radius: 8px; }
.mpf-quando-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.mpf-quando-weeks { font-family: var(--font-display); font-size: 22px; color: var(--amber); }
.mpf-quando-alert { display: flex; align-items: center; gap: 6px; color: var(--red); font-size: 12px; font-weight: 600; }
.mpf-prioridade-grid { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
.mpf-prioridade-card { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface-2); border-radius: 8px; border-left: 3px solid var(--p-color); }
.mpf-prioridade-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--p-color); flex-shrink: 0; }
.mpf-prioridade-label { font-size: 13px; font-weight: 600; color: var(--text); display: block; }
.mpf-prioridade-sub { font-size: 11px; color: var(--text-faint); }

.goal-card-impact { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.05em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; color: var(--badge-color); border: 1px solid var(--badge-color); flex-shrink: 0; }

.memo-card { overflow: hidden; }
.memo-head { width: 100%; display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: none; border: none; cursor: pointer; text-align: left; }
.memo-status { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.memo-status.concluída_êxito { background: rgba(91,140,110,0.18); color: var(--green); }
.memo-status.concluída_falha { background: rgba(201,84,75,0.18); color: var(--red); }
.memo-head-text { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.memo-title { font-size: 14px; color: var(--text); }
.memo-sub { font-size: 11px; color: var(--text-faint); }
.memo-body { padding: 0 16px 16px; }

.goal-list { display: flex; flex-direction: column; gap: 10px; }
.goal-card { overflow: hidden; border-top: 2px solid var(--u-color); }
.goal-card-head { width: 100%; display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: none; border: none; cursor: pointer; text-align: left; color: var(--text); }
.goal-card-unit { font-size: 10px; color: var(--text-faint); text-transform: uppercase; flex-shrink: 0; }
.goal-card-title { flex: 1; font-size: 14px; }
.goal-card-pct { font-family: var(--font-mono); font-size: 12px; color: var(--amber); }
.goal-card-bar { height: 2px; background: var(--surface-2); margin: 0 16px; }
.goal-card-bar-fill { height: 100%; background: var(--amber); }
.goal-card-body { padding: 14px 16px 16px; }
.goal-card-desc { font-size: 13px; color: var(--text-dim); line-height: 1.5; margin: 0 0 12px; }
.goal-card-actions { display: flex; gap: 8px; margin-bottom: 14px; flex-wrap: wrap; }

.btn-tiny { display: inline-flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); font-size: 11px; padding: 6px 10px; border-radius: 14px; cursor: pointer; }
.btn-tiny.danger { color: var(--red); border-color: rgba(201,84,75,0.3); }
.btn-reset.is-confirming { background: var(--red); color: #fff; border-color: var(--red); }

.step-list { display: flex; flex-direction: column; gap: 10px; }
.step-card { background: var(--surface-2); border-radius: 8px; padding: 10px 12px; }
.step-card-head { display: flex; align-items: center; gap: 8px; color: var(--text-dim); margin-bottom: 8px; }
.step-card-title { flex: 1; font-size: 13px; color: var(--text); }
.step-empty { font-size: 12px; color: var(--text-faint); font-style: italic; padding: 4px 0; }

.activity-list { display: flex; flex-direction: column; gap: 6px; }
.activity-row { display: flex; align-items: center; gap: 8px; background: var(--surface); border-radius: 6px; padding: 8px 10px; }
.activity-priority-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.activity-row-title { flex: 1; font-size: 12px; color: var(--text); }
.activity-status-tag { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; color: var(--text-faint); background: var(--surface-2); }
.activity-status-tag.concluída_êxito { color: var(--green); background: rgba(91,140,110,0.15); }
.activity-status-tag.concluída_falha { color: var(--red); background: rgba(201,84,75,0.15); }
.activity-status-tag.em_andamento { color: var(--amber); background: rgba(201,162,75,0.15); }

.manage-list { display: flex; flex-direction: column; gap: 10px; }
.manage-row { padding: 14px 16px; border-top: 2px solid var(--u-color); }
.manage-row-top { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.manage-row-title { flex: 1; font-size: 13px; color: var(--text); }
.manage-row-unit { font-size: 10px; color: var(--text-faint); text-transform: uppercase; }
.manage-row-time { display: flex; flex-direction: column; gap: 6px; }
.manage-row-time-label { font-family: var(--font-mono); font-size: 10px; color: var(--text-faint); text-transform: uppercase; }

.settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px; }
.settings-item { padding: 14px; display: flex; flex-direction: column; gap: 4px; }
.settings-item-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; }
.settings-item-value { font-family: var(--font-mono); font-size: 15px; color: var(--text); }
.settings-note { font-size: 13px; color: var(--text-dim); line-height: 1.6; margin: 0 0 16px; }
.settings-actions { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.btn-ghost-upload { display: inline-flex; align-items: center; gap: 8px; background: var(--surface-2); border: 1px solid var(--border); color: var(--text-dim); padding: 12px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; justify-content: center; }

.btn-primary { display: inline-flex; align-items: center; gap: 8px; background: var(--amber); color: #1a1505; border: none; padding: 12px 18px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; font-family: var(--font-body); box-shadow: 0 4px 12px rgba(201,162,75,0.2); }
.btn-primary:hover { background: #d9b15c; }
.btn-primary:disabled { background: var(--surface-2); color: var(--text-faint); cursor: not-allowed; box-shadow: none; }

/* ---------- capital toggle ---------- */
.capital-toggle { display: flex; gap: 1px; background: var(--border); border-radius: var(--radius); overflow: hidden; margin-bottom: 20px; border: 1px solid var(--border); }
.capital-toggle-btn { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; background: var(--surface); border: none; color: var(--text-faint); font-size: 13px; padding: 13px 8px; cursor: pointer; }
.capital-toggle-btn.is-active { background: var(--amber); color: #1a1505; font-weight: 600; }

/* ---------- bottomnav dual-mode / cubo mágico ---------- */
.bottomnav-wrap { position: fixed; bottom: 0; left: 0; right: 0; max-width: 1100px; margin: 0 auto; perspective: 800px; z-index: 10; }
.bottomnav { display: flex; background: var(--surface); border-top: 1px solid var(--border); box-shadow: 0 -4px 16px rgba(0,0,0,0.3); transform-origin: center bottom; animation: cube-enter 0.38s ease-out; }
.bottomnav.cube-exit { animation: cube-flip 0.38s ease-in forwards; }
@keyframes cube-flip {
  0%   { transform: rotateX(0deg);    opacity: 1; }
  100% { transform: rotateX(-90deg);  opacity: 0; }
}
@keyframes cube-enter {
  0%   { transform: rotateX(90deg);   opacity: 0; }
  100% { transform: rotateX(0deg);    opacity: 1; }
}
.bottomnav-item.is-switch { color: var(--amber); }
.bottomnav-item.is-switch .bottomnav-label { color: var(--amber); font-weight: 600; }
.bottomnav { position: static; }
.bottomnav-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 10px 4px 12px; background: none; border: none; color: var(--text-faint); cursor: pointer; }
.bottomnav-item.is-active { color: var(--amber); }
.bottomnav-icon-wrap { position: relative; }
.bottomnav-pulse { position: absolute; top: -2px; right: -4px; width: 6px; height: 6px; border-radius: 50%; background: var(--amber); animation: pulse-dot 1.6s ease-in-out infinite; }
.bottomnav-pulse.red { background: var(--red); }
.bottomnav-label { font-size: 10px; letter-spacing: 0.02em; }

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
button:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .boot-bar-fill, .topbar-live-dot, .active-session-dot, .bottomnav-pulse { animation: none; } }
`;
