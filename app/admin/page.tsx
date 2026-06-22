"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Doctor, Schedule, CustomHoliday, Carryover } from "@/lib/types";
import {
  loadDoctors,
  saveSchedule,
  loadSchedule,
  deleteSchedule,
  loadCustomHolidays,
  saveCustomHolidays,
  loadCarryover,
  saveCarryover,
  prevMonth,
  purgeExpiredData,
  deleteDoctor,
} from "@/lib/storage";
import { generateSchedule } from "@/lib/scheduler";
import { getTargetUnits, getRotatingTarget, getShiftUnits } from "@/lib/holidays";
import Calendar from "@/components/Calendar";
import ScheduleTable from "@/components/ScheduleTable";
import UnitCountChart from "@/components/UnitCountChart";
import CustomHolidayEditor from "@/components/CustomHolidayEditor";

const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD ?? "0515";
const _now = new Date();
const NEXT_MONTH = _now.getMonth() + 2 > 12 ? 1 : _now.getMonth() + 2;
const NEXT_YEAR = _now.getMonth() + 2 > 12 ? _now.getFullYear() + 1 : _now.getFullYear();
const CURRENT_YEAR = _now.getFullYear();

type ViewMode = "calendar" | "table";

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState(false);

  const [year, setYear] = useState(NEXT_YEAR);
  const [month, setMonth] = useState(NEXT_MONTH);

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>([]);
  const [carryover, setCarryover] = useState<Carryover>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("calendar");

  useEffect(() => { purgeExpiredData(); }, []);

  useEffect(() => {
    if (!authed) return;
    setDoctors(loadDoctors(year, month));
    setSchedule(loadSchedule(year, month));
    setCustomHolidays(loadCustomHolidays(year, month));
    const prev = prevMonth(year, month);
    setCarryover(loadCarryover(prev.year, prev.month));
    setWarnings([]);
  }, [authed, year, month]);

  function handleLogin() {
    if (pwInput === ADMIN_PASSWORD) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

  function handleGenerate() {
    const { schedule: newSchedule, warnings: newWarnings, newCarryover } = generateSchedule(
      year, month, doctors, customHolidays, carryover
    );
    saveSchedule(year, month, newSchedule);
    saveCarryover(year, month, newCarryover);
    setSchedule(newSchedule);
    setWarnings(newWarnings);
  }

  function handleChangeDayshift(date: string, name: string | null) {
    if (!schedule) return;
    const updated = {
      ...schedule,
      assignments: schedule.assignments.map((a) => a.date === date ? { ...a, dayshift: name } : a),
    };
    recalc(updated);
  }

  function handleChangeOncall(date: string, name: string | null) {
    if (!schedule) return;
    const updated = {
      ...schedule,
      assignments: schedule.assignments.map((a) => a.date === date ? { ...a, oncall: name } : a),
    };
    recalc(updated);
  }

  function recalc(updated: Schedule) {
    const counts: Record<string, number> = {};
    const whCounts: Record<string, number> = {};
    updated.assignments.forEach((a) => {
      const isWH = a.dayType !== "weekday";
      if (a.dayshift) {
        counts[a.dayshift] = (counts[a.dayshift] ?? 0) + getShiftUnits(a.dayType, "dayshift");
        if (isWH) whCounts[a.dayshift] = (whCounts[a.dayshift] ?? 0) + 1;
      }
      if (a.oncall) {
        counts[a.oncall] = (counts[a.oncall] ?? 0) + getShiftUnits(a.dayType, "oncall");
        if (isWH) whCounts[a.oncall] = (whCounts[a.oncall] ?? 0) + 1;
      }
    });
    const final = { ...updated, unitCounts: counts, weekendHolidayCounts: whCounts };
    saveSchedule(year, month, final);
    setSchedule(final);
  }

  function handleResetSchedule() {
    if (!confirm("当直表をリセットしますか？手動での修正内容も消えます。")) return;
    deleteSchedule(year, month);
    setSchedule(null);
    setWarnings([]);
  }

  function handleDeleteDoctor(doctorId: string, doctorName: string) {
    if (!confirm(`「${doctorName}」のデータを削除しますか？`)) return;
    deleteDoctor(year, month, doctorId);
    setDoctors(loadDoctors(year, month));
  }

  function handleCustomHolidaysChange(holidays: CustomHoliday[]) {
    saveCustomHolidays(year, month, holidays);
    setCustomHolidays(holidays);
  }

  function exportCSV() {
    if (!schedule) return;
    const rows = [["日付", "種別", "日直", "当直"]];
    schedule.assignments.forEach((a) => {
      const label: Record<string, string> = { weekday: "平日", saturday: "土曜", "second-saturday": "第2土", holiday: "休日" };
      rows.push([a.date, label[a.dayType] ?? a.dayType, a.dayshift ?? "", a.oncall ?? ""]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = `当直表_${year}-${String(month).padStart(2, "0")}.csv`;
    el.click();
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-gray-800 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-sm space-y-6">
          <h1 className="text-2xl font-bold text-gray-800 text-center">管理者ログイン</h1>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">パスワード</label>
            <input
              type="password"
              value={pwInput}
              onChange={(e) => { setPwInput(e.target.value); setPwError(false); }}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              className={`w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 ${pwError ? "border-red-400 focus:ring-red-400" : "focus:ring-gray-400"}`}
            />
            {pwError && <p className="text-red-500 text-xs mt-1">パスワードが違います</p>}
          </div>
          <button onClick={handleLogin} className="w-full bg-gray-700 text-white py-3 rounded-lg font-medium hover:bg-gray-800">ログイン</button>
          <Link href="/" className="block text-center text-sm text-gray-400 hover:text-gray-600">← トップへ戻る</Link>
        </div>
      </main>
    );
  }

  const prev = prevMonth(year, month);

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-5xl mx-auto space-y-6">

        <div className="bg-white rounded-xl shadow-sm p-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">管理者画面</h1>
            <p className="text-sm text-gray-500">当直表の自動生成・管理</p>
          </div>
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">← 戻る</Link>
        </div>

        {/* 対象月選択 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">対象月</h2>
          <div className="flex gap-2 items-center flex-wrap">
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="border rounded px-3 py-2">
              {[CURRENT_YEAR - 1, CURRENT_YEAR, CURRENT_YEAR + 1].map((y) => (
                <option key={y} value={y}>{y}年</option>
              ))}
            </select>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="border rounded px-3 py-2">
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}月</option>
              ))}
            </select>
          </div>
          {Object.keys(carryover).length > 0 && (
            <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
              <span className="font-medium">前月（{prev.year}年{prev.month}月）からの繰り越し: </span>
              {Object.entries(carryover).map(([name, v]) => (
                <span key={name} className={`mr-3 ${v > 0 ? "text-orange-600" : "text-green-700"}`}>
                  {name}: {v > 0 ? "+" : ""}{v}単位
                </span>
              ))}
            </div>
          )}
        </div>

        {/* カスタム祝日 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">祝日設定（カスタム祝日）</h2>
          <CustomHolidayEditor year={year} month={month} holidays={customHolidays} onChange={handleCustomHolidaysChange} />
        </div>

        {/* 医師一覧 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-gray-700 mb-4">医師一覧</h2>
          {doctors.length === 0 ? (
            <p className="text-gray-400 text-sm">この月の医師データがありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2">氏名</th>
                    <th className="px-3 py-2">年限</th>
                    <th className="px-3 py-2">他科ローテ</th>
                    <th className="px-3 py-2">子育て</th>
                    <th className="px-3 py-2">基本目標</th>
                    <th className="px-3 py-2">今月目標</th>
                    <th className="px-3 py-2">当直不可</th>
                    <th className="px-3 py-2">日直不可</th>
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {doctors.map((doc) => {
                    const base = getTargetUnits(doc.yearsOfExperience ?? 3);
                    const baseTarget = doc.isRotating ? getRotatingTarget(base) : base;
                    const carry = carryover[doc.name] ?? 0;
                    const adjusted = Math.max(0.5, Math.round((baseTarget - carry) * 2) / 2);
                    return (
                      <tr key={doc.id} className="border-b">
                        <td className="px-3 py-2 font-medium">{doc.name}</td>
                        <td className="px-3 py-2">{doc.yearsOfExperience}年目</td>
                        <td className="px-3 py-2 text-center">{doc.isRotating ? "✓" : "—"}</td>
                        <td className="px-3 py-2 text-center">{doc.hasChildcare ? "✓" : "—"}</td>
                        <td className="px-3 py-2 text-center">{baseTarget}</td>
                        <td className="px-3 py-2 text-center font-medium">
                          {adjusted}
                          {carry !== 0 && (
                            <span className={`ml-1 text-xs ${carry > 0 ? "text-orange-500" : "text-green-600"}`}>
                              ({carry > 0 ? "-" : "+"}{Math.abs(carry)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">{doc.unavailableDates.oncall.length}日</td>
                        <td className="px-3 py-2 text-center">{doc.unavailableDates.dayshift.length}日</td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs ${doc.savedAt ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                            {doc.savedAt ? "入力済" : "未入力"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <button
                            onClick={() => handleDeleteDoctor(doc.id, doc.name)}
                            className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50"
                          >
                            削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 生成ボタン */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex gap-3 flex-wrap items-center">
            <button
              onClick={handleGenerate}
              disabled={doctors.length === 0}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              当直表を自動生成
            </button>
            {schedule && (
              <button
                onClick={handleResetSchedule}
                className="border border-red-300 text-red-500 px-5 py-3 rounded-lg font-medium hover:bg-red-50"
              >
                当直表をリセット
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            生成すると前月繰り越しが今月の目標に反映されます。翌月への繰り越しも自動計算されます。
          </p>
        </div>

        {/* 警告 */}
        {warnings.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
            <h3 className="font-semibold text-yellow-800 mb-2">⚠️ 調整が必要な項目</h3>
            <ul className="text-sm text-yellow-700 space-y-1">
              {warnings.map((w, i) => <li key={i}>• {w}</li>)}
            </ul>
          </div>
        )}

        {/* 当直表 */}
        {schedule && (
          <>
            <div className="bg-white rounded-xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="font-semibold text-gray-700">{year}年{month}月 当直表</h2>
                <div className="flex gap-2">
                  <button onClick={() => setViewMode("calendar")} className={`px-3 py-1.5 rounded text-sm ${viewMode === "calendar" ? "bg-blue-600 text-white" : "border text-gray-600"}`}>カレンダー</button>
                  <button onClick={() => setViewMode("table")} className={`px-3 py-1.5 rounded text-sm ${viewMode === "table" ? "bg-blue-600 text-white" : "border text-gray-600"}`}>テーブル</button>
                  <button onClick={exportCSV} className="px-3 py-1.5 rounded text-sm border text-gray-600 hover:bg-gray-50">CSVダウンロード</button>
                </div>
              </div>
              {viewMode === "calendar" ? (
                <Calendar year={year} month={month} assignments={schedule.assignments} customHolidays={customHolidays} />
              ) : (
                <ScheduleTable
                  assignments={schedule.assignments}
                  doctors={doctors}
                  customHolidays={customHolidays}
                  onChangeDayshift={handleChangeDayshift}
                  onChangeOncall={handleChangeOncall}
                  editable={true}
                />
              )}
            </div>

            {doctors.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm p-6">
                <h2 className="font-semibold text-gray-700 mb-4">コマ数カウント</h2>
                <UnitCountChart
                  doctors={doctors}
                  unitCounts={schedule.unitCounts}
                  weekendHolidayCounts={schedule.weekendHolidayCounts ?? {}}
                  carryover={carryover}
                />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
