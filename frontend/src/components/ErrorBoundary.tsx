import { Component, type ErrorInfo, type ReactNode } from "react";

import { BRAND_NAME } from "../config";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/** Last-resort catch for rendering errors (005 R1): a branded fallback with a
 * reload action instead of a blank page. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unrecoverable render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="crash">
        <div className="crash__card" role="alert">
          <img src="/brand/livenear-logo.svg" alt={BRAND_NAME} className="crash__logo" />
          <p className="crash__msg">Something went wrong loading this page.</p>
          <button
            type="button"
            className="crash__reload"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
