import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button.tsx';
import styles from './ErrorBoundary.module.css';
import { describeError, errorDetails } from './errors.ts';
import { Icon } from './Icon.tsx';

interface Props {
  children: ReactNode;
  /** Shown in the panel title: "The Plan screen hit a problem". */
  area?: string;
  /** Called once per caught error (e.g. to log it to the session's command log later). */
  onError?: (error: unknown, info: ErrorInfo) => void;
  /** Changing this key resets the boundary (e.g. the route), so navigating away recovers. */
  resetKey?: string;
}

interface State {
  error: unknown;
  key: string | undefined;
  copied: boolean;
}

/**
 * Catches a render error in one region of the app and shows a recoverable panel instead of a blank
 * window. The rest of the app keeps working; nothing about the plan file is touched.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, key: undefined, copied: false };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown error'), copied: false };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null, copied: false };
    return null;
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private readonly retry = (): void => {
    this.setState({ error: null, copied: false });
  };

  private readonly copy = (): void => {
    void navigator.clipboard.writeText(errorDetails(this.state.error)).then(
      () => {
        this.setState({ copied: true });
      },
      () => undefined,
    );
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const d = describeError(this.state.error);
    const where = this.props.area === undefined ? 'This screen' : `The ${this.props.area}`;
    return (
      <div className={styles.panel} role="alert">
        <Icon name="warning" size={20} className={styles.icon} />
        <div className={styles.text}>
          <h2 className={styles.title}>{where} hit a problem</h2>
          <p className={styles.message}>
            {d.title}. {d.message}
          </p>
          <p className={styles.note}>Your plan file is safe: nothing was saved from this screen after the problem.</p>
          <div className={styles.actions}>
            <Button variant="primary" icon="sync" onClick={this.retry}>
              Try again
            </Button>
            <Button icon="list" onClick={this.copy}>
              {this.state.copied ? 'Copied' : 'Copy details'}
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
