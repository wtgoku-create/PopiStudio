import React, { useEffect } from 'react';

import { MainView, type MainView as MainViewType } from '../constants/navigation';
import { i18nService } from '../services/i18n';
import SidebarAutomationIcon from './icons/SidebarAutomationIcon';
import LoginButton from './LoginButton';
import TeamOutlinedIcon from './icons/TeamOutlinedIcon';
interface SidebarProps {
  onShowSettings: () => void;
  onShowLogin?: () => void;
  activeView: MainViewType;
  onShowSkills: () => void;
  onShowCowork: () => void;
  onShowFolder: () => void;
  onShowContacts: () => void;
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

const SIDEBAR_WIDTH = 54;
const sidebarIconButtonBaseClassName =
  'relative inline-flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors hover:bg-surface hover:text-[#333333] dark:hover:bg-white/[0.06] dark:hover:text-foreground';
const sidebarIconButtonClassName = `${sidebarIconButtonBaseClassName} text-muted`;
const activeSidebarIconButtonClassName = `${sidebarIconButtonBaseClassName} bg-surface text-[#333333] dark:bg-white/[0.08] dark:text-foreground`;
const sidebarIconClassName = 'h-[25px] w-[25px] shrink-0';

const PopiRailLogo: React.FC = () => (
  <img src="logo.png" alt="Popi" className="h-[30px] w-[30px] object-contain" draggable={false} />
);

const ChatRailIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width="25"
      height="25"
      viewBox="0 0 25 25"
      fill="currentColor"
    >
      <path
        d="M19.876 8.08443C19.876 6.71703 18.7653 5.60626 17.3979 5.60626H7.08443C5.71703 5.60626 4.60626 6.71703 4.60626 8.08443V18.4242H17.3979C18.7653 18.4242 19.876 17.3134 19.876 15.946V8.08443ZM21.4823 15.946C21.4823 18.2006 19.6524 20.0305 17.3979 20.0305H3.80313C3.35957 20.0305 3 19.6709 3 19.2273V8.08443C3 5.82992 4.82992 4 7.08443 4H17.3979C19.6524 4 21.4823 5.82992 21.4823 8.08443V15.946Z"
        fill="currentColor"
      />
      <path
        d="M8.54201 13.0457C9.10339 13.0457 9.55848 12.5906 9.55848 12.0293C9.55848 11.4679 9.10339 11.0128 8.54201 11.0128C7.98063 11.0128 7.52554 11.4679 7.52554 12.0293C7.52554 12.5906 7.98063 13.0457 8.54201 13.0457Z"
        fill="currentColor"
      />
      <path
        d="M12.2414 13.0177C12.8027 13.0177 13.2578 12.5626 13.2578 12.0012C13.2578 11.4399 12.8027 10.9848 12.2414 10.9848C11.68 10.9848 11.2249 11.4399 11.2249 12.0012C11.2249 12.5626 11.68 13.0177 12.2414 13.0177Z"
        fill="currentColor"
      />
      <path
        d="M15.9407 13.0457C16.5021 13.0457 16.9572 12.5906 16.9572 12.0293C16.9572 11.4679 16.5021 11.0128 15.9407 11.0128C15.3793 11.0128 14.9242 11.4679 14.9242 12.0293C14.9242 12.5906 15.3793 13.0457 15.9407 13.0457Z"
        fill="currentColor"
      />
    </svg>
  );
};

const LightningRailIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width="25"
      height="25"
      viewBox="0 0 25 25"
      fill="currentColor"
    >
      <path
        d="M13.8342 2.41357C14.705 1.48462 16.27 2.23812 16.062 3.50943L14.921 10.4995H17.9259C19.0596 10.4995 19.6501 11.8541 18.8722 12.6839L18.8721 12.6838L10.3903 21.7608C10.39 21.7611 10.3898 21.7614 10.3895 21.7617C9.51847 22.6909 7.9529 21.9369 8.16177 20.6651L9.30267 13.6758H6.29777C5.15555 13.6758 4.58416 12.3179 5.3488 11.4943L5.35057 11.4923L13.8333 2.41454C13.8336 2.41423 13.8339 2.41388 13.8342 2.41357ZM7.00964 12.0695H9.6676C10.466 12.0695 11.0759 12.7869 10.9466 13.5749L10.9467 13.5749L9.91065 19.9215L17.214 12.1058H14.556C13.7576 12.1058 13.1477 11.3884 13.2769 10.6004L14.3129 4.2538L7.00964 12.0695Z"
        fill="currentColor"
      />
    </svg>
  );
};

