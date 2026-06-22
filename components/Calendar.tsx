"use client";
import { Assignment, CustomHoliday } from "@/lib/types";
import { getDayType, toDateString, getDatesInPeriod, isHoliday } from "@/lib/holidays";

interface CalendarProps {
  year: number;
  month: number;
  assignments: Assignment[];
  customHolidays: CustomHoliday[];
  onCellClick?: (date: string) => void;
}

function getDayBg(dayType: Assignment["dayType"]): string {
  switch (dayType) {
    case "holiday": return "bg-pink-100";
    case "second-saturday": return "bg-blue-100";
    case "saturday": return "bg-cyan-100";
    default: return "bg-white";
  }
}

export default function Calendar({ year, month, assignments, customHolidays, onCellClick }: CalendarProps) {
  const assignMap = new Map(assignments.map((a) => [a.date, a]));

  const months = [{ year, month }];

  const DOW = ["月", "火", "水", "木", "金", "土", "日"];

  return (
    <div className="space-y-6">
      {months.map(({ year, month }) => {
        const firstDow = new Date(year, month - 1, 1).getDay(); // 0=Sun
        const offset = (firstDow + 6) % 7; // Mon=0
        const daysInMonth = new Date(year, month, 0).getDate();
        const cells: (number | null)[] = Array(offset).fill(null);
        for (let d = 1; d <= daysInMonth; d++) cells.push(d);
        while (cells.length % 7 !== 0) cells.push(null);

        const customLabel = (date: Date) => {
          const ds = toDateString(date);
          return customHolidays.find((h) => h.date === ds)?.label ?? null;
        };

        return (
          <div key={`${year}-${month}`}>
            <h3 className="text-lg font-bold mb-2">{year}年{month}月</h3>
            <div className="grid grid-cols-7 text-center text-sm font-medium">
              {DOW.map((d, i) => (
                <div key={d} className={`py-1 ${i === 6 ? "text-red-500" : i === 5 ? "text-blue-500" : ""}`}>{d}</div>
              ))}
              {cells.map((day, idx) => {
                if (day === null) return <div key={idx} />;
                const date = new Date(year, month - 1, day);
                const ds = toDateString(date);
                const a = assignMap.get(ds);
                const dayType = a?.dayType ?? getDayType(date, customHolidays);
                const bg = getDayBg(dayType);
                const isCustomHoliday = customHolidays.some((h) => h.date === ds);
                const label = customLabel(date);
                const isHol = isHoliday(date, customHolidays);

                return (
                  <div
                    key={ds}
                    className={`border border-gray-200 p-1 min-h-[70px] text-xs ${bg} ${onCellClick ? "cursor-pointer hover:opacity-80" : ""}`}
                    onClick={() => onCellClick?.(ds)}
                    title={label ?? undefined}
                  >
                    <div className={`font-bold mb-1 ${(date.getDay() === 0 || isHol) ? "text-red-600" : date.getDay() === 6 ? "text-blue-600" : ""}`}>
                      {day}
                      {isCustomHoliday && <span className="ml-1 text-pink-500 text-[10px]">★</span>}
                    </div>
                    {a?.dayshift && (
                      <div className="bg-yellow-100 rounded px-1 mb-0.5 truncate text-gray-800">日:{a.dayshift}</div>
                    )}
                    {a?.oncall && (
                      <div className="bg-blue-50 rounded px-1 truncate text-gray-800">当:{a.oncall}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
