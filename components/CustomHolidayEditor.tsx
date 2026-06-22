"use client";
import { useState } from "react";
import { CustomHoliday } from "@/lib/types";
import { getDatesInPeriod, toDateString } from "@/lib/holidays";

interface CustomHolidayEditorProps {
  year: number;
  month: number;
  holidays: CustomHoliday[];
  onChange: (holidays: CustomHoliday[]) => void;
}

export default function CustomHolidayEditor({
  year,
  month,
  holidays,
  onChange,
}: CustomHolidayEditorProps) {
  const [selectedDate, setSelectedDate] = useState("");
  const [label, setLabel] = useState("");

  const dates = getDatesInPeriod(year, month);
  const dateOptions = dates.map((d) => toDateString(d));

  function addHoliday() {
    if (!selectedDate) return;
    if (holidays.some((h) => h.date === selectedDate)) return;
    onChange([...holidays, { date: selectedDate, label }]);
    setSelectedDate("");
    setLabel("");
  }

  function removeHoliday(date: string) {
    onChange(holidays.filter((h) => h.date !== date));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">日付</label>
          <select
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border rounded px-2 py-1.5 text-sm"
          >
            <option value="">選択してください</option>
            {dateOptions.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">ラベル（任意）</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例：年末休診"
            className="border rounded px-2 py-1.5 text-sm"
          />
        </div>
        <button
          onClick={addHoliday}
          disabled={!selectedDate}
          className="bg-pink-500 text-white px-3 py-1.5 rounded text-sm disabled:opacity-50 hover:bg-pink-600"
        >
          祝日として追加
        </button>
      </div>

      {holidays.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-gray-700 mb-2">登録済みカスタム祝日</h4>
          <div className="space-y-1">
            {holidays
              .slice()
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((h) => (
                <div key={h.date} className="flex items-center gap-2 bg-pink-50 border border-pink-200 rounded px-3 py-1.5">
                  <span className="text-pink-600 text-xs">★</span>
                  <span className="text-sm font-medium">{h.date}</span>
                  {h.label && <span className="text-sm text-gray-600">（{h.label}）</span>}
                  <button
                    onClick={() => removeHoliday(h.date)}
                    className="ml-auto text-red-500 hover:text-red-700 text-xs"
                  >
                    削除
                  </button>
                </div>
              ))}
          </div>
        </div>
      )}

      {holidays.length === 0 && (
        <p className="text-sm text-gray-400">カスタム祝日は登録されていません</p>
      )}
    </div>
  );
}