const FolderRailIcon: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width="25"
      height="25"
      viewBox="0 0 25 25"
      fill="currentColor"
    >
      <path
        d="M18.46 19.2957H5.84473C4.82743 19.2957 4 18.4683 4 17.451V7.84473C4 6.82743 4.82743 6 5.84473 6H9.97488C10.6466 6 11.2657 6.36532 11.5902 6.95346L12.848 9.23311C12.89 9.30931 12.9699 9.35626 13.0568 9.35626H18.46C19.4773 9.35626 20.3048 10.1837 20.3048 11.201V17.451C20.3048 18.4683 19.4773 19.2957 18.46 19.2957ZM5.84473 7.60626C5.71334 7.60626 5.60626 7.71334 5.60626 7.84473V17.451C5.60626 17.5824 5.71334 17.6895 5.84473 17.6895H18.46C18.5914 17.6895 18.6985 17.5824 18.6985 17.451V11.201C18.6985 11.0696 18.5914 10.9625 18.46 10.9625H13.0568C12.3851 10.9625 11.7661 10.5972 11.4415 10.0091L10.1837 7.72941C10.1417 7.65321 10.0618 7.60626 9.97488 7.60626H5.84473Z"
        fill="currentColor"
      />
      <path
        d="M19.4881 8.14663C19.4881 8.25495 19.4003 8.34267 19.292 8.34267H13.8806C13.4465 8.34267 13.0474 8.10791 12.8377 7.72817L12.5457 7.19976C12.4736 7.0692 12.568 6.90857 12.7175 6.90857H18.25C18.9337 6.90857 19.4876 7.46294 19.4876 8.14621L19.4881 8.14663Z"
        fill="currentColor"
      />
    </svg>
  );
};

const SettingsRailIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="64 64 896 896"
    className={className}
    focusable="false"
    data-icon="setting"
    width="1em"
    height="1em"
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M924.8 625.7l-65.5-56c3.1-19 4.7-38.4 4.7-57.8s-1.6-38.8-4.7-57.8l65.5-56a32.03 32.03 0 009.3-35.2l-.9-2.6a443.74 443.74 0 00-79.7-137.9l-1.8-2.1a32.12 32.12 0 00-35.1-9.5l-81.3 28.9c-30-24.6-63.5-44-99.7-57.6l-15.7-85a32.05 32.05 0 00-25.8-25.7l-2.7-.5c-52.1-9.4-106.9-9.4-159 0l-2.7.5a32.05 32.05 0 00-25.8 25.7l-15.8 85.4a351.86 351.86 0 00-99 57.4l-81.9-29.1a32 32 0 00-35.1 9.5l-1.8 2.1a446.02 446.02 0 00-79.7 137.9l-.9 2.6c-4.5 12.5-.8 26.5 9.3 35.2l66.3 56.6c-3.1 18.8-4.6 38-4.6 57.1 0 19.2 1.5 38.4 4.6 57.1L99 625.5a32.03 32.03 0 00-9.3 35.2l.9 2.6c18.1 50.4 44.9 96.9 79.7 137.9l1.8 2.1a32.12 32.12 0 0035.1 9.5l81.9-29.1c29.8 24.5 63.1 43.9 99 57.4l15.8 85.4a32.05 32.05 0 0025.8 25.7l2.7.5a449.4 449.4 0 00159 0l2.7-.5a32.05 32.05 0 0025.8-25.7l15.7-85a350 350 0 0099.7-57.6l81.3 28.9a32 32 0 0035.1-9.5l1.8-2.1c34.8-41.1 61.6-87.5 79.7-137.9l.9-2.6c4.5-12.3.8-26.3-9.3-35zM788.3 465.9c2.5 15.1 3.8 30.6 3.8 46.1s-1.3 31-3.8 46.1l-6.6 40.1 74.7 63.9a370.03 370.03 0 01-42.6 73.6L721 702.8l-31.4 25.8c-23.9 19.6-50.5 35-79.3 45.8l-38.1 14.3-17.9 97a377.5 377.5 0 01-85 0l-17.9-97.2-37.8-14.5c-28.5-10.8-55-26.2-78.7-45.7l-31.4-25.9-93.4 33.2c-17-22.9-31.2-47.6-42.6-73.6l75.5-64.5-6.5-40c-2.4-14.9-3.7-30.3-3.7-45.5 0-15.3 1.2-30.6 3.7-45.5l6.5-40-75.5-64.5c11.3-26.1 25.6-50.7 42.6-73.6l93.4 33.2 31.4-25.9c23.7-19.5 50.2-34.9 78.7-45.7l37.9-14.3 17.9-97.2c28.1-3.2 56.8-3.2 85 0l17.9 97 38.1 14.3c28.7 10.8 55.4 26.2 79.3 45.8l31.4 25.8 92.8-32.9c17 22.9 31.2 47.6 42.6 73.6L781.8 426l6.5 39.9zM512 326c-97.2 0-176 78.8-176 176s78.8 176 176 176 176-78.8 176-176-78.8-176-176-176zm79.2 255.2A111.6 111.6 0 01512 614c-29.9 0-58-11.7-79.2-32.8A111.6 111.6 0 01400 502c0-29.9 11.7-58 32.8-79.2C454 401.6 482.1 390 512 390c29.9 0 58 11.6 79.2 32.8A111.6 111.6 0 01624 502c0 29.9-11.7 58-32.8 79.2z"></path>
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
  onShowFolder,
  onShowContacts,
  onShowScheduledTasks,
  isAgentPanelCollapsed,
  onToggleAgentPanel,
  onCollapseAgentPanel,
  isCollapsed,
  updateBadge,
  hideLogin,
}) => {
  const isWindows = window.electron.platform === 'win32';

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
      className="relative z-40 shrink-0 overflow-y-hidden overflow-x-visible  bg-surface-raised sidebar-transition"
      style={{ width: isCollapsed ? 0 : SIDEBAR_WIDTH }}
    >
      <div
        className={`relative flex h-full flex-col transition-opacity ease-out ${
          isCollapsed ? 'pointer-events-none opacity-0' : 'opacity-100'
        }`}
        style={{
          width: SIDEBAR_WIDTH,
          transitionDuration: '200ms',
        }}
      >
        {!isWindows && (
          <div
            className={`draggable sidebar-header-drag flex h-[30px] items-center justify-center mb-2`}
          >
            <PopiRailLogo />
          </div>
        )}
        <div className="non-draggable flex flex-col items-center gap-2 px-[7px] pt-0">
          <SidebarIconButton
            label={i18nService.t('cowork')}
            active={activeView === MainView.Cowork && !isAgentPanelCollapsed}
            onClick={() => {
              if (activeView === MainView.Cowork) {
                onToggleAgentPanel();
                return;
              }
              onShowCowork();
            }}
          >
            <ChatRailIcon className={sidebarIconClassName} />
          </SidebarIconButton>
          <SidebarIconButton
            label={i18nService.t('contactsTitle')}
            active={activeView === MainView.Contacts}
            onClick={() => {
              onShowContacts();
              onCollapseAgentPanel();
            }}
          >
            <TeamOutlinedIcon className={sidebarIconClassName + ' h-[20px] w-[20px]'} />
          </SidebarIconButton>
          <SidebarIconButton
            label={i18nService.t('scheduledTasks')}
            active={activeView === MainView.ScheduledTasks}
            onClick={() => {
              onShowScheduledTasks();
              onCollapseAgentPanel();
            }}
          >
            <SidebarAutomationIcon className={sidebarIconClassName} />
          </SidebarIconButton>
          <SidebarIconButton
            label={i18nService.t('skills')}
            active={activeView === MainView.Skills}
            onClick={() => {
              onShowSkills();
              onCollapseAgentPanel();
            }}
          >
            <LightningRailIcon className={sidebarIconClassName} />
          </SidebarIconButton>
          <SidebarIconButton
            label={i18nService.t('folder')}
            active={activeView === MainView.Folder}
            onClick={() => {
              onShowFolder();
              onCollapseAgentPanel();
            }}
          >
            <FolderRailIcon className={sidebarIconClassName} />
          </SidebarIconButton>
        </div>
        <div className="flex-1" />
        <div className="non-draggable flex flex-col items-center gap-2 px-[7px] pb-3">
          {updateBadge && (
            <div className="flex min-h-10 w-10 items-center justify-center overflow-hidden rounded-[9px] border border-border bg-surface-raised px-[5px] py-0.5">
              {updateBadge}
            </div>
          )}
          <SidebarIconButton label={i18nService.t('settings')} onClick={onShowSettings}>
            <SettingsRailIcon className="h-[22px] w-[22px] shrink-0" />
          </SidebarIconButton>
          {!hideLogin && (
            <div className="flex h-9 w-9 items-center justify-center">
              <LoginButton iconOnly />
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
