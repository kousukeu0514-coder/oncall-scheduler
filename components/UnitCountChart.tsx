"use client";
import { Doctor, Carryover } from "@/lib/types";
import { getTargetUnits, getAdjustedTarget } from "@/lib/holidays";

const WH_PREFIX = "__wh__";

interface UnitCountChartProps {
  doctors: Doctor[];
  unitCounts: Record<string, number>;
  weekendHolidayCounts: Record<string, number>;
  carryover: Carryover;
}

export default function UnitCountChart({ doctors, unitCounts, weekendHolidayCounts, carryover }: UnitCountChartProps) {
  const rows = doctors.map((doc) => {
    const base = getTargetUnits(doc.yearsOfExperience ?? 3);
    const baseTarget = getAdjustedTarget(base, doc.isRotating);
    const carry = carryover[doc.name] ?? 0;
    const target = doc.hasChildcare === true
      ? Math.min(2, Math.max(0.5, Math.round((baseTarget - carry) * 2) / 2))
      : Math.min(5.5, Math.max(0.5, Math.round((baseTarget - carry) * 2) / 2));
    const actual = unitCounts[doc.name] ?? 0;
    const diff = actual - target;
    const whCount = weekendHolidayCounts[doc.name] ?? 0;
    // 累積土日祝回数（繰り越し含む）: carryoverの __wh__ キーに保存されている
    const whTotal = carryover[`${WH_PREFIX}${doc.name}`] ?? whCount;
    return { doc, target, actual, diff, whCount, whTotal };
  });

  const maxActual = Math.max(...rows.map((r) => Math.max(r.target, r.actual)), 1);

  // 合計行
  const totalActual = rows.reduce((s, r) => s + r.actual, 0);
  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const totalWh = rows.reduce((s, r) => s + r.whCount, 0);
  const totalWhTotal = rows.reduce((s, r) => s + r.whTotal, 0);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-3 py-2">医師名</th>
            <th className="px-3 py-2">年限</th>
            <th className="px-3 py-2">今月目標</th>
            <th className="px-3 py-2">今月実績</th>
            <th className="px-3 py-2">差分</th>
            <th className="px-3 py-2 text-center">今月<br/>土日祝</th>
            <th className="px-3 py-2 text-center">累積<br/>土日祝</th>
            <th className="px-3 py-2 min-w-[160px]">グラフ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ doc, target, actual, diff, whCount, whTotal }) => {
            const barColor = diff > 0.4 ? "bg-red-400" : diff < -0.4 ? "bg-green-400" : "bg-blue-400";
            const diffColor = diff > 0.4 ? "text-red-600 font-bold" : diff < -0.4 ? "text-green-600" : "text-gray-600";
            const pct = Math.min((actual / maxActual) * 100, 100);
            return (
              <tr key={doc.id} className="border-b">
                <td className="px-3 py-2 font-medium">{doc.name}</td>
                <td className="px-3 py-2">{doc.yearsOfExperience}年目</td>
                <td className="px-3 py-2">{target}</td>
                <td className="px-3 py-2">{actual.toFixed(1)}</td>
                <td className={`px-3 py-2 ${diffColor}`}>{diff > 0 ? "+" : ""}{diff.toFixed(1)}</td>
                <td className="px-3 py-2 text-center">{whCount}回</td>
                <td className="px-3 py-2 text-center font-medium">{whTotal}回</td>
                <td className="px-3 py-2">
                  <div className="relative h-5 bg-gray-100 rounded overflow-hidden">
                    <div className={`absolute left-0 top-0 h-full ${barColor} rounded`} style={{ width: `${pct}%` }} />
                    <div className="absolute top-0 h-full border-l-2 border-gray-500" style={{ left: `${(target / maxActual) * 100}%` }} title={`目標: ${target}`} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-gray-50 font-semibold border-t-2 border-gray-300">
            <td className="px-3 py-2" colSpan={2}>合計</td>
            <td className="px-3 py-2">{totalTarget.toFixed(1)}</td>
            <td className="px-3 py-2">{totalActual.toFixed(1)}</td>
            <td className={`px-3 py-2 ${(totalActual - totalTarget) > 0 ? "text-red-600" : (totalActual - totalTarget) < 0 ? "text-green-600" : "text-gray-600"}`}>
              {(totalActual - totalTarget) > 0 ? "+" : ""}{(totalActual - totalTarget).toFixed(1)}
            </td>
            <td className="px-3 py-2 text-center">{totalWh}回</td>
            <td className="px-3 py-2 text-center">{totalWhTotal}回</td>
            <td className="px-3 py-2" />
          </tr>
        </tfoot>
      </table>
      <p className="text-xs text-gray-400 mt-2">※ 累積土日祝は前月までの繰り越し＋今月分の合計です。途中参加・離脱の先生は累積が少なくなります。</p>
    </div>
  );
}
