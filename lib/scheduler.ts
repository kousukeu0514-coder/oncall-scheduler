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

const SAT_PREFIX = "__sat__";   // 旧キー（互換用）
const SAT1_PREFIX = "__sat1__"; // 先月の土曜当直
const SAT2_PREFIX = "__sat2__"; // 先々月の土曜当直
const WH_PREFIX = "__wh__";
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
// 優先：3-6年目→7-9年目→10年目以上(1枠)→若手3回目→シニア2回目
function applyWeekendFilters(
  candidates: DoctorState[], // isSeniorAllowed適用済み（シニア1回済み除外）
  gapFiltered: DoctorState[], // gap制限適用済み（全員）
  base: DoctorState[],        // gap制限なし（全員）
  dateStr: string,
  label: string,
  warnings: string[]
): DoctorState[] {
  // Step 1: 3〜4年目 で週末2回まで（最優先で確保）
  const juniorPriority = candidates.filter(
    (s) => years(s) >= 3 && years(s) <= 4 && s.weekendHolidayCount < 2
  );
  if (juniorPriority.length > 0) return juniorPriority;

  // Step 2: 4-9年目 で週末1回目（シニアより先に若手全員の1回目を優先）
  const midFirst = candidates.filter(
    (s) => years(s) >= 4 && years(s) <= 9 && s.weekendHolidayCount < 1
  );
  if (midFirst.length > 0) return midFirst;

  // Step 3: 10年目以上 未割当（若手全員が1回目を終えた後）
  const seniorFirst = candidates.filter(
    (s) => years(s) >= 10 && s.shiftCount === 0 && s.weekendHolidayCount < 2
  );
  if (seniorFirst.length > 0) return seniorFirst;

  // Step 4: 4-5年目 で週末2回目
  const earlyJuniorSecond = candidates.filter(
    (s) => years(s) >= 4 && years(s) <= 5 && s.weekendHolidayCount < 2
  );
  if (earlyJuniorSecond.length > 0) return earlyJuniorSecond;

  // Step 5: 6-9年目 で週末2回目
  const midJuniorSecond = candidates.filter(
    (s) => years(s) >= 6 && years(s) <= 9 && s.weekendHolidayCount < 2
  );
  if (midJuniorSecond.length > 0) return midJuniorSecond;

  // Step 6: 若手（9年目以下）で週末3回未満
  const juniorThird = gapFiltered.filter(
    (s) => isJunior(s) && s.weekendHolidayCount < 3
  );
  if (juniorThird.length > 0) return juniorThird;

  // Step 7: 間隔制限も緩める（若手3回未満 or シニア未割当のみ）
  // シニアはshiftCount=0のみ対象（月1回上限を厳守）
  const fullRelaxed = base.filter(
    (s) => isJunior(s) ? s.weekendHolidayCount < 3 : s.shiftCount === 0 && s.weekendHolidayCount < 2
  );
  if (fullRelaxed.length > 0) return fullRelaxed;

  // Step 8: 最終手段（若手のみ）
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

  // 土曜当直3か月制限：先月・先々月に実施した医師を除外対象に
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
        candidates = applyWeekendFilters(seniorPool, gapFiltered, base, dateStr, "日直", warnings);
      } else {
        // 平日：シニアは常にshiftCount=0のみ候補（月1回上限を厳守）
        // 若手が3人超なら若手のみ、2人以下ならシニア未割当も含める
        const allowed = candidates.filter(isSeniorAllowed); // 若手 + シニア未割当
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
        // 平日：若手3人以上なら若手のみ、2人以下なら未割当シニアも含める（月1回上限を守る）
        const juniorOnly = candidates.filter(isJunior);
        const withUnassignedSenior = candidates.filter(isSeniorAllowed);
        if (juniorOnly.length > 2) candidates = juniorOnly;
        else if (withUnassignedSenior.length > 0) candidates = withUnassignedSenior;
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
    // 残り同じなら年次が低い（若手）を優先
    const yearsA = a.doctor.yearsOfExperience ?? 99;
    const yearsB = b.doctor.yearsOfExperience ?? 99;
    if (yearsA !== yearsB) return yearsA - yearsB;
    // 同年次なら今月の土日祝回数が少ない方を優先（単位数を均等化）
    if (a.weekendHolidayCount !== b.weekendHolidayCount)
      return a.weekendHolidayCount - b.weekendHolidayCount;
    return a.weekendHolidayTotal - b.weekendHolidayTotal;
  });
}

function pickBest(candidates: DoctorState[], isWH: boolean = false): DoctorState | null {
  if (candidates.length === 0) return null;

  // 1.0単位以上不足（シニア1回済みは除外）
  const significantlyUnder = candidates.filter(
    (s) => s.target - s.accumulated >= 1.0 && (years(s) < 10 || s.shiftCount === 0)
  );
  if (significantlyUnder.length > 0) return sortByRemaining(significantlyUnder)[0];

  // 目標未達を優先（シニア1回済みは除外）
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
