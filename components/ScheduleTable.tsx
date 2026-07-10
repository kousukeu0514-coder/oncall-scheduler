"use client";
import { Assignment, Doctor, CustomHoliday, LockedSlots } from "@/lib/types";

const DAY_TYPE_LABELS: Record<Assignment["dayType"], string> = {
  weekday: "平日",
  saturday: "土曜",
  "second-saturday": "第2土",
  holiday: "休日",
};

interface ScheduleTableProps {
  assignments: Assignment[];
  doctors: Doctor[];
  customHolidays: CustomHoliday[];
  onChangeDayshift?: (date: string, name: string | null) => void;
  onChangeOncall?: (date: string, name: string | null) => void;
  onLockDayshift?: (date: string, locked: boolean) => void;
  onLockOncall?: (date: string, locked: boolean) => void;
  lockedSlots?: LockedSlots;
  editable?: boolean;
}

function getDayBgClass(dayType: Assignment["dayType"]): string {
  switch (dayType) {
    case "holiday": return "bg-pink-50";
    case "second-saturday": return "bg-blue-50";
    case "saturday": return "bg-cyan-50";
    default: return "";
  }
}

export default function ScheduleTable({
  assignments,
  doctors,
  customHolidays,
  onChangeDayshift,
  onChangeOncall,
  onLockDayshift,
  onLockOncall,
  lockedSlots,
  editable = false,
}: ScheduleTableProps) {
  const doctorNames = ["（なし）", ...doctors.map((d) => d.name)];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-100">
            <th className="border px-2 py-1 text-left">日付</th>
            <th className="border px-2 py-1">曜日</th>
            <th className="border px-2 py-1">種別</th>
            <th className="border px-2 py-1">日直</th>
            <th className="border px-2 py-1">当直</th>
          </tr>
        </thead>
        <tbody>
          {assignments.map((a) => {
            const date = new Date(a.date + "T00:00:00");
            const dow = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
            const bg = getDayBgClass(a.dayType);
            const isCustom = customHolidays.some((h) => h.date === a.date);
            const isDayshiftLocked = a.lockedDayshift || (lockedSlots?.[a.date] && "dayshift" in lockedSlots[a.date]);
            const isOncallLocked = a.lockedOncall || (lockedSlots?.[a.date] && "oncall" in lockedSlots[a.date]);

            return (
              <tr key={a.date} className={`border-b ${bg}`}>
                <td className="border px-2 py-1 whitespace-nowrap">
                  {a.date}
                  {isCustom && <span className="ml-1 text-pink-500 text-xs">★</span>}
                </td>
                <td className={`border px-2 py-1 text-center ${date.getDay() === 0 ? "text-red-600" : date.getDay() === 6 ? "text-blue-600" : ""}`}>{dow}</td>
                <td className="border px-2 py-1 text-center text-xs">{DAY_TYPE_LABELS[a.dayType]}</td>

                {/* 日直 */}
                <td className="border px-2 py-1 text-center">
                  {a.dayType === "weekday" || a.dayType === "saturday" ? (
                    <span className="text-gray-300">—</span>
                  ) : editable ? (
                    <div className="flex items-center gap-1">
                      <select
                        value={a.dayshift ?? ""}
                        onChange={(e) => onChangeDayshift?.(a.date, e.target.value || null)}
                        className={`border rounded px-1 py-0.5 text-xs flex-1 ${isDayshiftLocked ? "border-amber-400 bg-amber-50" : ""}`}
                      >
                        {doctorNames.map((n) => (
                          <option key={n} value={n === "（なし）" ? "" : n}>{n}</option>
                        ))}
                      </select>
                      {onLockDayshift && (
                        <button
                          onClick={() => onLockDayshift(a.date, !isDayshiftLocked)}
                          title={isDayshiftLocked ? "確定を解除" : "確定する"}
                          className={`text-xs px-1 rounded ${isDayshiftLocked ? "text-amber-600 hover:text-gray-400" : "text-gray-300 hover:text-amber-500"}`}
                        >
                          {isDayshiftLocked ? "🔒" : "🔓"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className={isDayshiftLocked ? "font-medium" : ""}>
                      {isDayshiftLocked && <span className="mr-0.5 text-amber-500">🔒</span>}
                      {a.dayshift ?? "未定"}
                    </span>
                  )}
                </td>

                {/* 当直 */}
                <td className="border px-2 py-1 text-center">
                  {editable ? (
                    <div className="flex items-center gap-1">
                      <select
                        value={a.oncall ?? ""}
                        onChange={(e) => onChangeOncall?.(a.date, e.target.value || null)}
                        className={`border rounded px-1 py-0.5 text-xs flex-1 ${isOncallLocked ? "border-amber-400 bg-amber-50" : ""}`}
                      >
                        {doctorNames.map((n) => (
                          <option key={n} value={n === "（なし）" ? "" : n}>{n}</option>
                        ))}
                      </select>
                      {onLockOncall && (
                        <button
                          onClick={() => onLockOncall(a.date, !isOncallLocked)}
                          title={isOncallLocked ? "確定を解除" : "確定する"}
                          className={`text-xs px-1 rounded ${isOncallLocked ? "text-amber-600 hover:text-gray-400" : "text-gray-300 hover:text-amber-500"}`}
                        >
                          {isOncallLocked ? "🔒" : "🔓"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className={isOncallLocked ? "font-medium" : ""}>
                      {isOncallLocked && <span className="mr-0.5 text-amber-500">🔒</span>}
                      {a.oncall ?? "未定"}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
