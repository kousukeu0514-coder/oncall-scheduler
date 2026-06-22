"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Doctor, CustomHoliday } from "@/lib/types";
import { loadDoctors, saveDoctor, createDoctor, loadCustomHolidays, purgeExpiredData } from "@/lib/storage";
import DoctorForm from "@/components/DoctorForm";

const NOW = new Date();
const NEXT_MONTH = NOW.getMonth() + 2 > 12 ? 1 : NOW.getMonth() + 2;
const NEXT_MONTH_YEAR = NOW.getMonth() + 2 > 12 ? NOW.getFullYear() + 1 : NOW.getFullYear();
const NEXT_YEAR = NEXT_MONTH_YEAR;

export default function DoctorPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [startYear, setStartYear] = useState(NEXT_MONTH_YEAR);
  const [startMonth, setStartMonth] = useState(NEXT_MONTH);
  const [saved, setSaved] = useState(false);
  const [customHolidays, setCustomHolidays] = useState<CustomHoliday[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { purgeExpiredData(); }, []);

  useEffect(() => {
    if (!loggedIn) return;
    setLoading(true);
    Promise.all([
      loadCustomHolidays(startYear, startMonth),
      loadDoctors(startYear, startMonth),
    ]).then(([holidays, doctors]) => {
      setCustomHolidays(holidays);
      const existing = doctors.find((d) => d.name === doctorName);
      setDoctor(existing ?? createDoctor(doctorName, startYear, startMonth));
      setSaved(false);
    }).finally(() => setLoading(false));
  }, [startYear, startMonth, loggedIn, doctorName]);

  function normalizeName(name: string): string {
    return name.trim().replace(/　/g, " ").replace(/\s+/g, " ");
  }

  function handleLogin() {
    const normalized = normalizeName(nameInput);
    if (!normalized) return;
    setDoctorName(normalized);
    setLoggedIn(true);
  }

  async function handleSave() {
    if (!doctor) return;
    const now = new Date();
    const updated: Doctor = {
      ...doctor,
      savedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await saveDoctor(startYear, startMonth, updated);
    setDoctor(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const monthOptions = Array.from({ length: 12 }, (_, i) => i + 1);
  const yearOptions = [NEXT_YEAR - 1, NEXT_YEAR, NEXT_YEAR + 1];

  if (!loggedIn) {
    return (
      <main className="min-h-screen bg-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-md p-8 w-full max-w-md space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-gray-800">医師ログイン</h1>
            <p className="text-sm text-gray-500 mt-1">お名前を入力してください</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">氏名</label>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              placeholder="例：山田 太郎"
              className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleLogin}
            disabled={!nameInput.trim()}
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            ログイン
          </button>
          <Link href="/" className="block text-center text-sm text-gray-400 hover:text-gray-600">← トップへ戻る</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-gray-800">{doctorName} さんの入力フォーム</h1>
            <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">← 戻る</Link>
          </div>

          <div className="bg-blue-50 rounded-lg p-4 mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">対象月</label>
            <div className="flex gap-2 items-center flex-wrap">
              <select
                value={startYear}
                onChange={(e) => setStartYear(Number(e.target.value))}
                className="border rounded-lg px-3 py-2 bg-white"
              >
                {yearOptions.map((y) => <option key={y} value={y}>{y}年</option>)}
              </select>
              <select
                value={startMonth}
                onChange={(e) => setStartMonth(Number(e.target.value))}
                className="border rounded-lg px-3 py-2 bg-white"
              >
                {monthOptions.map((m) => <option key={m} value={m}>{m}月</option>)}
              </select>
              <span className="text-sm text-gray-500">（1ヶ月間）</span>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-400">読み込み中...</div>
          ) : doctor && (
            <DoctorForm
              doctor={doctor}
              onChange={setDoctor}
              onSave={handleSave}
              customHolidays={customHolidays}
            />
          )}

          {saved && (
            <div className="mt-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
              ✓ 保存しました（有効期限: 1年間）
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
