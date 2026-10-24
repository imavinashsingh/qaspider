import { type ReactNode } from 'react';
import { Icon, type V3View } from './ui.js';

interface AppShellProps {
  view: V3View;
  projects: { id: string; name: string }[];
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNavigate: (v: V3View) => void;
  onLogout: () => void;
  children: ReactNode;
}

const navItems: { view: V3View; label: string }[] = [
  { view: 'orchestrator', label: 'Orchestrator' },
  { view: 'tickets', label: 'QA Tickets' },
  { view: 'knowledge', label: 'Knowledge' },
  { view: 'settings', label: 'Settings' },
];

export function AppShell({ view, projects, selectedProjectId, onSelectProject, onNavigate, onLogout, children }: AppShellProps) {
  return (
    <div className="v3-shell">
      <a className="skip-link" href="#v3-content">Skip to content</a>
      <aside className="v3-sidebar">
        <div className="brand">
          <span className="brand-mark">Q</span>
          <div>
            <strong>QASpider</strong>
            <small>QA STUDIO · V3</small>
          </div>
        </div>
        <nav className="v3-nav" aria-label="Studio navigation">
          {navItems.map(item => (
            <button
              key={item.view}
              className={`v3-nav-item${view === item.view ? ' active' : ''}`}
              aria-current={view === item.view ? 'page' : undefined}
              onClick={() => onNavigate(item.view)}
            >
              <Icon name={item.view} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="v3-sidebar-bottom">
          <button className="v3-nav-item" onClick={onLogout} aria-label="Logout">
            <Icon name="logout" />
            <span>Logout</span>
          </button>
        </div>
      </aside>
      <div className="v3-main">
        <header className="v3-header">
          <span className="brand-mark" aria-hidden="true">Q</span>
          <div className="v3-project-select">
            <small>PROJECT</small>
            <select
              aria-label="Active project"
              value={selectedProjectId ?? ''}
              onChange={e => onSelectProject(e.target.value)}
            >
              <option value="" disabled>Select project</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <span className="v3-header-sep" aria-hidden="true" />
          <span className="v3-header-page">{navItems.find(n => n.view === view)?.label}</span>
        </header>
        <div className="v3-content" id="v3-content">
          {children}
        </div>
      </div>
    </div>
  );
}
