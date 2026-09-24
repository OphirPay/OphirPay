import { useState, useEffect } from 'react';

export interface FiltersBarProps {
  search: string;
  sort: string;
  status: string[];
  onSearchChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onStatusChange: (statuses: string[]) => void;
}

export function FiltersBar({
  search,
  sort,
  status,
  onSearchChange,
  onSortChange,
  onStatusChange,
}: FiltersBarProps) {
  const [searchInput, setSearchInput] = useState(search);
  const [sortInput, setSortInput] = useState(sort);
  const [statusInput, setStatusInput] = useState(status);

  // Debounce search input to avoid flooding the URL
  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput, onSearchChange]);

  useEffect(() => {
    onSortChange(sortInput);
  }, [sortInput, onSortChange]);

  useEffect(() => {
    onStatusChange(statusInput);
  }, [statusInput, onStatusChange]);

  return (
    <div className="flex flex-wrap gap-4 items-center">
      <input
        type="text"
        placeholder="Search payments"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="border rounded px-2 py-1"
      />

      <select
        value={sortInput}
        onChange={(e) => setSortInput(e.target.value)}
        className="border rounded px-2 py-1"
      >
        <option value="createdAt">Newest</option>
        <option value="-createdAt">Oldest</option>
        <option value="amount">Amount ↑</option>
        <option value="-amount">Amount ↓</option>
      </select>

      <div className="flex gap-2">
        <label>
          <input
            type="checkbox"
            checked={statusInput.includes('pending')}
            onChange={(e) => {
              const newStatus = e.target.checked
                ? [...statusInput, 'pending']
                : statusInput.filter((s) => s !== 'pending');
              setStatusInput(newStatus);
            }}
          />
          Pending
        </label>
        <label>
          <input
            type="checkbox"
            checked={statusInput.includes('failed')}
            onChange={(e) => {
              const newStatus = e.target.checked
                ? [...statusInput, 'failed']
                : statusInput.filter((s) => s !== 'failed');
              setStatusInput(newStatus);
            }}
          />
          Failed
        </label>
        {/* Add more status options as needed */}
      </div>
    </div>
  );
}
