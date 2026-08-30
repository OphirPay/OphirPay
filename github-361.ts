import { useState, useEffect } from 'react';
import Papa from 'papaparse';

interface AuditLog {
  id: string;
  timestamp: string;
  transactionType: string;
  status: 'success' | 'failed' | 'pending';
  amount: number;
  user: string;
  details: string;
}

const AuditLogExplorer = () => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    type: '',
    status: ''
  });

  // Mock data fetching
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 500));
        const mockData: AuditLog[] = [
          {
            id: '1',
            timestamp: '2023-05-15T10:30:00Z',
            transactionType: 'Transfer',
            status: 'success',
            amount: 1000,
            user: 'user123',
            details: 'Transfer to wallet'
          },
          {
            id: '2',
            timestamp: '2023-05-16T14:22:00Z',
            transactionType: 'Payment',
            status: 'failed',
            amount: 500,
            user: 'user456',
            details: 'Payment declined'
          }
        ];
        setLogs(mockData);
        setFilteredLogs(mockData);
      } catch (error) {
        console.error('Failed to fetch logs:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, []);

  // Apply filters
  useEffect(() => {
    let result = [...logs];
    
    if (filters.startDate) {
      result = result.filter(log => 
        new Date(log.timestamp) >= new Date(filters.startDate)
      );
    }
    
    if (filters.endDate) {
      result = result.filter(log => 
        new Date(log.timestamp) <= new Date(filters.endDate)
      );
    }
    
    if (filters.type) {
      result = result.filter(log => log.transactionType === filters.type);
    }
    
    if (filters.status) {
      result = result.filter(log => log.status === filters.status);
    }
    
    setFilteredLogs(result);
  }, [filters, logs]);

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFilters(prev => ({ ...prev, [name]: value }));
  };

  const exportToCSV = () => {
    const csvContent = Papa.unparse(filteredLogs);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'audit-logs.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <div className="p-4">Loading audit logs...</div>;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Audit Log Explorer</h1>
      
      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Start Date</label>
            <input
              type="date"
              name="startDate"
              value={filters.startDate}
              onChange={handleFilterChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">End Date</label>
            <input
              type="date"
              name="endDate"
              value={filters.endDate}
              onChange={handleFilterChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Transaction Type</label>
            <select
              name="type"
              value={filters.type}
              onChange={handleFilterChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              <option value="">All Types</option>
              <option value="Transfer">Transfer</option>
              <option value="Payment">Payment</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Status</label>
            <select
              name="status"
              value={filters.status}
              onChange={handleFilterChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              <option value="">All Statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
          </div>
        </div>
        
        <div className="mt-4 flex justify-end">
          <button
            onClick={exportToCSV}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Export to CSV
          </button>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white shadow overflow-hidden sm:rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Timestamp</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Details</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredLogs.map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{new Date(log.timestamp).toLocaleString()}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{log.transactionType}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                    ${log.status === 'success' ? 'bg-green-100 text-green-800' : 
                      log.status === 'failed' ? 'bg-red-100 text-red-800' : 
                      'bg-yellow-100 text-yellow-800'}`}>
                    {log.status}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${log.amount}</td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{log.user}</td>
                <td className="px-6 py-4 text-sm text-gray-900">{log.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredLogs.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No audit logs match your filters</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditLogExplorer;