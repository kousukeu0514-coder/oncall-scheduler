import HolidayJP from "@holiday-jp/holiday_jp";
import { CustomHoliday, DayType } from "./types";

export function isNationalHoliday(date: Date): boolean {
  return HolidayJP.isHoliday(date);
}

export function isFoundersDay(date: Date): boolean {
  return date.getMonth() === 4 && date.getDate() === 15;
}

export function isHoliday(date: Date, customHolidays: CustomHoliday[] = []): boolean {
  const dateStr = toDateString(date);
  if (customHolidays.some((h) => h.date === dateStr)) return true;
  if (isFoundersDay(date)) return true;
  return isNationalHoliday(date);
}

export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getSecondSaturday(year: number, month: number): Date {
  // month is 1-based
  let count = 0;
  const d = new Date(year, month - 1, 1);
  while (true) {
    if (d.getDay() === 6) {
      count++;
      if (count === 2) return new Date(d);
    }
    d.setDate(d.getDate() + 1);
  }
}

export function getDayType(date: Date, customHolidays: CustomHoliday[] = []): DayType {
  const dow = date.getDay(); // 0=Sun, 6=Sat

  if (dow === 0 || isHoliday(date, customHolidays)) return "holiday";

  if (dow === 6) {
    const second = getSecondSaturday(date.getFullYear(), date.getMonth() + 1);
    if (toDateString(date) === toDateString(second)) return "second-saturday";
    return "saturday";
  }

  return "weekday";
}

export function getShiftUnits(dayType: DayType, shift: "dayshift" | "oncall"): number {
  if (shift === "dayshift") {
    // dayshift only on second-saturday and holiday
    if (dayType === "second-saturday") return 1.0;
    if (dayType === "holiday") return 1.0;
    return 0;
  } else {
    // oncall
    if (dayType === "weekday") return 1.0;
    if (dayType === "saturday") return 1.5;
    if (dayType === "second-saturday") return 1.0;
    if (dayType === "holiday") return 1.0;
    return 0;
  }
}

// 1ヶ月あたりの基本目標単位数
export function getTargetUnits(yearsOfExperience: number): number {
  const table: Record<number, number> = {
    3: 5.5,
    4: 5.0,
    5: 4.5,
    6: 4.0,
    7: 3.5,
    8: 3.0,
    9: 2.5,
    10: 2.0,
  };
  if (yearsOfExperience <= 10) return table[yearsOfExperience] ?? 2.0;
  return 1.5;
}

// ローテーション種別に応じた目標単位数調整
export function getAdjustedTarget(base: number, isRotating: string | null): number {
  if (isRotating === "emergency") return Math.max(0.5, base - 2);
  if (isRotating === "other") return Math.max(0.5, base - 0.5);
  return base; // "own" または null（当科）
}

export function getDatesInPeriod(year: number, month: number): Date[] {
  const dates: Date[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    dates.push(new Date(year, month - 1, d));
  }
  return dates;
}

export function isWeekendOrHoliday(date: Date, customHolidays: CustomHoliday[] = []): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6 || isHoliday(date, customHolidays);
}
