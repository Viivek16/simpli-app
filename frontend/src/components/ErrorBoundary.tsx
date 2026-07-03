import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}
interface State {
  hasError: boolean;
}

/**
 * Catches render-time errors in its subtree and shows `fallback` instead of
 * crashing/freezing the entire app. Critical around the WebGL <Canvas>: without
 * it, any throw in the 3D tree wedges the main thread and the DOM overlay
 * (modals, inputs, buttons) becomes unresponsive.
 *
 * NOTE: React error boundaries do NOT catch errors thrown inside useFrame /
 * requestAnimationFrame. Those must be prevented with guards in the frame
 * callbacks themselves (done in the scene components).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[SIMPLI] Scene error caught by boundary:', error);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
