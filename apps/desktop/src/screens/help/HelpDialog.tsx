// Help (S7.5): bundled topics on the left, the chosen one on the right; the keyboard shortcut list
// is one click away. About HAFB (S8.4) adds the version and the third-party licenses.
import { useState } from 'react';
import { APP_VERSION, loadNotices } from '../../shell/appInfo.ts';
import { Button } from '../../ui/Button.tsx';
import { cx } from '../../ui/cx.ts';
import { Dialog } from '../../ui/Dialog.tsx';
import { HELP_TOPICS } from './helpTopics.ts';
import styles from './Help.module.css';

export function HelpDialog({ onClose, onShortcuts, initial = 'start' }: { onClose: () => void; onShortcuts: () => void; initial?: string }) {
  const [chosen, setChosen] = useState(initial);
  const topic = HELP_TOPICS.find((t) => t.id === chosen) ?? HELP_TOPICS[0];
  return (
    <Dialog
      open
      onClose={onClose}
      size="large"
      title="Help"
      footer={
        <>
          <Button onClick={onShortcuts}>Keyboard shortcuts</Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      <div className={styles.layout}>
        <ul className={styles.topics} aria-label="Help topics">
          {HELP_TOPICS.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className={cx(styles.topic, t.id === topic?.id && styles.topicOn)}
                aria-current={t.id === topic?.id ? 'true' : undefined}
                onClick={() => {
                  setChosen(t.id);
                }}
              >
                {t.title}
              </button>
            </li>
          ))}
        </ul>
        {topic && (
          <article key={topic.id} className={styles.article} aria-labelledby="help-topic-title" tabIndex={0}>
            <h3 id="help-topic-title">{topic.title}</h3>
            {topic.about && <p>Version {APP_VERSION}</p>}
            {topic.blocks.map((b, i) =>
              typeof b === 'string' ? (
                <p key={i}>{b}</p>
              ) : (
                <ul key={i}>
                  {b.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ),
            )}
            {topic.about && <ThirdPartyLicenses />}
          </article>
        )}
      </div>
    </Dialog>
  );
}

function ThirdPartyLicenses() {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  if (text !== null) {
    return (
      <pre className={styles.notices} aria-label="Third-party licenses">
        {text}
      </pre>
    );
  }
  return (
    <>
      <Button
        onClick={() => {
          loadNotices().then(setText, () => {
            setFailed(true);
          });
        }}
      >
        Show third-party licenses
      </Button>
      {failed && <p role="alert">The license list couldn’t be loaded. It’s also in THIRD-PARTY-NOTICES.txt next to HAFB.exe.</p>}
    </>
  );
}
