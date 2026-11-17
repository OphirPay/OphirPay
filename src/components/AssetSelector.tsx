import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';

interface Asset {
  id: string;
  symbol: string;
  name: string;
  icon?: string;
}

interface AssetSelectorProps {
  assets: Asset[];
  onSelect: (asset: Asset) => void;
  onClose?: () => void;
  isOpen: boolean;
}

export const AssetSelector: React.FC<AssetSelectorProps> = ({
  assets,
  onSelect,
  onClose,
  isOpen,
}) => {
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset active index when list changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      // Focus the container to capture keyboard events immediately
      listRef.current?.focus();
    }
  }, [isOpen, assets]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!isOpen) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((prev) => (prev < assets.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < assets.length) {
          onSelect(assets[activeIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        onClose?.();
        break;
      case 'Tab':
        // Basic focus trap logic could go here if not handled by a parent Modal component
        break;
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="asset-selector-container"
      role="dialog"
      aria-modal="true"
      aria-label="Select an asset"
    >
      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="asset-list-wrapper focus:outline-none"
        aria-activedescendant={activeIndex >= 0 ? `asset-option-${activeIndex}` : undefined}
      >
        {assets.map((asset, index) => (
          <div
            key={asset.id}
            id={`asset-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            onClick={() => onSelect(asset)}
            onMouseEnter={() => setActiveIndex(index)}
            className={`asset-item ${
              index === activeIndex ? 'bg-blue-100 dark:bg-blue-900 selected' : ''
            } cursor-pointer p-3 flex items-center gap-3`}
          >
            {asset.icon && <img src={asset.icon} alt="" className="w-6 h-6" />}
            <div className="flex flex-col">
              <span className="font-bold">{asset.symbol}</span>
              <span className="text-sm opacity-70">{asset.name}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
