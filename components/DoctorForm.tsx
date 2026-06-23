"use client";
import { Doctor, CustomHoliday } from "@/lib/types";
import { getDatesInPeriod, toDateString, getDayType } from "@/lib/holidays";

interface DoctorFormProps {
  doctor: Doctor;
  onChange: (doctor: Doctor) => void;
  onSave: () => void;
  customHolidays?: CustomHoliday[];
}

export default function DoctorForm({ doctor, onChange, onSave, customHolidays = [] }: DoctorFormProps) {
  const dates = getDatesInPeriod(doctor.targetPeriod.startYear, doctor.targetPeriod.startMonth);
  const dateStrings = dates.map((d) => toDateString(d));
  // 日直がある日のみ（第2土・日曜・祝日・カスタム祝日）
  const dayshiftDates = dateStrings.filter((ds) => {
    const d = new Date(ds + "T00:00:00");
    const t = getDayType(d, customHolidays);
    return t === "second-saturday" || t === "holiday";
  });

  function toggleDate(field: "oncall" | "dayshift", ds: string) {
    const current = doctor.unavailableDates[field];
    const next = current.includes(ds) ? current.filter((d) => d !== ds) : [...current, ds];
    onChange({ ...doctor, unavailableDates: { ...doctor.unavailableDates, [field]: next } });
  }

  const yearOptions = Array.from({ length: 13 }, (_, i) => i + 3);

  const DOW_MON = ["月", "火", "水", "木", "金", "土", "日"];

  function getDow(ds: string): string {
    const d = new Date(ds + "T00:00:00");
    return ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  }

  function getDateClass(ds: string): string {
    const d = new Date(ds + "T00:00:00");
    const dow = d.getDay();
    if (dow === 0) return "text-red-600";
    if (dow === 6) return "text-blue-600";
    return "";
  }

  // 月曜始まりカレンダーで日付ボタンを描画（月ごとに分けて表示）
  function renderCalendarGrid(
    dsList: string[],
    selected: string[],
    selectedClass: string,
    onToggle: (ds: string) => void
  ) {
    // 対象期間の月ごとにグループ化
    const byMonth: Record<string, string[]> = {};
    dsList.forEach((ds) => {
      const ym = ds.slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = [];
      byMonth[ym].push(ds);
    });

    return Object.entries(byMonth).map(([ym, mDates]) => {
      const [y, m] = ym.split("-").map(Number);
      // 月の最初の日の曜日（月曜=0...日曜=6）
      const firstDow = new Date(y, m - 1, 1).getDay(); // 0=Sun
      const offset = (firstDow + 6) % 7; // Mon=0
      const daysInMonth = new Date(y, m, 0).getDate();

      // その月の全日付セル（不可日選択対象でない日も含む）
      const allDays: (string | null)[] = Array(offset).fill(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${ym}-${String(d).padStart(2, "0")}`;
        allDays.push(dsList.includes(ds) ? ds : ds + "_disabled");
      }
      while (allDays.length % 7 !== 0) allDays.push(null);

      return (
        <div key={ym} className="mb-4">
          <div className="text-sm font-medium text-gray-600 mb-1">{y}年{m}月</div>
          <div className="grid grid-cols-7 gap-0.5 text-xs text-center mb-1">
            {DOW_MON.map((d, i) => (
              <div key={d} className={`py-0.5 font-medium ${i === 5 ? "text-blue-500" : i === 6 ? "text-red-500" : "text-gray-500"}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {allDays.map((cell, idx) => {
              if (cell === null) return <div key={idx} />;
              const isDisabled = cell.endsWith("_disabled");
              const ds = isDisabled ? cell.replace("_disabled", "") : cell;
              const day = ds.slice(8);
              const dow = new Date(ds + "T00:00:00").getDay();
              const isSel = selected.includes(ds);

              if (isDisabled) {
                // 対象外（日直なし）の日はグレーアウト表示のみ
                return (
                  <div key={ds} className={`px-1 py-1 rounded text-xs text-center text-gray-300 ${dow === 0 ? "text-red-200" : dow === 6 ? "text-blue-200" : ""}`}>
                    {day}
                  </div>
                );
              }

              return (
                <button
                  key={ds}
                  onClick={() => onToggle(ds)}
                  className={`px-1 py-1 rounded text-xs border transition-colors ${
                    isSel ? `${selectedClass} text-white` : `bg-white border-gray-200 hover:bg-gray-50 ${getDateClass(ds) || "text-gray-800"}`
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      );
    });
  }

  // 当直不可日はすべての日が対象（月曜始まりカレンダー）
  function renderOncallCalendar() {
    const byMonth: Record<string, true> = {};
    dateStrings.forEach((ds) => { byMonth[ds.slice(0, 7)] = true; });

    return Object.keys(byMonth).map((ym) => {
      const [y, m] = ym.split("-").map(Number);
      const firstDow = new Date(y, m - 1, 1).getDay();
      const offset = (firstDow + 6) % 7;
      const daysInMonth = new Date(y, m, 0).getDate();

      const cells: (string | null)[] = Array(offset).fill(null);
      for (let d = 1; d <= daysInMonth; d++) {
        cells.push(`${ym}-${String(d).padStart(2, "0")}`);
      }
      while (cells.length % 7 !== 0) cells.push(null);

      return (
        <div key={ym} className="mb-4">
          <div className="text-sm font-medium text-gray-600 mb-1">{y}年{m}月</div>
          <div className="grid grid-cols-7 gap-0.5 text-xs text-center mb-1">
            {DOW_MON.map((d, i) => (
              <div key={d} className={`py-0.5 font-medium ${i === 5 ? "text-blue-500" : i === 6 ? "text-red-500" : "text-gray-500"}`}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((ds, idx) => {
              if (!ds) return <div key={idx} />;
              const day = ds.slice(8);
              const dow = new Date(ds + "T00:00:00").getDay();
              const isSel = doctor.unavailableDates.oncall.includes(ds);
              return (
                <button
                  key={ds}
                  onClick={() => toggleDate("oncall", ds)}
                  className={`px-1 py-1 rounded text-xs border transition-colors ${
                    isSel ? "bg-red-500 border-red-500 text-white" : `bg-white border-gray-200 hover:bg-gray-50 ${dow === 0 ? "text-red-500" : dow === 6 ? "text-blue-500" : "text-gray-800"}`
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      );
    });
  }

  const isComplete =
    doctor.yearsOfExperience !== null &&
    doctor.isRotating !== null &&
    doctor.hasChildcare !== null;

  return (
    <div className="space-y-6">
      {/* 卒後年数 */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          医師年限（卒後年数）<span className="text-red-500 ml-1">*</span>
        </label>
        <select
          value={doctor.yearsOfExperience ?? ""}
          onChange={(e) => onChange({ ...doctor, yearsOfExperience: e.target.value === "" ? null : Number(e.target.value) })}
          className={`w-full border rounded px-3 py-2 text-gray-800 bg-white ${doctor.yearsOfExperience === null ? "border-red-300 bg-red-50" : ""}`}
        >
          <option value="">-- 選択してください --</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>{y}年目{y >= 15 ? "以上" : ""}</option>
          ))}
        </select>
        {doctor.yearsOfExperience === null && (
          <p className="text-red-500 text-xs mt-1">卒後年数を選択してください</p>
        )}
      </div>

      {/* ローテーション */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          ローテーション状況<span className="text-red-500 ml-1">*</span>
        </label>
        <div className="flex flex-col gap-2">
          {[
            { value: "own", label: "当科ローテ中" },
            { value: "emergency", label: "他科ローテ中（救急）－2単位" },
            { value: "other", label: "他科ローテ中（その他）－0.5単位" },
          ].map(({ value, label }) => (
            <label key={value} className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border transition-colors ${
              doctor.isRotating === value ? "bg-blue-50 border-blue-400 text-blue-700" : "border-gray-300 hover:bg-gray-50 text-gray-800"
            }`}>
              <input
                type="radio"
                name="isRotating"
                checked={doctor.isRotating === value}
                onChange={() => onChange({ ...doctor, isRotating: value as "own" | "emergency" | "other" })}
                className="w-4 h-4"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
        {doctor.isRotating === null && (
          <p className="text-red-500 text-xs mt-1">ローテーション状況を選択してください</p>
        )}
      </div>

      {/* 子育て */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          当直対応<span className="text-red-500 ml-1">*</span>
        </label>
        <div className="flex gap-3">
          {[
            { value: false, label: "当直・日直どちらも対応可" },
            { value: true, label: "日直のみ対応可（当直は割り当てない）" },
          ].map(({ value, label }) => (
            <label key={String(value)} className={`flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg border transition-colors ${
              doctor.hasChildcare === value ? "bg-blue-50 border-blue-400 text-blue-700" : "border-gray-300 hover:bg-gray-50 text-gray-800"
            }`}>
              <input
                type="radio"
                name="hasChildcare"
                checked={doctor.hasChildcare === value}
                onChange={() => onChange({ ...doctor, hasChildcare: value })}
                className="w-4 h-4"
              />
              <span className="text-sm">{label}</span>
            </label>
          ))}
        </div>
        {doctor.hasChildcare === null && (
          <p className="text-red-500 text-xs mt-1">当直対応を選択してください</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          当直不可日（クリックで選択/解除）
        </label>
        {renderOncallCalendar()}
        {doctor.unavailableDates.oncall.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">{doctor.unavailableDates.oncall.length}日 選択中</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          日直不可日（クリックで選択/解除）
          <span className="ml-2 text-xs font-normal text-gray-400">※日直がある日（第2土・日曜・祝日）のみ</span>
        </label>
        {renderCalendarGrid(
          dayshiftDates,
          doctor.unavailableDates.dayshift,
          "bg-orange-500 border-orange-500",
          (ds) => toggleDate("dayshift", ds)
        )}
        {doctor.unavailableDates.dayshift.length > 0 && (
          <p className="text-xs text-gray-500 mt-1">{doctor.unavailableDates.dayshift.length}日 選択中</p>
        )}
      </div>

      {!isComplete && (
        <p className="text-sm text-red-500 text-center">※ すべての必須項目（*）を選択してから保存してください</p>
      )}
      <button
        onClick={onSave}
        disabled={!isComplete}
        className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        入力を保存する
      </button>
    </div>
  );
}
