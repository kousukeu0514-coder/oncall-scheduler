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
  lastOncallDate: string | null; // 当直-当直間の中2日soft用
}

const SAT_PREFIX = "__sat__";
const WH_PREFIX = "__wh__";
const HARD_MAX = 6; // 累積単位数ハードキャップ

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000
  );
}

function hasEnoughGap(s: DoctorState, dateStr: string): boolean {
  return !s.lastShiftDate || daysBetween(s.lastShiftDate, dateStr) >= 2;
}

function isJunior(s: DoctorState): boolean {
  return (s.doctor.yearsOfExperience ?? 0) < 10;
}

function isSeniorAllowed(s: DoctorState): boolean {
  return isJunior(s) || s.shiftCount === 0;
}

function years(s: DoctorState): number {
  return s.doctor.yearsOfExperience ?? 0;
}

// 週末スロットの候補絞り込み
// 優先：3-6年目→7-9年目→10年目以上(1枠)→若手3回目→シニア2回目
function applyWeekendFilters(
  candidates: DoctorState[], // isSeniorAllowed適用済み（シニア1回済み除外）
  gapFiltered: DoctorState[], // gap制限適用済み（全員）
  base: DoctorState[],        // gap制限なし（全員）
  dateStr: string,
  label: string,
  warnings: string[]
): DoctorState[] {
  // Step 1: 3-6年目 で週末1回目（まだ0回）
  const earlyJuniorFirst = candidates.filter(
    (s) => years(s) >= 3 && years(s) <= 6 && s.weekendHolidayCount < 1
  );
  if (earlyJuniorFirst.length > 0) return earlyJuniorFirst;

  // Step 2: 10年目以上 未割当（3-6年目の2回目より先に1コマ確保）
  const seniorFirst = candidates.filter(
    (s) => years(s) >= 10 && s.shiftCount === 0 && s.weekendHolidayCount < 2
  );
  if (seniorFirst.length > 0) return seniorFirst;

  // Step 3: 7-9年目 で週末1回目（まだ0回）
  const midJuniorFirst = candidates.filter(
    (s) => years(s) >= 7 && years(s) <= 9 && s.weekendHolidayCount < 1
  );
  if (midJuniorFirst.length > 0) return midJuniorFirst;

  // Step 4: 3-5年目 で週末2回目（入りやすい人から）
  const earlyJuniorSecond = candidates.filter(
    (s) => years(s) >= 3 && years(s) <= 5 && s.weekendHolidayCount < 2
  );
  if (earlyJuniorSecond.length > 0) return earlyJuniorSecond;

  // Step 5: 6-9年目 で週末2回目
  const midJuniorSecond = candidates.filter(
    (s) => years(s) >= 6 && years(s) <= 9 && s.weekendHolidayCount < 2
  );
  if (midJuniorSecond.length > 0) return midJuniorSecond;

  // Step 4: 若手（9年目以下）で週末3回未満（シニア2回目より優先）
  const juniorThird = gapFiltered.filter(
    (s) => isJunior(s) && s.weekendHolidayCount < 3
  );
  if (juniorThird.length > 0) return juniorThird;

  // Step 5: シニア2回目（間隔維持・週末2回未満）
  const seniorSecond = gapFiltered.filter((s) => s.weekendHolidayCount < 2);
  if (seniorSecond.length > 0) return seniorSecond;

  // Step 6: 間隔制限も緩める（週末2回未満）
  const fullRelaxed = base.filter((s) => s.weekendHolidayCount < 2);
  if (fullRelaxed.length > 0) return fullRelaxed;

  // Step 7: 最終手段
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
      lastOncallDate: null,
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
        if (s.accumulated >= HARD_MAX) return false; // 6単位ハードキャップ
        if (s.doctor.unavailableDates.dayshift.includes(dateStr)) return false;
        if (prevAssignment?.oncall === s.doctor.name) return false;
        return true;
      });

      const gapFiltered = base.filter((s) => hasEnoughGap(s, dateStr));
      let candidates = gapFiltered.length > 0 ? gapFiltered : (() => {
        warnings.push(`${dateStr} 日直: 間隔制限を緩めて割り当てます`);
        return base;
      })();

      if (isWH) {
        const withSenior = candidates.filter(isSeniorAllowed);
        const seniorPool = withSenior.length > 0 ? withSenior : candidates;
        candidates = applyWeekendFilters(seniorPool, gapFiltered, base, dateStr, "日直", warnings);
      } else {
        const withSenior = candidates.filter(isSeniorAllowed);
        if (withSenior.length > 0) candidates = withSenior;
      }

      // 日直のみ医師：月1回確保を最優先、次に目標未達を優先
      const childcareUnassigned = candidates.filter(
        (s) => s.doctor.hasChildcare === true && s.shiftCount === 0
      );
      const childcareUnder = candidates.filter(
        (s) => s.doctor.hasChildcare === true && s.accumulated < s.target
      );
      const dayshiftPool =
        childcareUnassigned.length > 0 ? childcareUnassigned :
        childcareUnder.length > 0 ? childcareUnder :
        candidates;

      const chosen = pickBest(dayshiftPool, isWH);
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
        if (s.accumulated >= HARD_MAX) return false; // 6単位ハードキャップ
        if (s.doctor.hasChildcare === true) return false;
        if (s.doctor.unavailableDates.oncall.includes(dateStr)) return false;
        if (prevAssignment?.oncall === s.doctor.name) return false;
        if (assignment.dayshift === s.doctor.name) return false;
        return true;
      });

      const gapFiltered = base.filter((s) => hasEnoughGap(s, dateStr));
      let candidates = gapFiltered.length > 0 ? gapFiltered : (() => {
        warnings.push(`${dateStr} 当直: 間隔制限を緩めて割り当てます`);
        return base;
      })();

      // 当直-当直間は中2日以上（soft）: 優先候補に絞るが、いなければ緩める
      const oncallGapPreferred = candidates.filter(
        (s) => !s.lastOncallDate || daysBetween(s.lastOncallDate, dateStr) >= 3
      );
      if (oncallGapPreferred.length > 0) candidates = oncallGapPreferred;

      if (isWH) {
        const withSenior = candidates.filter(isSeniorAllowed);
        const seniorPool = withSenior.length > 0 ? withSenior : candidates;
        candidates = applyWeekendFilters(seniorPool, gapFiltered, base, dateStr, "当直", warnings);
      } else {
        // 平日：シニアは週末優先のため平日では最低優先
        // シニア未割当でも、若手に目標未達があれば若手を先にする
        const withSenior = candidates.filter(isSeniorAllowed);
        if (withSenior.length > 0) candidates = withSenior;
      }

      // 土曜当直は2か月に1回制限（soft）
      if (dayType === "saturday") {
        const preferred = candidates.filter(
          (s) => !satLastMonth.has(s.doctor.name) && !satThisMonth.has(s.doctor.name)
        );
        if (preferred.length > 0) candidates = preferred;
        else {
          const fallback = candidates.filter((s) => !satThisMonth.has(s.doctor.name));
          if (fallback.length > 0) candidates = fallback;
        }
      }

      const chosen = pickBest(candidates, isWH);
      if (chosen) {
        assignment.oncall = chosen.doctor.name;
        chosen.accumulated += getShiftUnits(dayType, "oncall");
        chosen.shiftCount++;
        if (isWH) {
          chosen.weekendHolidayCount++;
          chosen.weekendHolidayTotal++;
        }
        chosen.lastShiftDate = dateStr;
        chosen.lastOncallDate = dateStr;
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
    if (remainB !== remainA) return remainB - remainA;
    // 残り同じなら年次が低い（若手）を優先
    const yearsA = a.doctor.yearsOfExperience ?? 99;
    const yearsB = b.doctor.yearsOfExperience ?? 99;
    if (yearsA !== yearsB) return yearsA - yearsB;
    return a.weekendHolidayTotal - b.weekendHolidayTotal;
  });
}

function pickBest(candidates: DoctorState[], isWH: boolean = false): DoctorState | null {
  if (candidates.length === 0) return null;

  // 10年目以上未割当を最優先（週末・平日問わず必ず1枠確保）
  const seniorUnassigned = candidates.filter(
    (s) => years(s) >= 10 && s.shiftCount === 0 && s.accumulated < s.target
  );
  if (seniorUnassigned.length > 0) return sortByRemaining(seniorUnassigned)[0];

  // 1.0単位以上不足（シニア1回済みは除外）
  const significantlyUnder = candidates.filter(
    (s) => s.target - s.accumulated >= 1.0 && (years(s) < 10 || s.shiftCount === 0)
  );
  if (significantlyUnder.length > 0) return sortByRemaining(significantlyUnder)[0];

  // 目標未達を優先
  const underTarget = candidates.filter((s) => s.accumulated < s.target);
  if (underTarget.length > 0) return sortByRemaining(underTarget)[0];

  // 最終手段：目標超過でも割り当て（翌月繰り越しで調整）
  return sortByRemaining(candidates)[0];
}
