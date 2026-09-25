import Link from 'next/link';

export function Sidebar() {
  return (
    <div className="hidden md:block">
      <div className="fixed inset-y-0 left-0 z-10 flex flex-col border-r border-gray-200 bg-white w-64">
        <div className="flex-1 flex flex-col overflow-y-auto">
          <nav className="flex-1 px-2 py-4 space-y-1">
            <Link
              href="/dashboard""
              className="bg-gray-100 text-gray-900 group flex items-center px-2 py-2 text-sm font-medium rounded-md"
            >
              Dashboard
            </Link>
            <Link
              href="/escrows""
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-50 group flex items-center px-2 py-2 text-sm font-medium rounded-md"
            >
              Escrows
            </Link>
            <Link
              href="/transactions""
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-50 group flex items-center px-2 py-2 text-sm font-medium rounded-md"
            >
              Transactions
            </Link>
          </nav>
        </div>
      </div>
    </div>
  );
}