import React, { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import Footer from './Footer';
import SSHPage from '../../pages/SSHPage';
import ChatPage from '../../pages/ChatPage/index';

interface LayoutProps {
  children: ReactNode;
}

/**
 * Application shell layout — vertical three-zone structure:
 *
 *   ┌─────────────────────────────────┐
 *   │           Header (h-10)         │  ← top, fixed height
 *   ├──────┬──────────────────────────┤
 *   │ Side │                          │
 *   │ bar  │    Main content          │  ← middle, flex-1
 *   │      │                          │
 *   ├──────┴──────────────────────────┤
 *   │           Footer (h-[22px])     │  ← bottom, fixed height
 *   └─────────────────────────────────┘
 */
const Layout: React.FC<LayoutProps> = ({ children }) => {
  const { pathname } = useLocation();
  // Full-bleed pages: terminal/ssh/workspace need every pixel (no padding)
  const isFullBleed = pathname === '/ssh' || pathname === '/chat' || pathname.startsWith('/workspace');

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Top: Header ── */}
      <Header />

      {/* ── Middle: Sidebar + Main content ── */}
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className={`flex-1 overflow-y-auto bg-background-secondary scrollbar-thin ${
          isFullBleed ? 'p-0' : 'p-6'
        }`}>
          {/* Keep-Alive Persistent Pages */}
          <div 
            className="h-full w-full flex flex-col overflow-hidden"
            style={{ display: pathname === '/ssh' ? 'flex' : 'none' }}
          >
            <SSHPage />
          </div>
          <div 
            className="h-full w-full flex flex-col overflow-hidden"
            style={{ display: pathname === '/chat' ? 'flex' : 'none' }}
          >
            <ChatPage />
          </div>

          {/* Standard routes */}
          {pathname !== '/ssh' && pathname !== '/chat' && children}
        </main>
      </div>

      {/* ── Bottom: Footer ── */}
      <Footer />
    </div>
  );
};

export default Layout;
