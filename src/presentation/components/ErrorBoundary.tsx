import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Alert } from '@/presentation/components/Alert'

interface ErrorBoundaryProps {
  children: ReactNode
  /** Título exibido no fallback. */
  title?: string
  /** Fallback customizado (opcional). */
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Limite de erro de renderização (RNF04/RNF08).
 *
 * Garante que a falha de uma seção (ex.: um gráfico com carregamento sob
 * demanda que não pôde ser baixado offline) **não** derrube a página inteira —
 * o restante da interface continua utilizável.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Registra para diagnóstico — nunca propaga o erro para a árvore acima.
    console.error('ErrorBoundary capturou um erro:', error, info.componentStack)
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <Alert variant="info" title={this.props.title ?? 'Conteúdo indisponível'}>
            Não foi possível carregar esta seção agora. Verifique sua conexão e tente novamente.
          </Alert>
        )
      )
    }
    return this.props.children
  }
}
