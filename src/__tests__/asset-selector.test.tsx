import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetSelector } from '../components/AssetSelector';
import '@testing-library/jest-dom';

const mockAssets = [
  { id: '1', symbol: 'ETH', name: 'Ethereum' },
  { id: '2', symbol: 'USDC', name: 'USD Coin' },
  { id: '3', symbol: 'OP', name: 'Optimism' },
];

describe('AssetSelector Keyboard Navigation & A11y', () => {
  const mockOnSelect = jest.fn();
  const mockOnClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders with correct ARIA roles', () => {
    render(
      <AssetSelector 
        assets={mockAssets} 
        onSelect={mockOnSelect} 
        isOpen={true} 
      />
    );

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(mockAssets.length);
  });

  test('navigates down with ArrowDown key', () => {
    render(
      <AssetSelector 
        assets={mockAssets} 
        onSelect={mockOnSelect} 
        isOpen={true} 
      />
    );

    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    // Initial state (first item selected by default in our implementation)
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
  });

  test('navigates up with ArrowUp key', () => {
    render(
      <AssetSelector 
        assets={mockAssets} 
        onSelect={mockOnSelect} 
        isOpen={true} 
      />
    );

    const listbox = screen.getByRole('listbox');
    const options = screen.getAllByRole('option');

    // Move to second item then back to first
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  test('selects item with Enter key', () => {
    render(
      <AssetSelector 
        assets={mockAssets} 
        onSelect={mockOnSelect} 
        isOpen={true} 
      />
    );

    const listbox = screen.getByRole('listbox');
    
    // Navigate to second item (USDC)
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(mockOnSelect).toHaveBeenCalledWith(mockAssets[1]);
  });

  test('closes on Escape key', () => {
    render(
      <AssetSelector 
        assets={mockAssets} 
        onSelect={mockOnSelect} 
        onClose={mockOnClose}
        isOpen={true} 
      />
    );

    const listbox = screen.getByRole('listbox');
    fireEvent.keyDown(listbox, { key: 'Escape' });

    expect(mockOnClose).toHaveBeenCalled();
  });
});
