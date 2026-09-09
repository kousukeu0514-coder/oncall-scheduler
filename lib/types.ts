export interface Doctor {
  id: string;
  name: string;
  yearsOfExperience: number | null;  // null = 未選択
  isRotating: "own" | "emergency" | "other" | null; // null=未選択, own=当科, emergency=救急, other=その他
  hasChildcare: boolean | null;      // null = 未選択
  unavailableDates: {
    oncall: string[];
    dayshift: string[];
  };
  targetPeriod: {
    startYear: number;
    startMonth: number;
  };
  savedAt: string;
  expiresAt: string;
}

export interface CustomHoliday {
  date: string;
  label: string;
}

export type DayType = "weekday" | "second-saturday" | "saturday" | "holiday";

export interface Assignment {
  date: string;
  dayType: DayType;
  dayshift: string | null;
  oncall: string | null;
  lockedDayshift?: boolean; // 事前確定: 自動生成時に変更しない
  lockedOncall?: boolean;   // 事前確定: 自動生成時に変更しない
}

export type LockedSlots = Record<string, { dayshift?: string | null; oncall?: string | null }>;

export interface Schedule {
  period: { startYear: number; startMonth: number };
  assignments: Assignment[];
  unitCounts: Record<string, number>;
  // 土日祝シフト回数（公平性確認用）
  weekendHolidayCounts: Record<string, number>;
  // 累積シフト回数（前月繰り越し含む）
  shiftTotals?: Record<string, number>;
  savedAt: string;
}

// 前月からの繰り越し（実績 - 目標）。プラスなら過剰、マイナスなら不足
export type Carryover = Record<string, number>;

export interface UnitCountTarget {
  doctorName: string;
  target: number;
  actual: number;
}
