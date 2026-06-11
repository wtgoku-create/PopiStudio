import React, { useEffect } from 'react';

import { i18nService } from '../services/i18n';
import LoginButton from './LoginButton';
import SidebarAutomationIcon from './icons/SidebarAutomationIcon';
interface SidebarProps {
  onShowSettings: () => void;
  onShowLogin?: () => void;
  activeView: 'cowork' | 'skills' | 'scheduledTasks' | 'mcp' | 'folder';
  onShowSkills: () => void;
  onShowCowork: () => void;
  onShowFolder: () => void;
  onShowScheduledTasks: () => void;
  onNewChat: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isAgentPanelCollapsed: boolean;
  onToggleAgentPanel: () => void;
  onCollapseAgentPanel: () => void;
  updateBadge?: React.ReactNode;
  hideLogin?: boolean;
}

const SIDEBAR_WIDTH = 60;
const sidebarIconButtonClassName =
  'relative inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-[#999999] transition-colors hover:bg-black/[0.04] hover:text-[#555555] dark:hover:bg-white/[0.05]';
const activeSidebarIconButtonClassName =
  `${sidebarIconButtonClassName} bg-black/[0.06] text-[#333333] dark:bg-white/[0.07] dark:text-foreground`;
const sidebarIconClassName = 'h-[25px] w-[25px] shrink-0';

const PopiRailLogo: React.FC = () => (
  <img
    src="logo.png"
    alt="Popi"
    className="h-[30px] w-[30px] object-contain"
    draggable={false}
  />
);

const ChatRailIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <rect x="5.25" y="6.25" width="14.5" height="12.5" rx="3.25" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="9.8" cy="12.5" r="1.05" fill="currentColor" />
    <circle cx="12.5" cy="12.5" r="1.05" fill="currentColor" />
    <circle cx="15.2" cy="12.5" r="1.05" fill="currentColor" />
  </svg>
);

const LightningRailIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path
      d="M14.15 3.7 6.6 13.55h5.15l-.85 7.75 7.6-10.15h-5.25l.9-7.45Z"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.65"
    />
  </svg>
);

const FolderRailIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 25 25" fill="none" aria-hidden="true">
    <path
      d="M4.6 8.45h6.15l1.95 2h7.7v8.2a1.9 1.9 0 0 1-1.9 1.9h-12a1.9 1.9 0 0 1-1.9-1.9V8.45Z"
      stroke="currentColor"
      strokeLinejoin="round"
      strokeWidth="1.6"
    />
    <path d="M4.6 8.45V7.8a1.8 1.8 0 0 1 1.8-1.8h4.05l2.25 2.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
  </svg>
);

interface SidebarIconButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const SidebarIconButton: React.FC<SidebarIconButtonProps> = ({
  label,
  active = false,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={active ? activeSidebarIconButtonClassName : sidebarIconButtonClassName}
    aria-label={label}
    aria-current={active ? 'page' : undefined}
    title={label}
  >
    {children}
  </button>
);

const Sidebar: React.FC<SidebarProps> = ({
  onShowSettings,
  activeView,
  onShowSkills,
  onShowCowork,
  onShowScheduledTasks,
  isAgentPanelCollapsed,
  onToggleAgentPanel,
  onCollapseAgentPanel,
  isCollapsed,
  updateBadge,
  hideLogin,
}) => {
  const isMac = window.electron.platform === 'darwin';

  useEffect(() => {
    const handleSearch = () => {
      onShowCowork();
    };
    window.addEventListener('cowork:shortcut:search', handleSearch);
    return () => {
      window.removeEventListener('cowork:shortcut:search', handleSearch);
    };
  }, [onShowCowork]);

  return (
    <aside
      className="relative z-40 shrink-0 overflow-y-hidden overflow-x-visible bg-[#E5E6EB] sidebar-transition dark:bg-[#1f1f1f]"
      style={{ width: isCollapsed ? 0 : SIDEBAR_WIDTH }}
    >
      <div
        className={`relative flex h-full flex-col transition-opacity ease-out ${isCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        style={{
          width: SIDEBAR_WIDTH,
          transitionDuration: '200ms',
        }}
      >
        <div className={`draggable sidebar-header-drag flex h-[30px] items-center justify-center mb-2 ${isMac ? 'mt-5' : 'mt-4'}`}>
          <PopiRailLogo />
        </div>
        <div className="non-draggable flex flex-col items-center gap-2 px-[10px] pt-0">
          <SidebarIconButton
            label={i18nService.t('cowork')}
            active={activeView === 'cowork' && !isAgentPanelCollapsed}
            onClick={() => {
              onShowCowork();
              onToggleAgentPanel();
            }}
          >
            <ChatRailIcon className={sidebarIconClassName} />
          </SidebarIconButton>
          <SidebarIconButton
            label={i18nService.t('scheduledTasks')}
            active={activeView === 'scheduledTasks'}
            onClick={() => {
              onShowScheduledTasks();
              onCollapseAgentPanel();
            }}
          >
            <SidebarAutomationIcon className={sidebarIconClassName} />
          </SidebarIconButton>
          <SidebarIconButton
            label={i18nService.t('skills')}
            active={activeView === 'skills'}
            onClick={() => {
              onShowSkills();
              onCollapseAgentPanel();
            }}
          >
            <LightningRailIcon className={sidebarIconClassName} />
          </SidebarIconButton>
          <SidebarIconButton
            label={i18nService.t('folder')}
            active={activeView === 'folder'}
            onClick={() => {
              onShowSkills();
              onCollapseAgentPanel();
            }}
          >
            <FolderRailIcon className={sidebarIconClassName} />
          </SidebarIconButton>
        </div>
        <div className="flex-1" />
        <div className="non-draggable flex flex-col items-center gap-2 px-[10px] pb-3">
          {updateBadge && (
            <div className="flex min-h-10 w-10 items-center justify-center overflow-hidden rounded-[9px] border border-[#c9c9c9] bg-[#f9f9f9] px-[5px] py-0.5">
              {updateBadge}
            </div>
          )}
          {!hideLogin && (
            <div className="flex h-9 w-9 items-center justify-center">
              <LoginButton iconOnly onShowSettings={onShowSettings} />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
