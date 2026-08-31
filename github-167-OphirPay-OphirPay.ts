// components/AddressBook/AddressBook.tsx
import React, { useState, useCallback } from 'react';
import { AddressBookItem } from './AddressBookItem';
import { createBatch } from '../../services/batchService';
import { useToast } from '../../hooks/useToast';

interface AddressBookProps {
  addresses: Array<{
    id: string;
    name: string;
    address: string;
    network: string;
  }>;
  onBatchCreated?: (batchId: string, count: number) => void;
}

export const AddressBook: React.FC<AddressBookProps> = ({
  addresses,
  onBatchCreated,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { showToast } = useToast();

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(addresses.map(addr => addr.id)));
  }, [addresses]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const createBatchFromSelection = useCallback(async () => {
    if (selectedIds.size === 0) {
      showToast('error', 'Please select at least one address to create a batch');
      return;
    }

    const selectedAddresses = addresses.filter(addr => 
      selectedIds.has(addr.id)
    );

    try {
      const batchId = await createBatch(selectedAddresses);
      showToast('success', `Batch created successfully with ${selectedAddresses.length} addresses`);
      onBatchCreated?.(batchId, selectedAddresses.length);
      clearSelection();
    } catch (error) {
      showToast('error', 'Failed to create batch. Please try again.');
      console.error('Batch creation failed:', error);
    }
  }, [selectedIds, addresses, showToast, onBatchCreated, clearSelection]);

  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);

  return (
    <div className="address-book">
      <div className="address-book-header">
        <h3>Address Book</h3>
        <div className="batch-controls">
          <button 
            onClick={selectAll}
            disabled={addresses.length === 0}
            className="btn-secondary"
          >
            Select All
          </button>
          <button 
            onClick={clearSelection}
            disabled={selectedIds.size === 0}
            className="btn-secondary"
          >
            Clear
          </button>
          <button 
            onClick={createBatchFromSelection}
            disabled={selectedIds.size === 0}
            className="btn-primary"
          >
            Create Batch ({selectedIds.size})
          </button>
        </div>
      </div>
      <div className="address-book-list">
        {addresses.map(address => (
          <AddressBookItem
            key={address.id}
            address={address}
            isSelected={isSelected(address.id)}
            onToggle={() => toggleSelection(address.id)}
          />
        ))}
      </div>
    </div>
  );
};