import React from 'react';
import { Link } from 'react-router-dom';

interface SidebarProps {
  isOpen: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`} role="complementary">
      <nav className="sidebar-nav" aria-label="Secondary navigation">
        <ul>
          <li><Link to="/wallet">Wallet</Link></li>
          <li><Link to="/activity">Activity</Link></li>
          <li><Link to="/support">Support</Link></li>
        </ul>
      </nav>
    </aside>
  );
};
