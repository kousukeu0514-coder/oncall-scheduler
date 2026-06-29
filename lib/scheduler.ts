import { Doctor, Schedule, Assignment, CustomHoliday, Carryover } from "./types";
import {
  getDatesInPeriod,
  getDayType,
  getShiftUnits,
  getTargetUnits,
  getAdjustedTarget,
  toDateString,
  isWeekendOrHoliday,
} from "./holidays";

interface DoctorState {
  doctor: Doctor;
  target: number;
  baseTarget: number;
  accumulated: number;
  shiftCount: number;
  weekendHolidayCount: number;   // 今月の土日祝シフト回数（上限チェック用）
  weekendHolidayTotal: number;   // 累積土日祝回数（繰り越し含む、公平性ソート用）
  lastShiftDate: string | null;
}

const SAT_PREFIX = "__sat__";
const WH_PREFIX = "__wh__";

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000
  );
}

// 間隔チェック：中1日以上（= 当日と次のシフトが2日以上離れている）
function hasEnoughGap(s: DoctorState, dateStr: string): boolean {
  return !s.lastShiftDate || daysBetween(s.lastShiftDate, dateStr) >= 2;
}

function isJunior(s: DoctorState): boolean {
  return (s.doctor.yearsOfExperience ?? 0) < 10;
}

function isSeniorAllowed(s: DoctorState): boolean {
  return isJunior(s) || s.shiftCount === 0;
}

// 週末スロットの候補を絞る：若手優先→シニア→最終手段
function applyWeekendFilters(
  candidates: DoctorState[],
  gapFiltered: DoctorState[],
  base: DoctorState[],
  dateStr: string,
  label: string,
  warnings: string[]
): DoctorState[] {
  // Step 1: 若手 OR シニア未割当（0回）かつ上限未満
  // ※ シニア0回はpickBest内で最優先、若手は2回までを先に埋める
  const priorityWithCap = candidates.filter(
    (s) => (isJunior(s) || s.shiftCount === 0) && s.weekendHolidayCount < 2
  );
  if (priorityWithCap.length > 0) return priorityWithCap;

  // Step 2: 全員（シニア2回目も許可）かつ上限未満
  const withCap = candidates.filter((s) => s.weekendHolidayCount < 2);
  if (withCap.length > 0) return withCap;

  // Step 2.5: シニア2回目になるよりも若手（9年目以下）の土日祝3回目を優先
  const juniorThirdCap = gapFiltered.filter((s) => isJunior(s) && s.weekendHolidayCount < 3);
  if (juniorThirdCap.length > 0) return juniorThirdCap;

  // Step 3: シニア制限を緩める（上限未満 + 間隔維持）
  const seniorRelaxed = gapFiltered.filter((s) => s.weekendHolidayCount < 2);
  if (seniorRelaxed.length > 0) return seniorRelaxed;

  // Step 4: 間隔制限も緩める（上限未満のみ維持）
  const fullRelaxed = base.filter((s) => s.weekendHolidayCount < 2);
  if (fullRelaxed.length > 0) return fullRelaxed;

  // Step 5: 全員上限超え→上限を緩める（最終手段）
  warnings.push(`${dateStr} ${label}: 週末シフト上限超過のため上限を緩めて割り当てます`);
  return base;
}

