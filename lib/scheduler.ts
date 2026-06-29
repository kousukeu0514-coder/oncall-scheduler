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
  shiftCount: number;            // 今月の合計シフト回数
  weekendHolidayCount: number;   // 今月の土日祝シフト回数（上限チェック用）
  weekendHolidayTotal: number;   // 累積土日祝回数（繰り越し含む、公平性ソート用）
  lastShiftDate: string | null;  // 直近のシフト日（間隔チェック用）
}

const SAT_PREFIX = "__sat__";
const WH_PREFIX = "__wh__";

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000
  );
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
      : Math.max(0.5, Math.round(adjusted * 2) / 2);
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

      // 土日祝の日直は週末回数上限2回を優先適用
      let candidates = base;
      if (isWH) {
        const withCap = base.filter((s) => s.weekendHolidayCount < 2);
        if (withCap.length > 0) candidates = withCap;
      }

      // 中2日間隔
      const withGap = candidates.filter(
        (s) => !s.lastShiftDate || daysBetween(s.lastShiftDate, dateStr) >= 3
      );
      if (withGap.length > 0) candidates = withGap;

      // 10年目以上は月1回まで（soft）- 日直のみ優先より先に適用
      const withSenior = candidates.filter(
        (s) => (s.doctor.yearsOfExperience ?? 0) < 10 || s.shiftCount === 0
      );
      if (withSenior.length > 0) candidates = withSenior;

      // 日直のみ医師を優先（目標未達 かつ 月1回制限を超えていない場合）
      const childcareCandidates = candidates.filter(
        (s) => s.doctor.hasChildcare === true && s.accumulated < s.target
      );
      const chosen = pickBest(
        childcareCandidates.length > 0 ? childcareCandidates : candidates
      );
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

      let candidates = base;

      // 10年目以上は月1回まで（soft）
      const withSenior = candidates.filter(
        (s) => (s.doctor.yearsOfExperience ?? 0) < 10 || s.shiftCount === 0
      );
      if (withSenior.length > 0) candidates = withSenior;

      // 中2日間隔（soft）
      const withGap = candidates.filter(
        (s) => !s.lastShiftDate || daysBetween(s.lastShiftDate, dateStr) >= 3
      );
      if (withGap.length > 0) candidates = withGap;

      // 土日祝は週末回数上限2回（soft）
      if (isWH) {
        const withCap = candidates.filter((s) => s.weekendHolidayCount < 2);
        if (withCap.length > 0) candidates = withCap;
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
    // 累積土日祝回数を繰り越し
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

function pickBest(candidates: DoctorState[]): DoctorState | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    const remainA = a.target - a.accumulated;
    const remainB = b.target - b.accumulated;
    if (Math.abs(remainB - remainA) > 0.4) return remainB - remainA;
    // 累積土日祝回数が少ない順（長期的公平性）
    return a.weekendHolidayTotal - b.weekendHolidayTotal;
  });
  return sorted[0];
}
