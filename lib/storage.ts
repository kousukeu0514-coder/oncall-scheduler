import { Doctor, Schedule, CustomHoliday, Carryover } from "./types";

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function periodKey(prefix: string, year: number, month: number): string {
  return `${prefix}:${year}-${month}`;
}

// Remove all entries older than 1 year
export function purgeExpiredData(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const keysToDelete: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw);
      if (data.expiresAt && new Date(data.expiresAt).getTime() < now) {
        keysToDelete.push(key);
      }
      // For arrays, check first element
      if (Array.isArray(data) && data[0]?.expiresAt && new Date(data[0].expiresAt).getTime() < now) {
        keysToDelete.push(key);
      }
    } catch {
      // ignore parse errors
    }
  }
  keysToDelete.forEach((k) => localStorage.removeItem(k));
}

// Doctors
export function saveDoctors(year: number, month: number, doctors: Doctor[]): void {
  const key = periodKey("doctors", year, month);
  localStorage.setItem(key, JSON.stringify(doctors));
}

export function loadDoctors(year: number, month: number): Doctor[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(periodKey("doctors", year, month));
  if (!raw) return [];
  try {
    const doctors: Doctor[] = JSON.parse(raw);
    const now = Date.now();
    return doctors.filter((d) => !d.expiresAt || new Date(d.expiresAt).getTime() > now);
  } catch {
    return [];
  }
}

export function deleteDoctor(year: number, month: number, doctorId: string): void {
  const doctors = loadDoctors(year, month);
  saveDoctors(year, month, doctors.filter((d) => d.id !== doctorId));
}

export function saveDoctor(year: number, month: number, doctor: Doctor): void {
  const doctors = loadDoctors(year, month);
  const idx = doctors.findIndex((d) => d.id === doctor.id);
  if (idx >= 0) {
    doctors[idx] = doctor;
  } else {
    doctors.push(doctor);
  }
  saveDoctors(year, month, doctors);
}

export function createDoctor(name: string, year: number, month: number): Doctor {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    name,
    yearsOfExperience: null,
    isRotating: null,
    hasChildcare: null,
    unavailableDates: { oncall: [], dayshift: [] },
    targetPeriod: { startYear: year, startMonth: month },
    savedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ONE_YEAR_MS).toISOString(),
  };
}

// Schedule
export function deleteSchedule(year: number, month: number): void {
  localStorage.removeItem(periodKey("schedule", year, month));
}

export function saveSchedule(year: number, month: number, schedule: Schedule): void {
  const key = periodKey("schedule", year, month);
  localStorage.setItem(key, JSON.stringify(schedule));
}

export function loadSchedule(year: number, month: number): Schedule | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(periodKey("schedule", year, month));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Schedule;
  } catch {
    return null;
  }
}

// Carryover（前月繰り越し）
export function saveCarryover(year: number, month: number, carryover: Carryover): void {
  const key = periodKey("carryover", year, month);
  localStorage.setItem(key, JSON.stringify(carryover));
}

export function loadCarryover(year: number, month: number): Carryover {
  if (typeof window === "undefined") return {};
  const raw = localStorage.getItem(periodKey("carryover", year, month));
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Carryover;
  } catch {
    return {};
  }
}

// 前の月のキーを返す
export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

// Custom Holidays
export function saveCustomHolidays(year: number, month: number, holidays: CustomHoliday[]): void {
  const key = periodKey("custom-holidays", year, month);
  localStorage.setItem(key, JSON.stringify(holidays));
}

export function loadCustomHolidays(year: number, month: number): CustomHoliday[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(periodKey("custom-holidays", year, month));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CustomHoliday[];
  } catch {
    return [];
  }
}