export function generateSchedule(
  year: number,
  month: number,
  doctors: Doctor[],
  customHolidays: CustomHoliday[] = [],
  carryover: Carryover = {}
): { schedule: Schedule; warnings: string[]; newCarryover: Carryover } {
  const dates = getDatesInPeriod(year, month);
  const assignments: Assignment[] = [];
  const warnings: string[] = [];

  const satLastMonth = new Set<string>(
    Object.entries(carryover)
      .filter(([k, v]) => k.startsWith(SAT_PREFIX) && v === 1)
      .map(([k]) => k.slice(SAT_PREFIX.length))
  );
  const satThisMonth = new Set<string>();

  const states: DoctorState[] = doctors.map((doc) => {
    const base = getTargetUnits(doc.yearsOfExperience ?? 3);
    const baseTarget = getAdjustedTarget(base, doc.isRotating);
    const carry = carryover[doc.name] ?? 0;
    const adjusted = baseTarget - carry;
    const target = doc.hasChildcare === true
      ? Math.min(2, Math.max(0.5, Math.round(adjusted * 2) / 2))
      : Math.min(5.5, Math.max(0.5, Math.round(adjusted * 2) / 2));
    return {
      doctor: doc,
      target,
      baseTarget,
      accumulated: 0,
      shiftCount: 0,
      weekendHolidayCount: 0,
      weekendHolidayTotal: carryover[`${WH_PREFIX}${doc.name}`] ?? 0,
      lastShiftDate: null,
    };
  });

  const assignMap = new Map<string, Assignment>();

  for (const date of dates) {
    const dateStr = toDateString(date);
    const dayType = getDayType(date, customHolidays);
    const needsDayshift = dayType === "second-saturday" || dayType === "holiday";
    const isWH = isWeekendOrHoliday(date, customHolidays);

    const assignment: Assignment = { date: dateStr, dayType, dayshift: null, oncall: null };

    // ── 日直 ──────────────────────────────────────────────────
    if (needsDayshift) {
      const prevDateStr = toDateString(new Date(date.getTime() - 86400000));
      const prevAssignment = assignMap.get(prevDateStr);

      const base = states.filter((s) => {
        if (s.doctor.unavailableDates.dayshift.includes(dateStr)) return false;
        if (prevAssignment?.oncall === s.doctor.name) return false;
        return true;
      });

      // 間隔：中1日以上（hard）
      const gapFiltered = base.filter((s) => hasEnoughGap(s, dateStr));
      let candidates = gapFiltered.length > 0 ? gapFiltered : (() => {
        warnings.push(`${dateStr} 日直: 間隔制限を緩めて割り当てます`);
        return base;
      })();

      if (isWH) {
        // 10年目以上は月1回まで（soft）→ 若手優先の週末フィルターで内包
        const withSenior = candidates.filter(isSeniorAllowed);
        const seniorPool = withSenior.length > 0 ? withSenior : candidates;
        candidates = applyWeekendFilters(seniorPool, gapFiltered, base, dateStr, "日直", warnings);
      } else {
        // 平日：シニア制限（soft）
        const withSenior = candidates.filter(isSeniorAllowed);
        if (withSenior.length > 0) candidates = withSenior;
      }

      // 日直のみ医師を優先（目標未達の場合）
      const childcareCandidates = candidates.filter(
        (s) => s.doctor.hasChildcare === true && s.accumulated < s.target
      );
      const chosen = pickBest(childcareCandidates.length > 0 ? childcareCandidates : candidates);
      if (chosen) {
        assignment.dayshift = chosen.doctor.name;
        chosen.accumulated += getShiftUnits(dayType, "dayshift");
        chosen.shiftCount++;
        if (isWH) {
          chosen.weekendHolidayCount++;
          chosen.weekendHolidayTotal++;
        }
        chosen.lastShiftDate = dateStr;
      } else {
        warnings.push(`${dateStr} 日直: 割り当て可能な医師がいません`);
      }
    }

    // ── 当直 ──────────────────────────────────────────────────
    {
      const prevDateStr = toDateString(new Date(date.getTime() - 86400000));
      const prevAssignment = assignMap.get(prevDateStr);

      const base = states.filter((s) => {
        if (s.doctor.hasChildcare === true) return false;
        if (s.doctor.unavailableDates.oncall.includes(dateStr)) return false;
        if (prevAssignment?.oncall === s.doctor.name) return false;
        if (assignment.dayshift === s.doctor.name) return false;
        return true;
      });

      // 間隔：中1日以上（hard）
      const gapFiltered = base.filter((s) => hasEnoughGap(s, dateStr));
      let candidates = gapFiltered.length > 0 ? gapFiltered : (() => {
        warnings.push(`${dateStr} 当直: 間隔制限を緩めて割り当てます`);
        return base;
      })();

      if (isWH) {
        // 週末：若手優先でシニア制限と上限を適用
        const withSenior = candidates.filter(isSeniorAllowed);
        const seniorPool = withSenior.length > 0 ? withSenior : candidates;
        candidates = applyWeekendFilters(seniorPool, gapFiltered, base, dateStr, "当直", warnings);
      } else {
        // 平日：シニア制限（soft）
        const withSenior = candidates.filter(isSeniorAllowed);
        if (withSenior.length > 0) candidates = withSenior;
      }

      // 土曜当直は2か月に1回制限（soft）
      if (dayType === "saturday") {
        const preferred = candidates.filter(
          (s) => !satLastMonth.has(s.doctor.name) && !satThisMonth.has(s.doctor.name)
        );
        if (preferred.length > 0) {
          candidates = preferred;
        } else {
          const fallback = candidates.filter((s) => !satThisMonth.has(s.doctor.name));
          if (fallback.length > 0) candidates = fallback;
        }
      }

      const chosen = pickBest(candidates);
      if (chosen) {
        assignment.oncall = chosen.doctor.name;
        chosen.accumulated += getShiftUnits(dayType, "oncall");
        chosen.shiftCount++;
        if (isWH) {
          chosen.weekendHolidayCount++;
          chosen.weekendHolidayTotal++;
        }
        chosen.lastShiftDate = dateStr;
        if (dayType === "saturday") satThisMonth.add(chosen.doctor.name);
      } else {
        warnings.push(`${dateStr} 当直: 割り当て可能な医師がいません`);
      }
    }

    assignments.push(assignment);
    assignMap.set(dateStr, assignment);
  }

  // 不足警告
  states.forEach((s) => {
    if (s.accumulated < s.target - 0.4) {
      warnings.push(
        `${s.doctor.name}: 目標 ${s.target} 単位に対して ${s.accumulated.toFixed(1)} 単位（不足 ${(s.target - s.accumulated).toFixed(1)}）`
      );
    }
  });

  const unitCounts: Record<string, number> = {};
  const weekendHolidayCounts: Record<string, number> = {};
  const newCarryover: Carryover = {};

  states.forEach((s) => {
    unitCounts[s.doctor.name] = s.accumulated;
    weekendHolidayCounts[s.doctor.name] = s.weekendHolidayCount;
    newCarryover[s.doctor.name] = Math.round((s.accumulated - s.baseTarget) * 10) / 10;
    newCarryover[`${WH_PREFIX}${s.doctor.name}`] = s.weekendHolidayTotal;
  });
  satThisMonth.forEach((name) => {
    newCarryover[`${SAT_PREFIX}${name}`] = 1;
  });

  const schedule: Schedule = {
    period: { startYear: year, startMonth: month },
    assignments,
    unitCounts,
    weekendHolidayCounts,
    savedAt: new Date().toISOString(),
  };

  return { schedule, warnings, newCarryover };
}

