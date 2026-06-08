import React, { ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error: error }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const message = this.state.error?.message?.trim() || 'Unexpected application error.'

      // You can render any custom fallback UI
      return (
        <div className="flex min-h-screen items-center justify-center bg-surface-container">
          <div className="rounded-lg p-6 max-w-md bg-surface-container-high mx-auto text-center">
            <div className="max-w-md">
              <h1 className="text-4xl text-on-surface">Error occured</h1>
              <p className="py-6 text-on-surface-variant">{message}</p>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
