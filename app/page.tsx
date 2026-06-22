import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">医師当直表作成システム</h1>
          <p className="text-gray-500 text-sm">当直・日直スケジュールを効率的に管理します</p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Link
            href="/doctor"
            className="block bg-blue-600 text-white py-5 px-8 rounded-xl text-lg font-medium hover:bg-blue-700 transition-colors shadow-md"
          >
            <div className="text-2xl mb-1">🏥</div>
            医師ログイン
            <div className="text-sm font-normal opacity-80 mt-1">不可日の入力・スケジュール確認</div>
          </Link>

          <Link
            href="/admin"
            className="block bg-gray-700 text-white py-5 px-8 rounded-xl text-lg font-medium hover:bg-gray-800 transition-colors shadow-md"
          >
            <div className="text-2xl mb-1">⚙️</div>
            管理者ログイン
            <div className="text-sm font-normal opacity-80 mt-1">当直表の自動生成・調整・エクスポート</div>
          </Link>
        </div>
      </div>
    </main>
  );
}