function sortByRemaining(pool: DoctorState[]): DoctorState[] {
  return [...pool].sort((a, b) => {
    const remainA = a.target - a.accumulated;
    const remainB = b.target - b.accumulated;
    // 残り単位数が異なれば必ず多い順（閾値なし）
    if (remainB !== remainA) return remainB - remainA;
    // 残り単位が同じなら年次が低い（若手）を優先して逆転を防ぐ
    const yearsA = a.doctor.yearsOfExperience ?? 99;
    const yearsB = b.doctor.yearsOfExperience ?? 99;
    if (yearsA !== yearsB) return yearsA - yearsB;
    // それも同じなら累積土日祝回数が少ない順
    return a.weekendHolidayTotal - b.weekendHolidayTotal;
  });
}

function pickBest(candidates: DoctorState[]): DoctorState | null {
  if (candidates.length === 0) return null;

  // 最優先：10年目以上でまだ未割り当て（若手が超過する前に確保）
  const seniorUnassigned = candidates.filter(
    (s) => (s.doctor.yearsOfExperience ?? 0) >= 10 && s.shiftCount === 0 && s.accumulated < s.target
  );
  if (seniorUnassigned.length > 0) return sortByRemaining(seniorUnassigned)[0];

  // 1.0単位以上不足している人を最優先（-1.0超えを防ぐ）
  // ただし10年目以上で月1回制限済み（shiftCount>=1）のシニアは除外
  const significantlyUnder = candidates.filter(
    (s) => s.target - s.accumulated >= 1.0 &&
      ((s.doctor.yearsOfExperience ?? 0) < 10 || s.shiftCount === 0)
  );
  if (significantlyUnder.length > 0) return sortByRemaining(significantlyUnder)[0];

  // 目標未達を優先（超過させない）
  const underTarget = candidates.filter((s) => s.accumulated < s.target);
  if (underTarget.length > 0) return sortByRemaining(underTarget)[0];

  // 最終手段：目標超過でも割り当て（間隔ルールは絶対に緩めない）
  // 超過分は翌月繰り越しで調整
  return sortByRemaining(candidates)[0];
}
