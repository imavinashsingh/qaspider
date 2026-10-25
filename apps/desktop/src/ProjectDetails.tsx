import { useEffect, useState } from 'react';
import type { Project, ProjectMutation, ProjectTopic } from './chat-types.js';

/** Explicit user context capture until the model-backed supervisor is integrated. */
export function ProjectDetails({ project, busy, save }: { project: Project; busy: boolean; save: (action: ProjectMutation['action']) => Promise<void> }) {
  const [title, setTitle] = useState(project.title), [description, setDescription] = useState(project.description);
  const [topic, setTopic] = useState<ProjectTopic>(project.nextQuestion?.topic ?? 'purpose'), [text, setText] = useState('');
  useEffect(() => {
    setTitle(project.title); setDescription(project.description); setTopic(project.nextQuestion?.topic ?? 'purpose'); setText('');
  }, [project.version]);
  const editable = project.id !== 'legacy' && !project.archived && !busy;
  return <details className="project-details card">
    <summary>Project profile{project.archived ? ' · Archived' : ''}</summary>
    <p>Project context stays here across restarts. The Main Agent uses a bounded selection of these notes when you chat. Leave credentials out.</p>
    <form className="workspace-form" onSubmit={event => { event.preventDefault(); void save({ type: 'profile', title, description }); }}>
      <label>Project name<input value={title} onChange={event => setTitle(event.target.value)} disabled={!editable} required maxLength={200}/></label>
      <label htmlFor="project-description">Project description</label><textarea id="project-description" value={description} onChange={event => setDescription(event.target.value)} disabled={!editable} maxLength={4000}/>
      <button disabled={!editable || (title === project.title && description === project.description)}>Save project profile</button>
    </form>
    <p className="hint">These are user statements, awaiting validation against sources and approved requirements. Environment notes do not authorize browser actions. Leave secrets and credentials out.</p>
    {project.nextQuestion ? <p data-testid="onboarding-question">Optional: {project.nextQuestion.text}</p> : <p data-testid="onboarding-question">Optional questions answered or skipped. You can add more context at any time.</p>}
    <form className="workspace-form" onSubmit={event => { event.preventDefault(); void save({ type: 'note', topic, text }); }}>
      <label>Context topic<select value={topic} disabled={!editable} onChange={event => setTopic(event.target.value as ProjectTopic)}>
        <option value="purpose">Application purpose</option><option value="domain">Business domain</option><option value="roles">User roles</option><option value="environments">Testing environments</option><option value="sources">Documentation</option><option value="setup">Setup requirements</option>
      </select></label>
      <label htmlFor="project-context-note">Project context note</label><textarea id="project-context-note" value={text} onChange={event => setText(event.target.value)} disabled={!editable} maxLength={4000} required placeholder="Describe your application in your own words."/>
      <button disabled={!editable || !text.trim()}>Save context note</button>
    </form>
    {project.nextQuestion && <button className="secondary" disabled={!editable} onClick={() => void save({ type: 'skip', topic: project.nextQuestion!.topic })}>Skip this optional question</button>}
    <ul aria-label="Saved project context">{project.notes.map(note => <li key={note.id}><strong>{note.topic}</strong>: {note.body} <small>· User statement</small></li>)}</ul>
    {project.notes.length === 100 && <p>Showing the latest 100 notes. Earlier notes remain in local storage.</p>}
    {project.id !== 'legacy' && <button className="secondary" disabled={busy} onClick={() => void save({ type: 'archive', archived: !project.archived })}>{project.archived ? 'Restore project' : 'Archive project'}</button>}
    <p className="hint">Archiving organizes the project list and preserves its plans, reports and conversations.</p>
  </details>;
}
