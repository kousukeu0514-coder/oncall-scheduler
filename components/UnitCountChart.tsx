"use client";
import { Doctor, Carryover } from "@/lib/types";
import { getTargetUnits, getAdjustedTarget } from "@/lib/holidays";

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
    const target = doc.hasChildcare === true ? 2 : Math.max(0.5, Math.round((baseTarget - carry) * 2) / 2);
    const actual = unitCounts[doc.name] ?? 0;
    const diff = actual - target;
    const whCount = weekendHolidayCounts[doc.name] ?? 0;
    return { doc, target, actual, diff, whCount };
  });

  const maxActual = Math.max(...rows.map((r) => Math.max(r.target, r.actual)), 1);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-3 py-2">医師名</th>
            <th className="px-3 py-2">年限</th>
            <th className="px-3 py-2">今月目標</th>
            <th className="px-3 py-2">実績</th>
            <th className="px-3 py-2">差分</th>
            <th className="px-3 py-2">土日祝回数</th>
            <th className="px-3 py-2 min-w-[160px]">グラフ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ doc, target, actual, diff, whCount }) => {
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
      </table>
    </div>
  );
}
