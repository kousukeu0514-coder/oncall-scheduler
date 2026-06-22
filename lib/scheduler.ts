import { Doctor, Schedule, Assignment, CustomHoliday, Carryover } from "./types";
import {
  getDatesInPeriod,
  getDayType,
  getShiftUnits,
  getTargetUnits,
  getRotatingTarget,
  toDateString,
  isWeekendOrHoliday,
} from "./holidays";

interface DoctorState {
  doctor: Doctor;
  target: number;        // 今月の目標単位数（キャリーオーバー調整済み）
  baseTarget: number;    // キャリーオーバー調整前の基本目標
  accumulated: number;
  weekendHolidayCount: number; // 土日祝シフト回数
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

  const states: DoctorState[] = doctors.map((doc) => {
    const base = getTargetUnits(doc.yearsOfExperience ?? 3);
    const baseTarget = doc.isRotating ? getRotatingTarget(base) : base;
    // キャリーオーバー調整：前月過剰分を今月の目標から引く（0.5単位刻み）
    const carry = carryover[doc.name] ?? 0;
    const adjusted = baseTarget - carry;
    // 最低0.5単位は確保、日直のみ対応は最大2単位
    const cappedTarget = doc.hasChildcare === true ? Math.min(adjusted, 2) : adjusted;
    const target = Math.max(0.5, Math.round(cappedTarget * 2) / 2);
    return { doctor: doc, target, baseTarget, accumulated: 0, weekendHolidayCount: 0 };
  });

  const assignMap = new Map<string, Assignment>();

  for (const date of dates) {
    const dateStr = toDateString(date);
    const dayType = getDayType(date, customHolidays);
    const needsDayshift = dayType === "second-saturday" || dayType === "holiday";
    const isWH = isWeekendOrHoliday(date, customHolidays);

    const assignment: Assignment = { date: dateStr, dayType, dayshift: null, oncall: null };

    if (needsDayshift) {
      const prevDateStr = toDateString(new Date(date.getTime() - 86400000));
      const prevAssignment = assignMap.get(prevDateStr);

      const candidates = states.filter((s) => {
        if (s.doctor.unavailableDates.dayshift.includes(dateStr)) return false;
        if (prevAssignment?.oncall === s.doctor.name) return false;
        return true;
      });

      const chosen = pickBest(candidates, "dayshift");
      if (chosen) {
        assignment.dayshift = chosen.doctor.name;
        chosen.accumulated += getShiftUnits(dayType, "dayshift");
        if (isWH) chosen.weekendHolidayCount++;
      } else {
        warnings.push(`${dateStr} 日直: 割り当て可能な医師がいません`);
      }
    }

    {
      const prevDateStr = toDateString(new Date(date.getTime() - 86400000));
      const prevAssignment = assignMap.get(prevDateStr);

      const candidates = states.filter((s) => {
        if (s.doctor.hasChildcare === true) return false;
        if (s.doctor.unavailableDates.oncall.includes(dateStr)) return false;
        if (prevAssignment?.oncall === s.doctor.name) return false;
        if (assignment.dayshift === s.doctor.name) return false;
        return true;
      });

      const chosen = pickBest(candidates, "oncall");
      if (chosen) {
        assignment.oncall = chosen.doctor.name;
        chosen.accumulated += getShiftUnits(dayType, "oncall");
        if (isWH) chosen.weekendHolidayCount++;
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
    // 今月の実績 - 基本目標 = 来月への繰り越し（プラスなら過剰、マイナスなら不足）
    newCarryover[s.doctor.name] = Math.round((s.accumulated - s.baseTarget) * 10) / 10;
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

function pickBest(candidates: DoctorState[], _shift: string): DoctorState | null {
  if (candidates.length === 0) return null;
  // 第1ソート: 残り単位数が多い順
  // 第2ソート: 土日祝シフト回数が少ない順（公平性）
  const sorted = [...candidates].sort((a, b) => {
    const remainA = a.target - a.accumulated;
    const remainB = b.target - b.accumulated;
    if (Math.abs(remainB - remainA) > 0.4) return remainB - remainA;
    return a.weekendHolidayCount - b.weekendHolidayCount;
  });
  return sorted[0];
}
