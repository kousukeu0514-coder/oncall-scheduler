import { supabase } from "./supabase";
import { Doctor, Schedule, CustomHoliday, Carryover } from "./types";

// ─── helpers ───────────────────────────────────────────────────────────────

function ONE_YEAR_FROM_NOW(): string {
  return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Doctor ────────────────────────────────────────────────────────────────

export async function loadDoctors(year: number, month: number): Promise<Doctor[]> {
  const { data, error } = await supabase
    .from("doctors")
    .select("*")
    .eq("period_year", year)
    .eq("period_month", month)
    .gt("expires_at", new Date().toISOString());
  if (error) { console.error(error); return []; }
  return (data ?? []).map(rowToDoctor);
}

export async function saveDoctor(year: number, month: number, doctor: Doctor): Promise<void> {
  const row = doctorToRow(doctor, year, month);
  const { error } = await supabase.from("doctors").upsert(row, { onConflict: "id" });
  if (error) console.error(error);
}

export async function deleteDoctor(year: number, month: number, doctorId: string): Promise<void> {
  const { error } = await supabase.from("doctors").delete().eq("id", doctorId);
  if (error) console.error(error);
}

export function createDoctor(name: string, year: number, month: number): Doctor {
  return {
    id: crypto.randomUUID(),
    name,
    yearsOfExperience: null,
    isRotating: null,
    hasChildcare: null,
    unavailableDates: { oncall: [], dayshift: [] },
    targetPeriod: { startYear: year, startMonth: month },
    savedAt: new Date().toISOString(),
    expiresAt: ONE_YEAR_FROM_NOW(),
  };
}

function rowToDoctor(row: Record<string, unknown>): Doctor {
  return {
    id: row.id as string,
    name: row.name as string,
    yearsOfExperience: row.years_of_experience as number | null,
    isRotating: row.is_rotating as "own" | "emergency" | "other" | null,
    hasChildcare: row.has_childcare as boolean | null,
    unavailableDates: {
      oncall: (row.unavailable_oncall as string[]) ?? [],
      dayshift: (row.unavailable_dayshift as string[]) ?? [],
    },
    targetPeriod: { startYear: row.period_year as number, startMonth: row.period_month as number },
    savedAt: row.saved_at as string,
    expiresAt: row.expires_at as string,
  };
}

function doctorToRow(doc: Doctor, year: number, month: number) {
  return {
    id: doc.id,
    name: doc.name,
    years_of_experience: doc.yearsOfExperience,
    is_rotating: doc.isRotating,
    has_childcare: doc.hasChildcare,
    unavailable_oncall: doc.unavailableDates.oncall,
    unavailable_dayshift: doc.unavailableDates.dayshift,
    period_year: year,
    period_month: month,
    saved_at: doc.savedAt,
    expires_at: doc.expiresAt,
  };
}

// ─── Schedule ──────────────────────────────────────────────────────────────

export async function loadSchedule(year: number, month: number): Promise<Schedule | null> {
  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("period_year", year)
    .eq("period_month", month)
    .maybeSingle();
  if (error) { console.error(error); return null; }
  if (!data) return null;
  return {
    period: { startYear: data.period_year, startMonth: data.period_month },
    assignments: data.assignments,
    unitCounts: data.unit_counts,
    weekendHolidayCounts: data.weekend_holiday_counts ?? {},
    savedAt: data.saved_at,
  };
}

export async function saveSchedule(year: number, month: number, schedule: Schedule): Promise<void> {
  const { error } = await supabase.from("schedules").upsert({
    period_year: year,
    period_month: month,
    assignments: schedule.assignments,
    unit_counts: schedule.unitCounts,
    weekend_holiday_counts: schedule.weekendHolidayCounts,
    saved_at: schedule.savedAt,
  }, { onConflict: "period_year,period_month" });
  if (error) console.error(error);
}

export async function deleteSchedule(year: number, month: number): Promise<void> {
  const { error } = await supabase.from("schedules")
    .delete()
    .eq("period_year", year)
    .eq("period_month", month);
  if (error) console.error(error);
}

// ─── Custom Holidays ───────────────────────────────────────────────────────

export async function loadCustomHolidays(year: number, month: number): Promise<CustomHoliday[]> {
  const { data, error } = await supabase
    .from("custom_holidays")
    .select("date, label")
    .eq("period_year", year)
    .eq("period_month", month);
  if (error) { console.error(error); return []; }
  return (data ?? []) as CustomHoliday[];
}

export async function saveCustomHolidays(year: number, month: number, holidays: CustomHoliday[]): Promise<void> {
  // 全削除して再挿入
  await supabase.from("custom_holidays").delete().eq("period_year", year).eq("period_month", month);
  if (holidays.length === 0) return;
  const rows = holidays.map((h) => ({ period_year: year, period_month: month, date: h.date, label: h.label }));
  const { error } = await supabase.from("custom_holidays").insert(rows);
  if (error) console.error(error);
}

// ─── Carryover ─────────────────────────────────────────────────────────────

export async function loadCarryover(year: number, month: number): Promise<Carryover> {
  const { data, error } = await supabase
    .from("carryovers")
    .select("data")
    .eq("period_year", year)
    .eq("period_month", month)
    .maybeSingle();
  if (error) { console.error(error); return {}; }
  return (data?.data as Carryover) ?? {};
}

export async function saveCarryover(year: number, month: number, carryover: Carryover): Promise<void> {
  const { error } = await supabase.from("carryovers").upsert({
    period_year: year,
    period_month: month,
    data: carryover,
  }, { onConflict: "period_year,period_month" });
  if (error) console.error(error);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export function purgeExpiredData(): void {
  // Supabaseでは expires_at > now() のフィルタで自動除外。手動削除不要。
}
