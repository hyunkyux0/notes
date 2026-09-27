import { useState } from "react";
import { VaultPanel } from "./vault/VaultPanel";

const sections = {
  Notebook: {
    title: "A quiet place to think.",
    description: "Keep your ideas in Markdown files on your computer.",
    next: "Note creation and editing are coming next.",
  },
  Reviews: {
    title: "Make room to remember.",
    description: "Return to your notes after 3, 7, and 30 days.",
    next: "Review scheduling and Google Calendar connection are planned for later milestones.",
  },
  Settings: {
    title: "Your notes, your rhythm.",
    description: "Choose when and how you want to review.",
    next: "Calendar, review-time, and notification settings are coming later.",
  },
};

export function App() {
  const [section, setSection] = useState<keyof typeof sections>("Notebook");
  const content = sections[section];

  return (
    <div className="workspace">
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <aside>
        <div className="brand">
          <span aria-hidden="true">✳</span> Local Notes
        </div>
        <nav aria-label="Main navigation">
          {(Object.keys(sections) as (keyof typeof sections)[]).map((name) => (
            <button
              key={name}
              type="button"
              aria-pressed={section === name}
              onClick={() => setSection(name)}
            >
              {name}
            </button>
          ))}
        </nav>
        <p className="sidebar-caption">Space for your next idea.</p>
      </aside>
      <main id="content" tabIndex={-1}>
        <header>
          <span>{section}</span>
          <span className="badge">Early preview</span>
        </header>
        <section className="welcome" aria-labelledby="welcome-title">
          <p className="eyebrow">LOCAL NOTES</p>
          <h1 id="welcome-title">{content.title}</h1>
          <p className="description">{content.description}</p>
          {section !== "Reviews" && <VaultPanel />}
          <p className="milestone">{content.next}</p>
        </section>
        <footer>Stored locally. Made to revisit.</footer>
      </main>
    </div>
  );
}
