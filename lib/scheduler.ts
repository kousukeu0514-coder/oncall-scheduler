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
  weekendOncallCount: number;    // 今月の土日祝当直回数（2か月3回制限用）
  weekendOncallLastMonth: number;// 先月の土日祝当直回数（carryoverから）
  lastShiftDate: string | null;
  lastOncallDate: string | null; // 当直-当直間の中2日soft用
  lastWeekendOncallDate: string | null; // 2週連続土日当直回避soft用
}

const SAT_PREFIX = "__sat__";   // 旧キー（互換用）
const SAT1_PREFIX = "__sat1__"; // 先月の土曜当直
const SAT2_PREFIX = "__sat2__"; // 先々月の土曜当直
const WH_PREFIX = "__wh__";
const WHO_PREFIX = "__who1__";  // 先月の土日祝当直回数（2か月3回制限用）
const HARD_MAX = 5.5; // 累積単位数ハードキャップ

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
function applyWeekendFilters(
  candidates: DoctorState[], // isSeniorAllowed適用済み
  gapFiltered: DoctorState[], // gap制限適用済み（全員）
  base: DoctorState[],        // gap制限なし（全員）
  dateStr: string,
  label: string,
  warnings: string[],
  seniorReservedForWeekday: Set<string> // 平日不足日に必要なシニア
): DoctorState[] {
  // Step 1: 3〜5年目（1・2回目）＋ 10年目以上の日直のみ（hasChildcare）未割当
  const step1 = candidates.filter(
    (s) =>
      (years(s) >= 3 && years(s) <= 5 && s.weekendHolidayCount < 2) ||
      (years(s) >= 10 && s.doctor.hasChildcare === true && s.shiftCount === 0)
  );
  if (step1.length > 0) return step1;

  // Step 2: 6〜9年目 で週末1回目
  const midFirst = candidates.filter(
    (s) => years(s) >= 6 && years(s) <= 9 && s.weekendHolidayCount < 1
  );
  if (midFirst.length > 0) return midFirst;

  // Step 3: 10年目以上（当直可能）未割当
  // 平日不足日に必要なシニアは除外（平日を優先）、不要なシニアは週末割り当て
  const seniorOncallFree = candidates.filter(
    (s) =>
      years(s) >= 10 &&
      !s.doctor.hasChildcare &&
      s.shiftCount === 0 &&
      !seniorReservedForWeekday.has(s.doctor.name)
  );
  if (seniorOncallFree.length > 0) return seniorOncallFree;

  // 平日予約済みシニアも全員使い果たした後は週末に割り当て可
  const seniorOncallAny = candidates.filter(
    (s) => years(s) >= 10 && !s.doctor.hasChildcare && s.shiftCount === 0
  );
  if (seniorOncallAny.length > 0) return seniorOncallAny;

  // Step 4: 6〜9年目 で週末2回目
  const midJuniorSecond = candidates.filter(
    (s) => years(s) >= 6 && years(s) <= 9 && s.weekendHolidayCount < 2
  );
  if (midJuniorSecond.length > 0) return midJuniorSecond;

  // Step 5: 若手（9年目以下）で週末3回未満（緊急）
  const juniorThird = gapFiltered.filter(
    (s) => isJunior(s) && s.weekendHolidayCount < 3
  );
  if (juniorThird.length > 0) return juniorThird;

  // Step 6: 間隔制限も緩める（若手3回未満 or シニア未割当のみ）
  const fullRelaxed = base.filter(
    (s) => isJunior(s) ? s.weekendHolidayCount < 3 : s.shiftCount === 0 && s.weekendHolidayCount < 2
  );
  if (fullRelaxed.length > 0) return fullRelaxed;

  // Step 7: 最終手段
  warnings.push(`${dateStr} ${label}: 週末シフト上限超過のため上限を緩めて割り当てます`);
  return base.filter(isJunior).length > 0 ? base.filter(isJunior) : base;
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

  const satRecent = new Set<string>(
    Object.entries(carryover)
      .filter(([k, v]) =>
        (k.startsWith(SAT1_PREFIX) || k.startsWith(SAT2_PREFIX) || k.startsWith(SAT_PREFIX)) && v === 1
      )
      .map(([k]) =>
        k.startsWith(SAT1_PREFIX) ? k.slice(SAT1_PREFIX.length)
        : k.startsWith(SAT2_PREFIX) ? k.slice(SAT2_PREFIX.length)
        : k.slice(SAT_PREFIX.length)
      )
  );
  const satThisMonth = new Set<string>();

  // 平日の当直候補（若手）が少ない日を事前チェック
  // シニア（当直可能）が必要な平日を特定し、そのシニアを週末から外す
  const oncallJuniors = doctors.filter(
    (d) => (d.yearsOfExperience ?? 0) < 10 && !d.hasChildcare
  );
  const oncallSeniors = doctors.filter(
    (d) => (d.yearsOfExperience ?? 0) >= 10 && !d.hasChildcare
  );
  const seniorReservedForWeekday = new Set<string>();
  for (const date of dates) {
    if (isWeekendOrHoliday(date, customHolidays)) continue;
    const dateStr = toDateString(date);
    const availJuniors = oncallJuniors.filter(
      (d) => !d.unavailableDates.oncall.includes(dateStr)
    );
    if (availJuniors.length <= 2) {
      // この平日をカバーできるシニアを「平日予約済み」とマーク
      for (const doc of oncallSeniors) {
        if (!doc.unavailableDates.oncall.includes(dateStr)) {
          seniorReservedForWeekday.add(doc.name);
        }
      }
    }
  }

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
      weekendOncallCount: 0,
      weekendOncallLastMonth: carryover[`${WHO_PREFIX}${doc.name}`] ?? 0,
      lastShiftDate: null,
      lastOncallDate: null,
      lastWeekendOncallDate: null,
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
        if (s.accumulated + getShiftUnits(dayType, "dayshift") > HARD_MAX) return false;
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
        candidates = applyWeekendFilters(seniorPool, gapFiltered, base, dateStr, "日直", warnings, seniorReservedForWeekday);
      } else {
        const allowed = candidates.filter(isSeniorAllowed);
        const juniorOnly = allowed.filter(isJunior);
        candidates = juniorOnly.length > 2 ? juniorOnly : (allowed.length > 0 ? allowed : candidates);
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

      const chosen = pickBest(dayshiftPool);
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
        if (s.accumulated + getShiftUnits(dayType, "oncall") > HARD_MAX) return false;
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

      // 当直-当直間は中2日以上（soft）
      const oncallGapPreferred = candidates.filter(
        (s) => !s.lastOncallDate || daysBetween(s.lastOncallDate, dateStr) >= 3
      );
      if (oncallGapPreferred.length > 0) candidates = oncallGapPreferred;

      if (isWH) {
        const withSenior = candidates.filter(isSeniorAllowed);
        const seniorPool = withSenior.length > 0 ? withSenior : candidates;
        candidates = applyWeekendFilters(seniorPool, gapFiltered, base, dateStr, "当直", warnings, seniorReservedForWeekday);

        // 2週連続土日当直を避ける（soft）
        const noConsecutiveWeekend = candidates.filter(
          (s) => !s.lastWeekendOncallDate || daysBetween(s.lastWeekendOncallDate, dateStr) >= 7
        );
        if (noConsecutiveWeekend.length > 0) candidates = noConsecutiveWeekend;

        // 2か月で土日当直3回以内（soft）
        const recentUnder3 = candidates.filter(
          (s) => s.weekendOncallCount + s.weekendOncallLastMonth < 3
        );
        if (recentUnder3.length > 0) candidates = recentUnder3;
      } else {
        // 平日：シニアは常にshiftCount=0のみ候補（月1回上限を厳守）
        // 若手が3人超なら若手のみ、2人以下ならシニア未割当も含める
        const allowed = candidates.filter(isSeniorAllowed);
        const juniorOnly = allowed.filter(isJunior);
        candidates = juniorOnly.length > 2 ? juniorOnly : (allowed.length > 0 ? allowed : candidates);
      }

      // 土曜当直は3か月に1回制限（soft）
      if (dayType === "saturday") {
        const preferred = candidates.filter(
          (s) => !satRecent.has(s.doctor.name) && !satThisMonth.has(s.doctor.name)
        );
        if (preferred.length > 0) candidates = preferred;
        else {
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
        chosen.lastOncallDate = dateStr;
        if (isWH) {
          chosen.weekendOncallCount++;
          chosen.lastWeekendOncallDate = dateStr;
        }
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
    newCarryover[`${WHO_PREFIX}${s.doctor.name}`] = s.weekendOncallCount;
  });
  // 先月の __sat1__ を __sat2__ に繰り上げ
  Object.entries(carryover)
    .filter(([k, v]) => (k.startsWith(SAT1_PREFIX) || k.startsWith(SAT_PREFIX)) && v === 1)
    .forEach(([k]) => {
      const name = k.startsWith(SAT1_PREFIX) ? k.slice(SAT1_PREFIX.length) : k.slice(SAT_PREFIX.length);
      newCarryover[`${SAT2_PREFIX}${name}`] = 1;
    });
  // 今月の土曜当直を __sat1__ に保存
  satThisMonth.forEach((name) => {
    newCarryover[`${SAT1_PREFIX}${name}`] = 1;
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
    const yearsA = a.doctor.yearsOfExperience ?? 99;
    const yearsB = b.doctor.yearsOfExperience ?? 99;
    if (yearsA !== yearsB) return yearsA - yearsB;
    if (a.weekendHolidayCount !== b.weekendHolidayCount)
      return a.weekendHolidayCount - b.weekendHolidayCount;
    return a.weekendHolidayTotal - b.weekendHolidayTotal;
  });
}

function pickBest(candidates: DoctorState[]): DoctorState | null {
  if (candidates.length === 0) return null;

  // 1.0単位以上不足（シニア1回済みは除外）
  const significantlyUnder = candidates.filter(
    (s) => s.target - s.accumulated >= 1.0 && (years(s) < 10 || s.shiftCount === 0)
  );
  if (significantlyUnder.length > 0) return sortByRemaining(significantlyUnder)[0];

  // 目標未達（シニア1回済みは除外）
  const underTarget = candidates.filter(
    (s) => s.accumulated < s.target && (years(s) < 10 || s.shiftCount === 0)
  );
  if (underTarget.length > 0) return sortByRemaining(underTarget)[0];

  // 若手のみで目標超過でも割り当て
  const juniorOver = candidates.filter((s) => years(s) < 10);
  if (juniorOver.length > 0) return sortByRemaining(juniorOver)[0];

  // 最終手段：シニア含む全員（真に誰もいない場合のみ）
  return sortByRemaining(candidates)[0];
}
